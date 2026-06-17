'use client'

// LivePaperPane — the right-side paper window in the write stage.
//
// Shows sections as they complete (status: done) as rendered prose.
// Streaming text NEVER appears here — only the conversation pane sees raw stream output.
// Sections with status 'generating' show a skeleton placeholder; 'error' shows a chip.
//
// FP-3: satisfies the "right pane of the studio renders FullPaperView live-updating as
// sections reach done" requirement. Clicking a done section navigates to the editor page
// (the full SectionEditor with toolbar is available there).

import { useRouter } from 'next/navigation'
import { marked } from 'marked'
import type { PaperState, Section } from '@/lib/types'

interface Props {
  paper: PaperState
}

/** Convert section content (HTML or markdown) to HTML for display */
function toHtml(content: string): string {
  if (!content) return ''
  if (content.trimStart().startsWith('<')) return content
  const result = marked.parse(content, { async: false })
  return typeof result === 'string' ? result : ''
}

function StatusChip({ status }: { status: Section['status'] }) {
  if (status === 'done' || status === 'edited') {
    return (
      <span
        aria-label="section complete"
        className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950/40 dark:text-green-300"
      >
        ✓ clean
      </span>
    )
  }
  if (status === 'generating') {
    return (
      <span
        aria-label="section generating"
        className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-950/40 dark:text-blue-300"
      >
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
        generating
      </span>
    )
  }
  if (status === 'pending') {
    return (
      <span
        aria-label="section pending"
        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
      >
        ◌ pending
      </span>
    )
  }
  // error or unknown
  return (
    <span
      aria-label="section error"
      className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300"
    >
      ✗ error
    </span>
  )
}

export function LivePaperPane({ paper }: Props) {
  const router = useRouter()

  const totalWords = paper.sections
    .filter((s) => s.status === 'done' || s.status === 'edited')
    .reduce((sum, s) => sum + s.wordCount, 0)

  const doneCount = paper.sections.filter(
    (s) => s.status === 'done' || s.status === 'edited',
  ).length

  return (
    <div
      data-testid="live-paper-pane"
      className="flex flex-col rounded-xl border bg-background overflow-hidden h-full max-h-[calc(100vh-8rem)] lg:sticky lg:top-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-2.5">
        <div>
          <span className="text-sm font-semibold">Paper Preview</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {doneCount} / {paper.sections.length} sections · {totalWords.toLocaleString()} words
          </span>
        </div>
        {doneCount > 0 && (
          <button
            type="button"
            onClick={() => router.push('/editor')}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Edit all →
          </button>
        )}
      </div>

      {/* Paper content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-8">
        {/* Paper title */}
        <div>
          <h1 className="text-xl font-bold leading-tight">{paper.config.topic}</h1>
          {paper.config.authors.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              {paper.config.authors.map((a) => a.name).filter(Boolean).join(', ')}
            </p>
          )}
        </div>

        {/* Sections */}
        {paper.sections.map((section) => {
          const isDone = section.status === 'done' || section.status === 'edited'
          const isGenerating = section.status === 'generating'

          return (
            <div
              key={section.id}
              data-testid={`paper-section-${section.id}`}
              className={isDone ? 'group cursor-pointer' : undefined}
              onClick={isDone ? () => router.push('/editor') : undefined}
              title={isDone ? 'Click to edit this section' : undefined}
            >
              {/* Section heading row */}
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-base font-semibold text-foreground">{section.heading}</h2>
                <StatusChip status={section.status} />
              </div>

              {/* Content — rendered prose or skeleton */}
              {isDone ? (
                <div
                  data-testid={`section-prose-${section.id}`}
                  className="prose prose-sm max-w-none group-hover:ring-1 group-hover:ring-primary/30 group-hover:rounded transition-all"
                  dangerouslySetInnerHTML={{ __html: toHtml(section.content) }}
                />
              ) : isGenerating ? (
                /* Skeleton placeholder while the section streams in the conversation pane */
                <div
                  aria-label="Generating…"
                  className="space-y-2"
                >
                  <div className="h-3 rounded bg-muted animate-pulse w-full" />
                  <div className="h-3 rounded bg-muted animate-pulse w-11/12" />
                  <div className="h-3 rounded bg-muted animate-pulse w-10/12" />
                  <div className="h-3 rounded bg-muted animate-pulse w-3/4" />
                </div>
              ) : (
                <p className="text-sm italic text-muted-foreground">Waiting to be written…</p>
              )}
            </div>
          )
        })}

        {paper.sections.length === 0 && (
          <p className="text-sm italic text-muted-foreground text-center py-8">
            Sections will appear here as they are generated.
          </p>
        )}
      </div>
    </div>
  )
}
