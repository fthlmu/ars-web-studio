'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { modesByFamily } from '@/lib/tools/registry'
import type { ToolMode } from '@/lib/tools/registry'

const STATUS_BADGE: Record<ToolMode['status'], { label: string; variant: 'default' | 'outline' | 'secondary' }> = {
  ready:    { label: 'Ready',    variant: 'default' },
  launcher: { label: 'Pipeline', variant: 'outline' },
  planned:  { label: 'Coming',   variant: 'secondary' },
}

export default function ToolsPage() {
  const [query, setQuery] = useState('')
  const families = modesByFamily()
  const q = query.toLowerCase()

  const filtered = families.map((f) => ({
    ...f,
    modes: f.modes.filter(
      (m) => !q || m.label.toLowerCase().includes(q) || m.examplePrompt.toLowerCase().includes(q)
    ),
  })).filter((f) => f.modes.length > 0)

  return (
    <main className="min-h-[calc(100vh-57px)] bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-8">

        {/* Header */}
        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight">Quick Tools</h1>
          <p className="text-muted-foreground max-w-2xl">
            Run any ARS mode as a standalone tool — paste a paper, enter a topic, and stream the result.
            No full pipeline needed.
          </p>
          <Input
            placeholder="Search tools…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-sm"
            aria-label="Search tools"
          />
        </div>

        {/* Family sections */}
        {filtered.map(({ family, label, modes }) => (
          <section key={family} aria-labelledby={`family-${family}`}>
            <h2
              id={`family-${family}`}
              className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3"
            >
              {label}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {modes.map((mode) => {
                const badge = STATUS_BADGE[mode.status]
                return (
                  <Link key={mode.id} href={`/tools/${mode.id}`} className="group block">
                    <Card className="h-full transition-colors group-hover:border-primary/50">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="text-sm font-semibold leading-snug">
                            {mode.label}
                          </CardTitle>
                          <Badge variant={badge.variant} className="shrink-0 text-xs">
                            {badge.label}
                          </Badge>
                        </div>
                        {mode.approximation && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            Lightweight approximation — not the full P9 corpus
                          </p>
                        )}
                      </CardHeader>
                      <CardContent>
                        <CardDescription className="text-xs leading-relaxed">
                          {mode.examplePrompt}
                        </CardDescription>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          </section>
        ))}

        {filtered.length === 0 && (
          <p className="text-muted-foreground text-sm">No tools match &ldquo;{query}&rdquo;.</p>
        )}
      </div>
    </main>
  )
}
