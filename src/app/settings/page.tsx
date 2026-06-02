'use client'

// P8 — Settings page (advanced model configuration).
// Pick a preset model, or define a custom OpenAI-compatible endpoint (a local
// Ollama/LM Studio model not in the preset list). Saved to THIS browser only.
//
// Security: this form NEVER stores an API key in the browser. Local models
// (Ollama / LM Studio) don't need one. For a cloud OpenAI-style endpoint, set the
// key as a SERVER env var (OPENAI_API_KEY) — the /api/generate route uses it
// server-side and it never reaches the browser.

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ModelSelector } from '@/components/ModelSelector'
import { DEFAULT_MODELS } from '@/lib/types'
import type { ModelConfig } from '@/lib/types'
import {
  loadModelConfig,
  saveModelConfig,
  loadGlobalSettings,
  saveGlobalSettings,
} from '@/lib/storage'

export default function SettingsPage() {
  const [current, setCurrent] = useState<ModelConfig>(DEFAULT_MODELS[0])

  // P15 — opt-in Claim-Faithfulness Audit toggle (ARS_CLAIM_AUDIT). Defaults OFF.
  const [claimAuditEnabled, setClaimAuditEnabled] = useState(false)

  // Custom OpenAI-compatible endpoint form fields. There is deliberately NO API key
  // field — see the security note at the top of this file.
  const [label, setLabel] = useState('Custom (local)')
  const [model, setModel] = useState('')
  const [baseURL, setBaseURL] = useState('http://localhost:11434/v1')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    queueMicrotask(() => {
      setCurrent(loadModelConfig())
      setClaimAuditEnabled(loadGlobalSettings().claimAuditEnabled)
    })
  }, [])

  // Persist the claim-audit toggle immediately on change (settings are app-wide).
  function onClaimAuditChange(enabled: boolean) {
    setClaimAuditEnabled(enabled)
    saveGlobalSettings({ ...loadGlobalSettings(), claimAuditEnabled: enabled })
  }

  function saveCustom() {
    const config: ModelConfig = {
      provider: 'openai-compatible',
      model: model.trim(),
      baseURL: baseURL.trim(),
      // Never store a real key in the browser. Cloud keys live in OPENAI_API_KEY on the server.
      apiKey: 'local',
      label: label.trim() || 'Custom (local)',
    }
    if (!config.model) return
    saveModelConfig(config)
    setCurrent(config)
    setSaved(true)
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose which model generates your paper. Saved to this browser only.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Preset models</CardTitle>
          <CardDescription>
            Currently selected: <strong>{current.label}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ModelSelector className="w-full" onChange={setCurrent} />
        </CardContent>
      </Card>

      {/* P15 — opt-in Claim-Faithfulness Audit (ARS_CLAIM_AUDIT). Default OFF. */}
      <Card>
        <CardHeader>
          <CardTitle>Claim-Faithfulness Audit</CardTitle>
          <CardDescription>
            After the final integrity gate passes, optionally run an extra audit that
            checks whether each claim in the paper is faithfully supported by the evidence
            it cites. A high-severity finding disables PDF / LaTeX export (Markdown stays).
            Adds one model call on the finalize screen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-start gap-3 text-sm">
            <Switch
              id="claim-audit-toggle"
              data-testid="claim-audit-toggle"
              checked={claimAuditEnabled}
              onCheckedChange={onClaimAuditChange}
            />
            <span>
              Enable Claim-Faithfulness Audit{' '}
              <span className="text-muted-foreground">
                ({claimAuditEnabled ? 'on' : 'off'} — applies to the next finalize)
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Custom OpenAI-compatible endpoint</CardTitle>
          <CardDescription>
            For a local model (Ollama / LM Studio) or any OpenAI-style API not in the
            preset list. No API key is stored here: local models don&apos;t need one, and for
            a cloud endpoint set <code>OPENAI_API_KEY</code> as a server env var instead.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="m-label">Display name</Label>
            <Input id="m-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-model">Model id</Label>
            <Input id="m-model" placeholder="e.g. qwen2.5:32b" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-base">Base URL</Label>
            <Input id="m-base" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={saveCustom} disabled={!model.trim()}>Save custom model</Button>
            {saved && (
              <span className="text-sm text-green-600">Saved — used on the next run.</span>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
