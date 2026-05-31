'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ModelSelector } from '@/components/ModelSelector'
import { loadPaper, clearPaper } from '@/lib/storage'
import type { PaperState } from '@/lib/types'

export default function Home() {
  const [paper, setPaper] = useState<PaperState | null>(null)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setPaper(loadPaper())
    })
    return () => {
      cancelled = true
    }
  }, [])

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
            {paper && (
              <Link
                href={paper.sections.length > 0 ? '/editor' : '/pipeline'}
                className="inline-flex h-11 items-center justify-center rounded-md border bg-background px-8 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Continue Previous Paper
              </Link>
            )}
          </div>
          {/* Model picker: like choosing which "engine" drives generation —
              the selected model is saved to localStorage and read by the pipeline. */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Generation model</p>
            <ModelSelector className="w-full sm:w-80" />
          </div>
        </section>

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
      </div>
    </main>
  )
}

