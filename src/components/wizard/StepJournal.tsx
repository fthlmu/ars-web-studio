'use client'

// Step 3: Target Journal (optional)
// Knowing the target journal helps the ARS pipeline match style and scope.

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

interface Props {
  value: string
  onChange: (value: string) => void
  onSkip: () => void
}

export function StepJournal({ value, onChange, onSkip }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Target journal or venue? <span className="text-muted-foreground font-normal text-base">(optional)</span></h2>
        <p className="text-sm text-muted-foreground mb-4">
          If you have a specific journal or conference in mind, enter it here.
          The pipeline will adapt the writing style and scope to match.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="journal">Journal / Conference Name</Label>
        <Input
          id="journal"
          placeholder="e.g. IEEE Transactions on Antennas and Propagation"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Examples: Nature, Science, IEEE Access, ICASSP 2026, EMNLP
        </p>
      </div>

      <Button variant="outline" size="sm" onClick={onSkip} type="button">
        Skip — I don&apos;t have a specific venue in mind
      </Button>
    </div>
  )
}
