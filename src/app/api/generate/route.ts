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
