// Schema 9 — the Material Passport (DR-05, FR-48/FR-49).
//
// The passport is the paper's "chain-of-custody" record: is its content currently
// VERIFIED (passed a recent integrity gate, untouched since), UNVERIFIED (never passed,
// or proceeded via a bounded override), or STALE (edited after a pass, or the pass aged
// out). It is DERIVED from PaperState — there is no separate stored passport blob — so it
// can never drift from the actual integrity/edit history.
//
// Two invariants the rest of the app depends on:
//   1. verificationStatus has EXACTLY three values — VERIFIED | UNVERIFIED | STALE. No 4th.
//   2. An override is an EVENT in complianceHistory (action: 'override'), NOT a status.
//      The "override logged" badge derives from (an override record) AND (UNVERIFIED) —
//      it is never read off verificationStatus.

import type { PaperState, ComplianceEntry, VerificationStatus } from '../types'

// A pass older than this is treated as STALE (the world may have moved on — re-verify).
export const PASSPORT_STALE_AFTER_MS = 24 * 60 * 60 * 1000 // 24 hours

export interface MaterialPassport {
  verificationStatus: VerificationStatus
  versionLabel: string                 // monotonic, e.g. "paper_draft_v1"
  integrityPassDate: string | null     // ISO time of the most recent PASS (null = never)
  complianceHistory: ComplianceEntry[] // append-only audit trail (override records live here)
  // DERIVED: a bounded override was logged AND the material is not currently verified.
  // The "override logged" badge reads THIS, never a verificationStatus value.
  overrideLogged: boolean
  staleAfterMs: number
}

// The single source of truth for the passport. `nowMs` is injectable for testing; it
// defaults to the wall clock.
export function buildPassport(state: PaperState, nowMs: number = Date.now()): MaterialPassport {
  const history = state.complianceHistory ?? []
  const hasOverride = history.some((e) => e.action === 'override')
  // The most recent pass date across the 2.5 and 4.5 gates.
  const passDate = state.finalIntegrityPassDate ?? state.integrityPassDate ?? null

  const verificationStatus = deriveVerificationStatus(state, passDate, hasOverride, nowMs)

  return {
    verificationStatus,
    versionLabel: state.versionLabel ?? 'paper_draft_v1',
    integrityPassDate: passDate,
    complianceHistory: history,
    overrideLogged: hasOverride && verificationStatus !== 'VERIFIED',
    staleAfterMs: PASSPORT_STALE_AFTER_MS,
  }
}

// The three-way status rule. Order matters: an explicit STALE flag wins, then "never
// passed / overridden" → UNVERIFIED, then the 24h freshness check on a real pass.
function deriveVerificationStatus(
  state: PaperState,
  passDate: string | null,
  hasOverride: boolean,
  nowMs: number,
): VerificationStatus {
  // 1. The STALE-on-edit hook (passport.ts) set this explicitly — it always wins.
  if (state.materialVerification === 'STALE') return 'STALE'

  // 2. Never passed an integrity gate → UNVERIFIED.
  if (!passDate) return 'UNVERIFIED'

  // 3. Proceeded through a gate via a bounded override → the material is not clean;
  //    surface it as UNVERIFIED (the override-logged badge then derives from the record).
  if (hasOverride) return 'UNVERIFIED'

  // 4. A real, override-free pass — VERIFIED only while it is fresh (<24h); else STALE.
  const passMs = Date.parse(passDate)
  if (Number.isNaN(passMs)) return 'UNVERIFIED'
  return nowMs - passMs > PASSPORT_STALE_AFTER_MS ? 'STALE' : 'VERIFIED'
}
