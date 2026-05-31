'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { getMode } from '@/lib/tools/registry'
import { runToolMode } from '@/lib/tools/run'
import { ToolNotReadyError, MissingInputError } from '@/lib/tools/prompt-builder'
import type { ToolInputs } from '@/lib/tools/prompt-builder'
import { loadModelConfig } from '@/lib/storage'
import { safeFilename } from '@/lib/export/content'

type RunStatus = 'idle' | 'active' | 'done' | 'error'

export default function ToolRunnerPage() {
  const { modeId } = useParams<{ modeId: string }>()
  const router = useRouter()
  const mode = getMode(modeId)

  const [inputs, setInputs] = useState<ToolInputs>({ topic: '' })
  const [streamingText, setStreamingText] = useState('')
  const [status, setStatus] = useState<RunStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const fullTextRef = useRef('')
  const isRunningRef = useRef(false)

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

  // ── Export-helper (format-convert) — wired in QT2 ────────────────────────
  if (mode.promptSource.kind === 'export-helper') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 space-y-6">
        <BackLink />
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{mode.label}</h1>
          <p className="text-muted-foreground">{mode.examplePrompt}</p>
        </div>
        <div className="rounded-lg border bg-muted/20 p-5">
          <p className="text-sm text-muted-foreground">
            This tool uses the local export engine (no AI call) — it ships in QT2.
          </p>
        </div>
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

      {/* Input — QT0 ships a single topic textarea.
          QT1 replaces this block with PaperInput / CommentsInput / TopicInput
          driven by mode.intake[]. */}
      <div className="space-y-2">
        <label htmlFor="topic-input" className="text-sm font-medium">
          Topic / prompt
        </label>
        <Textarea
          id="topic-input"
          value={inputs.topic ?? ''}
          onChange={(e) => setInputs((prev) => ({ ...prev, topic: e.target.value }))}
          placeholder="Describe what you want to generate…"
          rows={4}
          className="resize-none"
          disabled={status === 'active'}
        />
      </div>

      {/* Run button */}
      <Button
        onClick={handleRun}
        disabled={status === 'active' || !inputs.topic?.trim()}
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
              className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed max-h-[60vh] overflow-y-auto font-mono"
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
