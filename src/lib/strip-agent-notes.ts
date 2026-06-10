// Strip agent notes from generated content (P20).
// AI agents sometimes output internal notes/comments in the paper content.
// This utility extracts them so they can be shown in the chat panel instead
// of polluting the paper view.

export interface StrippedContent {
  /** Clean paper content with notes removed */
  content: string
  /** Extracted agent notes (shown in chat panel) */
  notes: string[]
}

/**
 * Strips agent-internal notes from generated content.
 * Patterns matched:
 *   - [NOTE: ...] or [AGENT: ...] or [INTERNAL: ...] or [THINKING: ...] or [PROCESS: ...]
 *   - <!-- ... --> (HTML comments)
 *   - Lines starting with "Note to self:" or "Agent note:" etc.
 */
export function stripAgentNotes(raw: string): StrippedContent {
  const notes: string[] = []

  // Pattern 1: [NOTE: ...], [AGENT: ...], [INTERNAL: ...], [THINKING: ...], [PROCESS: ...]
  let cleaned = raw.replace(
    /\[(NOTE|AGENT|INTERNAL|THINKING|PROCESS):\s*([^\]]+)\]/gi,
    (_, _tag, content) => {
      notes.push(content.trim())
      return ''
    }
  )

  // Pattern 2: HTML comments <!-- ... -->
  cleaned = cleaned.replace(
    /<!--\s*([\s\S]*?)\s*-->/g,
    (_, content) => {
      const trimmed = (content as string).trim()
      if (trimmed) notes.push(trimmed)
      return ''
    }
  )

  // Pattern 3: Lines starting with known agent-note prefixes
  const agentPrefixes = /^(note to self|agent note|internal note|process note):\s*/i
  cleaned = cleaned
    .split('\n')
    .filter((line) => {
      if (agentPrefixes.test(line.trim())) {
        notes.push(line.trim().replace(agentPrefixes, ''))
        return false
      }
      return true
    })
    .join('\n')

  // Clean up extra blank lines left by removal
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim()

  return { content: cleaned, notes }
}
