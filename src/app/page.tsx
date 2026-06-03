'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ModelSelector } from '@/components/ModelSelector'
import { clearPaper, listPapers, deletePaper, setCurrentPaper, type PaperSummary } from '@/lib/storage'

export default function Home() {
  const router = useRouter()
  const [papers, setPapers] = useState<PaperSummary[]>([])
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setPapers(listPapers())
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Open a saved paper: make it the current working slot, then let the /pipeline router
  // dispatch to the right stage.
  function handleOpen(id: string) {
    const loaded = setCurrentPaper(id)
    if (!loaded) {
      setToast('Could not open that paper — its data may have been cleared.')
      setPapers(listPapers())
      return
    }
    router.push('/pipeline')
  }

  // Delete one paper (eviction path, NFR-08) and refresh the list.
  function handleDelete(id: string) {
    const ok = deletePaper(id)
    if (!ok) {
      setToast('Could not delete that paper from local storage.')
    }
    setPapers(listPapers())
  }

  return (
    <main className="min-h-[calc(100vh-57px)] bg-background">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-16">
        <section className="space-y-6">
          <div className="inline-flex rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
            Single-user academic paper studio · localStorage based
          </div>
          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Turn an ARS intake interview into an editable paper draft.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              ARS Web Studio gives you a browser workflow for the Academic Research Skills pipeline:
              fill the intake wizard, approve an outline, watch sections generate, edit them with math
              support, then export Markdown, LaTeX, or PDF.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/intake"
              onClick={() => clearPaper()}
              className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Full Paper Pipeline
            </Link>
            <Link
              href="/tools"
              className="inline-flex h-11 items-center justify-center rounded-md border bg-background px-8 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Quick Tools
            </Link>
          </div>
          {/* Model picker: like choosing which "engine" drives generation —
              the selected model is saved to localStorage and read by the pipeline. */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Generation model</p>
            <ModelSelector className="w-full sm:w-80" />
          </div>
        </section>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Workflow</CardTitle>
              <CardDescription>One paper, one state file, no database.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                ['1', 'Intake', 'Collect topic, paper type, authors, citation style, and target word count.'],
                ['2', 'Pipeline', 'Generate an outline first, then write sections sequentially after approval.'],
                ['3', 'Editor', 'Revise each section in Tiptap with KaTeX math and auto-save.'],
                ['4', 'Export', 'Download Markdown, LaTeX, or a Typst-generated PDF.'],
              ].map(([num, title, body]) => (
                <div key={num} className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {num}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{title}</p>
                    <p className="text-sm text-muted-foreground">{body}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* P18.11 — Previous Papers panel: open or delete any saved paper. */}
          {papers.length > 0 && (
            <Card data-testid="previous-papers">
              <CardHeader>
                <CardTitle>Previous Papers</CardTitle>
                <CardDescription>Resume or remove a saved paper.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {papers.map((p) => (
                  <div
                    key={p.id}
                    data-testid={`paper-row-${p.id}`}
                    className="flex items-center gap-3 rounded-md border px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => handleOpen(p.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-medium">{p.topic || '(untitled)'}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.paperType ? p.paperType.replace('_', ' ').toUpperCase() : 'paper'} ·{' '}
                        {p.updatedAt ? new Date(p.updatedAt).toLocaleString() : ''}
                      </p>
                    </button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 text-xs"
                      onClick={() => handleOpen(p.id)}
                    >
                      Open
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`delete-paper-${p.id}`}
                      className="shrink-0 text-xs text-red-600 hover:text-red-700"
                      onClick={() => handleDelete(p.id)}
                    >
                      Delete
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* NFR-07 toast surface (shared with the save sites). */}
      {toast && (
        <div
          data-testid="home-toast"
          role="status"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-lg dark:bg-amber-950/40 dark:text-amber-200"
        >
          {toast}
          <button type="button" onClick={() => setToast(null)} className="ml-3 underline underline-offset-2">
            dismiss
          </button>
        </div>
      )}
    </main>
  )
}
