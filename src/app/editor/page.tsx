'use client'

// Section editor page — lets the user read, edit, and refine each generated section.
// Layout: sidebar (section list) + main area (Tiptap editor).
//
// Tiptap is browser-only (uses DOM APIs), so editor components are dynamically imported.
// All saves go to localStorage via the onSave callback → savePaper().

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { loadPaper, savePaper } from '@/lib/storage'
import { generateAbstract } from '@/lib/ars-client'
import type { PaperState } from '@/lib/types'

// Dynamic import with ssr:false — prevents ProseMirror DOM errors during SSR
const SectionEditor = dynamic(
  () => import('@/components/editor/SectionEditor').then((m) => m.SectionEditor),
  { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading editor…</div> }
)

const FullPaperView = dynamic(
  () => import('@/components/editor/FullPaperView').then((m) => m.FullPaperView),
  { ssr: false }
)

// ─── Word count color helper ─────────────────────────────────────────────────

function wcColor(count: number, target: number): string {
  if (target === 0) return ''
  const pct = (count / target) * 100
  if (pct >= 75 && pct <= 125) return 'text-green-600 dark:text-green-400'
  if (pct >= 50 && pct <= 150) return 'text-yellow-500'
  return 'text-red-500'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EditorPage() {
  const router = useRouter()

  const [paper, setPaper] = useState<PaperState | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [showFullPaper, setShowFullPaper] = useState(false)
  const [showAbstractPanel, setShowAbstractPanel] = useState(false)
  const [abstractText, setAbstractText] = useState('')
  const [isGeneratingAbstract, setIsGeneratingAbstract] = useState(false)

  // ─── Load paper from localStorage ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return

      const saved = loadPaper()
      if (!saved || saved.sections.length === 0) {
        router.replace('/pipeline')
        return
      }
      setPaper(saved)
      // Default to first section
      setActiveId(saved.sections[0]?.id ?? null)
    })

    return () => {
      cancelled = true
    }
  }, [router])

  // ─── Save a section back to localStorage ───────────────────────────────────
  const handleSave = useCallback(
    (sectionId: string, html: string, wc: number) => {
      setPaper((prev) => {
        if (!prev) return prev
        const next: PaperState = {
          ...prev,
          sections: prev.sections.map((s) =>
            s.id === sectionId
              ? { ...s, content: html, wordCount: wc, status: 'edited' }
              : s
          ),
          updatedAt: new Date().toISOString(),
        }
        savePaper(next)
        return next
      })
    },
    []
  )

  // ─── Generate bilingual abstract ────────────────────────────────────────────
  const handleGenerateAbstract = useCallback(async () => {
    if (!paper) return
    setIsGeneratingAbstract(true)
    setAbstractText('')
    setShowAbstractPanel(true)

    try {
      await generateAbstract(
        paper.config,
        paper.sections,
        (chunk) => setAbstractText((prev) => prev + chunk)
      )
    } catch (err) {
      setAbstractText(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsGeneratingAbstract(false)
    }
  }, [paper])

  // ─── Derived values ─────────────────────────────────────────────────────────

  const activeSection = paper?.sections.find((s) => s.id === activeId) ?? null
  const totalWords = paper?.sections.reduce((sum, s) => sum + (s.wordCount ?? 0), 0) ?? 0
  const allSectionsDone = paper?.sections.every(
    (s) => s.status === 'done' || s.status === 'edited'
  ) ?? false

  // ─── Loading / redirect states ──────────────────────────────────────────────

  if (!paper) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading paper…</p>
      </div>
    )
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col bg-background overflow-hidden md:flex-row">

      {/* ── Left sidebar: section navigation ── */}
      <aside className="flex max-h-64 w-full shrink-0 flex-col border-b bg-muted/20 overflow-y-auto md:max-h-none md:w-64 md:border-b-0 md:border-r">

        {/* Sidebar header */}
        <div className="px-4 py-3 border-b">
          <h1 className="font-semibold text-sm truncate" title={paper.config.topic}>
            {paper.config.topic}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalWords.toLocaleString()} words · {paper.sections.length} sections
          </p>
        </div>

        {/* Section list */}
        <nav className="flex-1 py-2">
          {paper.sections.map((section) => {
            const target = Math.round(
              paper.config.wordCount *
                (1 / Math.max(paper.sections.length, 1))
            )
            const isActive = section.id === activeId
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveId(section.id)}
                className={`w-full text-left px-4 py-2 transition-colors hover:bg-accent/50 md:py-2.5 ${
                  isActive ? 'bg-accent border-r-2 border-primary' : ''
                }`}
              >
                <div className="text-sm font-medium truncate leading-tight">
                  {section.heading}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-xs tabular-nums ${wcColor(section.wordCount ?? 0, target)}`}>
                    {(section.wordCount ?? 0).toLocaleString()} w
                  </span>
                  {section.status === 'edited' && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                      edited
                    </Badge>
                  )}
                </div>
              </button>
            )
          })}
        </nav>

        {/* Sidebar actions */}
        <div className="p-3 border-t space-y-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => setShowFullPaper(true)}
          >
            👁 View Full Paper
          </Button>

          {allSectionsDone && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={handleGenerateAbstract}
              disabled={isGeneratingAbstract}
            >
              {isGeneratingAbstract ? '⏳ Generating…' : '✦ Generate Abstract'}
            </Button>
          )}

          <Button
            size="sm"
            className="w-full text-xs"
            onClick={() => router.push('/export')}
          >
            Export Paper →
          </Button>
        </div>
      </aside>

      {/* ── Main area: editor ── */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Section header */}
        {activeSection && (
          <div className="px-4 py-3 border-b bg-background shrink-0 sm:px-6">
            <h2 className="text-lg font-semibold">{activeSection.heading}</h2>
            <p className="text-xs text-muted-foreground">
              {paper.config.citationFormat} · {paper.config.language}
              {activeSection.status === 'edited' && ' · Edited'}
            </p>
          </div>
        )}

        {/* Editor */}
        {activeSection ? (
          <div className="flex-1 overflow-hidden">
            <SectionEditor
              key={activeSection.id}   // remount editor when section changes
              section={activeSection}
              config={paper.config}
              outline={paper.outline}
              completedSections={paper.sections.filter((s) => s.id !== activeSection.id)}
              onSave={handleSave}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Select a section from the sidebar to start editing.
          </div>
        )}

        {/* Abstract panel — slides in at the bottom when generated */}
        {showAbstractPanel && (
          <div className="shrink-0 border-t bg-muted/20 max-h-72 overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <span className="text-sm font-semibold">Bilingual Abstract</span>
              <div className="flex items-center gap-2">
                {isGeneratingAbstract && (
                  <span className="text-xs text-blue-500 animate-pulse">Generating…</span>
                )}
                <button
                  type="button"
                  onClick={() => setShowAbstractPanel(false)}
                  className="text-muted-foreground hover:text-foreground text-sm"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="px-4 py-3 font-mono text-xs whitespace-pre-wrap text-foreground/80">
              {abstractText || <span className="text-muted-foreground italic">Abstract will appear here…</span>}
            </div>
          </div>
        )}
      </main>

      {/* ── Full paper overlay ── */}
      {showFullPaper && paper && (
        <FullPaperView
          paper={paper}
          onClose={() => setShowFullPaper(false)}
        />
      )}
    </div>
  )
}
