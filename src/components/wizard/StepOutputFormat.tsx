'use client'

// Step 5: Output Formats
// Which file formats should the export screen produce?

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

interface Props {
  value: string[]
  onChange: (value: string[]) => void
}

const FORMATS = [
  {
    id: 'markdown',
    label: 'Markdown (.md)',
    description: 'Plain text with formatting. Opens in any editor. Always fast.',
  },
  {
    id: 'latex',
    label: 'LaTeX (.tex)',
    description: 'Paste into Overleaf for journal-ready PDF. Good for math-heavy papers.',
  },
  {
    id: 'pdf',
    label: 'PDF via Typst',
    description: 'IEEE two-column PDF generated locally. Requires Typst installed.',
  },
]

export function StepOutputFormat({ value, onChange }: Props) {
  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((f) => f !== id))
    } else {
      onChange([...value, id])
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Output formats</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Choose which formats you want on the export screen. Select at least one.
        </p>
      </div>

      <div className="space-y-3">
        {FORMATS.map((fmt) => (
          <div
            key={fmt.id}
            className={`flex items-start gap-3 rounded-lg border p-4 transition-colors cursor-pointer
              ${value.includes(fmt.id) ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/30'}`}
            onClick={() => toggle(fmt.id)}
          >
            <Checkbox
              id={fmt.id}
              checked={value.includes(fmt.id)}
              onCheckedChange={() => toggle(fmt.id)}
              className="mt-0.5"
            />
            <Label htmlFor={fmt.id} className="cursor-pointer flex-1">
              <div className="font-semibold">{fmt.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{fmt.description}</div>
            </Label>
          </div>
        ))}
      </div>

      {value.length === 0 && (
        <p className="text-sm text-yellow-600 dark:text-yellow-400">
          ⚠ Select at least one output format.
        </p>
      )}
    </div>
  )
}
