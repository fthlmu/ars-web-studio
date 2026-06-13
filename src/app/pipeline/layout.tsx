'use client'

// P18.5/10 — the persistent pipeline shell.
//
// This nested layout wraps EVERY /pipeline/* route, so the 12-checkpoint sidebar and the
// Material Passport panel stay on screen as the paper advances stage to stage. It is the
// one place that:
//   • renders the persistent sidebar + passport (P18.6/7/8)
//   • keeps the unified pipelineStatus + checkpointIndex MAINTAINED, not dead state (P18.6)
//   • applies the NFR-12 "running-* is not resumable on a cold reload" revert to the
//     unified status marker (P18.10). The per-stage routes already follow the rule that
//     an 'awaiting-*' gate makes NO agent call on mount and a 'running-*' state shows a
//     Re-run/Retry affordance, so the layout only has to keep the UNIFIED marker honest.
//
// The sidebar re-reads the paper on a light interval so it tracks the child route's saves
// (same-tab localStorage writes don't fire 'storage' events).

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { loadPaper, savePaper } from '@/lib/storage'
import {
  derivePipelineStatus,
  deriveCheckpointIndex,
  isRunningStatus,
  revertRunningStatus,
} from '@/lib/pipeline-router'
import { PipelineSidebar } from '@/components/pipeline/PipelineSidebar'
import { AgentChatPanel } from '@/components/pipeline/AgentChatPanel'
import type { PaperState } from '@/lib/types'

export default function PipelineLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [paper, setPaper] = useState<PaperState | null>(null)

  // Keep the unified status/checkpoint maintained on first load (P18.6/10). This runs
  // once per real mount; it never calls an agent — it only refreshes derived bookkeeping.
  useEffect(() => {
    // queueMicrotask defers the setState out of the synchronous effect body (the repo's
    // React-19 lint pattern — see P8 BUG-5). This only refreshes derived bookkeeping; it
    // NEVER calls an agent.
    queueMicrotask(() => {
      const saved = loadPaper()
      if (!saved) {
        setPaper(null)
        return
      }

      const derived = derivePipelineStatus(saved)
      // NFR-12: an in-flight stage does not survive a cold reload — revert the unified
      // marker to the resumable predecessor so the index router won't re-enter a dead
      // running view. (The per-stage routes own their own Re-run UI.)
      const unified = isRunningStatus(derived) ? revertRunningStatus(derived) : derived
      const checkpointIndex = deriveCheckpointIndex(saved)

      if (saved.pipelineStatus !== unified || saved.checkpointIndex !== checkpointIndex) {
        const next: PaperState = { ...saved, pipelineStatus: unified, checkpointIndex }
        savePaper(next)
        setPaper(next)
      } else {
        setPaper(saved)
      }
    })
  }, [])

  // Track child-route saves so the sidebar stays live as stages advance.
  useEffect(() => {
    const tick = () => setPaper(loadPaper())
    const interval = setInterval(tick, 1500)
    return () => clearInterval(interval)
  }, [pathname])

  // No paper yet (e.g. the index router about to redirect to /intake) — render the child
  // alone so its own redirect/loading UI shows without an empty sidebar.
  if (!paper) {
    return <>{children}</>
  }

  // FP-2 — the 3-pane "Agent Studio": progress tracker | stage/paper | orchestrator chat.
  // On lg+ the chat is a persistent docked column (the AgentChatPanel renders it as an
  // <aside>); below lg it self-collapses to a floating panel, so the centre pane gets the
  // full width on smaller screens (P19.7 responsive discipline).
  return (
    <div className="mx-auto flex max-w-[100rem] flex-col gap-6 px-4 py-6 lg:flex-row">
      <aside className="hidden sm:block lg:w-60 lg:shrink-0">
        <div className="lg:sticky lg:top-6">
          <PipelineSidebar paper={paper} />
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
      <AgentChatPanel paperId={paper.id ?? 'default'} paper={paper} />
    </div>
  )
}
