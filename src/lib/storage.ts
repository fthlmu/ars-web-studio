'use client'

// localStorage helpers for persisting paper state across browser refreshes.
// Think of localStorage like non-volatile memory — it survives power cycles (page reloads).
// The paper state is serialized to JSON and stored under a single key.

import type { PaperConfig, PaperState, ModelConfig } from './types'
import { DEFAULT_MODELS } from './types'

const STORAGE_KEY = 'ars-paper-state'
const DRAFT_CONFIG_KEY = 'ars-draft-config'
const MODEL_KEY = 'ars-selected-model'

// Save the entire paper state to localStorage.
export function savePaper(state: PaperState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (e) {
    // localStorage can throw if storage quota is exceeded (~5MB limit)
    console.error('Failed to save paper state:', e)
  }
}

// Load the paper state from localStorage. Returns null if nothing is saved.
export function loadPaper(): PaperState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as PaperState) : null
  } catch (e) {
    console.error('Failed to load paper state:', e)
    return null
  }
}

// Delete the saved paper state (e.g. when starting a new paper).
export function clearPaper(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (e) {
    console.error('Failed to clear paper state:', e)
  }
}

// Save only a config as a draft for pre-filling the intake wizard.
export function saveDraftConfig(config: PaperConfig): void {
  try {
    localStorage.setItem(DRAFT_CONFIG_KEY, JSON.stringify(config))
  } catch (e) {
    console.error('Failed to save draft config:', e)
  }
}

export function loadDraftConfig(): PaperConfig | null {
  try {
    const raw = localStorage.getItem(DRAFT_CONFIG_KEY)
    return raw ? (JSON.parse(raw) as PaperConfig) : null
  } catch (e) {
    console.error('Failed to load draft config:', e)
    return null
  }
}

export function clearDraftConfig(): void {
  try {
    localStorage.removeItem(DRAFT_CONFIG_KEY)
  } catch (e) {
    console.error('Failed to clear draft config:', e)
  }
}

// Save which AI model the user picked (e.g. Claude vs a local Ollama model).
// Think of this like a saved "channel selection" — it sticks across reloads.
export function saveModelConfig(config: ModelConfig): void {
  try {
    localStorage.setItem(MODEL_KEY, JSON.stringify(config))
  } catch (e) {
    console.error('Failed to save model config:', e)
  }
}

// Load the saved model choice. If nothing is saved (or the data is corrupt),
// fall back to the first preset — the default channel: Claude Sonnet 4.5.
export function loadModelConfig(): ModelConfig {
  try {
    const raw = localStorage.getItem(MODEL_KEY)
    return raw ? (JSON.parse(raw) as ModelConfig) : DEFAULT_MODELS[0]
  } catch (e) {
    console.error('Failed to load model config:', e)
    return DEFAULT_MODELS[0]
  }
}

// Generate a unique paper ID based on timestamp.
export function generatePaperId(): string {
  return `paper-${Date.now()}`
}
