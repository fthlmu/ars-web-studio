'use client'

// Pipeline execution page — drives the ARS agents sequentially and streams output
// section by section. Think of this like a data acquisition system: each agent call
// is a measurement, the stream is the data arriving over time, localStorage is the
// non-volatile buffer that survives a power cycle (browser close).
//
// Flow:
//   Load paper config → generate outline → user approves → write sections in order
//   → auto-save after each → show "Done" when all complete

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { PipelineStepper, PipelineStage } from '@/components/pipeline/PipelineStepper'
import { SectionStream } from '@/components/pipeline/SectionStream'
import { loadPaper, savePaper } from '@/lib/storage'
import { generateOutline, generateSection, getSectionWordCount } from '@/lib/ars-client'
import type { PaperState, Section } from '@/lib/types'

// ─── Section heading parser ───────────────────────────────────────────────────

/**
 * Extracts section headings from the outline text.
 * Looks for markdown ## headings, numbered or plain.
 * Falls back to paper-type defaults if parsing yields too few results.
 */
function parseSectionHeadings(outlineText: string, paperType: string): string[] {
  const lines = outlineText.split('\n')
  const headings: string[] = []

  for (const line of lines) {
    // Match: ## N. Title  or  ## Title  (but NOT # which is the paper title)
    const m = line.match(/^#{2,3}\s+(?:\d+[\.\)]\s*)?(.+)/)
    if (m) {
      const raw = m[1]
        .replace(/\s*\(.*?\)\s*$/, '')   // strip parenthetical notes
        .replace(/\s*—.*$/, '')           // strip em-dash subtitles
        .replace(/\*+/g, '')              // strip markdown bold
        .trim()
      if (raw.length > 0 && raw.length < 100) headings.push(raw)
    }
  }

  if (headings.length >= 3) return headings

  // Fallback: use the paper type's default sections
  const DEFAULTS: Record<string, string[]> = {
    imrad:        ['Introduction', 'Literature Review', 'Methodology', 'Results', 'Discussion', 'Conclusion'],
    lit_review:   ['Introduction', 'Search Strategy', 'Thematic Synthesis', 'Gaps and Future Work', 'Conclusion'],
    theoretical:  ['Introduction', 'Background', 'Theoretical Framework', 'Propositions', 'Implications', 'Conclusion'],
    case_study:   ['Introduction', 'Case Background', 'Analysis', 'Findings', 'Discussion', 'Conclusion'],
    policy_brief: ['Executive Summary', 'Problem Statement', 'Evidence Review', 'Options Analysis', 'Recommendations'],
    conference:   ['Introduction', 'Related Work', 'Methodology', 'Results', 'Conclusion'],
  }
  return DEFAULTS[paperType] ?? ['Introduction', 'Body', 'Conclusion']
}

/** Count words in a plain-text string */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Strip HTML tags to get plain text for word counting */
function stripTagsSimple(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const router = useRouter()

  // The full paper state (config + outline + sections)
  const [paper, setPaper] = useState<PaperState | null>(null)

  // Pipeline phases shown in the stepper
  const [phases, setPhases] = useState<PipelineStage[]>([])

  // Outline: generated text + edited version
  const [outlineText, setOutlineText] = useState('')
  const [outlineApproved, setOutlineApproved] = useState(false)

  // Currently streaming section
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [streamingText, setStreamingText] = useState('')

  // Error state per section (keyed by section heading)
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({})
  const [outlineError, setOutlineError] = useState<string | null>(null)

  // Generation lock — prevents double-start
  const isRunningRef = useRef(false)

  // Keep a ref to the most recent completed sections to avoid stale closures
  const completedSectionsRef = useRef<Section[]>([])

  // Keep a ref to the current paper state for use inside async callbacks
  const paperRef = useRef<PaperState | null>(null)
  const outlineRef = useRef('')

  // ─── Build pipeline phases from paper state ─────────────────────────────────

  function buildPhases(state: PaperState) {
    const base: PipelineStage[] = [
      { id: 'configured',   label: 'Paper Configured',   status: 'done' },
      {
        id:     'outline',
        label:  'Generating Outline',
        status: state.outline ? 'done' : 'pending',
      },
      {
        id:     'approval',
        label:  'Outline Review',
        status: state.outlineApproved ? 'done' : state.outline ? 'active' : 'pending',
      },
    ]

    const sectionPhases: PipelineStage[] = state.sections.map((s) => ({
      id:        `section-${s.id}`,
      label:     `Writing ${s.heading}`,
      status:    s.status === 'done' || s.status === 'edited' ? 'done' : 'pending',
      wordCount: s.status === 'done' || s.status === 'edited'
        ? countWords(stripTagsSimple(s.content))
        : undefined,
    }))

    const allDone =
      state.generationStatus === 'done' ||
      (state.outlineApproved &&
        state.sections.length > 0 &&
        state.sections.every((s) => s.status === 'done' || s.status === 'edited'))

    const donePhase: PipelineStage = {
      id:     'done',
      label:  'Done — Edit or Export',
      status: allDone ? 'done' : 'pending',
    }

    setPhases([...base, ...sectionPhases, donePhase])
  }

  // ─── Update a single phase status ──────────────────────────────────────────

  const updatePhase = useCallback(
    (id: string, status: PipelineStage['status'], extra?: Partial<PipelineStage>) => {
      setPhases((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status, ...extra } : p))
      )
    },
    []
  )

  // ─── Save paper state helper ────────────────────────────────────────────────

  const persist = useCallback((updater: (prev: PaperState) => PaperState) => {
    if (!paperRef.current) return
    const next = updater(paperRef.current)
    next.updatedAt = new Date().toISOString()
    paperRef.current = next
    setPaper(next)
    savePaper(next)
  }, [])

  // ─── Stage 1: Generate outline ──────────────────────────────────────────────

  async function startOutlineGeneration(state: PaperState) {
    if (isRunningRef.current) return
    isRunningRef.current = true

    updatePhase('outline', 'active')
    setOutlineError(null)
    setStreamingText('')
    setActiveSection('outline')

    let accumulatedOutline = ''
    try {
      accumulatedOutline = await generateOutline(state.config, (chunk) => {
        accumulatedOutline += chunk
        setStreamingText((prev) => prev + chunk)
      })

      outlineRef.current = accumulatedOutline
      setOutlineText(accumulatedOutline)

      persist((prev) => ({ ...prev, outline: accumulatedOutline }))

      updatePhase('outline', 'done')
      updatePhase('approval', 'active')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setOutlineError(message)
      updatePhase('outline', 'error', { error: message })
      console.error('Outline generation failed:', err)
    } finally {
      setActiveSection(null)
      setStreamingText('')
      isRunningRef.current = false
    }
  }

  // ─── Stage 2: Outline approval ──────────────────────────────────────────────

  function handleApproveOutline() {
    if (!paper) return

    // Use the (possibly edited) outlineText to derive sections
    const headings = parseSectionHeadings(outlineRef.current, paper.config.paperType)

    // Build Section objects — one per heading
    const sections: Section[] = headings.map((heading, i) => ({
      id:        String(i),
      heading,
      level:     1,
      content:   '',
      wordCount: 0,
      status:    'pending' as const,
    }))

    persist((prev) => ({
      ...prev,
      outline:         outlineRef.current,
      outlineApproved: true,
      sections,
      generationStatus: 'running',
    }))

    setOutlineApproved(true)
    updatePhase('approval', 'done')

    // Add section phases to the stepper
    const sectionPhases: PipelineStage[] = sections.map((s) => ({
      id:     `section-${s.id}`,
      label:  `Writing ${s.heading}`,
      status: 'pending' as const,
    }))
    const donePhase: PipelineStage = { id: 'done', label: 'Done — Edit or Export', status: 'pending' }

    setPhases((prev) => {
      const base = prev.filter((p) => ['configured', 'outline', 'approval'].includes(p.id))
      return [...base, ...sectionPhases, donePhase]
    })

    runSectionLoop(paperRef.current!, outlineRef.current, sections)
  }

  // ─── Stage 3: Sequential section generation ─────────────────────────────────

  async function runSectionLoop(
    state: PaperState,
    outline: string,
    sectionsToGenerate: Section[]
  ) {
    if (isRunningRef.current) return
    isRunningRef.current = true

    for (const section of sectionsToGenerate) {
      const phaseId = `section-${section.id}`
      updatePhase(phaseId, 'active')
      setActiveSection(section.heading)
      setStreamingText('')

      const targetWords = getSectionWordCount(
        state.config.wordCount,
        state.config.paperType,
        section.heading
      )

      let content = ''
      try {
        content = await generateSection(
          state.config,
          outline,
          completedSectionsRef.current,
          section.heading,
          targetWords,
          (chunk) => {
            content += chunk
            setStreamingText((prev) => prev + chunk)
          }
        )

        const completed: Section = {
          ...section,
          content,
          wordCount: countWords(content),
          status: 'done',
        }

        completedSectionsRef.current = [...completedSectionsRef.current, completed]

        // Auto-save after this section completes
        persist((prev) => ({
          ...prev,
          sections: prev.sections.map((s) =>
            s.id === section.id ? completed : s
          ),
        }))

        updatePhase(phaseId, 'done', { wordCount: completed.wordCount })
        setSectionErrors((prev) => {
          const next = { ...prev }
          delete next[section.heading]
          return next
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        updatePhase(phaseId, 'error', { error: msg })
        setSectionErrors((prev) => ({ ...prev, [section.heading]: msg }))
        // Don't abort — continue to next section; user can retry the failed one
      }
    }

    setActiveSection(null)
    setStreamingText('')
    isRunningRef.current = false

    // Check if all sections completed successfully
    const allDone = completedSectionsRef.current.length === (paperRef.current?.sections.length ?? 0)
    if (allDone) {
      persist((prev) => ({ ...prev, generationStatus: 'done' }))
      updatePhase('done', 'done')
    }
  }

  // ─── Load paper state on mount ─────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return

      const saved = loadPaper()
      if (!saved) {
        router.replace('/intake')
        return
      }

      paperRef.current = saved
      setPaper(saved)

      // If sections already exist (resuming after close), load them
      if (saved.sections.length > 0) {
        completedSectionsRef.current = saved.sections.filter(
          (section) => section.status === 'done' || section.status === 'edited'
        )
      }

      if (saved.outline) {
        setOutlineText(saved.outline)
        outlineRef.current = saved.outline
      }

      if (saved.outlineApproved) {
        setOutlineApproved(true)
      }

      // Build initial phases from saved state
      buildPhases(saved)

      // Auto-start generation if not already done
      if (saved.generationStatus === 'idle' || saved.generationStatus === 'running') {
        if (!saved.outline) {
          // Outline not yet generated — start from scratch
          startOutlineGeneration(saved)
        } else if (saved.outlineApproved) {
          // Outline approved but sections not all done — resume section generation
          const pendingSections = saved.sections.filter((section) => section.status === 'pending')
          if (pendingSections.length > 0) {
            runSectionLoop(saved, saved.outline, pendingSections)
          }
        }
      }
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Retry a single failed section ─────────────────────────────────────────

  async function retrySection(section: Section) {
    if (!paper || isRunningRef.current) return

    updatePhase(`section-${section.id}`, 'active')
    setActiveSection(section.heading)
    setStreamingText('')

    const targetWords = getSectionWordCount(
      paper.config.wordCount,
      paper.config.paperType,
      section.heading
    )

    let content = ''
    try {
      content = await generateSection(
        paper.config,
        outlineRef.current,
        completedSectionsRef.current,
        section.heading,
        targetWords,
        (chunk) => {
          content += chunk
          setStreamingText((prev) => prev + chunk)
        }
      )

      const completed: Section = {
        ...section,
        content,
        wordCount: countWords(content),
        status: 'done',
      }

      completedSectionsRef.current = [...completedSectionsRef.current, completed]

      persist((prev) => ({
        ...prev,
        sections: prev.sections.map((s) => (s.id === section.id ? completed : s)),
      }))

      updatePhase(`section-${section.id}`, 'done', { wordCount: completed.wordCount })
      setSectionErrors((prev) => {
        const next = { ...prev }
        delete next[section.heading]
        return next
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      updatePhase(`section-${section.id}`, 'error', { error: msg })
      setSectionErrors((prev) => ({ ...prev, [section.heading]: msg }))
    } finally {
      setActiveSection(null)
      setStreamingText('')
    }
  }

  // ─── Derived state ──────────────────────────────────────────────────────────

  const isDone =
    paper?.generationStatus === 'done' ||
    (outlineApproved &&
      paper !== null &&
      paper.sections.length > 0 &&
      paper.sections.every((s) => s.status === 'done' || s.status === 'edited'))

  const doneCount = paper?.sections.filter(
    (s) => s.status === 'done' || s.status === 'edited'
  ).length ?? 0

  const totalSections = paper?.sections.length ?? 0
  const progress = totalSections > 0 ? (doneCount / totalSections) * 100 : 0

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (!paper) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading paper…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8 sm:py-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold mb-1 truncate">{paper.config.topic}</h1>
          <p className="text-sm text-muted-foreground">
            {paper.config.paperType.replace('_', ' ').toUpperCase()} ·{' '}
            {paper.config.wordCount.toLocaleString()} words target ·{' '}
            {paper.config.citationFormat}
          </p>
        </div>

        {/* Section progress bar — only shown during section generation */}
        {outlineApproved && totalSections > 0 && !isDone && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Sections complete</span>
              <span>{doneCount} / {totalSections}</span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}

        {/* Pipeline stepper */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Pipeline Status
          </h2>
          <PipelineStepper stages={phases} />
        </div>

        {/* Outline error banner */}
        {outlineError && !outlineApproved && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <p className="font-medium text-destructive">Outline generation failed</p>
            <p className="mt-1 text-muted-foreground">{outlineError}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => startOutlineGeneration(paper)}
              disabled={activeSection === 'outline'}
            >
              Retry outline
            </Button>
          </div>
        )}

        {/* Outline box — shown while generating OR waiting for approval */}
        {!outlineApproved && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {activeSection === 'outline' ? 'Generating Outline…' : 'Review & Edit Outline'}
            </h2>

            <Textarea
              value={outlineText}
              onChange={(e) => {
                setOutlineText(e.target.value)
                outlineRef.current = e.target.value
              }}
              placeholder="Outline will appear here as it is generated…"
              rows={16}
              className="font-mono text-sm resize-none"
              readOnly={activeSection === 'outline'}
              aria-live="polite"
              aria-label="Paper outline"
            />

            {/* Approval gate — only shown when outline is ready and not actively generating */}
            {outlineText && activeSection !== 'outline' && (
              <div className="flex items-center gap-3 pt-1">
                <p className="text-sm text-muted-foreground flex-1">
                  Review the outline above. You can edit section titles or order before approving.
                </p>
                <Button onClick={handleApproveOutline} className="shrink-0">
                  Approve & Start Writing →
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Active section streaming display */}
        {activeSection && activeSection !== 'outline' && paper.sections.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Currently Writing
            </h2>
            {paper.sections
              .filter((s) => s.heading === activeSection)
              .map((s) => (
                <SectionStream
                  key={s.id}
                  heading={s.heading}
                  status="active"
                  streamingText={streamingText}
                />
              ))}
          </div>
        )}

        {/* Per-section error retry buttons */}
        {Object.keys(sectionErrors).length > 0 && paper.sections.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Failed Sections
            </h2>
            {paper.sections
              .filter((s) => sectionErrors[s.heading])
              .map((s) => (
                <SectionStream
                  key={s.id}
                  heading={s.heading}
                  status="error"
                  streamingText=""
                  error={sectionErrors[s.heading]}
                  onRetry={() => retrySection(s)}
                />
              ))}
          </div>
        )}

        {/* Done state */}
        {isDone && (
          <div className="rounded-xl border bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 p-6 text-center space-y-4">
            <div className="text-3xl">🎉</div>
            <div>
              <h2 className="text-lg font-semibold text-green-800 dark:text-green-200">
                Paper Generated
              </h2>
              <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                {totalSections} sections ·{' '}
                {paper.sections
                  .reduce((sum, s) => sum + countWords(stripTagsSimple(s.content)), 0)
                  .toLocaleString()}{' '}
                words written
              </p>
            </div>
            <div className="flex flex-col gap-3 justify-center sm:flex-row">
              <Button variant="outline" onClick={() => router.push('/editor')}>
                Edit Sections
              </Button>
              <Button onClick={() => router.push('/export')}>
                Export Paper →
              </Button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
