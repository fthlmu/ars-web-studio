// Agent chat client transport (P20).
// Calls /api/chat and streams the response chunk by chunk via SSE.
// Same fetch+SSE pattern used by the coaching transport (src/lib/coaching.ts).

import type { ModelConfig } from './types'

export interface ChatContext {
  topic?: string
  paperType?: string
  outline?: string
  completedSections?: string[]
  currentStage?: string
}

export interface ChatRequestMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Stream a chat response from the /api/chat endpoint.
 * Returns the full accumulated response text.
 */
export async function streamAgentChat(
  messages: ChatRequestMessage[],
  context: ChatContext,
  onChunk: (chunk: string) => void,
  modelConfig?: ModelConfig
): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      context,
      model: modelConfig?.model,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Chat API error ${res.status}: ${text}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let accumulated = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    const lines = chunk.split('\n')

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (payload === '[DONE]') continue
      try {
        const parsed = JSON.parse(payload)
        if (parsed.error) throw new Error(parsed.error)
        if (parsed.text) {
          accumulated += parsed.text
          onChunk(parsed.text)
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('Chat API')) throw e
        // Skip malformed lines
      }
    }
  }

  return accumulated
}
