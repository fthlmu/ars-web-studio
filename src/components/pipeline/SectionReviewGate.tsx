'use client'

// SectionReviewGate — the P10 "Stage 2 review" panel shown once every section
// has been drafted. Think of it like a bench inspection step before you hand a
// board off to the next test station: you eyeball each section, check whether it
// hit its expected length, and flag the spots where the writer left a
// "[MATERIAL GAP ...]" marker (a claim with no source material behind it).
//
// This component is PURE DISPLAY + callbacks. It never mutates paper state and it
// never calls the model. The parent (pipeline/page.tsx) owns all the real work:
//   • onRegenerate(sectionId) → re-runs ONE section (reuses the page's retrySection)
//   • onApproveDraft()        → freezes the draft and moves on to the Integrity Gate
//
// Why a separate component? Same reason you put a connector between two PCBs:
// it keeps the wiring (page state machine) and the inspection panel (this UI)
// loosely coupled, so each can change without breaking the other.

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { PaperState } from '@/lib/types'
import { stripHtml, getSectionWordCount } from '@/lib/ars-client'

// The marker the drafting agents leave behind whenever a claim has no backing
// source material. We must use the EXACT same regex the rest of P10 uses so the
// counts here agree with the integrity gate and the editor highlight.
//   \[MATERIAL GAP   → literal "[MATERIAL GAP"
//   [^\]]*           → anything up to the closing bracket
//   \]               → literal "]"
// The `g` flag means "find ALL occurrences", not just the first.
const MATERIAL_GAP_REGEX = /\[MATERIAL GAP[^\]]*\]/g

/** Count words in a plain-text string (same approach as the pipeline page). */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Count how many [MATERIAL GAP ...] markers appear in a section's plain text. */
function countMaterialGaps(plainText: string): number {
  const matches = plainText.match(MATERIAL_GAP_REGEX)
  return matches ? matches.length : 0
}

interface Props {
  paper: PaperState
  onApproveDraft: () => void
  onRegenerate: (sectionId: string) => void
}

export function SectionReviewGate({ paper, onApproveDraft, onRegenerate }: Props) {
  // Pre-compute one inspection row per section. We strip the Tiptap HTML to plain
  // text ONCE here, then derive both the actual word count and the gap count from
  // that same plain text — like taking a single measurement and reading two values
  // off it instead of probing the same node twice.
  const rows = paper.sections.map((section) => {
    const plain = stripHtml(section.content)
    const actualWords = countWords(plain)
    const targetWords = getSectionWordCount(
      paper.config.wordCount,
      paper.config.paperType,
      section.heading
    )
    const gapCount = countMaterialGaps(plain)
    return { section, actualWords, targetWords, gapCount }
  })

  // Advisory total — the sum of every section's material gaps. This is NOT a
  // hard block here (the Integrity Gate is the blocking check); it just tells the
  // user how much unsupported material is still in the draft before they approve.
  const totalGaps = rows.reduce((sum, r) => sum + r.gapCount, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stage 2 — Draft Review</CardTitle>
        <CardDescription>
          Review each section before the Integrity Gate. Regenerate any section that
          looks off, or approve the draft to run the academic-integrity check.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Advisory note: total unsupported-claim markers across the whole draft.
            Always carries a TEXT label (never color-only) per NFR-17. */}
        <div
          className={
            totalGaps > 0
              ? 'rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-200'
              : 'rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/30 dark:text-green-200'
          }
        >
          {totalGaps > 0 ? (
            <span>
              <strong>Advisory:</strong> {totalGaps} unsupported-claim marker
              {totalGaps === 1 ? '' : 's'} ([MATERIAL GAP]) remain in the draft.
              Provide the missing data/source or delete the claim before finalizing.
            </span>
          ) : (
            <span>
              <strong>No material gaps:</strong> every drafted claim is backed by
              source material.
            </span>
          )}
        </div>

        {/* Per-section inspection rows */}
        <ul className="space-y-2">
          {rows.map(({ section, actualWords, targetWords, gapCount }) => (
            <li
              key={section.id}
              className="flex flex-col gap-2 rounded-md border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              {/* Left: heading + metrics */}
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {section.heading}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {/* word-count-vs-target */}
                  <span className="tabular-nums">
                    {actualWords.toLocaleString()} / {targetWords.toLocaleString()} words
                  </span>

                  {/* [MATERIAL GAP] count — only call attention when > 0.
                      Badge always carries a TEXT label, never color-only (NFR-17). */}
                  {gapCount > 0 ? (
                    <Badge
                      variant="outline"
                      className="border-yellow-400 text-yellow-700 dark:text-yellow-300"
                    >
                      {gapCount} material gap{gapCount === 1 ? '' : 's'}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      No gaps
                    </Badge>
                  )}
                </div>
              </div>

              {/* Right: per-section regenerate control */}
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => onRegenerate(section.id)}
              >
                Regenerate
              </Button>
            </li>
          ))}
        </ul>

        {/* Approve gate → hands off to the Integrity Gate (Stage 2.5) */}
        <div className="flex items-center gap-3 pt-1">
          <p className="flex-1 text-sm text-muted-foreground">
            Approving the draft freezes these sections and starts the Integrity Gate.
          </p>
          <Button
            className="shrink-0"
            onClick={onApproveDraft}
            data-testid="approve-draft"
          >
            Approve Draft → Integrity Gate
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
