'use client'

// Stage-4→5 FINALIZE page (Phase P15, claim-audit portion).
//
// Reached after the zero-tolerance Stage-4.5 gate sets the paper export-ready. Its job
// is the opt-in L3 Claim-Faithfulness Audit (ARS_CLAIM_AUDIT): if the user enabled the
// audit in Settings, run it ONCE here (export-ready + no findings yet), persist the
// findings, and surface the formatter REFUSE state. A HIGH-WARN finding removes the
// PDF/LaTeX export paths downstream (P16) while Markdown stays available.
//
// Guard: this page is meaningless unless the paper is export-ready. If it is not (the
// final gate has not passed), we send the user to the final gate rather than letting
// them near export — there is no path to export that skips Stage 4.5.
//
// State machine:
//   loading      → read saved paper + global settings
//   not-ready    → pipelineStatus !== 'export-ready' → bounce-to-final-gate guidance
//   auditing     → runClaimAudit() streaming (only when enabled + no findings yet)
//   ready        → audit done (or disabled) → findings + REFUSE state + Continue to Export
//   audit-error  → runClaimAudit THREW → retry; export still gated until it completes

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { buildPaperDraft, runClaimAudit } from '@/lib/ars-client'
import { computeRefuseGuard } from '@/lib/export/refuse-guard'
import { loadPaper, savePaper, loadModelConfig, loadGlobalSettings } from '@/lib/storage'
import type {
  PaperState,
  ModelConfig,
  ClaimAuditFinding,
  ClaimAuditSeverity,
} from '@/lib/types'

type Phase = 'loading' | 'not-ready' | 'auditing' | 'ready' | 'audit-error'

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

export default function FinalizePage() {
  const router = useRouter()

  const [paper, setPaper] = useState<PaperState | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [streamingText, setStreamingText] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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

      // Guard: only an export-ready paper belongs here. Otherwise send the user to the
      // final gate — there is no export path that skips Stage 4.5.
      if (saved.pipelineStatus !== 'export-ready') {
        setPhase('not-ready')
        return
      }

      // Audit disabled, or already run once → just show the ready state (FR-41: run ONCE).
      if (!settings.claimAuditEnabled || saved.claimAuditFindings) {
        setPhase('ready')
        return
      }

      // Enabled + export-ready + no findings yet → run the audit exactly once.
      startAudit()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Render ─────────────────────────────────────────────────────────────────────
  if (phase === 'loading' || !paper) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading finalize…</p>
      </div>
    )
  }

  const findings = paper.claimAuditFindings ?? []
  const refuse = computeRefuseGuard(paper.claimAuditFindings)

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8 sm:py-8">

        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl font-bold mb-1 truncate">{paper.config.topic}</h1>
          <p className="text-sm text-muted-foreground">
            Stage 5 — Finalize ·{' '}
            {paper.config.paperType.replace('_', ' ').toUpperCase()} ·{' '}
            {paper.config.citationFormat}
          </p>
        </div>

        {/* ── NOT READY: the final gate has not passed. No export path from here. ── */}
        {phase === 'not-ready' && (
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-5 space-y-3">
            <p className="font-semibold text-amber-800 dark:text-amber-300">
              Not export-ready yet
            </p>
            <p className="text-sm text-muted-foreground">
              This paper has not cleared the zero-tolerance Stage 4.5 final integrity gate,
              so finalize and export are not available. Run the final gate first.
            </p>
            <Button onClick={() => router.push('/pipeline/final-integrity')}>
              Go to Final Integrity Gate
            </Button>
          </div>
        )}

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

        {/* ── READY: audit done (or disabled). Show findings + REFUSE + Continue. ── */}
        {phase === 'ready' && (
          <div className="space-y-6">

            {/* REFUSE banner — any HIGH-WARN removes PDF/LaTeX downstream (P16). */}
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

            {/* Claim-audit results (only meaningful when the audit ran). */}
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

            <div className="flex flex-col items-start gap-2 sm:flex-row">
              <Button data-testid="continue-to-export" onClick={() => router.push('/export')}>
                Continue to Export →
              </Button>
              <Button variant="outline" onClick={() => router.push('/pipeline')}>
                Back to pipeline
              </Button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
