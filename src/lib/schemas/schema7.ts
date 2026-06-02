// P13 Schema 7 — parses the revision_coach_agent's Revision Roadmap into a grouped
// RevisionRoadmap (mustFix / shouldFix / consider). Same defensive contract as
// schema6/schema13: the agent ends its reply with one fenced ```json block,
// extractJsonBlock() pulls it out, and here we VALIDATE field-by-field, throwing
// HandoffIncompleteError('schema7', missing) when the roadmap is absent.
//
// Mental model: this is the reviewers' comments compiled into an ordered work-list —
// the must_fix items first (the blocking changes), then should_fix, then consider.
// The author cannot hand-tick must_fix items; the revision agent resolves them by
// rewriting (the checklist is read-only — see RevisionRoadmapChecklist).
//
// Tolerance: the roadmap may arrive in two shapes and we accept BOTH —
//   (a) GROUPED   — { roadmap: { mustFix:[…], shouldFix:[…], consider:[…] } }
//                   (or those three keys at the top level), the contract we ask for;
//   (b) FLAT      — { revisionRoadmap: [ {…, priority}, … ] } (the Schema-6 shape),
//                   which we bucket by each item's own `priority`.
// Either way the output is the SAME grouped RevisionRoadmap.

import type { RevisionRoadmap, RoadmapItem } from '@/lib/types'
import { extractJsonBlock } from './index'
import { HandoffIncompleteError } from './errors'

// ── small defensive guards (mirror schema6) ──

// True only for a plain object (not null, not an array).
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// The three roadmap priority literals, paired with the grouped-key they map to.
const PRIORITY_BUCKETS = [
  { key: 'mustFix', priority: 'must_fix' },
  { key: 'shouldFix', priority: 'should_fix' },
  { key: 'consider', priority: 'consider' },
] as const

const ALL_PRIORITIES = ['must_fix', 'should_fix', 'consider'] as const

// Leniently map ONE raw item to a RoadmapItem, forcing its priority to `forced`
// (the bucket it sits in). Returns null when the item can't be mapped (skipped with
// a warn — a single malformed item never aborts the whole revision). Mirrors
// schema6's toRoadmapItem, but the bucket — not the item — decides priority.
function toRoadmapItem(
  raw: unknown,
  forced: RoadmapItem['priority'],
  index: number,
): RoadmapItem | null {
  if (!isObject(raw)) {
    console.warn('parseSchema7: roadmap item[' + index + '] is not an object — skipping')
    return null
  }
  const r = raw
  // description is the minimum needed to render an item; id falls back to a synthetic one.
  if (typeof r.description !== 'string' || r.description.trim().length === 0) {
    console.warn('parseSchema7: roadmap item[' + index + '] missing description — skipping')
    return null
  }
  const id =
    typeof r.id === 'string' && r.id.trim().length > 0
      ? String(r.id)
      : forced + '-' + index
  const item: RoadmapItem = {
    id,
    description: String(r.description),
    priority: forced,
  }
  // Optional enrichment — included only when validly present.
  if (typeof r.reviewer === 'string') item.reviewer = String(r.reviewer)
  if (r.type === 'Major' || r.type === 'Minor' || r.type === 'Editorial') item.type = r.type
  if (typeof r.targetSection === 'string') item.targetSection = String(r.targetSection)
  if (typeof r.suggestedAction === 'string') item.suggestedAction = String(r.suggestedAction)
  return item
}

// Map a flat array of items (the Schema-6 shape) into a RoadmapItem[], bucketing by
// each item's OWN `priority` (defaulting unknown priorities to 'should_fix' so nothing
// is dropped — "no comment left behind"). Used only in the FLAT fallback path.
function mapFlat(rawItems: unknown[]): RoadmapItem[] {
  const out: RoadmapItem[] = []
  rawItems.forEach((raw, i) => {
    const p =
      isObject(raw) && ALL_PRIORITIES.includes(raw.priority as (typeof ALL_PRIORITIES)[number])
        ? (raw.priority as RoadmapItem['priority'])
        : 'should_fix'
    const item = toRoadmapItem(raw, p, i)
    if (item) out.push(item)
  })
  return out
}

// Parse + validate the Revision Roadmap. Throws HandoffIncompleteError('schema7', …)
// only when NO roadmap structure is present at all — empty buckets are allowed (the
// agent may legitimately report nothing in a given priority).
export function parseSchema7(raw: string): RevisionRoadmap {
  const data = extractJsonBlock(raw)

  if (!isObject(data)) {
    throw new HandoffIncompleteError('schema7', ['(root is not a JSON object)'])
  }

  // The roadmap may be wrapped under `roadmap` or sit at the top level. Prefer the
  // wrapper when it is an object; otherwise read the grouped keys off the root.
  const source: Record<string, unknown> = isObject(data.roadmap) ? data.roadmap : data

  // Detect which shape we got. GROUPED = any of the three bucket keys is an array.
  const hasGrouped = PRIORITY_BUCKETS.some((b) => Array.isArray(source[b.key]))

  // FLAT = a single array under one of these common keys.
  const flatArray =
    (Array.isArray(source.revisionRoadmap) && source.revisionRoadmap) ||
    (Array.isArray(source.items) && source.items) ||
    (Array.isArray(data.revisionRoadmap) && data.revisionRoadmap) ||
    null

  // Nothing recognisable → the agent never produced a roadmap. Abort (one retry upstream).
  if (!hasGrouped && !flatArray && !isObject(data.roadmap)) {
    throw new HandoffIncompleteError('schema7', ['roadmap'])
  }

  let mustFix: RoadmapItem[]
  let shouldFix: RoadmapItem[]
  let consider: RoadmapItem[]

  if (hasGrouped) {
    // GROUPED path — read each bucket, forcing each item's priority to its bucket.
    const grouped = PRIORITY_BUCKETS.map((b) => {
      const arr = Array.isArray(source[b.key]) ? (source[b.key] as unknown[]) : []
      const items: RoadmapItem[] = []
      arr.forEach((rawItem, i) => {
        const item = toRoadmapItem(rawItem, b.priority, i)
        if (item) items.push(item)
      })
      return items
    })
    mustFix = grouped[0]
    shouldFix = grouped[1]
    consider = grouped[2]
  } else if (flatArray) {
    // FLAT path — bucket a single array by each item's own priority.
    const all = mapFlat(flatArray)
    mustFix = all.filter((i) => i.priority === 'must_fix')
    shouldFix = all.filter((i) => i.priority === 'should_fix')
    consider = all.filter((i) => i.priority === 'consider')
  } else {
    // An empty `roadmap: {}` wrapper — valid but carries no items.
    mustFix = []
    shouldFix = []
    consider = []
  }

  const roadmap: RevisionRoadmap = { mustFix, shouldFix, consider }
  if (typeof source.summary === 'string' && source.summary.trim().length > 0) {
    roadmap.summary = String(source.summary)
  }
  return roadmap
}
