'use client'

// Stage 6 — PROCESS SUMMARY page (Phase P17). Advisory, NON-BLOCKING: it runs AFTER the
// first export and never re-blocks the pipeline or holds the paper download hostage.
//
// What it renders:
//   • AI Self-Reflection Report (4 sections — timeline / decisions / disagreements / model)
//   • Collaboration Depth chart (4 dimensions 1–5 + prominent Zone badge; text fallback)
//   • Failure-Mode Audit Log (all 7 modes, assembled LOCALLY — no LLM call)
//   • AI-usage disclosure statement + Copy button
//   • "Download Process Summary" PDF (separate Typst compile, Stage-6 content only)
//
// Non-blocking guards (P17.6):
//   • Accessed pre-export-ready → advisory only (the LLM agents do NOT run; the local
//     sections still render so the page is never blank).
//   • Stage-6 (LLM) fail → Retry. The LOCAL sections (audit log, timeline, disclosure)
//     keep rendering and the paper download is unaffected (link back to finalize).
//
// State machine:
//   loading  → read saved paper
//   advisory → pipelineStatus !== 'export-ready' (Stage 6 runs after export)
//   running  → runProcessSummary() streaming (only when export-ready + not yet run)
//   ready    → summary available (persisted) → full render
//   error    → runProcessSummary THREW → retry; local sections still shown

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { AISelfReflectionReport } from '@/components/pipeline/AISelfReflectionReport'
import { CollaborationDepthChart } from '@/components/pipeline/CollaborationDepthChart'
import { FailureModeAuditLog } from '@/components/pipeline/FailureModeAuditLog'
import { runProcessSummary } from '@/lib/ars-client'
import {
  buildPipelineTrace,
  buildKeyDecisions,
  buildModelPerStage,
  buildFailureModeAuditLog,
  buildDisclosureStatement,
  serializeAuditLog,
} from '@/lib/process-summary'
import { loadPaper, savePaper, loadModelConfig } from '@/lib/storage'
import type { PaperState, ModelConfig, AISelfReflection, CollaborationDepth } from '@/lib/types'
import type { SummaryDoc } from '@/lib/export/summary-typst'

type Phase = 'loading' | 'advisory' | 'running' | 'ready' | 'error'

// Same marker /api/export-summary-pdf returns when Typst is not installed (see route).
const TYPST_MISSING_MARKER = 'Typst executable not found'

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

export default function SummaryPage() {
  const router = useRouter()

  const [paper, setPaper] = useState<PaperState | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [streamingText, setStreamingText] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Disclosure + PDF UI state.
  const [copied, setCopied] = useState(false)
  const [isPdfLoading, setIsPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [typstMissing, setTypstMissing] = useState(false)
  // The active model's display label, held in STATE (not just the ref) so it can be read
  // safely during render (the ref is only for passing the full ModelConfig to the agent).
  const [modelLabel, setModelLabel] = useState('Claude Sonnet 4.5 (default)')

  const isRunningRef = useRef(false)
  const paperRef = useRef<PaperState | null>(null)
  const modelConfigRef = useRef<ModelConfig | undefined>(undefined)

  const persist = useCallback((updater: (prev: PaperState) => PaperState) => {
    if (!paperRef.current) return
    const next = updater(paperRef.current)
    next.updatedAt = new Date().toISOString()
    paperRef.current = next
    setPaper(next)
    savePaper(next)
  }, [])

  // ─── Run the Stage-6 process summary (once; also the retry path) ─────────────────
  const startSummary = useCallback(async () => {
    if (isRunningRef.current) return
    if (!paperRef.current) return
    isRunningRef.current = true

    setErrorMessage(null)
    setStreamingText('')
    setPhase('running')
    persist((prev) => ({ ...prev, processSummaryStatus: 'running' }))

    try {
      const summary = await runProcessSummary(
        paperRef.current,
        (chunk) => setStreamingText((prev) => prev + chunk),
        modelConfigRef.current,
      )
      persist((prev) => ({
        ...prev,
        processSummary: summary,
        processSummaryStatus: 'done',
      }))
      setPhase('ready')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMessage(msg)
      setPhase('error')
      persist((prev) => ({ ...prev, processSummaryStatus: 'error' }))
      console.error('Process summary failed to complete:', err)
    } finally {
      isRunningRef.current = false
      setStreamingText('')
    }
  }, [persist])

  // ─── Mount: load paper, then decide what to do ───────────────────────────────────
  useEffect(() => {
    if (paperRef.current !== null) return

    const saved = loadPaper()
    if (!saved || saved.sections.length === 0) {
      router.replace('/pipeline')
      return
    }

    paperRef.current = saved
    const model = loadModelConfig()
    modelConfigRef.current = model

    queueMicrotask(() => {
      setPaper(saved)
      setModelLabel(model.label)

      // Advisory guard (P17.6): Stage 6 runs AFTER the first export. If the paper is not
      // export-ready, do NOT run the agents — show the advisory state (local sections still
      // render below). The paper download is unaffected.
      if (saved.pipelineStatus !== 'export-ready') {
        setPhase('advisory')
        return
      }

      // Already run once → just show it (don't re-run; mirrors the claim-audit run-once rule).
      if (saved.processSummary) {
        setPhase('ready')
        return
      }

      // Export-ready + not yet run → run the summary exactly once.
      startSummary()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Build a LOCAL-only reflection (timeline / decisions / model) so the 4 self-reflection
  // sections always render — even in advisory/error phases where the agent did not run.
  const localReflection = useCallback((state: PaperState): AISelfReflection => {
    return {
      timeline: buildPipelineTrace(state),
      keyDecisions: buildKeyDecisions(state),
      modelPerStage: buildModelPerStage(state, modelLabel),
      agentDisagreements: [],
    }
  }, [modelLabel])

  // ─── Disclosure copy ─────────────────────────────────────────────────────────────
  const handleCopyDisclosure = useCallback(async () => {
    if (!paperRef.current) return
    const text = buildDisclosureStatement(paperRef.current, modelLabel)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      // Clipboard can be blocked (insecure context / permissions). Log; do not crash.
      console.error('Failed to copy disclosure to clipboard:', err)
    }
  }, [modelLabel])

  // ─── Assemble the Stage-6-only SummaryDoc and download it as a PDF (P17.5) ────────
  const handleDownloadPdf = useCallback(async () => {
    if (!paperRef.current || isPdfLoading) return
    const state = paperRef.current
    setIsPdfLoading(true)
    setPdfError(null)

    const reflection = state.processSummary?.selfReflection ?? localReflection(state)
    const depth: CollaborationDepth | null = state.processSummary?.collaborationDepth ?? null
    const auditEntries = buildFailureModeAuditLog(state)

    const sections: SummaryDoc['sections'] = []

    // 1. Self-reflection narrative + timeline + decisions + disagreements + models.
    const reflectionParagraphs: string[] = []
    if (reflection.narrative) reflectionParagraphs.push(reflection.narrative)
    sections.push({
      heading: 'AI Self-Reflection Report',
      paragraphs: reflectionParagraphs.length ? reflectionParagraphs : ['(No reflective narrative was generated.)'],
    })
    sections.push({
      heading: 'Execution timeline',
      table: {
        header: ['Stage', 'Outcome', 'Status'],
        rows: reflection.timeline.map((t) => [t.stage, `${t.label}${t.detail ? ` (${t.detail})` : ''}`, t.status]),
      },
    })
    sections.push({
      heading: 'Key decisions',
      bullets: reflection.keyDecisions.map((d) => `${d.label}: ${d.detail}`),
    })
    sections.push({
      heading: 'Logged agent disagreements',
      paragraphs: reflection.agentDisagreements.length
        ? undefined
        : ['No material agent disagreements were logged during this run.'],
      bullets: reflection.agentDisagreements.length ? reflection.agentDisagreements : undefined,
    })
    sections.push({
      heading: 'Model per stage',
      table: {
        header: ['Stage', 'Model'],
        rows: reflection.modelPerStage.map((m) => [m.stage, m.model]),
      },
    })

    // 2. Collaboration depth.
    if (depth) {
      sections.push({
        heading: 'Collaboration Depth',
        paragraphs: [`Zone: ${depth.zoneLabel} (${depth.zoneClassification}/5).${depth.rationale ? ` ${depth.rationale}` : ''}`],
        table: {
          header: ['Dimension', 'Score (1-5)'],
          rows: [
            ['Delegation Intensity', String(depth.delegationIntensity)],
            ['Cognitive Vigilance', String(depth.cognitiveVigilance)],
            ['Cognitive Reallocation', String(depth.cognitiveReallocation)],
            ['Zone Classification', String(depth.zoneClassification)],
          ],
        },
      })
    } else {
      sections.push({
        heading: 'Collaboration Depth',
        paragraphs: ['Collaboration-depth scores are unavailable for this run.'],
      })
    }

    // 3. Failure-mode audit log (the serialized local table).
    sections.push({
      heading: 'Failure-Mode Audit Log',
      paragraphs: [serializeAuditLog(state, auditEntries)],
    })

    // 4. Disclosure statement.
    sections.push({
      heading: 'AI-Usage Disclosure',
      paragraphs: [buildDisclosureStatement(state, modelLabel)],
    })

    const doc: SummaryDoc = {
      title: 'Process Summary',
      subtitle: state.config.topic,
      sections,
    }

    try {
      const response = await fetch('/api/export-summary-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: doc }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(err.error ?? response.statusText)
      }
      const blob = await response.blob()
      const safe = state.config.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'paper'
      downloadBlob(blob, `${safe}-process-summary.pdf`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setPdfError(msg)
      if (msg.includes(TYPST_MISSING_MARKER)) setTypstMissing(true)
    } finally {
      setIsPdfLoading(false)
    }
  }, [isPdfLoading, localReflection, modelLabel])

  // ─── Render ─────────────────────────────────────────────────────────────────────
  if (phase === 'loading' || !paper) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading process summary…</p>
      </div>
    )
  }

  const reflection = paper.processSummary?.selfReflection ?? localReflection(paper)
  const depth = paper.processSummary?.collaborationDepth ?? null

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8 sm:py-8">

        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl font-bold mb-1 truncate">{paper.config.topic}</h1>
          <p className="text-sm text-muted-foreground">
            Stage 6 — Process Summary · {paper.config.paperType.replace('_', ' ').toUpperCase()} ·{' '}
            {paper.config.citationFormat}
          </p>
        </div>

        {/* ── ADVISORY: accessed before export-ready. Local sections still render. ── */}
        {phase === 'advisory' && (
          <div
            role="status"
            data-testid="summary-advisory"
            className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-5 space-y-2 text-sm text-amber-800 dark:text-amber-200"
          >
            <p className="font-semibold">Process summary runs after your first export</p>
            <p>
              The AI self-reflection and collaboration-depth report is generated once the
              paper has passed the final integrity gate and been exported. The locally-built
              audit log and timeline below are available now; the reflective narrative will
              appear after export.
            </p>
            <Button variant="outline" size="sm" onClick={() => router.push('/pipeline/finalize')}>
              Go to Finalize &amp; Export
            </Button>
          </div>
        )}

        {/* ── RUNNING: the Stage-6 agents are streaming. ── */}
        {phase === 'running' && (
          <div className="rounded-lg border bg-card p-5 space-y-3">
            <p className="font-semibold">Generating the process summary…</p>
            <p className="text-sm text-muted-foreground">
              Writing the AI self-reflection report and scoring the collaboration depth.
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

        {/* ── ERROR: the LLM summary failed. Non-blocking — local sections still render. ── */}
        {phase === 'error' && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 space-y-3">
            <p className="font-semibold text-destructive">
              Process summary could not complete. Retry?
            </p>
            {errorMessage && <p className="text-sm text-muted-foreground">{errorMessage}</p>}
            <p className="text-xs text-muted-foreground">
              This is a non-blocking step — your paper is unaffected and can still be
              downloaded from the Finalize screen. The local audit log and timeline below are
              still available.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button data-testid="retry-process-summary" onClick={startSummary}>
                Retry process summary
              </Button>
              <Button variant="outline" onClick={() => router.push('/pipeline/finalize')}>
                Back to Finalize &amp; Export
              </Button>
            </div>
          </div>
        )}

        {/* ── The Stage-6 content. Local sections (reflection scaffolding + audit log +
            disclosure) render in EVERY non-loading phase; the LLM narrative + depth fill in
            once available. ── */}
        <AISelfReflectionReport reflection={reflection} />

        <CollaborationDepthChart depth={depth} />

        <FailureModeAuditLog state={paper} />

        {/* ── Disclosure statement + Copy (P17.5) ── */}
        <section aria-labelledby="disclosure-heading" className="space-y-3" data-testid="disclosure-block">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="disclosure-heading" className="text-lg font-semibold">
                AI-Usage Disclosure
              </h2>
              <p className="text-sm text-muted-foreground">
                A ready-to-paste statement for your acknowledgements or methods section.
              </p>
            </div>
            <Button variant="outline" size="sm" data-testid="copy-disclosure" onClick={handleCopyDisclosure}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <pre className="rounded-lg border bg-muted/20 p-4 text-xs leading-relaxed whitespace-pre-wrap font-sans">
            {buildDisclosureStatement(paper, modelLabel)}
          </pre>
        </section>

        {/* ── Download Process Summary PDF (P17.5) ── */}
        <section aria-labelledby="download-heading" className="space-y-3">
          <h2 id="download-heading" className="text-lg font-semibold">
            Download
          </h2>
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <Button
              data-testid="download-process-summary"
              onClick={handleDownloadPdf}
              disabled={isPdfLoading || typstMissing}
            >
              {isPdfLoading ? 'Compiling PDF…' : 'Download Process Summary (PDF)'}
            </Button>
            <Button variant="outline" onClick={() => router.push('/pipeline/finalize')}>
              Back to Finalize &amp; Export
            </Button>
          </div>
          {typstMissing && (
            <p className="text-xs text-amber-700 dark:text-amber-400" role="status">
              The PDF needs Typst installed on the server. It is unavailable here — the audit
              log above has its own plain-text download, and your paper is unaffected.
            </p>
          )}
          {pdfError && !typstMissing && (
            <p className="text-xs text-destructive">{pdfError}</p>
          )}
        </section>

      </div>
    </div>
  )
}
