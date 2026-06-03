// P18 — Material Passport content hashing + STALE-on-edit (FR-49, NFR-15).
//
// When a draft PASSES the Stage 2.5 integrity gate, the passport is VERIFIED and we
// remember a SHA-256 of the section content (the "passed" fingerprint). If the author
// then edits ANY section, the content no longer matches that fingerprint, so the
// passport must flip to STALE and a banner must tell them to re-run the integrity check
// before peer review. This module owns that detection so the editor and the passport
// agree on exactly one rule.
//
// Mental model (EE analogy): the integrity PASS is a calibration. Editing the signal
// after calibration invalidates it — you must re-calibrate (re-run 2.5) before trusting
// the measurement chain (peer review) again.

import type { PaperState, Section, ComplianceEntry } from './types'

// Concatenate the section content in paper order into one string to hash. We strip HTML
// tags so a no-op formatting round-trip doesn't falsely register as an edit; what matters
// is the human-readable text the integrity agent actually read.
export function sectionContentForHash(sections: Section[]): string {
  return sections
    .map((s) => `${s.heading}\n${stripTags(s.content)}`)
    .join('\n\n')
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

// SHA-256 → lowercase hex, via the Web Crypto API (browser-only; this module is used by
// 'use client' components). Async because crypto.subtle.digest is async.
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Has this paper ever PASSED an integrity gate? (Either the explicit pass date, the
// integrity status, or a recorded 2.5/4.5 report verdict.) Only after a pass does an
// edit matter for STALE — before any pass the passport is simply UNVERIFIED.
export function hasPassedIntegrity(state: PaperState): boolean {
  if (state.integrityStatus === 'passed') return true
  if (state.integrityPassDate) return true
  if (state.finalIntegrityPassDate) return true
  return false
}

// markEditAfterPass — pure, synchronous, idempotent. If the paper has passed integrity
// and is not ALREADY stale, return a new state flipped to STALE with an append-only
// 'edit_after_pass' compliance entry (NFR-15 audit trail). Otherwise return the state
// unchanged (referential equality, so callers can cheaply detect "nothing changed").
//
// `timestamp` is passed in (the caller stamps it) so this stays a pure function.
export function markEditAfterPass(state: PaperState, timestamp: string): PaperState {
  if (!hasPassedIntegrity(state)) return state
  if (state.materialVerification === 'STALE') return state

  const entry: ComplianceEntry = {
    timestamp,
    action: 'edit_after_pass',
    agentId: 'editor',
    reason: 'A section was edited after the Stage 2.5 integrity PASS; the integrity check must be re-run before peer review.',
  }

  return {
    ...state,
    materialVerification: 'STALE',
    complianceHistory: [...(state.complianceHistory ?? []), entry],
    updatedAt: timestamp,
  }
}
