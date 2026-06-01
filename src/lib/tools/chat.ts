// Quick Tools — multi-turn chat transport (QT7).
//
// The interactive sibling of callAgent() in src/lib/ars-client.ts. callAgent sends one
// user message to /api/generate; streamChat sends a whole conversation to /api/tools-chat
// so the interactive modes (#4 Socratic, #9 Plan, #20 Guided) can hold a back-and-forth.
//
// The SSE-reading loop below is copied VERBATIM from callAgent — same reader/decoder,
// same split("\n\n"), same "data: " prefix handling, same [DONE] sentinel, same
// error-frame-throws behaviour — because /api/tools-chat emits identical frames.

import type { ModelConfig } from '@/lib/types'

// One conversation turn. Mirrors the route's ChatMessage shape.
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * POSTs a full conversation to /api/tools-chat and streams the assistant reply back.
 *
 * @param systemPrompt - the ARS SKILL system prompt (resolveSystemPrompt(mode))
 * @param messages     - the full conversation so far (must end with a user turn)
 * @param onChunk      - called with each text chunk as it arrives (for live UI updates)
 * @param modelConfig  - which model to route to. Optional — server defaults to Claude Sonnet 4.5.
 * @returns            - the full accumulated assistant text
 */
export async function streamChat(
  systemPrompt: string,
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig,
): Promise<string> {
  const response = await fetch('/api/tools-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt, messages, modelConfig }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(`API error ${response.status}: ${err.error ?? response.statusText}`)
  }

  if (!response.body) {
    throw new Error('No response body from /api/tools-chat')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // SSE messages are separated by double newlines: "data: {...}\n\n"
    const lines = buffer.split('\n\n')
    buffer = lines.pop() ?? ''   // keep the incomplete last chunk for next iteration

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (payload === '[DONE]') break

      let parsed: { text?: string; error?: string }
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue // skip truly malformed JSON frames
      }
      if (parsed.error) throw new Error(parsed.error)
      if (parsed.text) {
        fullText += parsed.text
        onChunk(parsed.text)
      }
    }
  }

  return fullText
}
