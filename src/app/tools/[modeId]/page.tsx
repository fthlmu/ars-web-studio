'use client'

import { useState, useRef, useMemo } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getMode } from '@/lib/tools/registry'
import type { IntakeType } from '@/lib/tools/registry'
import { runToolMode } from '@/lib/tools/run'
import { ToolNotReadyError, MissingInputError, isApiMode } from '@/lib/tools/prompt-builder'
import type { ToolInputs } from '@/lib/tools/prompt-builder'
import { loadModelConfig } from '@/lib/storage'
import { safeFilename } from '@/lib/export/content'
import {
  convertTextSync,
  rawTextToPaperState,
  formatToExtension,
  formatMimeType,
} from '@/lib/export/format-convert'
import {
  saveImportedPaper,
  loadImportedPaper,
  saveReviewerComments,
  loadReviewerComments,
} from '@/lib/tools/imported-paper'
import { PaperInput } from '@/components/tools/PaperInput'
import { CommentsInput } from '@/components/tools/CommentsInput'
import { TopicInput } from '@/components/tools/TopicInput'
import { InteractiveRunner } from '@/components/tools/InteractiveRunner'

type RunStatus = 'idle' | 'active' | 'done' | 'error'

export default function ToolRunnerPage() {
  const { modeId } = useParams<{ modeId: string }>()
  const router = useRouter()
  const mode = getMode(modeId)

  // Lazy initializer: read localStorage once on first render (client only).
  // typeof-window guard ensures the server render returns {} without errors.
  const [inputs, setInputs] = useState<ToolInputs>(() => {
    if (typeof window === 'undefined') return {}
    const paper = loadImportedPaper()
    const comments = loadReviewerComments()
    return {
      ...(paper !== null ? { paperText: paper } : {}),
      ...(comments !== null ? { comments } : {}),
    }
  })
  const [streamingText, setStreamingText] = useState('')
  const [status, setStatus] = useState<RunStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const fullTextRef = useRef('')
  const isRunningRef = useRef(false)

  // Derive whether all required inputs are present — gates the Run button
  const readyToRun = useMemo(() => {
    if (!mode || !isApiMode(mode)) return false
    for (const type of mode.intake) {
      switch (type) {
        case 'topic':     if (!inputs.topic?.trim())      return false; break
        case 'byo-paper': if (!inputs.paperText?.trim())  return false; break
        case 'comments':  if (!inputs.comments?.trim())   return false; break
        case 'claims':    if (!inputs.claims?.trim())     return false; break
        case 'config':    if (!inputs.config)             return false; break
      }
    }
    for (const field of mode.optionFields ?? []) {
      if (field.required && !inputs.options?.[field.key]?.trim()) return false
    }
    return true
  }, [mode, inputs])

  // ── Format-convert handler (export-helper mode, QT2) ──────────────────────
  // Defined before early returns so it is in scope for the export-helper branch.

  async function handleConvert() {
    if (!inputs.paperText?.trim()) return
    setStatus('active')
    setError(null)
    fullTextRef.current = ''

    const rawFormat = inputs.options?.targetFormat ?? ''
    const ext = formatToExtension(rawFormat)

    try {
      if (ext === 'pdf') {
        const paper = rawTextToPaperState(inputs.paperText)
        const res = await fetch('/api/export-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paper }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: res.statusText }))
          throw new Error(`PDF export failed: ${(data as { error?: string }).error ?? res.statusText}`)
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'converted.pdf'
        a.click()
        URL.revokeObjectURL(url)
        fullTextRef.current = '[PDF downloaded successfully]'
        setStreamingText('[PDF downloaded successfully]')
      } else {
        const converted = convertTextSync(inputs.paperText, rawFormat)
        fullTextRef.current = converted ?? ''
        setStreamingText(fullTextRef.current)
      }
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  function handleDownloadConvert() {
    const rawFormat = inputs.options?.targetFormat ?? 'markdown'
    const ext = formatToExtension(rawFormat)
    const mimeType = formatMimeType(ext)
    const blob = new Blob([fullTextRef.current], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = safeFilename('converted', ext)
    a.click()
    URL.revokeObjectURL(url)
  }

  // Unknown mode
  if (!mode) {
    return (
      <div className="flex min-h-[calc(100vh-57px)] flex-col items-center justify-center gap-4 text-center px-4">
        <p className="text-lg font-semibold">Unknown tool: &ldquo;{modeId}&rdquo;</p>
        <Link href="/tools" className="text-sm text-primary underline underline-offset-4">
          ← Back to Quick Tools
        </Link>
      </div>
    )
  }

  // ── Launcher (pipeline) ───────────────────────────────────────────────────
  if (mode.delivery === 'launch') {
    const href = mode.launchHref ?? '/pipeline'
    const fallbackHref = mode.fallbackModeId ? `/tools/${mode.fallbackModeId}` : null
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 space-y-6">
        <BackLink />
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{mode.label}</h1>
          <p className="text-muted-foreground">{mode.examplePrompt}</p>
        </div>
        <div className="rounded-lg border bg-muted/20 p-5 space-y-4">
          <p className="text-sm">
            This mode runs the full ARS pipeline — not a standalone one-shot call.
          </p>
          <Button onClick={() => router.push(href)}>
            Open in Pipeline →
          </Button>
          {fallbackHref && (
            <p className="text-xs text-muted-foreground">
              True mid-entry (P18 state router) isn&apos;t built yet.{' '}
              <Link href={fallbackHref} className="underline underline-offset-4">
                Use the nearest standalone tool instead →
              </Link>
            </p>
          )}
        </div>
      </div>
    )
  }

  // ── Interactive (multi-turn chat) — QT7 ──────────────────────────────────
  // Modes #4 research-socratic, #9 paper-plan, #20 review-guided are a dialogue,
  // not a one-shot. Isolate them onto the chat runner BEFORE the single-shot path.
  // (isApiMode guards out launchers/export-helpers, which never reach here anyway.)
  if (mode.delivery === 'interactive' && isApiMode(mode)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
        <BackLink />
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{mode.label}</h1>
          <p className="text-sm text-muted-foreground">{mode.examplePrompt}</p>
          {mode.approximation && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Lightweight approximation — not the verified P9 research corpus.
            </p>
          )}
        </div>
        <InteractiveRunner mode={mode} />
      </div>
    )
  }

  // ── Export-helper (format-convert) — QT2 ────────────────────────────────
  if (mode.promptSource.kind === 'export-helper') {
    const targetFormat = inputs.options?.targetFormat ?? ''
    const hasPaper = !!inputs.paperText?.trim()
    const hasFormat = !!targetFormat.trim()
    const readyToConvert = hasPaper && hasFormat
    const isPdf = formatToExtension(targetFormat) === 'pdf'
    const pdfDownloaded = streamingText === '[PDF downloaded successfully]'

    return (
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
        <BackLink />

        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{mode.label}</h1>
          <p className="text-sm text-muted-foreground">{mode.examplePrompt}</p>
          <p className="text-xs text-muted-foreground">
            Client-side conversion — no AI call. Markdown and LaTeX are instant; PDF uses Typst (requires the server).
          </p>
        </div>

        {/* Inputs */}
        <div className="space-y-5">
          {mode.intake.map((type) => renderIntake(type, inputs, setInputs, status === 'active'))}

          {/* Target format option field */}
          {mode.optionFields?.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`opt-${field.key}`} className="text-sm font-medium">
                {field.label}
                {field.required && (
                  <span className="ml-1 text-destructive" aria-label="required">*</span>
                )}
              </Label>
              <Input
                id={`opt-${field.key}`}
                value={inputs.options?.[field.key] ?? ''}
                onChange={(e) =>
                  setInputs((prev) => ({
                    ...prev,
                    options: { ...prev.options, [field.key]: e.target.value },
                  }))
                }
                placeholder={field.placeholder}
                disabled={status === 'active'}
              />
            </div>
          ))}
        </div>

        {/* Convert button */}
        <Button
          onClick={handleConvert}
          disabled={status === 'active' || !readyToConvert}
          className="w-full sm:w-auto"
        >
          {status === 'active' ? 'Converting…' : 'Convert →'}
        </Button>

        {/* Result: markdown / latex preview */}
        {status === 'done' && !isPdf && !pdfDownloaded && (
          <div className="rounded-lg border bg-muted/20 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <span className="text-sm font-semibold">Converted output</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigator.clipboard.writeText(fullTextRef.current)}
                >
                  Copy
                </Button>
                <Button size="sm" variant="outline" onClick={handleDownloadConvert}>
                  Download
                </Button>
              </div>
            </div>
            <div className="px-4 py-3">
              <pre
                aria-live="polite"
                aria-label="Converted output"
                className="text-sm text-foreground/80 leading-relaxed max-h-[60vh] overflow-y-auto prose prose-sm max-w-none"
              >
                {streamingText}
              </pre>
            </div>
          </div>
        )}

        {/* Result: PDF downloaded */}
        {status === 'done' && pdfDownloaded && (
          <p className="text-sm text-muted-foreground">
            PDF downloaded to your device.
          </p>
        )}

        {/* Error */}
        {status === 'error' && error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 space-y-3">
            <p className="text-sm font-medium text-destructive">Conversion failed</p>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button size="sm" variant="outline" onClick={() => setStatus('idle')}>
              Try again
            </Button>
          </div>
        )}
      </div>
    )
  }

  // ── API mode (bundled-agent or skill-dir) ─────────────────────────────────
  async function handleRun() {
    if (isRunningRef.current) return
    isRunningRef.current = true
    setStatus('active')
    setStreamingText('')
    setError(null)
    fullTextRef.current = ''

    try {
      const modelConfig = loadModelConfig()
      const result = await runToolMode(mode!, inputs, (chunk: string) => {
        fullTextRef.current += chunk
        setStreamingText((prev) => prev + chunk)
      }, modelConfig)
      fullTextRef.current = result
      setStatus('done')
    } catch (err) {
      if (err instanceof ToolNotReadyError || err instanceof MissingInputError) {
        setError(err.message)
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
      setStatus('error')
    } finally {
      isRunningRef.current = false
    }
  }

  function handleDownload() {
    const blob = new Blob([fullTextRef.current], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = safeFilename(mode!.label, 'md')
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(fullTextRef.current)
  }

  const isSkillDir = mode.promptSource.kind === 'skill-dir'

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <BackLink />

      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{mode.label}</h1>
        <p className="text-sm text-muted-foreground">{mode.examplePrompt}</p>
        {mode.approximation && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Lightweight approximation — not the verified P9 research corpus.
          </p>
        )}
      </div>

      {/* Local-model hint for SKILL+dir modes */}
      {isSkillDir && (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-300">
          This mode uses a long SKILL prompt. Local models may follow it poorly — a cloud model is recommended.
        </div>
      )}

      {/* Intake inputs — driven by mode.intake[] (QT1) */}
      <div className="space-y-5">
        {mode.intake.map((type) => renderIntake(type, inputs, setInputs, status === 'active'))}

        {/* Option fields (venue, target format, gold set, …) */}
        {mode.optionFields && mode.optionFields.length > 0 && (
          <div className="space-y-3">
            {mode.optionFields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`opt-${field.key}`} className="text-sm font-medium">
                  {field.label}
                  {field.required && (
                    <span className="ml-1 text-destructive" aria-label="required">*</span>
                  )}
                </Label>
                <Input
                  id={`opt-${field.key}`}
                  value={inputs.options?.[field.key] ?? ''}
                  onChange={(e) =>
                    setInputs((prev) => ({
                      ...prev,
                      options: { ...prev.options, [field.key]: e.target.value },
                    }))
                  }
                  placeholder={field.placeholder}
                  disabled={status === 'active'}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Run button */}
      <Button
        onClick={handleRun}
        disabled={status === 'active' || !readyToRun}
        className="w-full sm:w-auto"
      >
        {status === 'active' ? 'Generating…' : 'Run →'}
      </Button>

      {/* Streaming output */}
      {(status === 'active' || status === 'done') && (
        <div className="rounded-lg border bg-muted/20 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
            <span className="text-sm font-semibold">{mode.label}</span>
            {status === 'active' && (
              <span className="text-xs text-blue-500 font-medium animate-pulse">Generating…</span>
            )}
            {status === 'done' && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleCopy}>
                  Copy
                </Button>
                <Button size="sm" variant="outline" onClick={handleDownload}>
                  Download .md
                </Button>
              </div>
            )}
          </div>
          <div className="px-4 py-3">
            <div
              aria-live="polite"
              aria-label={`Output: ${mode.label}`}
              className="text-sm text-foreground/80 leading-relaxed max-h-[60vh] overflow-y-auto prose prose-sm max-w-none"
            >
              {streamingText || <span className="text-muted-foreground italic">Starting…</span>}
              {status === 'active' && (
                <span className="inline-block w-0.5 h-4 bg-blue-400 ml-0.5 animate-pulse align-middle" />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {status === 'error' && error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 space-y-3">
          <p className="text-sm font-medium text-destructive">Failed</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={() => setStatus('idle')}>
            Try again
          </Button>
        </div>
      )}
    </div>
  )
}

function BackLink() {
  return (
    <Link href="/tools" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
      ← Quick Tools
    </Link>
  )
}

// Maps each intake type to the right controlled input component.
// Called per-type from mode.intake[] in the runner — one component per slot.
function renderIntake(
  type: IntakeType,
  inputs: ToolInputs,
  setInputs: React.Dispatch<React.SetStateAction<ToolInputs>>,
  disabled: boolean,
) {
  switch (type) {
    case 'topic':
      return (
        <TopicInput
          key="topic"
          value={inputs.topic ?? ''}
          onChange={(text) => setInputs((prev) => ({ ...prev, topic: text }))}
          disabled={disabled}
        />
      )
    case 'byo-paper':
      return (
        <PaperInput
          key="byo-paper"
          value={inputs.paperText ?? ''}
          onChange={(text) => {
            saveImportedPaper(text)
            setInputs((prev) => ({ ...prev, paperText: text }))
          }}
          disabled={disabled}
        />
      )
    case 'comments':
      return (
        <CommentsInput
          key="comments"
          value={inputs.comments ?? ''}
          onChange={(text) => {
            saveReviewerComments(text)
            setInputs((prev) => ({ ...prev, comments: text }))
          }}
          disabled={disabled}
        />
      )
    case 'claims':
      return (
        <CommentsInput
          key="claims"
          label="Claims to Verify"
          placeholder="Paste the claims you want to fact-check, one per line…"
          id="claims-input"
          value={inputs.claims ?? ''}
          onChange={(text) => setInputs((prev) => ({ ...prev, claims: text }))}
          disabled={disabled}
        />
      )
    case 'config':
      // config-intake modes are all launchers — the launcher branch handles them
      // before we reach this code. Return null as a safety fallback.
      return null
  }
}
