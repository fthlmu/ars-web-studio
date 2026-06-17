'use client'

// P18 — the WRITE stage (Stages: outline → approve → sections → draft review).
//
// This is the former monolithic /pipeline/page.tsx, moved here unchanged in behavior so
// the unified /pipeline router (src/app/pipeline/page.tsx) can dispatch to it for the
// outline/section portion of the flow while every other stage owns its own route. The
// SectionReviewGate (CP-04) still hands off to /pipeline/integrity (Stage 2.5).
//
// Mental model: each agent call is a measurement, the stream is data arriving over time,
// localStorage is the non-volatile buffer that survives a power cycle (browser close).

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

import { PipelineStepper, PipelineStage } from '@/components/pipeline/PipelineStepper'
import { SectionStream } from '@/components/pipeline/SectionStream'
import { SectionReviewGate } from '@/components/pipeline/SectionReviewGate'
import { AgentProgressPanel } from '@/components/pipeline/AgentProgressPanel'
import { OutlineAccordion } from '@/components/pipeline/OutlineAccordion'
import { LivePaperPane } from '@/components/pipeline/LivePaperPane'
import { loadPaper, savePaper, loadModelConfig } from '@/lib/storage'
import { writeOutline, writeSection, getSectionWordCount, PaperContentError } from '@/lib/ars-client'
import { consumePendingInstructions, loadChatThread, saveChatThread } from '@/lib/chat-persistence'
import type { PaperState, Section, ModelConfig } from '@/lib/types'

// ─── Section heading parser ───────────────────────────────────────────────────

// Paper-type default section headings — used as the surfaced fallback (FP-1 B4) when the
// architect omits the structured section JSON, and by parseSectionHeadings below.
const DEFAULT_HEADINGS: Record<string, string[]> = {
  imrad:        ['Introduction', 'Literature Review', 'Methodology', 'Results', 'Discussion', 'Conclusion'],
  lit_review:   ['Introduction', 'Search Strategy', 'Thematic Synthesis', 'Gaps and Future Work', 'Conclusion'],
  theoretical:  ['Introduction', 'Background', 'Theoretical Framework', 'Propositions', 'Implications', 'Conclusion'],
  case_study:   ['Introduction', 'Case Background', 'Analysis', 'Findings', 'Discussion', 'Conclusion'],
  policy_brief: ['Executive Summary', 'Problem Statement', 'Evidence Review', 'Options Analysis', 'Recommendations'],
  conference:   ['Introduction', 'Related Work', 'Methodology', 'Results', 'Conclusion'],
}

function defaultHeadings(paperType: string): string[] {
  return DEFAULT_HEADINGS[paperType] ?? ['Introduction', 'Body', 'Conclusion']
}

/**
 * Back-compat heading parser for papers generated BEFORE FP-1 (no outlineSections).
 * Looks for markdown ## headings, numbered or plain; falls back to paper-type defaults.
 * New papers derive their section list from the architect's structured JSON instead (B4).
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

  return defaultHeadings(paperType)
}

/**
 * Append assistant chat messages for the chatter (notes) and citation slugs the
 * paper-extract channel pulled out of a deliverable. This is the conversation channel:
 * the paper window only ever gets clean prose.
 */
function postAgentNotes(
  paperId: string,
  stage: string,
  label: string,
  notes: string[],
  citations: string[],
): void {
  if (notes.length === 0 && citations.length === 0) return
  const thread = loadChatThread(paperId)
  const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  for (const note of notes) {
    thread.messages.push({
      id: stamp(),
      role: 'assistant',
      content: `📝 ${label}: ${note}`,
      timestamp: new Date().toISOString(),
      stage,
    })
  }
  if (citations.length > 0) {
    thread.messages.push({
      id: stamp(),
      role: 'assistant',
      content: `🔖 ${label} — citations referenced: ${citations.join(', ')}`,
      timestamp: new Date().toISOString(),
      stage,
    })
  }
  saveChatThread(paperId, thread)
}

/** Target words for a section: the architect's allocation if present, else the heuristic. */
function targetWordsFor(state: PaperState, heading: string): number {
  const declared = state.outlineSections?.find((o) => o.heading === heading)?.targetWords
  if (declared && declared > 0) return declared
  return getSectionWordCount(state.config.wordCount, state.config.paperType, heading)
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

export default function WritePage() {
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

  // Which AI model to use — like picking which instrument takes the measurement.
  // Loaded once on mount; passed to every generation call so all sections use it.
  const modelConfigRef = useRef<ModelConfig | undefined>(undefined)

  // ─── Build pipeline phases from paper state ─────────────────────────────────

  function buildPhases(state: PaperState) {
    const base: PipelineStage[] = [
      { id: 'configured',   label: 'Paper Configured',   status: 'done' },
      {
        id:     'outline',
        label:  'Generating Outline',
        status: state.outline
          ? 'done'
          : state.generationStatus === 'error'
            ? 'error'
            : 'pending',
        error: state.generationStatus === 'error' && !state.outline
          ? 'Outline generation failed'
          : undefined,
      },
      {
        id:          'approval',
        label:       'Outline Review',
        status:      state.outlineApproved ? 'done' : state.outline ? 'active' : 'pending',
        activeLabel: 'awaiting review',
        hint:        'Review the outline below, then click Approve & Start Writing',
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

    persist((prev) => ({ ...prev, generationStatus: 'running' }))
    updatePhase('outline', 'active')
    setOutlineError(null)
    setStreamingText('')
    setActiveSection('outline')

    try {
      // FP-1: the raw stream feeds the live preview; persistence goes through the
      // extract → sanitize → validate channel. writeOutline returns clean outline text
      // plus the architect's structured section list (B4) and any chatter/citations.
      const result = await writeOutline(
        state.config,
        (chunk) => setStreamingText((prev) => prev + chunk),
        defaultHeadings(state.config.paperType),
        modelConfigRef.current,
      )

      const paperId = paperRef.current?.id ?? 'default'
      postAgentNotes(paperId, 'write', 'Outline', result.notes, result.citations)
      if (result.usedFallback) {
        postAgentNotes(paperId, 'write', 'Outline', [
          'The structured section list was missing from the outline, so the default sections for this paper type were used. Review and edit the outline before approving.',
        ], [])
      }

      outlineRef.current = result.outline
      setOutlineText(result.outline)

      persist((prev) => ({ ...prev, outline: result.outline, outlineSections: result.sections }))

      updatePhase('outline', 'done')
      updatePhase('approval', 'active')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      persist((prev) => ({ ...prev, generationStatus: 'error' }))
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

    // FP-1 (B4): derive the section list from the architect's structured JSON, not from
    // regex over the outline text. Fall back to heading parsing only for papers generated
    // before FP-1 (which have no outlineSections).
    const declared = paperRef.current?.outlineSections
    const headings = declared && declared.length > 0
      ? declared.map((d) => d.heading)
      : parseSectionHeadings(outlineRef.current, paper.config.paperType)

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

      const targetWords = targetWordsFor(state, section.heading)

      try {
        // P20: consume any pending instructions from the chat panel
        const userInstructions = consumePendingInstructions(paperRef.current?.id ?? 'default')

        // FP-1: the raw stream feeds the live preview only; what we persist comes back
        // already extracted, sanitized, and validated (with one auto-retry inside).
        const result = await writeSection(
          state.config,
          outline,
          completedSectionsRef.current,
          section.heading,
          targetWords,
          (chunk) => setStreamingText((prev) => prev + chunk),
          modelConfigRef.current,
          userInstructions.length > 0 ? userInstructions : undefined
        )

        postAgentNotes(
          paperRef.current?.id ?? 'default',
          'write',
          section.heading,
          result.notes,
          result.citations,
        )

        const completed: Section = {
          ...section,
          content: result.content,
          wordCount: countWords(result.content),
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
        // FP-1: a PaperContentError means we got chatter/refusal twice — never persist it.
        const msg = err instanceof PaperContentError
          ? `The model did not return clean section content (${err.reason}). Nothing was saved for this section — retry it.`
          : err instanceof Error ? err.message : String(err)
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
    // paperRef is set below before any async work starts. Strict Mode runs this effect twice
    // in development — the second run sees paperRef.current !== null and exits immediately,
    // preventing double-init and double generation. On actual navigation (real unmount/remount)
    // paperRef resets to null, so init runs correctly for the new visit.
    if (paperRef.current !== null) return

    const saved = loadPaper()
    if (!saved) {
      router.replace('/intake')
      return
    }

    paperRef.current = saved
    modelConfigRef.current = loadModelConfig()

    if (saved.sections.length > 0) {
      completedSectionsRef.current = saved.sections.filter(
        (section) => section.status === 'done' || section.status === 'edited'
      )
    }

    if (saved.outline) {
      outlineRef.current = saved.outline
    }

    queueMicrotask(() => {
      setPaper(saved)

      if (saved.outline) {
        setOutlineText(saved.outline)
      }

      if (saved.outlineApproved) {
        setOutlineApproved(true)
      }

      if (saved.generationStatus === 'error' && !saved.outline) {
        setOutlineError('Outline generation failed. Click Retry outline to try again.')
      }

      buildPhases(saved)

      if (saved.generationStatus === 'idle' || saved.generationStatus === 'running') {
        if (!saved.outline) {
          startOutlineGeneration(saved)
        } else if (saved.outlineApproved) {
          const pendingSections = saved.sections.filter((section) => section.status === 'pending')
          if (pendingSections.length > 0) {
            runSectionLoop(saved, saved.outline, pendingSections)
          }
        }
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Retry a single failed section ─────────────────────────────────────────

  async function retrySection(section: Section) {
    if (!paper || isRunningRef.current) return

    updatePhase(`section-${section.id}`, 'active')
    setActiveSection(section.heading)
    setStreamingText('')

    const targetWords = targetWordsFor(paper, section.heading)

    try {
      // FP-1 (B3 fix): a retried section now goes through the SAME extract → sanitize →
      // validate channel as the first pass — it no longer keeps raw pollution.
      const result = await writeSection(
        paper.config,
        outlineRef.current,
        completedSectionsRef.current,
        section.heading,
        targetWords,
        (chunk) => setStreamingText((prev) => prev + chunk),
        modelConfigRef.current
      )

      postAgentNotes(
        paperRef.current?.id ?? 'default',
        'write',
        section.heading,
        result.notes,
        result.citations,
      )

      const completed: Section = {
        ...section,
        content: result.content,
        wordCount: countWords(result.content),
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
      const msg = err instanceof PaperContentError
        ? `The model did not return clean section content (${err.reason}). Nothing was saved for this section — retry it.`
        : err instanceof Error ? err.message : String(err)
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
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Loading paper…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      {/* Left column: pipeline controls, outline, streaming */}
      <div className="min-w-0 flex-1 space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold mb-1 truncate">{paper.config.topic}</h1>
          <p className="text-sm text-muted-foreground">
            {paper.config.paperType.replace('_', ' ').toUpperCase()} ·{' '}
            {paper.config.wordCount.toLocaleString()} words target ·{' '}
            {paper.config.citationFormat}
          </p>
        </div>

        {/* Outline generation progress — indeterminate, shown while outline streams in */}
        {activeSection === 'outline' && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="animate-pulse text-blue-500 font-medium">Generating outline…</span>
            {streamingText && (
              <span className="tabular-nums">{countWords(streamingText)} words so far</span>
            )}
          </div>
        )}

        {/* Section progress bar — shown during section generation */}
        {outlineApproved && totalSections > 0 && !isDone && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Sections complete</span>
              <span className="tabular-nums font-medium">
                {doneCount} / {totalSections}
                <span className="ml-1 text-blue-500">({Math.round(progress)}%)</span>
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {/* Pipeline stepper */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Pipeline Status
          </h2>
          <PipelineStepper stages={phases} />
        </div>

        {/* Agent progress panel — visible whenever AI is actively generating.
            key={activeSection} remounts the panel on each new generation so its
            elapsed timer resets to 0 cleanly without setState in an effect. */}
        <AgentProgressPanel
          key={activeSection ?? 'idle'}
          isActive={activeSection !== null}
          agentName={activeSection === 'outline' ? 'Structure Architect' : 'Draft Writer'}
          taskLabel={
            activeSection === 'outline'
              ? 'Generating paper outline…'
              : activeSection
                ? `Writing: ${activeSection}`
                : ''
          }
          streamingText={streamingText}
          totalSections={outlineApproved && totalSections > 0 ? totalSections : undefined}
          completedSections={outlineApproved && totalSections > 0 ? doneCount : undefined}
        />

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

            {/* Instruction callout — shown once outline is ready, guides the user */}
            {outlineText && activeSection !== 'outline' && (
              <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 flex items-start gap-3">
                <span className="text-lg shrink-0 mt-0.5">📋</span>
                <p className="flex-1 text-sm text-amber-800 dark:text-amber-200 leading-relaxed">
                  Your outline is ready. <strong>Click any section to edit it inline.</strong>{' '}
                  When you are happy with the structure, click{' '}
                  <strong>Approve &amp; Start Writing</strong> to begin generating the full paper.
                </p>
                <Button
                  onClick={handleApproveOutline}
                  size="sm"
                  className="shrink-0 self-center"
                >
                  Approve &amp; Start Writing →
                </Button>
              </div>
            )}

            {/* While generating: streaming preview. After done: structured accordion. */}
            {activeSection === 'outline' || !outlineText ? (
              <div
                className="min-h-[12rem] rounded-md border bg-muted/10 px-4 py-3 text-sm leading-relaxed text-foreground/80 overflow-y-auto prose prose-sm max-w-none"
                aria-live="polite"
                aria-label="Outline being generated"
              >
                {outlineText || <span className="text-muted-foreground italic">Outline will appear here as it is generated…</span>}
                {activeSection === 'outline' && (
                  <span className="inline-block w-0.5 h-4 bg-blue-400 ml-0.5 animate-pulse align-middle" />
                )}
              </div>
            ) : (
              <OutlineAccordion
                outline={outlineText}
                onChange={(newText) => {
                  setOutlineText(newText)
                  outlineRef.current = newText
                }}
                readOnly={false}
              />
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

        {/* P10 — Stage 2 draft review gate (CP-04). Approving the draft freezes the
            sections and hands off to the Integrity Gate (Stage 2.5). */}
        {isDone && (
          <SectionReviewGate
            paper={paper}
            onApproveDraft={() => {
              persist((prev) => ({ ...prev, integrityStatus: 'running' }))
              router.push('/pipeline/integrity')
            }}
            onRegenerate={(id) => {
              const target = paper.sections.find((s) => s.id === id)
              if (target) retrySection(target)
            }}
          />
        )}

      </div>

      {/* Right column: live paper preview pane (FP-3) — shows sections as they complete */}
      {paper.sections.length > 0 && (
        <aside className="hidden xl:block xl:w-[28rem] xl:shrink-0">
          <LivePaperPane paper={paper} />
        </aside>
      )}
    </div>
  )
}
