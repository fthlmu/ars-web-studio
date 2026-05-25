// Claude API proxy — all AI calls from the browser go through here.
// The API key lives only on the server side; the browser never sees it.
//
// How it works (think of it like a walkie-talkie relay):
//   Browser → POST /api/generate → this route → Claude API → SSE stream back to browser
//
// SSE = Server-Sent Events: a one-way stream of text chunks from server to browser.
// The browser reads each chunk as it arrives and appends it to the UI live.

import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'

// One shared client instance (reused across requests in the same worker process)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// What the browser sends in the POST body
interface GenerateRequest {
  agentPrompt: string   // the ARS agent's system prompt (from /lib/ars-agents/)
  userMessage: string   // the user message / task for that agent
  model?: string        // optional model override; defaults to claude-sonnet-4-5
  maxTokens?: number    // optional token limit; defaults to 8096
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as GenerateRequest
    const { agentPrompt, userMessage, model = 'claude-sonnet-4-5', maxTokens = 8096 } = body

    if (!agentPrompt || !userMessage) {
      return new Response(
        JSON.stringify({ error: 'agentPrompt and userMessage are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Open a streaming connection to the Claude API
    const stream = await anthropic.messages.stream({
      model,
      max_tokens: maxTokens,
      system: agentPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    // Build a ReadableStream that forwards each text chunk to the browser as SSE.
    // SSE format: each message is "data: <json>\n\n"
    // The browser reads these with EventSource or a manual fetch reader.
    const encoder = new TextEncoder()

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (
              chunk.type === 'content_block_delta' &&
              chunk.delta.type === 'text_delta'
            ) {
              const payload = JSON.stringify({ text: chunk.delta.text })
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
            }
          }
          // Signal the browser that the stream is complete
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (err) {
          // Stream error — send an error event then close
          const errPayload = JSON.stringify({ error: String(err) })
          controller.enqueue(encoder.encode(`data: ${errPayload}\n\n`))
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',   // prevents Nginx from buffering the stream
      },
    })
  } catch (err) {
    console.error('[/api/generate] error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal server error', detail: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// Tell Next.js this route can run longer than the default 10s Vercel limit
export const maxDuration = 300  // 5 minutes max per request
