'use client'

// AgentProgressPanel — permanently visible AI activity monitor.
// Shows idle / active / done states so the user always knows what Claude is doing.

import { useEffect, useRef, useState } from 'react'

interface Props {
  isActive: boolean
  agentName: string         // e.g. "Structure Architect" or "Draft Writer"
  taskLabel: string         // e.g. "Generating paper outline…" or "Writing: Introduction"
  streamingText: string
  totalSections?: number    // when writing sections, shown as "Section X of Y"
  completedSections?: number
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function AgentProgressPanel({
  isActive,
  agentName,
  taskLabel,
  streamingText,
  totalSections,
  completedSections,
}: Props) {
  // elapsed counts up inside setInterval callback only — never setState in effect body
  const [elapsed, setElapsed] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isActive) return
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [isActive])

  // Auto-scroll streaming text to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [streamingText])

  const wordCount = countWords(streamingText)
  const elapsedStr = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
    : `${elapsed}s`

  const isIdle = !isActive && !streamingText
  const isDone = !isActive && !!streamingText

  // ─── Idle state ─────────────────────────────────────────────────────────────
  if (isIdle) {
    return (
      <div className="rounded-lg border bg-muted/20 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-muted/30">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-muted-foreground/40" />
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-semibold text-muted-foreground">Agent Monitor</span>
            <span className="text-xs text-muted-foreground ml-2">Idle — waiting for generation</span>
          </div>
        </div>
        <div className="px-4 py-3 h-24 flex items-center justify-center">
          <p className="text-xs text-muted-foreground italic text-center">
            Claude&apos;s output will stream here in real time while writing your paper.
          </p>
        </div>
      </div>
    )
  }

  // ─── Active + Done states share the same shell ───────────────────────────────
  return (
    <div className={`rounded-lg border overflow-hidden ${
      isActive
        ? 'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20'
        : 'border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-950/10'
    }`}>
      {/* Header bar */}
      <div className={`flex items-center gap-3 px-4 py-2.5 border-b ${
        isActive
          ? 'border-blue-200 dark:border-blue-800 bg-blue-100/60 dark:bg-blue-900/30'
          : 'border-green-200 dark:border-green-800 bg-green-100/40 dark:bg-green-900/20'
      }`}>
        {/* Status dot */}
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          {isActive && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          )}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
            isActive ? 'bg-blue-500' : 'bg-green-500'
          }`} />
        </span>

        <div className="flex-1 min-w-0">
          <span className={`text-xs font-semibold ${
            isActive ? 'text-blue-700 dark:text-blue-300' : 'text-green-700 dark:text-green-300'
          }`}>
            {isActive ? agentName : 'Done'}
          </span>
          <span className={`text-xs ml-2 truncate ${
            isActive ? 'text-blue-600 dark:text-blue-400' : 'text-green-600 dark:text-green-400'
          }`}>
            {isActive ? taskLabel : `${agentName} — completed`}
          </span>
        </div>

        {/* Stats */}
        <div className={`flex items-center gap-3 text-xs tabular-nums shrink-0 ${
          isActive ? 'text-blue-600 dark:text-blue-400' : 'text-green-600 dark:text-green-400'
        }`}>
          {/* Section progress counter */}
          {totalSections !== undefined && completedSections !== undefined && totalSections > 0 && (
            <span className="font-medium">
              Section {completedSections + 1} of {totalSections}
            </span>
          )}
          {wordCount > 0 && (
            <span>{wordCount.toLocaleString()} words</span>
          )}
          {isActive && (
            <span className="font-mono">{elapsedStr}</span>
          )}
          {isDone && elapsed > 0 && (
            <span className="font-mono">in {elapsedStr}</span>
          )}
        </div>
      </div>

      {/* Streaming text area */}
      <div
        ref={scrollRef}
        aria-live="polite"
        aria-label={`Agent output: ${taskLabel}`}
        className="h-40 overflow-y-auto px-4 py-3 font-mono text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed"
      >
        {streamingText ? (
          <>
            {streamingText}
            {isActive && (
              <span className="inline-block w-0.5 h-3 bg-blue-400 ml-0.5 animate-pulse align-middle" />
            )}
          </>
        ) : (
          <span className="text-muted-foreground italic">
            {isActive ? 'Starting agent…' : ''}
          </span>
        )}
      </div>
    </div>
  )
}
