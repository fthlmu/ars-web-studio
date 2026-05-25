'use client'

// Step 10: Style Profile (optional)
// Notes about writing style — tone, formality, any style preferences.

import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

interface Props {
  value: string
  onChange: (value: string) => void
  onSkip: () => void
}

export function StepStyle({ value, onChange, onSkip }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">
          Writing style notes{' '}
          <span className="text-muted-foreground font-normal text-base">(optional)</span>
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Describe your preferred writing tone or style. The pipeline uses this to
          calibrate how the paper reads. Examples below.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="style">Style Notes</Label>
        <Textarea
          id="style"
          placeholder={`Examples:
- Formal and precise. Avoid passive voice. Use numbered equations.
- IEEE conference style. Dense, technical, minimal hedging.
- Clear and accessible. Explain acronyms. Avoid jargon where possible.`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          className="resize-none font-mono text-sm"
        />
      </div>

      <Button variant="outline" size="sm" onClick={onSkip} type="button">
        Skip — use the pipeline&apos;s default style
      </Button>
    </div>
  )
}
