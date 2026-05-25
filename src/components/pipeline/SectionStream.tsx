'use client'

// SectionStream — shows a section being written in real time.
// While generating: streams live text chunk-by-chunk.
// When done: shows word count and a short preview.
// On error: shows the error and a Retry button.

import { Button } from '@/components/ui/button'
import { StageStatus } from './PipelineStepper'

interface Props {
  heading: string
  status: StageStatus
  streamingText: string    // live text while generating
  wordCount?: number       // final word count when done
  error?: string
  onRetry?: () => void
}

export function SectionStream({
  heading,
  status,
  streamingText,
  wordCount,
  error,
  onRetry,
}: Props) {
  if (status === 'pending' || status === 'done') return null

  return (
    <div className="rounded-lg border bg-muted/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <span className="text-sm font-semibold">{heading}</span>
        {status === 'active' && (
          <span className="text-xs text-blue-500 font-medium animate-pulse">
            Generating…
          </span>
        )}
        {status === 'error' && (
          <span className="text-xs text-destructive font-medium">Failed</span>
        )}
      </div>

      {/* Content area */}
      <div className="px-4 py-3">
        {status === 'active' && (
          /* Live streaming text — aria-live so screen readers announce updates */
          <div
            aria-live="polite"
            aria-label={`Writing section: ${heading}`}
            className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto font-mono"
          >
            {streamingText || <span className="text-muted-foreground italic">Starting…</span>}
            {/* Blinking cursor at end of stream */}
            <span className="inline-block w-0.5 h-4 bg-blue-400 ml-0.5 animate-pulse align-middle" />
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{error ?? 'An error occurred during generation.'}</p>
            {onRetry && (
              <Button size="sm" variant="outline" onClick={onRetry}>
                Retry this section
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
