// Stage 3→4 coaching transport (P12).
//
// The coaching sibling of streamChat() in src/lib/tools/chat.ts. streamChat POSTs to
// /api/tools-chat; streamCoaching POSTs to /api/coaching so the EIC Socratic coach can
// hold a multi-turn back-and-forth (OQ-07: history carried as `conversationHistory`,
// not re-stuffed into one prompt each round).
//
// The SSE-reading loop below is copied VERBATIM from streamChat / callAgent — same
// reader/decoder, same split("\n\n"), same "data: " prefix handling, same [DONE]
// sentinel, same error-frame-throws behaviour — because /api/coaching emits identical
// frames.

import type { ModelConfig, CoachingMessage } from '@/lib/types'

// The wire shape /api/coaching expects. The model sees the EIC coach as the assistant
// role, so we map our domain 'eic' → 'assistant' before sending.
interface WireMessage {
  role: 'user' | 'assistant'
  content: string
}

function toWire(history: CoachingMessage[]): WireMessage[] {
  return history.map((m) => ({
    role: m.role === 'eic' ? 'assistant' : 'user',
    content: m.content,
  }))
}

/**
 * POSTs the coaching dialogue to /api/coaching and streams the EIC reply back.
 *
 * @param systemPrompt        - the EIC Socratic coaching system prompt
 * @param history             - the full dialogue so far (must end with a user turn)
 * @param onChunk             - called with each text chunk as it arrives (live UI updates)
 * @param modelConfig         - which model to route to. Optional — server defaults to Claude Sonnet 4.5.
 * @returns                   - the full accumulated EIC reply text
 */
export async function streamCoaching(
  systemPrompt: string,
  history: CoachingMessage[],
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig,
): Promise<string> {
  const response = await fetch('/api/coaching', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemPrompt,
      conversationHistory: toWire(history),
      modelConfig,
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(`API error ${response.status}: ${err.error ?? response.statusText}`)
  }

  if (!response.body) {
    throw new Error('No response body from /api/coaching')
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
