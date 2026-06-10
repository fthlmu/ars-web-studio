// /api/chat — SSE endpoint for the interactive agent chat panel (P20).
// Accepts a conversation thread + paper context, streams a Claude response.
// Same SSE pattern as /api/generate: `data: {"text":"..."}\n\n` frames + `data: [DONE]\n\n`.

import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'

export const maxDuration = 120

const CHAT_SYSTEM_PROMPT = `You are an AI writing assistant helping a user write an academic paper. You are embedded in the paper-generation pipeline. The user can ask you questions about the paper, request style changes, suggest content additions, or ask for clarifications about what you're doing.

When the user gives you an instruction that applies to a section being written or about to be written, acknowledge it clearly and explain how it will be applied. Keep responses concise and focused on the paper.

You have access to:
- The paper configuration (topic, type, citation format, etc.)
- The outline (if generated)
- Completed sections (if any)
- The current pipeline stage

Be helpful, direct, and academic in tone.`

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json()
  const { messages, context, model } = body as {
    messages: { role: 'user' | 'assistant'; content: string }[]
    context: {
      topic?: string
      paperType?: string
      outline?: string
      completedSections?: string[]
      currentStage?: string
    }
    model?: string
  }

  // Build context block injected into the system prompt
  const contextParts: string[] = []
  if (context.topic) contextParts.push(`Paper topic: ${context.topic}`)
  if (context.paperType) contextParts.push(`Paper type: ${context.paperType}`)
  if (context.currentStage) contextParts.push(`Current pipeline stage: ${context.currentStage}`)
  if (context.outline) contextParts.push(`Outline:\n${context.outline}`)
  if (context.completedSections && context.completedSections.length > 0) {
    // Limit context size: only include the last 5 sections to stay within token budget
    const recent = context.completedSections.slice(-5)
    contextParts.push(`Completed sections (latest ${recent.length}):\n${recent.join('\n---\n')}`)
  }

  const systemPrompt = contextParts.length > 0
    ? `${CHAT_SYSTEM_PROMPT}\n\n--- Paper Context ---\n${contextParts.join('\n\n')}`
    : CHAT_SYSTEM_PROMPT

  const client = new Anthropic({ apiKey })

  const stream = client.messages.stream({
    model: model || 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
            )
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`)
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
