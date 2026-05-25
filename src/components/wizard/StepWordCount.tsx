'use client'

// Step 7: Target Word Count
// Sets the total paper length. Word count is distributed across sections by the pipeline.

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PaperConfig } from '@/lib/types'

interface Props {
  value: number
  paperType: PaperConfig['paperType'] | ''
  onChange: (value: number) => void
}

// Minimum allowed word counts per paper type
const MINIMUMS: Record<PaperConfig['paperType'], number> = {
  policy_brief: 2000,
  conference:   2000,
  case_study:   4000,
  imrad:        5000,
  theoretical:  5000,
  lit_review:   6000,
}

// Suggested defaults per paper type
const SUGGESTED: Record<PaperConfig['paperType'], number> = {
  policy_brief: 3000,
  conference:   4000,
  case_study:   6000,
  imrad:        8000,
  theoretical:  8000,
  lit_review:   10000,
}

// Human-readable paper type labels
const TYPE_LABELS: Record<PaperConfig['paperType'], string> = {
  imrad:        'IMRaD',
  lit_review:   'Literature Review',
  theoretical:  'Theoretical',
  case_study:   'Case Study',
  policy_brief: 'Policy Brief',
  conference:   'Conference Paper',
}

export function StepWordCount({ value, paperType, onChange }: Props) {
  const minimum = paperType ? MINIMUMS[paperType] : 0
  const suggested = paperType ? SUGGESTED[paperType] : 0
  const isBelowMin = value > 0 && value < minimum

  const handleSuggest = () => {
    if (suggested > 0) onChange(suggested)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Target word count</h2>
        <p className="text-sm text-muted-foreground mb-4">
          The total length of the paper (excluding references). The pipeline distributes
          this across sections automatically.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="wordcount">Word Count</Label>
          {paperType && suggested > 0 && (
            <button
              type="button"
              onClick={handleSuggest}
              className="text-xs text-primary underline underline-offset-2"
            >
              Use suggested ({suggested.toLocaleString()} for {TYPE_LABELS[paperType]})
            </button>
          )}
        </div>
        <Input
          id="wordcount"
          type="number"
          min={minimum || 1000}
          step={500}
          value={value || ''}
          onChange={(e) => onChange(Number(e.target.value))}
          placeholder={suggested ? String(suggested) : '8000'}
          className="text-lg"
        />
      </div>

      {/* Minimum warning */}
      {isBelowMin && (
        <p className="text-sm text-yellow-600 dark:text-yellow-400">
          ⚠ Minimum for {paperType ? TYPE_LABELS[paperType] : 'this paper type'} is{' '}
          {minimum.toLocaleString()} words.
        </p>
      )}

      {/* Word allocation preview */}
      {paperType && value >= minimum && (
        <WordAllocationPreview wordCount={value} paperType={paperType} />
      )}
    </div>
  )
}

// Shows how the word count will be roughly distributed across sections
function WordAllocationPreview({
  wordCount,
  paperType,
}: {
  wordCount: number
  paperType: PaperConfig['paperType']
}) {
  // Approximate section weight distribution (fraction of total words)
  const WEIGHTS: Record<PaperConfig['paperType'], { label: string; weight: number }[]> = {
    imrad: [
      { label: 'Introduction', weight: 0.12 },
      { label: 'Literature Review', weight: 0.22 },
      { label: 'Methodology', weight: 0.18 },
      { label: 'Results', weight: 0.22 },
      { label: 'Discussion', weight: 0.18 },
      { label: 'Conclusion', weight: 0.08 },
    ],
    lit_review: [
      { label: 'Introduction', weight: 0.10 },
      { label: 'Search Strategy', weight: 0.10 },
      { label: 'Thematic Synthesis', weight: 0.60 },
      { label: 'Gaps & Future Work', weight: 0.12 },
      { label: 'Conclusion', weight: 0.08 },
    ],
    theoretical: [
      { label: 'Introduction', weight: 0.12 },
      { label: 'Background', weight: 0.20 },
      { label: 'Theoretical Framework', weight: 0.35 },
      { label: 'Propositions', weight: 0.18 },
      { label: 'Implications', weight: 0.10 },
      { label: 'Conclusion', weight: 0.05 },
    ],
    case_study: [
      { label: 'Introduction', weight: 0.10 },
      { label: 'Case Background', weight: 0.20 },
      { label: 'Analysis', weight: 0.35 },
      { label: 'Findings', weight: 0.20 },
      { label: 'Discussion', weight: 0.10 },
      { label: 'Conclusion', weight: 0.05 },
    ],
    policy_brief: [
      { label: 'Executive Summary', weight: 0.10 },
      { label: 'Problem Statement', weight: 0.20 },
      { label: 'Evidence Review', weight: 0.35 },
      { label: 'Options Analysis', weight: 0.20 },
      { label: 'Recommendations', weight: 0.15 },
    ],
    conference: [
      { label: 'Introduction', weight: 0.15 },
      { label: 'Related Work', weight: 0.20 },
      { label: 'Methodology', weight: 0.25 },
      { label: 'Results', weight: 0.25 },
      { label: 'Conclusion', weight: 0.15 },
    ],
  }

  const sections = WEIGHTS[paperType]

  return (
    <div className="rounded-lg border p-4 bg-muted/30">
      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
        Approximate Section Allocation
      </p>
      <div className="space-y-1.5">
        {sections.map((s) => {
          const words = Math.round(wordCount * s.weight)
          return (
            <div key={s.label} className="flex justify-between text-sm">
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-medium tabular-nums">~{words.toLocaleString()} words</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
