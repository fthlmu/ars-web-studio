'use client'

import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface CommentsInputProps {
  value: string
  onChange: (text: string) => void
  disabled?: boolean
  label?: string
  placeholder?: string
  id?: string
}

export function CommentsInput({
  value,
  onChange,
  disabled,
  label = 'Reviewer Comments',
  placeholder = 'Paste reviewer comments here…',
  id = 'comments-input',
}: CommentsInputProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={6}
        className="resize-none min-h-32"
        disabled={disabled}
      />
    </div>
  )
}
