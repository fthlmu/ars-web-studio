'use client'

// Step 4: Citation Format
// Choose one citation standard for the entire paper.

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { PaperConfig } from '@/lib/types'

type CitationFormat = PaperConfig['citationFormat']

interface Props {
  value: CitationFormat | ''
  paperType: PaperConfig['paperType'] | ''
  onChange: (value: CitationFormat) => void
}

const FORMATS: { value: CitationFormat; label: string; usedIn: string }[] = [
  { value: 'IEEE',     label: 'IEEE',     usedIn: 'Engineering, Computer Science, Electronics' },
  { value: 'APA7',    label: 'APA 7',    usedIn: 'Social Sciences, Psychology, Education' },
  { value: 'Chicago', label: 'Chicago',  usedIn: 'Humanities, History, Arts' },
  { value: 'MLA',     label: 'MLA',      usedIn: 'Literature, Linguistics, Cultural Studies' },
  { value: 'Vancouver', label: 'Vancouver', usedIn: 'Medicine, Biology, Health Sciences' },
]

// Auto-suggest the most likely citation format based on topic keywords
function suggestFormat(topic: string): CitationFormat | null {
  const t = topic.toLowerCase()
  if (t.match(/ieee|circuit|rf|antenna|signal|embedded|fpga|wireless|sensor|power|electrical/)) return 'IEEE'
  if (t.match(/medic|clinic|health|patient|drug|disease|hospital|nursing/)) return 'Vancouver'
  if (t.match(/psycholog|social|education|learning|behavior|survey/)) return 'APA7'
  if (t.match(/histor|literature|art|music|culture|philosophy|humanit/)) return 'Chicago'
  return null
}

export function StepCitation({ value, paperType, onChange }: Props) {
  // We pass paperType but use it for potential future warnings; not used yet
  void paperType

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Citation format</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Choose the reference style for your paper. For EE/RF research, IEEE is standard.
        </p>
      </div>

      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as CitationFormat)}
        className="space-y-3"
      >
        {FORMATS.map((fmt) => (
          <div
            key={fmt.value}
            className={`flex items-start gap-3 rounded-lg border p-3 transition-colors cursor-pointer
              ${value === fmt.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/30'}`}
            onClick={() => onChange(fmt.value)}
          >
            <RadioGroupItem value={fmt.value} id={fmt.value} className="mt-0.5" />
            <Label htmlFor={fmt.value} className="cursor-pointer flex-1">
              <span className="font-semibold">{fmt.label}</span>
              <span className="text-muted-foreground text-xs ml-2">— {fmt.usedIn}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  )
}
