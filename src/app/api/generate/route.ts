// Claude API proxy — all AI calls from the browser go through here.
// The API key lives only on the server side; the browser never sees it.
//
// How it works (think of it like a walkie-talkie relay):
//   Browser → POST /api/generate → this route → Claude API → SSE stream back to browser
//
// SSE = Server-Sent Events: a one-way stream of text chunks from server to browser.
// The browser reads each chunk as it arrives and appends it to the UI live.

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { NextRequest } from 'next/server'
import type { ModelConfig } from '@/lib/types'

// What the browser sends in the POST body
interface GenerateRequest {
  agentPrompt: string         // the ARS agent's system prompt (from /lib/ars-agents/)
  userMessage: string         // the user message / task for that agent
  modelConfig?: ModelConfig   // optional: which provider + model to use; defaults to Claude Sonnet 4.5
  maxTokens?: number          // optional token limit; defaults to 8096
  // optional: research-stage progress info ("Agent N of 5"). When present and well-formed,
  // we echo it back once as a 'progress' SSE frame so the client can show step status.
  progressMeta?: { agentName: string; completed: number; total: number }
  // ── P11 IR-03: data-access guard fields (all optional — pre-P11 callers omit them) ──
  // dataAccessLevel labels what the calling agent is ALLOWED to see:
  //   'raw'           — may read raw, un-verified material (default for most agents)
  //   'verified_only' — must NOT run until the paper has reached a verified stage
  // agentId / pipelineStatus let the server decide whether a verified_only agent is
  // being called at a LEGAL point in the pipeline (see the IR-03 guard in POST).
  dataAccessLevel?: 'raw' | 'verified_only'
  agentId?: string
  pipelineStatus?: string
}

// ── P11 IR-03 (Iron Rule 03): a 'verified_only' agent may run ONLY once the paper
// has reached a stage where verified material exists. This is the editorial-board
// rule made mechanical: a peer reviewer / coach / reviser must never see (or score)
// a draft that has not yet been through the integrity gate.
//
// VERIFIED_ONLY_OK is the set of pipelineStatus values where a verified_only consumer
// is legally allowed to run (everything from peer review onward through finalize).
const VERIFIED_ONLY_OK = new Set<string>([
  'running-peer-review',
  'awaiting-review-decision',
  'running-coaching',
  'running-revision',
  'running-re-review',
  'running-final-gate',
  'running-finalize',
])

// The integrity verification agent is the EXEMPTION: it is itself verified_only, yet it
// is the agent that TURNS a raw draft INTO verified material. Blocking it before its own
// stage would be a chicken-and-egg deadlock (nothing could ever become verified). So it is
// always allowed to run — including at running-integrity-gate (Stage 2.5) and
// running-final-gate (Stage 4.5), which are NOT in VERIFIED_ONLY_OK.
const INTEGRITY_AGENT_EXEMPT = 'integrity_verification_agent'

// Type guard: is this value a well-formed progressMeta object?
// Like a parity check on an incoming packet — if any field is the wrong type, reject it.
function isValidProgressMeta(value: unknown): value is { agentName: string; completed: number; total: number } {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.agentName === 'string' &&
    typeof v.completed === 'number' &&
    typeof v.total === 'number'
  )
}

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  label: 'Claude Sonnet 4.5 (Anthropic)',
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function normalizeMaxTokens(value: unknown): number {
  if (!Number.isInteger(value)) return 8096
  return Math.min(Math.max(value as number, 1), 32000)
}

function isLocalBaseUrl(baseURL: string): boolean {
  try {
    const host = new URL(baseURL).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  try {
    let body: GenerateRequest
    try {
      body = (await req.json()) as GenerateRequest
    } catch {
      return new Response(
        JSON.stringify({ error: 'Request body must be valid JSON' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const { agentPrompt, userMessage } = body
    const maxTokens = normalizeMaxTokens(body.maxTokens)

    // Which model to talk to. If the browser didn't pick one, fall back to Claude Sonnet 4.5.
    // Think of modelConfig as the "channel" the walkie-talkie is tuned to.
    const config: ModelConfig = body.modelConfig ?? DEFAULT_MODEL_CONFIG

    if (!agentPrompt || !userMessage) {
      return new Response(
        JSON.stringify({ error: 'agentPrompt and userMessage are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!config.model) {
      return new Response(
        JSON.stringify({ error: 'modelConfig.model is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (config.provider !== 'anthropic' && config.provider !== 'openai-compatible') {
      return new Response(
        JSON.stringify({ error: `Unsupported model provider: ${String(config.provider)}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (config.provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY is not set. Create .env.local with ANTHROPIC_API_KEY=sk-ant-...' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (config.provider === 'openai-compatible') {
      const baseURL = config.baseURL ?? 'https://api.openai.com/v1'
      const apiKey = process.env.OPENAI_API_KEY ?? config.apiKey
      if (!apiKey && !isLocalBaseUrl(baseURL)) {
        return new Response(
          JSON.stringify({ error: 'OPENAI_API_KEY is not set for this OpenAI-compatible cloud model.' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
      }
    }

    // ── P11 IR-03 guard: refuse a verified_only agent at an illegal stage ────────
    // If the caller declares itself verified_only, it may only run when:
    //   (a) it is the integrity verification agent (the EXEMPTION — it creates verified
    //       material, so it must be allowed even at running-integrity-gate / running-final-gate), OR
    //   (b) the current pipelineStatus is one of the legal post-integrity stages.
    // Otherwise we reject with 403 — the agent is trying to read/score material before
    // the integrity gate has produced any verified content. A 'raw' caller (the default)
    // skips this entirely, so all pre-P11 callers are unaffected.
    if (
      body.dataAccessLevel === 'verified_only' &&
      body.agentId !== INTEGRITY_AGENT_EXEMPT &&
      !VERIFIED_ONLY_OK.has(body.pipelineStatus ?? '')
    ) {
      return new Response(
        JSON.stringify({
          error:
            'IR-03: verified_only agent called before its legal stage (pipelineStatus=' +
            (body.pipelineStatus ?? 'unknown') +
            ')',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // One encoder shared by both provider branches below.
    // SSE format: each message is "data: <json>\n\n" — a blank line separates frames.
    // The browser reads these with EventSource or a manual fetch reader.
    const encoder = new TextEncoder()

    // Build the ReadableStream. The body inside depends on which provider we picked,
    // but BOTH branches emit the exact same SSE frames + [DONE] sentinel so the
    // browser-side reader never has to care which model produced the text.
    const readable = new ReadableStream({
      async start(controller) {
        const send = (payload: object) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        }

        // IR-04: before any provider work, echo the research-stage progress once so the
        // client can render "Agent N of 5". Malformed progressMeta is silently ignored.
        if (isValidProgressMeta(body.progressMeta)) {
          send({ progress: body.progressMeta })
        }

        try {
          if (config.provider === 'openai-compatible') {
            // OpenAI-compatible providers: OpenAI itself, plus local servers that speak the
            // same wire protocol (Ollama at :11434/v1, LM Studio at :1234/v1).
            // Build the client lazily, per request — like grabbing the right radio handset.
            // Key priority is SERVER-FIRST: a real cloud key set as OPENAI_API_KEY on the
            // server always wins, so a key arriving in the request body can never override it.
            const baseURL = config.baseURL ?? 'https://api.openai.com/v1'
            const client = new OpenAI({
              baseURL,
              apiKey: process.env.OPENAI_API_KEY ?? config.apiKey ?? 'local',
            })

            // OpenAI's chat completions API uses a "system" + "user" message pair instead of
            // Anthropic's separate system field, but the streamed text comes back the same way.
            const stream = await client.chat.completions.create({
              model: config.model,
              stream: true,
              max_tokens: maxTokens,
              messages: [
                { role: 'system', content: agentPrompt },
                { role: 'user', content: userMessage },
              ],
            })

            for await (const chunk of stream) {
              // Each chunk carries a small slice of text in delta.content (may be empty/undefined).
              const text = chunk.choices[0]?.delta?.content
              if (text) send({ text })
            }
          } else {
            // Anthropic branch (the default). The API key NEVER leaves the server —
            // it comes only from process.env, never from the request body.
            const anthropic = new Anthropic({
              apiKey: process.env.ANTHROPIC_API_KEY,
            })

            // Open a streaming connection to the Claude API inside the response stream.
            // If setup fails, the browser still receives a normal SSE error frame.
            const stream = await anthropic.messages.stream({
              model: config.model,
              max_tokens: maxTokens,
              system: agentPrompt,
              messages: [{ role: 'user', content: userMessage }],
            })

            for await (const chunk of stream) {
              if (
                chunk.type === 'content_block_delta' &&
                chunk.delta.type === 'text_delta'
              ) {
                send({ text: chunk.delta.text })
              }
            }
          }

          // Signal the browser that the stream is complete
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } catch (err) {
          const message = getErrorMessage(err)
          console.error('[/api/generate] stream error:', err)
          send({ error: message })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
        'X-Accel-Buffering': 'no',   // prevents Nginx from buffering the stream
      },
    })
  } catch (err) {
    console.error('[/api/generate] error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// Tell Next.js this route can run longer than the default 10s Vercel limit
export const maxDuration = 300  // 5 minutes max per request
