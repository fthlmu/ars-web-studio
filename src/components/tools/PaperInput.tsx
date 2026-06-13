'use client'

import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface PaperInputProps {
  value: string
  onChange: (text: string) => void
  disabled?: boolean
}

export function PaperInput({ value, onChange, disabled }: PaperInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result
      if (typeof text === 'string') onChange(text)
    }
    reader.readAsText(file)
    // Reset so the same file can be re-selected after clearing the textarea
    e.target.value = ''
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="paper-input" className="text-sm font-medium">
          Paper
        </Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload file
        </Button>
        {/* Hidden file input — .docx deferred; paste works meanwhile */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt,.tex"
          className="hidden"
          onChange={handleFile}
        />
      </div>
      <Textarea
        id="paper-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste your paper here, or click Upload to load a .md / .txt / .tex file…"
        rows={12}
        className="resize-none font-mono text-xs leading-relaxed min-h-56"
        disabled={disabled}
      />
      {value && (
        <p className="text-xs text-muted-foreground">
          {value.split('\n').length.toLocaleString()} lines ·{' '}
          {value.length.toLocaleString()} chars
        </p>
      )}
    </div>
  )
}
