'use client'

// Step 11: Funding & Conflicts of Interest
// Required by most journals in the acknowledgements section.

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface Props {
  hasFunding: boolean
  fundingSources: string[]         // each entry: "Agency | Grant Number"
  conflictsOfInterest: string
  onHasFundingChange: (value: boolean) => void
  onFundingSourcesChange: (value: string[]) => void
  onConflictsChange: (value: string) => void
}

export function StepFunding({
  hasFunding,
  fundingSources,
  conflictsOfInterest,
  onHasFundingChange,
  onFundingSourcesChange,
  onConflictsChange,
}: Props) {
  const addSource = () => {
    onFundingSourcesChange([...fundingSources, ''])
  }

  const updateSource = (index: number, value: string) => {
    const updated = fundingSources.map((s, i) => (i === index ? value : s))
    onFundingSourcesChange(updated)
  }

  const removeSource = (index: number) => {
    onFundingSourcesChange(fundingSources.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Funding & Conflicts of Interest</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Most journals require disclosure of funding sources and conflicts of interest.
          This information goes into the acknowledgements section.
        </p>
      </div>

      {/* Funding toggle */}
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div>
          <Label htmlFor="funding-toggle" className="font-medium">
            This research received external funding
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Grants, fellowships, institutional support, etc.
          </p>
        </div>
        <Switch
          id="funding-toggle"
          checked={hasFunding}
          onCheckedChange={onHasFundingChange}
        />
      </div>

      {/* Funding sources — shown only when toggle is on */}
      {hasFunding && (
        <div className="space-y-3">
          <Label>Funding Sources</Label>
          <p className="text-xs text-muted-foreground">
            Enter each source as &quot;Agency name | Grant number&quot;
          </p>
          {fundingSources.map((source, index) => (
            <div key={index} className="flex gap-2">
              <Input
                placeholder='e.g. National Research Foundation of Korea | NRF-2023R1A...'
                value={source}
                onChange={(e) => updateSource(index, e.target.value)}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeSource(index)}
                className="text-destructive hover:text-destructive shrink-0"
                type="button"
              >
                Remove
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addSource} type="button">
            + Add Funding Source
          </Button>
        </div>
      )}

      {/* Conflicts of interest */}
      <div className="space-y-2">
        <Label htmlFor="conflicts">Conflicts of Interest</Label>
        <Textarea
          id="conflicts"
          placeholder='e.g. "The authors declare no conflicts of interest." or describe any relevant financial or personal relationships.'
          value={conflictsOfInterest}
          onChange={(e) => onConflictsChange(e.target.value)}
          rows={3}
          className="resize-none"
        />
      </div>
    </div>
  )
}
