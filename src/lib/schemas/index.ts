// P9 schema barrel — the single entry point for parsing deep-research agent output.
//
// Each agent ends its reply with one fenced ```json block holding a machine-
// readable object. The flow is:
//   raw agent text  ->  extractJsonBlock()  ->  unknown object  ->  parseSchemaN()
// extractJsonBlock does the "find the JSON" step; the parseSchemaN functions do
// the field validation (see schema1/2/3.ts).

import type {
  RQBrief,
  Bibliography,
  SynthesisReport,
  PaperDraft,
  IntegrityReport,
  ReviewerScoreSet,
  ScoringPlan,
} from '@/lib/types'
import { parseSchema1 } from './schema1'
import { parseSchema2 } from './schema2'
import { parseSchema3 } from './schema3'
import { parseSchema4 } from './schema4'
import { parseSchema5 } from './schema5'
import { parseSchema6 } from './schema6'
import { parseSchema13 } from './schema13'

// Which schema a given agent's output maps to.
// schema1–3: P9 deep-research handoffs. schema4: P10 paper draft. schema5: P10
// integrity report. schema6: P11 review report (Phase 2). schema13: P11 scoring
// plan (Phase 1, paper-blind).
export type SchemaId =
  | 'schema1'
  | 'schema2'
  | 'schema3'
  | 'schema4'
  | 'schema5'
  | 'schema6'
  | 'schema13'

export { HandoffIncompleteError } from './errors'
export { parseSchema1 } from './schema1'
export { parseSchema2 } from './schema2'
export { parseSchema3 } from './schema3'
export { parseSchema4 } from './schema4'
export { parseSchema5 } from './schema5'
export { parseSchema6 } from './schema6'
export { parseSchema13 } from './schema13'

// ── extractJsonBlock ─────────────────────────────────────────────────────────
// Pull the JSON object out of an agent's free-form reply.
//
// Strategy (in order):
//   1. Find the LAST fenced code block whose info string is `json`
//      (three backticks + the word "json" ... three backticks) and JSON.parse it.
//      We take the LAST one so trailing "final answer" blocks win over examples
//      the agent may have shown earlier in its reasoning.
//   2. If there is no json-fenced block (or it fails to parse), fall back to the
//      LAST balanced {...} object found by scanning the string, and parse that.
//   3. If nothing parses, throw a plain Error('no JSON object found').
//
// Returns `unknown` on purpose — the caller (parseSchemaN) is responsible for
// validating the shape. We never trust the structure here.
export function extractJsonBlock(raw: string): unknown {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('no JSON object found')
  }

  // 1. All ```json ... ``` fenced blocks. The `g` flag lets us collect every
  //    match so we can keep the last one. [\s\S]*? matches across newlines,
  //    non-greedily, so each block stops at its own closing fence.
  const fenceRegex = /```json\s*([\s\S]*?)```/gi
  const jsonBlocks: string[] = []
  let match: RegExpExecArray | null
  while ((match = fenceRegex.exec(raw)) !== null) {
    jsonBlocks.push(match[1])
  }

  // Try fenced blocks from last to first. We only accept a block that parses to a
  // plain object — if the agent fenced an array or a bare scalar, skip it and keep
  // looking, so a salvageable object elsewhere (or the brace fallback) still wins.
  for (let i = jsonBlocks.length - 1; i >= 0; i--) {
    const parsed = tryParse(jsonBlocks[i])
    if (parsed.ok && isPlainObject(parsed.value)) return parsed.value
  }

  // 2. Fallback: the last balanced {...} object anywhere in the string.
  const lastObject = findLastBalancedObject(raw)
  if (lastObject !== null) {
    const parsed = tryParse(lastObject)
    if (parsed.ok && isPlainObject(parsed.value)) return parsed.value
  }

  // 3. Nothing worked.
  throw new Error('no JSON object found')
}

// True only for a real JSON object (not null, not an array). The parsers all
// expect an object root, so extractJsonBlock filters to objects before returning.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// JSON.parse wrapped so a parse failure is data, not an exception we must catch
// at every call site. Returns a small tagged result.
function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text.trim()) }
  } catch (e) {
    // Not fatal here — we just move on to the next candidate block. Logged at
    // warn level so a genuinely empty pipeline is still debuggable.
    console.warn('extractJsonBlock: candidate block did not parse as JSON:', e)
    return { ok: false }
  }
}

// Scan `raw` and return the substring of the LAST top-level balanced { ... }
// object, or null if there is no balanced object. We walk forward tracking
// brace depth; each time depth returns to 0 we've closed one complete object,
// and we remember the most recent one. String literals (and their escapes) are
// skipped so a `{` inside a quoted value does not confuse the depth count.
function findLastBalancedObject(raw: string): string | null {
  let depth = 0
  let start = -1
  let last: string | null = null
  let inString = false
  let escaped = false

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]

    if (inString) {
      if (escaped) {
        escaped = false // this char is a literal, skip it
      } else if (ch === '\\') {
        escaped = true // next char is escaped
      } else if (ch === '"') {
        inString = false // closing quote
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') {
      if (depth === 0) start = i // remember where this object began
      depth++
    } else if (ch === '}') {
      if (depth > 0) {
        depth--
        if (depth === 0 && start !== -1) {
          last = raw.slice(start, i + 1) // a complete object closed here
        }
      }
    }
  }

  return last
}

// ── parseSchema dispatcher ───────────────────────────────────────────────────
// Route a raw agent reply to the correct parser by schema id. Lets a caller that
// only knows "this is schema2 output" parse without importing each function.
export function parseSchema(
  raw: string,
  schemaId: SchemaId,
): RQBrief | Bibliography | SynthesisReport | PaperDraft | IntegrityReport | ReviewerScoreSet | ScoringPlan {
  switch (schemaId) {
    case 'schema1':
      return parseSchema1(raw)
    case 'schema2':
      return parseSchema2(raw)
    case 'schema3':
      return parseSchema3(raw)
    case 'schema4':
      return parseSchema4(raw)
    case 'schema5':
      return parseSchema5(raw)
    case 'schema6':
      return parseSchema6(raw)
    case 'schema13':
      return parseSchema13(raw)
    default: {
      // Exhaustiveness guard: if SchemaId ever grows a new member, TypeScript
      // flags this branch at compile time.
      const _never: never = schemaId
      throw new Error('unknown schemaId: ' + String(_never))
    }
  }
}
