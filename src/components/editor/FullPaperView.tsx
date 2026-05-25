'use client'

// FullPaperView — read-only view of all sections in order.
// Useful for reviewing narrative flow before export.
// Renders the HTML content from each section with prose styling.
// Print-friendly: navigation hides via @media print (handled in globals.css).

import { marked } from 'marked'
import type { PaperState } from '@/lib/types'

interface Props {
  paper: PaperState
  onClose: () => void
}

/** Convert content to HTML if it's markdown, else return as-is */
function toHtml(content: string): string {
  if (!content) return ''
  if (content.trimStart().startsWith('<')) return content
  const result = marked.parse(content, { async: false })
  return typeof result === 'string' ? result : ''
}

export function FullPaperView({ paper, onClose }: Props) {
  const totalWords = paper.sections.reduce((sum, s) => {
    const plain = s.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return sum + plain.split(/\s+/).filter(Boolean).length
  }, 0)

  return (
    <div className="fixed inset-0 z-40 bg-background overflow-y-auto">

      {/* Sticky header — hidden on print */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 border-b bg-background/95 backdrop-blur print:hidden">
        <div>
          <span className="font-semibold text-sm">{paper.config.topic}</span>
          <span className="text-muted-foreground text-xs ml-3">
            {totalWords.toLocaleString()} words · {paper.sections.length} sections
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Print / Save PDF
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground ml-4"
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* Paper content */}
      <div className="max-w-3xl mx-auto px-8 py-12">

        {/* Title */}
        <h1 className="text-3xl font-bold mb-2">{paper.config.topic}</h1>

        {/* Authors */}
        {paper.config.authors.length > 0 && (
          <p className="text-muted-foreground mb-1">
            {paper.config.authors.map((a) => a.name).filter(Boolean).join(', ')}
          </p>
        )}
        {paper.config.authors.length > 0 && (
          <p className="text-sm text-muted-foreground mb-8">
            {paper.config.authors.map((a) => a.affiliation).filter(Boolean).join('; ')}
          </p>
        )}

        <hr className="mb-8" />

        {/* Sections */}
        {paper.sections.map((section, i) => (
          <div key={section.id} className={i > 0 ? 'mt-10' : ''}>
            <div
              className="prose max-w-none"
              dangerouslySetInnerHTML={{ __html: toHtml(section.content) }}
            />
          </div>
        ))}

        <div className="mt-16 pt-8 border-t text-xs text-muted-foreground text-center">
          Generated with ARS Web Studio ·{' '}
          {new Date(paper.updatedAt).toLocaleDateString()}
        </div>
      </div>
    </div>
  )
}
