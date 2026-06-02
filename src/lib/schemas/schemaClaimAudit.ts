// P15 — parses the claim_audit agent's output into a ClaimAuditFinding[].
//
// Same defensive contract as schema5 (extractJsonBlock → validate), but TOLERANT in
// one deliberate way: a faithful paper can legitimately produce ZERO findings, so an
// empty `findings: []` is VALID, not a handoff failure. We only abort if the block is
// structurally wrong (no object, or `findings` is not an array). Individual rows that
// are malformed are skipped (logged) rather than aborting the whole audit — one bad
// row must not discard the other genuine findings.

import type { ClaimAuditFinding, ClaimAuditSeverity } from '@/lib/types'
import { extractJsonBlock } from './index'
import { HandoffIncompleteError } from './errors'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const SEVERITIES: ClaimAuditSeverity[] = ['OK', 'LOW-WARN', 'HIGH-WARN']

// Parse + validate the claim_audit output into a flat ClaimAuditFinding[]. Throws
// HandoffIncompleteError only when the structure is unusable (root not an object, or
// `findings` not an array) — so the caller's single retry targets a genuinely broken
// reply, not a clean "no problems found" one.
export function parseClaimAudit(raw: string): ClaimAuditFinding[] {
  const data = extractJsonBlock(raw)
  if (!isObject(data)) {
    throw new HandoffIncompleteError('claim_audit', ['(root is not a JSON object)'])
  }

  const rawFindings = data.findings
  if (!Array.isArray(rawFindings)) {
    throw new HandoffIncompleteError('claim_audit', ['findings'])
  }

  const findings: ClaimAuditFinding[] = []
  rawFindings.forEach((row, i) => {
    if (!isObject(row)) {
      console.warn('parseClaimAudit: skipping non-object findings[' + i + ']')
      return
    }
    // severity is the one field that drives the REFUSE guard — it MUST be valid.
    const severity = row.severity
    if (typeof severity !== 'string' || !SEVERITIES.includes(severity as ClaimAuditSeverity)) {
      console.warn('parseClaimAudit: skipping findings[' + i + '] with invalid severity:', severity)
      return
    }
    const claim = typeof row.claim === 'string' ? row.claim : ''
    const explanation = typeof row.explanation === 'string' ? row.explanation : ''
    // claim is the human-readable anchor; a finding with neither claim nor explanation
    // is content-free, so drop it.
    if (claim.trim().length === 0 && explanation.trim().length === 0) {
      console.warn('parseClaimAudit: skipping empty findings[' + i + ']')
      return
    }
    const finding: ClaimAuditFinding = {
      id: typeof row.id === 'string' && row.id.trim().length > 0 ? row.id : 'cf-' + (i + 1),
      claim,
      severity: severity as ClaimAuditSeverity,
      explanation,
    }
    if (typeof row.section === 'string' && row.section.trim().length > 0) {
      finding.section = row.section
    }
    if (typeof row.suggestedFix === 'string' && row.suggestedFix.trim().length > 0) {
      finding.suggestedFix = row.suggestedFix
    }
    findings.push(finding)
  })

  return findings
}
