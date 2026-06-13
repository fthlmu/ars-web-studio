// Claude API proxy for the Stage 3→4 EIC COACHING dialogue (Phase P12).
//
// This is the sibling of /api/tools-chat/route.ts. OQ-07 (the one real design call in
// P12) asked: should the coaching loop re-send the whole transcript baked into one user
// message every turn, or carry it as a structured conversation history? Answer: a
// dedicated route that takes `conversationHistory` (an array of user/assistant turns),
// exactly like /api/tools-chat — so the EIC coach holds a real multi-turn back-and-forth
// without us re-stuffing the history into a single prompt each round.
//
// Everything else — the SSE framing, the [DONE] sentinel, the provider branches, the
// server-first key checks, the headers — is identical to /api/tools-chat, so the
// browser-side reader (lib/coaching.ts) parses it exactly like streamChat parses
// /api/tools-chat.
//
//   Browser → POST /api/coaching → this route → Claude API → SSE stream back to browser

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { NextRequest } from 'next/server'
import type { ModelConfig } from '@/lib/types'

// One conversation turn, mirroring the Anthropic/OpenAI message shape. The browser maps
// its CoachingMessage ('eic' | 'user') onto this ('assistant' | 'user') before sending —
// the EIC coach is the assistant role to the model.
interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// What the browser sends in the POST body. `conversationHistory` is the OQ-07 contract.
interface CoachingRequest {
  systemPrompt: string                // the EIC Socratic coaching system prompt
  conversationHistory: ChatMessage[]  // the full dialogue so far (must end with a user turn)
  modelConfig?: ModelConfig           // optional: which provider + model; defaults to Claude Sonnet 4.5
  maxTokens?: number                  // optional token limit; defaults to 8096
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

// Validate that the history is a non-empty array of well-formed user/assistant turns.
function isValidHistory(value: unknown): value is ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every(
    (m) =>
      m &&
      typeof m === 'object' &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string',
  )
}

export async function POST(req: NextRequest) {
  try {
    let body: CoachingRequest
    try {
      body = (await req.json()) as CoachingRequest
    } catch {
      return new Response(
        JSON.stringify({ error: 'Request body must be valid JSON' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const { systemPrompt, conversationHistory } = body
    const maxTokens = normalizeMaxTokens(body.maxTokens)

    // Which model to talk to. If the browser didn't pick one, fall back to Claude Sonnet 4.5.
    const config: ModelConfig = body.modelConfig ?? DEFAULT_MODEL_CONFIG

    if (!systemPrompt || !isValidHistory(conversationHistory)) {
      return new Response(
        JSON.stringify({ error: 'systemPrompt and a non-empty conversationHistory[] (role/content) are required' }),
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

    // One encoder shared by both provider branches below.
    // SSE format: each message is "data: <json>\n\n" — a blank line separates frames.
    const encoder = new TextEncoder()

    // Build the ReadableStream. BOTH branches emit the exact same SSE frames + [DONE]
    // sentinel so the browser-side reader never has to care which model produced the text.
    const readable = new ReadableStream({
      async start(controller) {
        const send = (payload: object) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        }

        try {
          if (config.provider === 'openai-compatible') {
            // OpenAI-compatible providers: OpenAI itself, plus local servers (Ollama, LM Studio).
            // Key priority is SERVER-FIRST — a key in the request body can never override the env key.
            const baseURL = config.baseURL ?? 'https://api.openai.com/v1'
            const client = new OpenAI({
              baseURL,
              apiKey: process.env.OPENAI_API_KEY ?? config.apiKey ?? 'local',
            })

            // OpenAI puts the system prompt as the first message, then the conversation turns.
            const stream = await client.chat.completions.create({
              model: config.model,
              stream: true,
              max_tokens: maxTokens,
              messages: [
                { role: 'system', content: systemPrompt },
                ...conversationHistory,
              ],
            })

            for await (const chunk of stream) {
              const text = chunk.choices[0]?.delta?.content
              if (text) send({ text })
            }
          } else {
            // Anthropic branch (the default). The API key NEVER leaves the server.
            const anthropic = new Anthropic({
              apiKey: process.env.ANTHROPIC_API_KEY,
            })

            // Anthropic takes the system prompt in its own `system` field and the
            // conversation turns in `messages`.
            const stream = await anthropic.messages.stream({
              model: config.model,
              max_tokens: maxTokens,
              system: systemPrompt,
              messages: conversationHistory,
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
          console.error('[/api/coaching] stream error:', err)
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
    console.error('[/api/coaching] error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// Tell Next.js this route can run longer than the default 10s Vercel limit
export const maxDuration = 300  // 5 minutes max per request
