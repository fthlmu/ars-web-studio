'use client'

// localStorage helpers for persisting paper state across browser refreshes.
// Think of localStorage like non-volatile memory — it survives power cycles (page reloads).
// The paper state is serialized to JSON and stored under a single key.

import type { PaperState } from './types'

const STORAGE_KEY = 'ars-paper-state'

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

// Generate a unique paper ID based on timestamp.
export function generatePaperId(): string {
  return `paper-${Date.now()}`
}
