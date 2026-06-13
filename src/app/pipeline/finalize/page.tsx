'use client'

// Stage 5 — FINALIZE / EXPORT page (Phase P16, extends the P15 claim-audit page).
//
// Reached after the zero-tolerance Stage-4.5 gate sets the paper export-ready. This page
// is now the real export surface: it gates the format picker behind export-ready, applies
// the formatter REFUSE state on a HIGH-WARN claim-audit finding, and reuses the shipped P6
// Markdown / LaTeX / DOCX builders + the /api/export-pdf Typst route.
//
// Iron rules enforced here:
//   • Direct-nav guard (P16.6): if the paper is NOT export-ready, redirect to the final
//     gate — there is no export path that skips Stage 4.5.
//   • REFUSE (FR-42): a HIGH-WARN claim-audit finding REMOVES the PDF / LaTeX / DOCX cards
//     from the DOM (not merely disables them). Markdown always stays (escape hatch).
//   • The format picker only renders once the paper is export-ready (FR-44).
//
// State machine:
//   loading      → read saved paper + global settings
//   redirecting  → pipelineStatus !== 'export-ready' → router.replace to the final gate
//   auditing     → runClaimAudit() streaming (only when enabled + no findings yet)
//   ready        → audit done (or disabled) → integrity seal + REFUSE + format picker
//   audit-error  → runClaimAudit THREW → retry; export still gated until it completes

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { buildPaperDraft, runClaimAudit, formatPaper } from '@/lib/ars-client'
import type { TextExportFormat } from '@/lib/ars-client'
import { computeRefuseGuard } from '@/lib/export/refuse-guard'
import type { ExportFormat } from '@/lib/export/refuse-guard'
import {
  loadPaper,
  savePaper,
  savePaperChecked,
  loadModelConfig,
  loadGlobalSettings,
} from '@/lib/storage'
import type {
  PaperState,
  ModelConfig,
  ClaimAuditFinding,
  ClaimAuditSeverity,
} from '@/lib/types'

type Phase = 'loading' | 'redirecting' | 'auditing' | 'ready' | 'audit-error'

// Error text from /api/export-pdf when Typst is not installed on the server (see the
// runTypst fallback in /api/export-pdf/route.ts). Detected so we can show the amber hint.
const TYPST_MISSING_MARKER = 'Typst executable not found'

// Severity → badge (text-first per NFR-17).
function SeverityBadge({ severity }: { severity: ClaimAuditSeverity }) {
  if (severity === 'HIGH-WARN') {
    return <Badge variant="destructive">High warning</Badge>
  }
  if (severity === 'LOW-WARN') {
    return (
      <Badge
        variant="outline"
        className="border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-300"
      >
        Low warning
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className="border-green-400 text-green-700 dark:border-green-600 dark:text-green-400"
    >
      OK
    </Badge>
  )
}

// Trigger a browser download of an in-memory blob.
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function FinalizePage() {
  const router = useRouter()

  const [paper, setPaper] = useState<PaperState | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [streamingText, setStreamingText] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Export UI state.
  const [isPdfLoading, setIsPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [typstMissing, setTypstMissing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const isRunningRef = useRef(false)
  const paperRef = useRef<PaperState | null>(null)
  const modelConfigRef = useRef<ModelConfig | undefined>(undefined)
  const auditEnabledRef = useRef(false)

  const persist = useCallback((updater: (prev: PaperState) => PaperState) => {
    if (!paperRef.current) return
    const next = updater(paperRef.current)
    next.updatedAt = new Date().toISOString()
    paperRef.current = next
    setPaper(next)
    savePaper(next)
  }, [])

  // Record a successful export in exportedFormats (append-only set). Uses the quota-aware
  // save so a full localStorage surfaces the NFR-07 toast instead of failing silently —
  // the download already succeeded, only the bookkeeping write can fail.
  const recordExportedFormat = useCallback((format: ExportFormat) => {
    if (!paperRef.current) return
    const prev = paperRef.current
    const already = new Set(prev.exportedFormats ?? [])
    if (already.has(format)) return
    already.add(format)
    const next: PaperState = {
      ...prev,
      exportedFormats: [...already],
      updatedAt: new Date().toISOString(),
    }
    paperRef.current = next
    setPaper(next)
    const result = savePaperChecked(next)
    if (!result.ok && result.quotaExceeded) {
      setToast(
        "Couldn't save your export history — browser storage is full. Your download still worked.",
      )
    }
  }, [])

  // ─── Run the claim audit (once; also the retry path) ────────────────────────────
  const startAudit = useCallback(async () => {
    if (isRunningRef.current) return
    if (!paperRef.current) return
    isRunningRef.current = true

    setErrorMessage(null)
    setStreamingText('')
    setPhase('auditing')
    persist((prev) => ({ ...prev, claimAuditStatus: 'running' }))

    try {
      const draft = buildPaperDraft(paperRef.current)
      const findings = await runClaimAudit(
        draft,
        paperRef.current.config,
        (chunk) => setStreamingText((prev) => prev + chunk),
        modelConfigRef.current,
      )
      persist((prev) => ({
        ...prev,
        claimAuditFindings: findings,
        claimAuditStatus: 'done',
      }))
      setPhase('ready')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMessage(msg)
      setPhase('audit-error')
      persist((prev) => ({ ...prev, claimAuditStatus: 'error' }))
      console.error('Claim audit failed to complete:', err)
    } finally {
      isRunningRef.current = false
      setStreamingText('')
    }
  }, [persist])

  // ─── Mount: load paper + settings, then decide what to do ───────────────────────
  useEffect(() => {
    if (paperRef.current !== null) return

    const saved = loadPaper()
    if (!saved || saved.sections.length === 0) {
      router.replace('/pipeline')
      return
    }

    paperRef.current = saved
    modelConfigRef.current = loadModelConfig()
    const settings = loadGlobalSettings()
    auditEnabledRef.current = settings.claimAuditEnabled

    queueMicrotask(() => {
      setPaper(saved)

      // Direct-nav guard (P16.6): only an export-ready paper belongs here. Otherwise
      // redirect to the final gate — there is no export path that skips Stage 4.5.
      if (saved.pipelineStatus !== 'export-ready') {
        setPhase('redirecting')
        router.replace('/pipeline/final-integrity')
        return
      }

      // Audit disabled, or already run once → just show the ready state (FR-41: run ONCE).
      if (!settings.claimAuditEnabled || saved.claimAuditFindings) {
        setPhase('ready')
        return
      }

      // Enabled + export-ready + no findings yet → run the audit exactly once before
      // rendering the export choices (P16.3).
      startAudit()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Text-format export (Markdown / LaTeX / DOCX) via the P6 builders ────────────
  const handleTextExport = useCallback(
    (format: TextExportFormat) => {
      if (!paperRef.current) return
      const artifact = formatPaper(paperRef.current, format)
      downloadBlob(new Blob([artifact.content], { type: artifact.mimeType }), artifact.filename)
      recordExportedFormat(format)
    },
    [recordExportedFormat],
  )

  // ─── PDF export via the /api/export-pdf Typst route (reused from P6) ─────────────
  const handlePdf = useCallback(async () => {
    if (!paperRef.current || isPdfLoading) return
    setIsPdfLoading(true)
    setPdfError(null)

    try {
      const response = await fetch('/api/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper: paperRef.current }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(err.error ?? response.statusText)
      }

      const blob = await response.blob()
      const topic = paperRef.current.config.topic
      const safe = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'paper'
      downloadBlob(blob, `${safe}.pdf`)
      recordExportedFormat('pdf')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setPdfError(msg)
      // If Typst isn't installed on the server, surface the amber hint (PDF unavailable,
      // Markdown / LaTeX still work) rather than a bare error string.
      if (msg.includes(TYPST_MISSING_MARKER)) setTypstMissing(true)
    } finally {
      setIsPdfLoading(false)
    }
  }, [isPdfLoading, recordExportedFormat])

  // ─── Render ─────────────────────────────────────────────────────────────────────
  if (phase === 'loading' || phase === 'redirecting' || !paper) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">
          {phase === 'redirecting' ? 'Not export-ready — returning to the final gate…' : 'Loading finalize…'}
        </p>
      </div>
    )
  }

  const findings = paper.claimAuditFindings ?? []
  const highWarnFindings = findings.filter((f) => f.severity === 'HIGH-WARN')
  const refuse = computeRefuseGuard(paper.claimAuditFindings)
  const allowed = (format: ExportFormat) => refuse.allowedFormats.includes(format)
  const exported = paper.exportedFormats ?? []

  // Integrity seal data (Schema 9): all gates passed · final integrity date · version label.
  const versionLabel = buildPaperDraft(paper).versionLabel
  const passDate = paper.finalIntegrityPassDate
    ? new Date(paper.finalIntegrityPassDate).toLocaleString()
    : 'recorded'

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8 sm:py-8">

        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl font-bold mb-1 truncate">{paper.config.topic}</h1>
          <p className="text-sm text-muted-foreground">
            Stage 5 — Finalize &amp; Export ·{' '}
            {paper.config.paperType.replace('_', ' ').toUpperCase()} ·{' '}
            {paper.config.citationFormat}
          </p>
        </div>

        {/* ── AUDITING: the claim audit is streaming. ── */}
        {phase === 'auditing' && (
          <div className="rounded-lg border bg-card p-5 space-y-3">
            <p className="font-semibold">Running claim-faithfulness audit…</p>
            <p className="text-sm text-muted-foreground">
              Checking whether each substantive claim matches the strength of its evidence.
            </p>
            <div
              aria-live="polite"
              aria-busy="true"
              className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground/80"
            >
              {streamingText || 'Waiting for the first response…'}
            </div>
          </div>
        )}

        {/* ── AUDIT ERROR: the audit could not complete. Export stays gated; retry. ── */}
        {phase === 'audit-error' && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 space-y-3">
            <p className="font-semibold text-destructive">
              Claim audit could not complete. Retry?
            </p>
            {errorMessage && <p className="text-sm text-muted-foreground">{errorMessage}</p>}
            <p className="text-xs text-muted-foreground">
              The audit agent did not return a usable result (a network or format error).
              Export stays gated until the audit completes.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button data-testid="retry-claim-audit" onClick={startAudit}>
                Retry claim audit
              </Button>
              <Button variant="outline" onClick={() => router.push('/pipeline')}>
                Back to pipeline
              </Button>
            </div>
          </div>
        )}

        {/* ── READY: audit done (or disabled). Integrity seal + REFUSE + format picker. ── */}
        {phase === 'ready' && (
          <div className="space-y-6">

            {/* Integrity seal Badge (P16.4 / Schema 9). */}
            <div
              data-testid="integrity-seal"
              role="status"
              className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20 p-4 text-sm text-green-800 dark:text-green-200"
            >
              <span className="font-semibold">All gates passed</span> · Final integrity:{' '}
              {passDate} · Version: <span className="font-mono">{versionLabel}</span>
            </div>

            {/* REFUSE banner — any HIGH-WARN removes PDF / LaTeX / DOCX (Markdown stays). */}
            {refuse.refuse && (
              <div
                role="alert"
                data-testid="refuse-banner"
                className="rounded-lg border border-destructive/40 bg-destructive/10 p-5 space-y-2 text-sm text-destructive"
              >
                <p className="font-semibold">Typeset export refused</p>
                <p>{refuse.reason}</p>
                <p className="text-xs">
                  Disabled: {refuse.disabledFormats.join(', ').toUpperCase()} · Still
                  available: {refuse.allowedFormats.join(', ').toUpperCase()}
                </p>
              </div>
            )}

            {/* HIGH-WARN annotation Accordion (P16.3) — only when refusing. Native
                <details> elements act as the accordion (no extra UI dependency). */}
            {refuse.refuse && highWarnFindings.length > 0 && (
              <section aria-labelledby="high-warn-heading" className="space-y-2" data-testid="high-warn-accordion">
                <h2 id="high-warn-heading" className="text-sm font-semibold text-destructive">
                  High-severity faithfulness findings ({highWarnFindings.length})
                </h2>
                <div className="space-y-2">
                  {highWarnFindings.map((f) => (
                    <details key={f.id} className="rounded-md border border-destructive/30 p-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        {f.claim || 'Claim'}{f.section ? ` — ${f.section}` : ''}
                      </summary>
                      <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                        {f.explanation && <p>{f.explanation}</p>}
                        {f.suggestedFix && (
                          <p>
                            <span className="font-semibold">Suggested fix: </span>
                            {f.suggestedFix}
                          </p>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            )}

            {/* Full claim-audit results (only meaningful when the audit ran). */}
            {paper.claimAuditStatus === 'done' || findings.length > 0 ? (
              <section aria-labelledby="claim-audit-heading" className="space-y-3">
                <h2 id="claim-audit-heading" className="text-sm font-semibold">
                  Claim-Faithfulness Audit
                </h2>
                {findings.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="claim-audit-clean">
                    No faithfulness issues found — every audited claim is supported by its
                    evidence.
                  </p>
                ) : (
                  <ul className="space-y-3" data-testid="claim-audit-findings">
                    {findings.map((f: ClaimAuditFinding) => (
                      <li key={f.id} className="rounded-md border p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <SeverityBadge severity={f.severity} />
                          {f.section && (
                            <span className="text-xs text-muted-foreground">{f.section}</span>
                          )}
                        </div>
                        {f.claim && <p className="text-sm font-medium">{f.claim}</p>}
                        {f.explanation && (
                          <p className="text-xs text-muted-foreground">{f.explanation}</p>
                        )}
                        {f.suggestedFix && (
                          <p className="text-xs text-muted-foreground">
                            <span className="font-semibold">Suggested fix: </span>
                            {f.suggestedFix}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : (
              <p className="text-sm text-muted-foreground">
                The claim-faithfulness audit is off (enable it in Settings to run it). Your
                paper passed the final integrity gate and is ready to export.
              </p>
            )}

            {/* ── Format picker (FR-44). Only export-ready papers reach this branch, so the
                picker only ever renders post-gate. Refused (typeset) formats are absent
                from the DOM — not disabled. Markdown is always present. ── */}
            <section aria-labelledby="export-heading" className="space-y-3">
              <h2 id="export-heading" className="text-sm font-semibold">
                Export
              </h2>
              <div className="grid gap-4 sm:grid-cols-2" data-testid="format-picker">
                {/* Markdown — always available (escape hatch). */}
                <div className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">Markdown</p>
                    <Badge variant="outline">Always works</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Editable working format — backup, Obsidian, Git.
                  </p>
                  <Button
                    className="w-full"
                    data-testid="export-markdown"
                    onClick={() => handleTextExport('markdown')}
                  >
                    Download .md
                  </Button>
                </div>

                {/* DOCX — typeset deliverable, removed from the DOM on REFUSE. */}
                {allowed('docx') && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">Word (DOCX)</p>
                      <Badge variant="outline">Word</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Opens in Microsoft Word as an editable document.
                    </p>
                    <Button
                      className="w-full"
                      data-testid="export-docx"
                      onClick={() => handleTextExport('docx')}
                    >
                      Download .doc
                    </Button>
                  </div>
                )}

                {/* LaTeX — typeset deliverable, removed from the DOM on REFUSE. */}
                {allowed('latex') && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">LaTeX</p>
                      <Badge variant="outline">Overleaf</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      IEEEtran wrapper with math packages included.
                    </p>
                    <Button
                      className="w-full"
                      data-testid="export-latex"
                      onClick={() => handleTextExport('latex')}
                    >
                      Download .tex
                    </Button>
                  </div>
                )}

                {/* PDF — typeset deliverable, removed from the DOM on REFUSE. */}
                {allowed('pdf') && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">PDF</p>
                      <Badge variant="outline">Typst</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Two-column IEEE-like PDF compiled on the server.
                    </p>
                    <Button
                      className="w-full"
                      data-testid="export-pdf"
                      onClick={handlePdf}
                      disabled={isPdfLoading || typstMissing}
                    >
                      {isPdfLoading ? 'Compiling PDF…' : 'Download .pdf'}
                    </Button>
                    {typstMissing && (
                      <p className="text-xs text-amber-700 dark:text-amber-400" role="status">
                        PDF needs Typst installed on the server. It is unavailable here —
                        use Markdown or LaTeX (compile the .tex in Overleaf) instead.
                      </p>
                    )}
                    {pdfError && !typstMissing && (
                      <p className="text-xs text-destructive">{pdfError}</p>
                    )}
                  </div>
                )}
              </div>

              {exported.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Already exported: {exported.join(', ').toUpperCase()}
                </p>
              )}
            </section>

            <div className="flex flex-col items-start gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => router.push('/pipeline')}>
                Back to pipeline
              </Button>
            </div>
          </div>
        )}

        {/* ── NFR-07 quota toast — dismissible; export history could not be saved. ── */}
        {toast && (
          <div
            role="status"
            data-testid="quota-toast"
            className="fixed bottom-4 left-1/2 -translate-x-1/2 max-w-md rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 shadow-lg"
          >
            <div className="flex items-start gap-3">
              <span>{toast}</span>
              <button
                className="text-xs underline shrink-0"
                onClick={() => setToast(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
