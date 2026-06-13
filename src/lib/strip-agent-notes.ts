// Strip agent notes from generated content (P20) + Sanitizer v2 (FP-1).
//
// AI agents sometimes output internal notes/comments, metadata tables, self-scoring
// blocks, manifests, and citation markers *inside* what is supposed to be clean paper
// prose. This module pulls all of that out so only readable prose is persisted to the
// paper, while the extracted chatter is surfaced in the conversation/chat channel.
//
// Two entry points:
//   stripAgentNotes()      — the original P20 light strip ([NOTE:] tags + HTML comments).
//   sanitizePaperContent() — FP-1 Sanitizer v2: everything stripAgentNotes does PLUS
//                            word-count blocks, metadata/score tables, manifests,
//                            pre-commitment tags, leading preamble, trailing sign-offs,
//                            and citation-marker routing (refs → list, anchors → dropped).
//
// This file is pure (no React/Next imports) so it can be unit-tested in isolation.

export interface StrippedContent {
  /** Clean paper content with notes removed */
  content: string
  /** Extracted agent notes (shown in chat panel) */
  notes: string[]
}

/** Result of the FP-1 Sanitizer v2 pass. */
export interface SanitizedContent {
  /** Clean paper prose, safe to persist as section/outline content. */
  content: string
  /** Conversational chatter pulled out of the prose (shown in the chat channel). */
  notes: string[]
  /** Citation slugs recovered from `<!--ref:slug-->` markers (deduped, in order). */
  citations: string[]
}

/**
 * Strips agent-internal notes from generated content (original P20 behaviour).
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

// ─── FP-1 Sanitizer v2 ─────────────────────────────────────────────────────────
//
// The bundled draft_writer agent prompt *commands* the model to emit, inside its reply,
// telemetry that has no place in a clean paper: word-count tracking blocks, a Draft
// Metadata table, Dimension Scores / Failure Condition Checks / Writer Decision sections,
// a [PRE-COMMITMENT-ACKNOWLEDGED] tag, a Claim Intent Manifest JSON block, and two/three
// layer <!--ref:slug--><!--anchor:...--> citation markers. The web-adapted prompts tell
// the model to stop doing this, but the model obeys the system prompt as often as the
// user message, so this sanitizer is the deterministic backstop that guarantees clean
// prose regardless of what the model emits.

// The kind/value enums and headings below are matched by TEXT, not by heading level, so a
// model that emits "## Dimension Scores" or "### Dimension Scores" is caught either way.
const SCORE_SECTION_TITLES = [
  'draft metadata',
  'word count by section',
  'dimension scores',
  'failure condition checks',
  'writer decision',
  'acceptance criteria paraphrase',
  'revision log',
]

// A single line of word-count telemetry (the "Section:/Target:/Actual:/Deviation:/
// Running Total:" block the legacy prompt mandates after each section).
const WORD_COUNT_LINE = /^\s*(Section|Target|Actual|Deviation|Running\s+Total)\s*:\s*\S/i

// Trailing conversational sign-offs ("Let me know if…", "I hope this helps", etc.).
const SIGNOFF_LINE =
  /^\s*(let me know|i hope (this|that)|hope (this|that) helps|would you like|feel free|please let me|is there anything|that (completes|concludes)|this (completes|concludes)|happy to (help|revise|adjust))/i

// Count the `#` characters at the start of a markdown heading line, or 0 if not a heading.
function headingLevel(line: string): number {
  const m = line.match(/^(#{1,6})\s+\S/)
  return m ? m[1].length : 0
}

// Normalize a heading line to its bare text (drop leading #s, numbering, bold, trailing
// parenthetical), lower-cased — used to match against SCORE_SECTION_TITLES.
function headingText(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/\*+/g, '')
    .replace(/\s*\(.*?\)\s*$/, '')
    .trim()
    .toLowerCase()
}

/**
 * FP-1 Sanitizer v2. Takes whatever text the model produced for a paper deliverable and
 * returns clean prose plus the chatter/citation-slugs pulled out of it.
 *
 * Order matters: citation/anchor markers and fenced telemetry blocks are removed first
 * (they can contain `#`/`|` that would confuse the line-based passes), then heading-keyed
 * score sections, then word-count lines, then sign-offs, then whitespace cleanup.
 */
export function sanitizePaperContent(raw: string): SanitizedContent {
  const notes: string[] = []
  const citations: string[] = []
  let text = typeof raw === 'string' ? raw : ''

  // 1. Two/three-layer citation markers.
  //    <!--ref:slug--> → recover the slug into the structured citation list (not chat spam).
  text = text.replace(/<!--\s*ref:\s*([^>]+?)\s*-->/gi, (_, slug: string) => {
    const s = slug.trim()
    if (s && !citations.includes(s)) citations.push(s)
    return ''
  })
  //    <!--anchor:kind:value--> → drop silently (locator metadata, never paper content).
  text = text.replace(/<!--\s*anchor:[\s\S]*?-->/gi, '')

  // 2. Claim Intent Manifest (and any other agent-machinery) JSON blocks. A fenced ```json
  //    block whose body looks like a manifest / pre-commitment artifact is telemetry, not
  //    prose — drop it and note that it was removed.
  text = text.replace(/```json\s*([\s\S]*?)```/gi, (whole, body: string) => {
    if (/manifest|claim_id|emitted_by|pre_commitment|claim_intent/i.test(body)) {
      notes.push('[claim intent manifest removed]')
      return ''
    }
    return whole // a legitimate json example — leave it in place
  })

  // 3. Remaining HTML comments → notes (original P20 behaviour, after ref/anchor removal).
  text = text.replace(/<!--\s*([\s\S]*?)\s*-->/g, (_, content: string) => {
    const trimmed = content.trim()
    if (trimmed) notes.push(trimmed)
    return ''
  })

  // 4. [NOTE:]/[AGENT:]/… bracket tags → notes.
  text = text.replace(
    /\[(NOTE|AGENT|INTERNAL|THINKING|PROCESS):\s*([^\]]+)\]/gi,
    (_, _tag, content: string) => {
      notes.push(content.trim())
      return ''
    }
  )

  // 5. The terminal [PRE-COMMITMENT-ACKNOWLEDGED] tag (Phase 4a contract).
  text = text.replace(/^\s*\[PRE-COMMITMENT-ACKNOWLEDGED\]\s*$/gim, '')

  // 6. Heading-keyed score / metadata sections. Walk the lines; when a heading matches the
  //    kill-list, skip everything under it until the next heading of the same-or-higher
  //    level, a horizontal rule, or EOF.
  {
    const lines = text.split('\n')
    const kept: string[] = []
    let skipUntilLevel = 0 // 0 = not skipping; otherwise skip until heading level <= this
    let removedAny = false
    for (const line of lines) {
      const level = headingLevel(line)
      if (skipUntilLevel > 0) {
        // End the skip on a sibling/parent heading or a horizontal rule.
        if (level > 0 && level <= skipUntilLevel) {
          skipUntilLevel = 0
          // fall through to evaluate this heading normally
        } else if (/^\s*---+\s*$/.test(line)) {
          skipUntilLevel = 0
          continue // consume the rule that delimited the killed block
        } else {
          continue // still inside the killed section
        }
      }
      if (level > 0 && SCORE_SECTION_TITLES.includes(headingText(line))) {
        skipUntilLevel = level
        removedAny = true
        continue
      }
      kept.push(line)
    }
    if (removedAny) notes.push('[metadata / self-scoring section removed]')
    text = kept.join('\n')
  }

  // 7. Word-count tracking lines (the Section/Target/Actual/Deviation/Running Total block).
  //    Remove only clusters of ≥2 consecutive such lines so a stray legitimate "Section:"
  //    in prose is never eaten.
  {
    const lines = text.split('\n')
    const kept: string[] = []
    let removedAny = false
    for (let i = 0; i < lines.length; i++) {
      if (WORD_COUNT_LINE.test(lines[i])) {
        let j = i
        while (j < lines.length && WORD_COUNT_LINE.test(lines[j])) j++
        if (j - i >= 2) {
          removedAny = true
          i = j - 1 // skip the whole cluster
          continue
        }
      }
      kept.push(lines[i])
    }
    if (removedAny) notes.push('[word-count tracking block removed]')
    text = kept.join('\n')
  }

  // 8. Trailing conversational sign-offs. Strip a run of sign-off / blank lines from the end.
  {
    const lines = text.split('\n')
    let end = lines.length
    const trailer: string[] = []
    while (end > 0) {
      const line = lines[end - 1]
      if (line.trim() === '') { end--; continue }
      if (SIGNOFF_LINE.test(line)) { trailer.unshift(line.trim()); end--; continue }
      break
    }
    if (trailer.length > 0) {
      notes.push(trailer.join(' '))
      text = lines.slice(0, end).join('\n')
    }
  }

  // 9. Whitespace cleanup.
  text = text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()

  return { content: text, notes, citations }
}

/**
 * Drop leading conversational preamble that appears BEFORE the first markdown heading
 * (e.g. "Here is the Methodology section:"). Only applied where the deliverable is
 * expected to start with a heading (sections, outline) — never for the abstract, which
 * legitimately has no heading. Returns the trimmed content and the removed preamble (if
 * any) so the caller can route it to the chat channel.
 */
export function stripLeadingPreamble(content: string): { content: string; preamble: string | null } {
  const lines = content.split('\n')
  const firstHeading = lines.findIndex((l) => headingLevel(l) > 0)
  if (firstHeading <= 0) return { content, preamble: null }
  const preamble = lines.slice(0, firstHeading).join('\n').trim()
  if (preamble === '') return { content: lines.slice(firstHeading).join('\n').trimStart(), preamble: null }
  return { content: lines.slice(firstHeading).join('\n').trimStart(), preamble }
}
