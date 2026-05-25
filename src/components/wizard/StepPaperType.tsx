'use client'

// Step 2: Paper Type
// The user picks one of 6 paper structures. Each card shows the section breakdown.

import { PaperConfig } from '@/lib/types'

type PaperType = PaperConfig['paperType']

interface Props {
  value: PaperType | ''
  onChange: (value: PaperType) => void
}

// Each paper type card: label, description, and the sections it produces
const PAPER_TYPES: {
  value: PaperType
  label: string
  description: string
  sections: string[]
}[] = [
  {
    value: 'imrad',
    label: 'IMRaD',
    description: 'Empirical research. The standard format for journals.',
    sections: ['Introduction', 'Literature Review', 'Methodology', 'Results', 'Discussion', 'Conclusion'],
  },
  {
    value: 'lit_review',
    label: 'Literature Review',
    description: 'Systematic survey of existing research on a topic.',
    sections: ['Introduction', 'Search Strategy', 'Thematic Synthesis', 'Gaps & Future Work', 'Conclusion'],
  },
  {
    value: 'theoretical',
    label: 'Theoretical / Conceptual',
    description: 'Develops a new framework, model, or theory.',
    sections: ['Introduction', 'Background', 'Theoretical Framework', 'Propositions', 'Implications', 'Conclusion'],
  },
  {
    value: 'case_study',
    label: 'Case Study',
    description: 'Deep analysis of a specific instance or event.',
    sections: ['Introduction', 'Case Background', 'Analysis', 'Findings', 'Discussion', 'Conclusion'],
  },
  {
    value: 'policy_brief',
    label: 'Policy Brief',
    description: 'Evidence-based recommendation for decision makers.',
    sections: ['Executive Summary', 'Problem Statement', 'Evidence Review', 'Options Analysis', 'Recommendations'],
  },
  {
    value: 'conference',
    label: 'Conference Paper',
    description: 'Shorter format for conference proceedings.',
    sections: ['Introduction', 'Related Work', 'Methodology', 'Results', 'Conclusion'],
  },
]

export function StepPaperType({ value, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">What type of paper are you writing?</h2>
        <p className="text-sm text-muted-foreground mb-4">
          This determines the section structure. Hover over a card to see the sections.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PAPER_TYPES.map((type) => (
          <button
            key={type.value}
            type="button"
            onClick={() => onChange(type.value)}
            className={`group relative text-left rounded-lg border-2 p-4 transition-all hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary
              ${value === type.value
                ? 'border-primary bg-primary/5'
                : 'border-border bg-card hover:bg-accent/30'
              }`}
          >
            <div className="font-semibold text-sm mb-1">{type.label}</div>
            <div className="text-xs text-muted-foreground mb-3">{type.description}</div>
            {/* Section list — shown when selected or on hover */}
            <div className={`text-xs space-y-0.5 transition-all ${value === type.value ? 'block' : 'hidden group-hover:block'}`}>
              {type.sections.map((s) => (
                <div key={s} className="text-muted-foreground">→ {s}</div>
              ))}
            </div>
            {value === type.value && (
              <div className="absolute top-2 right-2 text-primary text-xs font-bold">✓</div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
