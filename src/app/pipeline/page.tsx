'use client'

// P18.5 — the unified /pipeline STATE ROUTER.
//
// This is no longer the monolith (that moved to /pipeline/write). It reads the saved
// paper, DERIVES its single PipelineStatus, and redirects to the matching stage route via
// the gate-to-route map. With no saved paper it sends the user to intake. It NEVER calls
// an agent — routing only (FR-03). The persistent sidebar + Material Passport live in the
// shared layout (src/app/pipeline/layout.tsx), so they show while this redirects.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { loadPaper } from '@/lib/storage'
import {
  derivePipelineStatus,
  pipelineHrefForState,
  pipelineStatusLabel,
} from '@/lib/pipeline-router'

export default function PipelineRouterPage() {
  const router = useRouter()
  const [label, setLabel] = useState('Loading…')

  useEffect(() => {
    // queueMicrotask defers the setState/redirect out of the synchronous effect body
    // (the repo's React-19 lint pattern — see P8 BUG-5). Routing only; never an agent call.
    queueMicrotask(() => {
      const saved = loadPaper()
      if (!saved) {
        router.replace('/intake')
        return
      }

      const status = derivePipelineStatus(saved)
      setLabel(pipelineStatusLabel(status))

      // pipelineHrefForState resolves the gate-to-route map AND appends the
      // ?stage=re-review query when the paper is in residual (Stage 3'→4') coaching.
      const dest = pipelineHrefForState(saved)
      // A paper already exists, so never bounce back to the intake wizard ('idle' maps to
      // /intake only for the no-paper case) and never self-redirect to '/pipeline' itself —
      // in both cases the correct next step is the writing flow, which auto-starts the outline.
      if (dest === '/intake' || dest === '/pipeline') {
        router.replace('/pipeline/write')
      } else {
        router.replace(dest)
      }
    })
  }, [router])

  return (
    <div className="flex min-h-[50vh] items-center justify-center" data-testid="pipeline-router">
      <p className="text-muted-foreground text-sm">Resuming pipeline — {label}…</p>
    </div>
  )
}
