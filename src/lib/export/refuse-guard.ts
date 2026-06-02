// P15.8 — the formatter REFUSE guard contract (FR-42), consumed by the P16 export UI.
//
// The opt-in Claim-Faithfulness Audit can flag claims that materially overstate or
// misattribute their evidence (HIGH-WARN). When that happens, the formatter must
// REFUSE to emit a "publication-grade" artifact — concretely: the PDF and LaTeX
// export paths are removed, while Markdown stays enabled (Markdown is an editable
// working format, not a final typeset deliverable, so the author can still iterate).
//
// This module is the SINGLE SOURCE OF TRUTH for that decision. P16's export screen
// calls computeRefuseGuard(findings) and renders only the allowed formats — it never
// re-derives "is there a HIGH-WARN?" on its own.

import type { ClaimAuditFinding } from '@/lib/types'

// The export formats the app can produce (mirrors PaperConfig.outputFormats values).
// DOCX joins the original P15 set as a fourth, publication-grade ("typeset") deliverable
// alongside PDF and LaTeX — like them, it is refused on a HIGH-WARN (see REFUSED_FORMATS).
export type ExportFormat = 'markdown' | 'latex' | 'pdf' | 'docx'

// The formats that are REMOVED when the guard refuses. These are the typeset,
// publication-grade artifacts (PDF, LaTeX, DOCX). Markdown is deliberately NOT here —
// it always stays available so the author can keep editing the affected claims.
const REFUSED_FORMATS: ExportFormat[] = ['pdf', 'latex', 'docx']
// The format that always survives a refusal.
const SAFE_FORMATS: ExportFormat[] = ['markdown']
// All formats, used when nothing is refused.
const ALL_FORMATS: ExportFormat[] = ['markdown', 'latex', 'pdf', 'docx']

export interface RefuseState {
  // True when at least one HIGH-WARN claim-audit finding exists.
  refuse: boolean
  // Formats the formatter may still emit (PASS: all; REFUSE: Markdown only).
  allowedFormats: ExportFormat[]
  // Formats the formatter must NOT emit (PASS: none; REFUSE: PDF + LaTeX).
  disabledFormats: ExportFormat[]
  // How many HIGH-WARN findings triggered the refusal (0 when not refusing).
  highWarnCount: number
  // Human-readable reason (empty string when not refusing).
  reason: string
}

// computeRefuseGuard — derive the REFUSE state from the claim-audit findings.
//
// Rule (FR-42): ANY HIGH-WARN finding → refuse (PDF + LaTeX removed, Markdown kept).
// LOW-WARN and OK never refuse. Undefined/empty findings (audit disabled or not run)
// never refuse — the absence of an audit is not evidence of a problem.
export function computeRefuseGuard(findings?: ClaimAuditFinding[]): RefuseState {
  const highWarn = (findings ?? []).filter((f) => f.severity === 'HIGH-WARN')
  const highWarnCount = highWarn.length

  if (highWarnCount === 0) {
    return {
      refuse: false,
      allowedFormats: [...ALL_FORMATS],
      disabledFormats: [],
      highWarnCount: 0,
      reason: '',
    }
  }

  return {
    refuse: true,
    allowedFormats: [...SAFE_FORMATS],
    disabledFormats: [...REFUSED_FORMATS],
    highWarnCount,
    reason:
      `The claim-faithfulness audit raised ${highWarnCount} high-severity ` +
      'finding(s): one or more claims materially overstate or misattribute their ' +
      'evidence. Typeset export (PDF / LaTeX / DOCX) is refused until these are ' +
      'resolved; Markdown stays available so you can edit the affected claims.',
  }
}

// Convenience predicate for callers that only need "is this format allowed?".
export function isFormatAllowed(
  format: ExportFormat,
  findings?: ClaimAuditFinding[],
): boolean {
  return computeRefuseGuard(findings).allowedFormats.includes(format)
}
