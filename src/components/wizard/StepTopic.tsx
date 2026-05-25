'use client'

// Step 1: Topic & Research Question
// The user tells us what the paper is about and states their research question.

import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

interface Props {
  topic: string
  researchQuestion: string
  onChange: (field: 'topic' | 'researchQuestion', value: string) => void
}

export function StepTopic({ topic, researchQuestion, onChange }: Props) {
  // Warn if research question has no question mark — soft warning, does not block
  const missingQuestionMark =
    researchQuestion.length > 10 && !researchQuestion.includes('?')

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">What is your paper about?</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Give a clear topic title and a specific research question. The more precise,
          the better the output.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="topic">Paper Topic</Label>
        <Textarea
          id="topic"
          placeholder="e.g. Hybrid analog-digital beamforming for 5G mmWave phased arrays"
          value={topic}
          onChange={(e) => onChange('topic', e.target.value)}
          rows={2}
          className="resize-none"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="rq">Research Question</Label>
        <Textarea
          id="rq"
          placeholder="e.g. How does true-time-delay beamforming reduce beam squinting compared to phase-shift-only methods in wideband phased arrays?"
          value={researchQuestion}
          onChange={(e) => onChange('researchQuestion', e.target.value)}
          rows={3}
          className="resize-none"
        />
        {missingQuestionMark && (
          <p className="text-sm text-yellow-600 dark:text-yellow-400">
            ⚠ Research questions usually end with a question mark. Is this a complete question?
          </p>
        )}
      </div>
    </div>
  )
}
