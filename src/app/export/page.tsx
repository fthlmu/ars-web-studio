'use client'

// Export page — final Phase 6 screen.
// This page reads the completed paper from localStorage, builds Markdown/LaTeX in
// the browser, and asks the server route to compile PDF through Typst.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { loadPaper } from '@/lib/storage'
import type { PaperState } from '@/lib/types'
import { safeFilename, totalWords } from '@/lib/export/content'
import { buildMarkdown } from '@/lib/export/markdown'
import { buildLatex } from '@/lib/export/latex'

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

function downloadText(content: string, filename: string, type: string): void {
  downloadBlob(new Blob([content], { type }), filename)
}

function formatPaperType(type: string): string {
  return type.replace('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

export default function ExportPage() {
  const router = useRouter()
  const [paper, setPaper] = useState<PaperState | null>(null)
  const [isPdfLoading, setIsPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return
      const saved = loadPaper()
      if (!saved || saved.sections.length === 0) {
        router.replace('/editor')
        return
      }
      setPaper(saved)
    })

    return () => {
      cancelled = true
    }
  }, [router])

  const handleMarkdown = useCallback(() => {
    if (!paper) return
    downloadText(
      buildMarkdown(paper),
      safeFilename(paper.config.topic, 'md'),
      'text/markdown;charset=utf-8'
    )
  }, [paper])

  const handleLatex = useCallback(() => {
    if (!paper) return
    downloadText(
      buildLatex(paper),
      safeFilename(paper.config.topic, 'tex'),
      'application/x-tex;charset=utf-8'
    )
  }, [paper])

  const handlePdf = useCallback(async () => {
    if (!paper || isPdfLoading) return

    setIsPdfLoading(true)
    setPdfError(null)

    try {
      const response = await fetch('/api/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(err.error ?? response.statusText)
      }

      const blob = await response.blob()
      downloadBlob(blob, safeFilename(paper.config.topic, 'pdf'))
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsPdfLoading(false)
    }
  }, [paper, isPdfLoading])

  if (!paper) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading paper…</p>
      </div>
    )
  }

  const words = totalWords(paper)
  const authors = paper.config.authors.map((author) => author.name).filter(Boolean)
  const completedSections = paper.sections.filter(
    (section) => section.status === 'done' || section.status === 'edited'
  ).length

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Phase 6 · Export
            </p>
            <h1 className="mt-1 text-2xl font-bold">Export Paper</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Download your edited paper as Markdown, LaTeX, or a Typst-compiled PDF.
            </p>
          </div>
          <Button variant="outline" onClick={() => router.push('/editor')}>
            ← Back to Editor
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="line-clamp-2">{paper.config.topic}</CardTitle>
            <CardDescription>
              {authors.length > 0 ? authors.join(', ') : 'Author not specified'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Paper type</p>
                <p className="text-sm font-medium">{formatPaperType(paper.config.paperType)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Citation</p>
                <p className="text-sm font-medium">{paper.config.citationFormat}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sections</p>
                <p className="text-sm font-medium">{completedSections} / {paper.sections.length}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Words</p>
                <p className="text-sm font-medium">{words.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Markdown</CardTitle>
                <Badge variant="outline">Always works</Badge>
              </div>
              <CardDescription>
                Best for backup, Obsidian, Git, and simple editing.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" onClick={handleMarkdown}>
                Download .md
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">LaTeX</CardTitle>
                <Badge variant="outline">Overleaf</Badge>
              </div>
              <CardDescription>
                IEEEtran wrapper with math packages included.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" onClick={handleLatex}>
                Download .tex
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">PDF</CardTitle>
                <Badge variant="outline">Typst</Badge>
              </div>
              <CardDescription>
                Compiles a two-column IEEE-like PDF on the server.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button className="w-full" onClick={handlePdf} disabled={isPdfLoading}>
                {isPdfLoading ? 'Compiling PDF…' : 'Download .pdf'}
              </Button>
              {pdfError && (
                <p className="text-xs text-destructive">
                  {pdfError}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Separator />

        <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Verification tip</p>
          <p className="mt-1">
            After downloading, check that all sections are present and any equation such as{' '}
            <code className="rounded bg-muted px-1 py-0.5">$E = mc^2$</code> appears in Markdown,
            LaTeX, and PDF outputs.
          </p>
        </div>
      </div>
    </main>
  )
}
