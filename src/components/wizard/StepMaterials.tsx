'use client'

// Step 8: Existing Materials
// What does the user already have? The pipeline adapts based on what's provided.

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

interface Props {
  value: Record<string, boolean>
  onChange: (value: Record<string, boolean>) => void
}

const MATERIALS = [
  {
    id: 'researchQuestion',
    label: 'Research Question Brief',
    description: 'A written statement of your research question and objectives.',
  },
  {
    id: 'bibliography',
    label: 'Bibliography / Reference List',
    description: 'A list of sources you plan to cite.',
  },
  {
    id: 'draftSections',
    label: 'Existing Draft Sections',
    description: 'Any partial or full sections you have already written.',
  },
  {
    id: 'dataResults',
    label: 'Data / Results Tables',
    description: 'Measurement data, experimental results, or statistical output.',
  },
  {
    id: 'figures',
    label: 'Figures / Charts',
    description: 'Diagrams, plots, schematics, or images.',
  },
  {
    id: 'surveyData',
    label: 'Survey or Interview Data',
    description: 'Raw data from primary qualitative or quantitative research.',
  },
]

export function StepMaterials({ value, onChange }: Props) {
  const toggle = (id: string) => {
    onChange({ ...value, [id]: !value[id] })
  }

  const selectedCount = Object.values(value).filter(Boolean).length

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">What do you already have?</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Check everything that applies. The pipeline uses this to decide which
          agents to run and how to weight existing content.
        </p>
      </div>

      <div className="space-y-3">
        {MATERIALS.map((m) => (
          <div
            key={m.id}
            className={`flex items-start gap-3 rounded-lg border p-4 transition-colors cursor-pointer
              ${value[m.id] ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/30'}`}
            onClick={() => toggle(m.id)}
          >
            <Checkbox
              id={m.id}
              checked={!!value[m.id]}
              onCheckedChange={() => toggle(m.id)}
              className="mt-0.5"
            />
            <Label htmlFor={m.id} className="cursor-pointer flex-1">
              <div className="font-semibold text-sm">{m.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{m.description}</div>
            </Label>
          </div>
        ))}
      </div>

      {selectedCount === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing selected — the pipeline will generate everything from scratch. That&apos;s fine.
        </p>
      )}
    </div>
  )
}
