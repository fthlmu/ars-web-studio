'use client'

// PipelineStepper — vertical list of pipeline stages with status icons.
// Pure display component; all logic lives in the pipeline page.

export type StageStatus = 'pending' | 'active' | 'done' | 'error'

export interface PipelineStage {
  id: string
  label: string
  status: StageStatus
  wordCount?: number   // shown when done
  error?: string       // shown when error
}

interface Props {
  stages: PipelineStage[]
}

// Status icons: think of these like LED indicators on test equipment
const ICONS: Record<StageStatus, string> = {
  pending: '○',
  active:  '⏳',
  done:    '✅',
  error:   '✗',
}

const COLORS: Record<StageStatus, string> = {
  pending: 'text-muted-foreground',
  active:  'text-blue-500',
  done:    'text-green-600',
  error:   'text-destructive',
}

const BG: Record<StageStatus, string> = {
  pending: 'bg-background',
  active:  'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800',
  done:    'bg-background',
  error:   'bg-destructive/5 border-destructive/30',
}

export function PipelineStepper({ stages }: Props) {
  return (
    <div className="space-y-1">
      {stages.map((stage) => (
        <div
          key={stage.id}
          className={`flex items-center gap-3 rounded-md border px-4 py-2.5 transition-colors ${BG[stage.status]}`}
        >
          {/* Status icon */}
          <span className={`text-base shrink-0 ${COLORS[stage.status]}`}>
            {ICONS[stage.status]}
          </span>

          {/* Stage label */}
          <span
            className={`flex-1 text-sm font-medium ${
              stage.status === 'pending'
                ? 'text-muted-foreground'
                : 'text-foreground'
            }`}
          >
            {stage.label}
          </span>

          {/* Right-side info */}
          {stage.status === 'active' && (
            <span className="text-xs text-blue-500 animate-pulse">writing…</span>
          )}
          {stage.status === 'done' && stage.wordCount !== undefined && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {stage.wordCount.toLocaleString()} words
            </span>
          )}
          {stage.status === 'error' && (
            <span className="text-xs text-destructive truncate max-w-[160px]">
              {stage.error ?? 'Error'}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
