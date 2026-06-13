'use client'

import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface TopicInputProps {
  value: string
  onChange: (text: string) => void
  disabled?: boolean
}

export function TopicInput({ value, onChange, disabled }: TopicInputProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="topic-input" className="text-sm font-medium">
        Topic / prompt
      </Label>
      <Textarea
        id="topic-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Describe what you want to generate…"
        rows={4}
        className="resize-none min-h-20"
        disabled={disabled}
      />
    </div>
  )
}
