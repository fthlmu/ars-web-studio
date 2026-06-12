// FP-2 — the orchestrator NARRATOR (no-LLM, pure).
//
// In the original ARS pipeline the defining trait is a narrator: an orchestrator that
// announces each stage, presents a Decision Dashboard at every checkpoint, and WAITS for the
// user to act. The web app split that into 10 routes with no narration. This module rebuilds
// the narrator as a LOCAL, deterministic function over PaperState — no model call.
//
// For a given paper it produces the single chat message that SHOULD exist for the paper's
// CURRENT derived status:
//   • running/generating statuses → a plain "Stage X started…" announcement (no actions)
//   • awaiting/decision/export statuses → a Decision-Dashboard CARD (metrics + ONE action
//     button that NAVIGATES to the /pipeline/* page owning the real, guarded control).
//
// IRON-RULE GUARANTEE: a card never performs a gate decision — its action only routes to the
// gate page (via pipelineHrefForState, the same SSOT the entry router uses). So the chat can
// never clear a blocking gate; blocking gates stay reachable-only, never bypassable.
//
// The message id is STABLE per status, so reconcileNarrator() is idempotent: re-running it on
// every state poll appends a card at most once per checkpoint (FR "exactly one checkpoint
// message per stage transition").

import type { PaperState, ChatMessage, ChatThread, ChatCheckpointAction } from './types'
import {
  derivePipelineStatus,
  pipelineHrefForState,
  pipelineStatusLabel,
  MAX_REVISION_LOOPS,
  MAX_COACHING_ROUNDS,
  MAX_RESIDUAL_COACHING_ROUNDS,
} from './pipeline-router'
import type { PipelineStatus } from './types'

// ─── small pure helpers ────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function countWords(text: string): number {
  return stripTags(text).split(/\s+/).filter(Boolean).length
}

function sectionStats(state: PaperState): { done: number; total: number; words: number } {
  const sections = state.sections ?? []
  const total = sections.length
  const done = sections.filter((s) => s.status === 'done' || s.status === 'edited').length
  const words = sections.reduce((sum, s) => sum + countWords(s.content ?? ''), 0)
  return { done, total, words }
}

function isResidualCoaching(state: PaperState): boolean {
  return (
    state.residualCoachingStatus === 'round-0' ||
    state.residualCoachingStatus === 'in-progress' ||
    state.residualCoachingStatus === 'cap-reached'
  )
}

// ─── the narrator build result (internal) ──────────────────────────────────────

interface NarratorBuild {
  /** stable id → idempotent reconcile (one message per checkpoint) */
  id: string
  /** pre-wrap text body: title line first, then dashboard lines */
  content: string
  /** present only for decision-point cards */
  checkpoint?: { checkpointId: string; blocking?: boolean; actions: ChatCheckpointAction[] }
}

// Build the single primary "open the page that owns the control" action. The href is the
// canonical route for the paper's derived status — the SAME route the entry router uses — so
// it can never skip a gate.
function openAction(state: PaperState, cpId: string, label: string): ChatCheckpointAction {
  return {
    label,
    href: pipelineHrefForState(state),
    testid: `checkpoint-open-${cpId}`,
    variant: 'default',
  }
}

// ─── the per-status narration ───────────────────────────────────────────────────

function narratorFor(status: PipelineStatus, state: PaperState): NarratorBuild | null {
  const { done, total, words } = sectionStats(state)
  const draftLine = `Draft: ${done}/${total} sections · ${words.toLocaleString()} words`

  switch (status) {
    // ── idle / error: no narration ──
    case 'idle':
    case 'error':
      return null

    // ── Stage 1 · Research ──
    case 'running-research':
      return {
        id: `narrator:${status}`,
        content: '🔎 Stage 1 · Research started — gathering sources and drafting the methodology blueprint…',
      }
    case 'awaiting-research-review':
      return {
        id: `narrator:${status}`,
        content: [
          '🤖 Stage 1 · Research — decision point (CP-01)',
          'The research brief and methodology are ready for your review.',
        ].join('\n'),
        checkpoint: {
          checkpointId: 'CP-01',
          actions: [openAction(state, 'CP-01', 'Open research review →')],
        },
      }

    // ── Stage 2 · Write ──
    case 'generating-outline':
      return { id: `narrator:${status}`, content: '✍️ Stage 2 · Writing the outline…' }
    case 'awaiting-outline-review':
      return {
        id: `narrator:${status}`,
        content: [
          '🤖 Stage 2 · Outline — decision point (CP-03)',
          state.outlineSections?.length
            ? `${state.outlineSections.length} sections proposed.`
            : 'An outline is ready for your approval.',
        ].join('\n'),
        checkpoint: {
          checkpointId: 'CP-03',
          actions: [openAction(state, 'CP-03', 'Open outline review →')],
        },
      }
    case 'generating-sections':
      return {
        id: `narrator:${status}`,
        content: '✍️ Stage 2 · Drafting sections… (live preview streams in the centre pane).',
      }
    case 'awaiting-section-review':
      return {
        id: `narrator:${status}`,
        content: [
          '🤖 Stage 2 · Draft — decision point (CP-04)',
          draftLine,
          'Approve the draft to hand it to the Integrity Gate, or regenerate a section.',
        ].join('\n'),
        checkpoint: {
          checkpointId: 'CP-04',
          actions: [openAction(state, 'CP-04', 'Open draft review →')],
        },
      }

    // ── Stage 2.5 · Integrity gate (BLOCKING) ──
    case 'running-integrity-gate':
      return {
        id: `narrator:${status}`,
        content: '🛡️ Stage 2.5 · Integrity gate running — verifying 7 failure modes…',
      }
    case 'awaiting-integrity-review': {
      const latest = (state.integrityReports ?? []).filter((r) => r.stage === '2.5').slice(-1)[0]
      const flagged = latest?.modes?.filter((m) => m.verdict !== 'CLEAR').length ?? 0
      const verdict = latest?.verdict ?? 'pending'
      return {
        id: `narrator:${status}`,
        content: [
          '🤖 Stage 2.5 · Integrity Gate — BLOCKING checkpoint (CP-05)',
          `7-mode verdict: ${verdict} · ${flagged} mode(s) flagged`,
          'This gate is BLOCKING: the paper cannot proceed to peer review without a PASS.',
        ].join('\n'),
        checkpoint: {
          checkpointId: 'CP-05',
          blocking: true,
          actions: [openAction(state, 'CP-05', 'Open integrity gate →')],
        },
      }
    }

    // ── Stage 3 · Peer review (BLOCKING — cannot be skipped) ──
    case 'running-peer-review':
      return {
        id: `narrator:${status}`,
        content: '👥 Stage 3 · Peer review running — 5 reviewers scoring the draft…',
      }
    case 'awaiting-peer-review': {
      const r = state.reviewReport
      const decision = r?.editorialDecision ?? 'pending'
      const conf = typeof r?.confidenceScore === 'number' ? ` · confidence ${r.confidenceScore}` : ''
      const da = r?.daCritical ? ' · ⚠ DA-CRITICAL' : ''
      return {
        id: `narrator:${status}`,
        content: [
          '🤖 Stage 3 · Editorial Decision — BLOCKING checkpoint (CP-06)',
          `Decision: ${decision}${conf}${da}`,
          'Review cannot be skipped — an explicit editorial decision is required.',
        ].join('\n'),
        checkpoint: {
          checkpointId: 'CP-06',
          blocking: true,
          actions: [openAction(state, 'CP-06', 'Open editorial decision →')],
        },
      }
    }

    // ── coaching (initial CP-07, or residual CP-10) ──
    case 'coaching': {
      const residual = isResidualCoaching(state)
      if (residual) {
        const round = state.residualCoachingRoundCount ?? 0
        return {
          id: 'narrator:coaching:residual',
          content: [
            "🤖 Stage 3' → 4' · Residual coaching — decision point (CP-10)",
            `Round ${round} of ${MAX_RESIDUAL_COACHING_ROUNDS}.`,
          ].join('\n'),
          checkpoint: {
            checkpointId: 'CP-10',
            actions: [openAction(state, 'CP-10', 'Open residual coaching →')],
          },
        }
      }
      const round = state.coachingRoundCount ?? 0
      return {
        id: 'narrator:coaching:initial',
        content: [
          '🤖 Stage 3 → 4 · Coaching — decision point (CP-07)',
          `Round ${round} of ${MAX_COACHING_ROUNDS}. Engage to reflect on the reviews, or skip straight to the revision.`,
        ].join('\n'),
        checkpoint: {
          checkpointId: 'CP-07',
          actions: [openAction(state, 'CP-07', 'Open coaching →')],
        },
      }
    }

    // ── Stage 4 · Revise ──
    case 'running-revision':
      return {
        id: `narrator:${status}`,
        content: '🛠️ Stage 4 · Revision running — applying the revision roadmap…',
      }
    case 'awaiting-revision-review': {
      const loop = state.revisionLoopCount ?? 0
      const changed = state.deltaReport?.changedCount
      return {
        id: `narrator:${status}`,
        content: [
          '🤖 Stage 4 · Revised draft — decision point (CP-08)',
          typeof changed === 'number' ? `${changed} section(s) changed.` : 'A revised draft is ready.',
          `Revision loop ${loop} of ${MAX_REVISION_LOOPS}.`,
        ].join('\n'),
        checkpoint: {
          checkpointId: 'CP-08',
          actions: [openAction(state, 'CP-08', 'Open revision review →')],
        },
      }
    }

    // ── Stage 3' · Re-review (BLOCKING — verification decision) ──
    case 'running-re-review':
      return {
        id: `narrator:${status}`,
        content: "👥 Stage 3' · Re-review running — verifying the revision…",
      }
    case 'awaiting-re-review': {
      const loop = state.revisionLoopCount ?? 0
      const atCap = loop >= MAX_REVISION_LOOPS
      return {
        id: `narrator:${status}`,
        content: [
          "🤖 Stage 3' · Re-review — BLOCKING checkpoint (CP-09)",
          atCap
            ? `Revision loop cap reached (${loop}/${MAX_REVISION_LOOPS}) — the only forward exit is the final gate.`
            : `Revision loop ${loop} of ${MAX_REVISION_LOOPS}.`,
        ].join('\n'),
        checkpoint: {
          checkpointId: 'CP-09',
          blocking: true,
          actions: [openAction(state, 'CP-09', 'Open re-review decision →')],
        },
      }
    }

    // ── Stage 4.5 · Final integrity gate (BLOCKING, zero-tolerance) ──
    case 'running-final-gate':
      return {
        id: `narrator:${status}`,
        content: '🛡️ Stage 4.5 · Final integrity gate running (zero-tolerance re-run)…',
      }
    case 'awaiting-final-review': {
      const failed = state.finalIntegrityStatus === 'failed'
      return {
        id: `narrator:${status}`,
        content: [
          '🤖 Stage 4.5 · Final Integrity Gate — BLOCKING checkpoint (CP-11)',
          failed
            ? 'Verdict: FAILED. Zero-tolerance — export stays locked until a clean re-run passes.'
            : 'Zero-tolerance re-run of all 7 modes. Export unlocks only on a clean PASS.',
        ].join('\n'),
        checkpoint: {
          checkpointId: 'CP-11',
          blocking: true,
          actions: [openAction(state, 'CP-11', 'Open final integrity gate →')],
        },
      }
    }

    // ── Stage 5 · Finalize / export ──
    case 'export-ready':
      return {
        id: `narrator:${status}`,
        content: [
          '🎉 All gates passed — export ready (CP-12)',
          draftLine,
          'Format and download the paper, or review the process summary.',
        ].join('\n'),
        checkpoint: {
          checkpointId: 'CP-12',
          blocking: true,
          actions: [openAction(state, 'CP-12', 'Open finalize & export →')],
        },
      }
  }
  // Exhaustiveness: if a PipelineStatus is added and not handled, this errors at compile time.
  const _exhaustive: never = status
  return _exhaustive
}

// ─── public API ─────────────────────────────────────────────────────────────────

/** The single narrator message the paper's CURRENT status should produce, or null. */
export function buildNarratorMessage(state: PaperState): ChatMessage | null {
  const status = derivePipelineStatus(state)
  const build = narratorFor(status, state)
  if (!build) return null
  return {
    id: build.id,
    role: 'narrator',
    content: build.content,
    timestamp: new Date().toISOString(),
    stage: pipelineStatusLabel(status),
    ...(build.checkpoint ? { checkpoint: build.checkpoint } : {}),
  }
}

/**
 * Idempotently fold the current narration into a thread. Returns the updated thread if a NEW
 * narrator message is due, or null when nothing changed (the message already exists or the
 * paper has no narration). Pure — the caller persists + setState only on a non-null result.
 */
export function reconcileNarrator(thread: ChatThread, state: PaperState): ChatThread | null {
  const msg = buildNarratorMessage(state)
  if (!msg) return null
  if (thread.messages.some((m) => m.id === msg.id)) return null
  return { ...thread, messages: [...thread.messages, msg] }
}
