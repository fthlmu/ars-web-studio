// FP-2 unit tests — the orchestrator narrator (no-LLM, pure).
//
// These assert the two FP-2 invariants at the source:
//   • EXACTLY ONE checkpoint card per checkpoint (reconcile is idempotent by stable id).
//   • Blocking gates are UNREACHABLE via chat — a card's only action routes TO the gate page
//     (the route that owns the guarded control), never to the post-gate route.
//
// Pure-function tests: no `page` fixture, no browser, no dev server (see playwright.unit.config.ts).

import { test, expect } from '@playwright/test'
import { buildNarratorMessage, reconcileNarrator } from '@/lib/orchestrator-narrator'
import type { PaperState, PaperConfig, Section, ChatThread } from '@/lib/types'

// The narrator only reads config.topic / config.paperType — a tiny config is enough.
const CONFIG = { topic: 'Beamforming for 5G Phased Arrays', paperType: 'imrad' } as unknown as PaperConfig

function section(id: string, heading: string): Section {
  return { id, heading, level: 1, content: `<p>${heading} body text here.</p>`, wordCount: 4, status: 'done' }
}

function base(overrides: Partial<PaperState>): PaperState {
  return {
    id: 'paper-1',
    config: CONFIG,
    outline: '',
    outlineApproved: false,
    sections: [],
    generationStatus: 'idle',
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
    ...overrides,
  }
}

const SECTIONS = [section('s1', 'Introduction'), section('s2', 'Methodology')]

// ── state fixtures keyed to the derived PipelineStatus ──────────────────────────
const idle = () => base({})
const generatingSections = () =>
  base({ outline: 'x', outlineApproved: true, sections: [{ ...SECTIONS[0], status: 'generating' }] })
const awaitingOutline = () => base({ outline: 'Introduction\nMethodology' })
const awaitingSection = () => base({ outline: 'x', outlineApproved: true, sections: SECTIONS })
const runningIntegrity = () =>
  base({ outline: 'x', outlineApproved: true, sections: SECTIONS, integrityStatus: 'running' })
const awaitingIntegrity = () =>
  base({ outline: 'x', outlineApproved: true, sections: SECTIONS, integrityStatus: 'awaiting-review' })
const awaitingPeerReview = () =>
  base({ outline: 'x', outlineApproved: true, sections: SECTIONS, reviewStatus: 'awaiting-decision' })
const coachingInitial = () =>
  base({ outline: 'x', outlineApproved: true, sections: SECTIONS, coachingStatus: 'in-progress', coachingRoundCount: 2 })
const coachingResidual = () =>
  base({ outline: 'x', outlineApproved: true, sections: SECTIONS, residualCoachingStatus: 'in-progress', residualCoachingRoundCount: 3 })
const awaitingRevision = () =>
  base({ outline: 'x', outlineApproved: true, sections: SECTIONS, revisionStatus: 'awaiting-approval', revisionLoopCount: 1 })
const awaitingReReview = () =>
  base({ outline: 'x', outlineApproved: true, sections: SECTIONS, reReviewStatus: 'awaiting-decision', revisionLoopCount: 2 })
const awaitingFinal = () =>
  base({ outline: 'x', outlineApproved: true, sections: SECTIONS, finalIntegrityStatus: 'awaiting-review' })
const exportReady = () =>
  base({ outline: 'x', outlineApproved: true, sections: SECTIONS, pipelineStatus: 'export-ready' })

// ── idle / running produce no checkpoint card ───────────────────────────────────

test.describe('narrator — non-decision states', () => {
  test('idle paper produces no narrator message', () => {
    expect(buildNarratorMessage(idle())).toBeNull()
  })

  test('generating-sections is a plain announcement (no checkpoint card)', () => {
    const msg = buildNarratorMessage(generatingSections())
    expect(msg).not.toBeNull()
    expect(msg!.role).toBe('narrator')
    expect(msg!.checkpoint).toBeUndefined()
  })

  test('running-integrity-gate is an announcement (no actions)', () => {
    const msg = buildNarratorMessage(runningIntegrity())
    expect(msg!.checkpoint).toBeUndefined()
    expect(msg!.id).toBe('narrator:running-integrity-gate')
  })
})

// ── one checkpoint card per decision point, routed to its own page ──────────────

interface Case {
  name: string
  state: () => PaperState
  checkpointId: string
  blocking: boolean
  href: string | RegExp
  openTestid: string
}

const CASES: Case[] = [
  { name: 'awaiting-outline-review', state: awaitingOutline, checkpointId: 'CP-03', blocking: false, href: '/pipeline/write', openTestid: 'checkpoint-open-CP-03' },
  { name: 'awaiting-section-review', state: awaitingSection, checkpointId: 'CP-04', blocking: false, href: '/pipeline/write', openTestid: 'checkpoint-open-CP-04' },
  { name: 'awaiting-integrity-review', state: awaitingIntegrity, checkpointId: 'CP-05', blocking: true, href: '/pipeline/integrity', openTestid: 'checkpoint-open-CP-05' },
  { name: 'awaiting-peer-review', state: awaitingPeerReview, checkpointId: 'CP-06', blocking: true, href: '/pipeline/review', openTestid: 'checkpoint-open-CP-06' },
  { name: 'coaching (initial)', state: coachingInitial, checkpointId: 'CP-07', blocking: false, href: '/pipeline/coaching', openTestid: 'checkpoint-open-CP-07' },
  { name: 'coaching (residual)', state: coachingResidual, checkpointId: 'CP-10', blocking: false, href: /\/pipeline\/coaching\?stage=re-review/, openTestid: 'checkpoint-open-CP-10' },
  { name: 'awaiting-revision-review', state: awaitingRevision, checkpointId: 'CP-08', blocking: false, href: '/pipeline/revise', openTestid: 'checkpoint-open-CP-08' },
  { name: 'awaiting-re-review', state: awaitingReReview, checkpointId: 'CP-09', blocking: true, href: '/pipeline/re-review', openTestid: 'checkpoint-open-CP-09' },
  { name: 'awaiting-final-review', state: awaitingFinal, checkpointId: 'CP-11', blocking: true, href: '/pipeline/final-integrity', openTestid: 'checkpoint-open-CP-11' },
  { name: 'export-ready', state: exportReady, checkpointId: 'CP-12', blocking: true, href: '/pipeline/finalize', openTestid: 'checkpoint-open-CP-12' },
]

for (const c of CASES) {
  test.describe(`narrator — ${c.name}`, () => {
    const msg = buildNarratorMessage(c.state())

    test('produces a narrator checkpoint card', () => {
      expect(msg).not.toBeNull()
      expect(msg!.role).toBe('narrator')
      expect(msg!.checkpoint).toBeDefined()
      expect(msg!.checkpoint!.checkpointId).toBe(c.checkpointId)
    })

    test('blocking flag matches the gate classification', () => {
      expect(Boolean(msg!.checkpoint!.blocking)).toBe(c.blocking)
    })

    test('has exactly one action that routes to the owning page', () => {
      const actions = msg!.checkpoint!.actions
      expect(actions).toHaveLength(1)
      expect(actions[0].testid).toBe(c.openTestid)
      if (c.href instanceof RegExp) expect(actions[0].href).toMatch(c.href)
      else expect(actions[0].href).toBe(c.href)
    })
  })
}

// ── the iron-rule guarantee: blocking cards can only route TO the gate ──────────

test('blocking checkpoint cards never route PAST the gate', () => {
  // The 2.5 card must take the user to /pipeline/integrity — NOT to the post-gate /pipeline/review.
  const integrity = buildNarratorMessage(awaitingIntegrity())!
  for (const a of integrity.checkpoint!.actions) {
    expect(a.href).toBe('/pipeline/integrity')
    expect(a.href).not.toContain('/pipeline/review')
  }
  // The 4.5 card must route to /pipeline/final-integrity — NOT to the post-gate /pipeline/finalize.
  const final = buildNarratorMessage(awaitingFinal())!
  for (const a of final.checkpoint!.actions) {
    expect(a.href).toBe('/pipeline/final-integrity')
    expect(a.href).not.toContain('/pipeline/finalize')
  }
})

// ── reconcile idempotency + transitions ─────────────────────────────────────────

test.describe('reconcileNarrator', () => {
  const empty: ChatThread = { messages: [], pendingInstructions: [] }

  test('adds the current checkpoint card exactly once', () => {
    const once = reconcileNarrator(empty, awaitingIntegrity())
    expect(once).not.toBeNull()
    expect(once!.messages).toHaveLength(1)

    // Reconciling the SAME state again is a no-op (stable id already present).
    const twice = reconcileNarrator(once!, awaitingIntegrity())
    expect(twice).toBeNull()
  })

  test('a stage transition appends a SECOND distinct card; both persist', () => {
    const afterDraft = reconcileNarrator(empty, awaitingSection())!
    const afterGate = reconcileNarrator(afterDraft, awaitingIntegrity())!
    expect(afterGate.messages).toHaveLength(2)
    const cps = afterGate.messages.map((m) => m.checkpoint?.checkpointId)
    expect(cps).toEqual(['CP-04', 'CP-05'])
  })

  test('initial vs residual coaching are distinct cards (not merged)', () => {
    const a = reconcileNarrator(empty, coachingInitial())!
    const b = reconcileNarrator(a, coachingResidual())!
    expect(b.messages).toHaveLength(2)
    expect(b.messages.map((m) => m.checkpoint?.checkpointId)).toEqual(['CP-07', 'CP-10'])
  })

  test('idle paper never adds a card', () => {
    expect(reconcileNarrator(empty, idle())).toBeNull()
  })
})
