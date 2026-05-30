'use client'

// P8 — Model selector dropdown.
// Think of this like a source-select switch on a bench instrument: it just picks
// which "generator" (Claude, or a local model) the pipeline will drive. The choice
// is written to localStorage so the next pipeline run reads it on mount.

import { useEffect, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DEFAULT_MODELS } from '@/lib/types'
import type { ModelConfig } from '@/lib/types'
import { loadModelConfig, saveModelConfig } from '@/lib/storage'

export function ModelSelector({ className }: { className?: string }) {
  // Track the full current config (not just the label) so a CUSTOM model — one saved
  // on the Settings page that is NOT in DEFAULT_MODELS — stays selected instead of
  // silently snapping back to the default.
  const [current, setCurrent] = useState<ModelConfig>(DEFAULT_MODELS[0])

  // Read the saved choice after mount (localStorage is browser-only).
  useEffect(() => {
    queueMicrotask(() => setCurrent(loadModelConfig()))
  }, [])

  // Dropdown options = the presets, plus the current selection when it is a custom
  // model not already in the preset list (so it remains visible and re-selectable).
  const isPreset = DEFAULT_MODELS.some((m) => m.label === current.label)
  const options = isPreset ? DEFAULT_MODELS : [current, ...DEFAULT_MODELS]

  function handleChange(value: string | null) {
    if (!value) return
    const chosen = options.find((m) => m.label === value)
    if (!chosen) return
    saveModelConfig(chosen)
    setCurrent(chosen)
  }

  return (
    <Select value={current.label} onValueChange={handleChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Select model" />
      </SelectTrigger>
      <SelectContent>
        {options.map((m) => (
          <SelectItem key={m.label} value={m.label}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
