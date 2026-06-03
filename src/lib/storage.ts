'use client'

// localStorage helpers for persisting paper state across browser refreshes.
// Think of localStorage like non-volatile memory — it survives power cycles (page reloads).
// The paper state is serialized to JSON and stored under a single key.

import type { PaperConfig, PaperState, ModelConfig } from './types'
import { DEFAULT_MODELS } from './types'

const STORAGE_KEY = 'ars-paper-state'
const DRAFT_CONFIG_KEY = 'ars-draft-config'
const MODEL_KEY = 'ars-selected-model'
// P15: app-wide settings (NOT per-paper). Currently just the opt-in claim-audit flag.
const SETTINGS_KEY = 'ars_global_settings'
// P18 (IR-06): per-paper namespaced keys + a lightweight papers index. The "current"
// paper still lives at STORAGE_KEY (the single working slot every existing page reads),
// and savePaper MIRRORS it to its namespaced slot `ars_<id>_paper` + updates the index,
// so the Previous Papers panel and per-paper delete work without rewriting every page.
const PAPERS_INDEX_KEY = 'ars_papers_index'
function paperKey(id: string): string {
  return `ars_${id}_paper`
}

// Save the entire paper state to localStorage. Also mirrors to the per-paper namespaced
// slot and refreshes the papers index (P18.3/IR-06) so multiple papers can coexist.
export function savePaper(state: PaperState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    mirrorToNamespace(state)
  } catch (e) {
    // localStorage can throw if storage quota is exceeded (~5MB limit)
    console.error('Failed to save paper state:', e)
  }
}

// Mirror a paper into its namespaced slot and update the index. Failures here are
// non-fatal to the primary save (the current-slot write already succeeded), so they are
// logged but swallowed — the index is a convenience surface, not the source of truth.
function mirrorToNamespace(state: PaperState): void {
  try {
    localStorage.setItem(paperKey(state.id), JSON.stringify(state))
    upsertPaperIndex(state)
  } catch (e) {
    console.error('Failed to mirror paper to namespaced slot:', e)
  }
}

// Result of a quota-aware save (NFR-07). `ok` is true when the write succeeded;
// `quotaExceeded` is true when it failed specifically because localStorage is full
// (so the caller can surface a "couldn't save — storage full" toast). Other failures
// set ok=false with quotaExceeded=false.
export interface SaveResult {
  ok: boolean
  quotaExceeded: boolean
}

// True when a thrown DOMException is the browser's "localStorage is full" signal.
// Different engines use different names/codes, so we check the known variants.
function isQuotaExceeded(e: unknown): boolean {
  if (!(e instanceof DOMException)) return false
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014
  )
}

// Like savePaper, but reports WHY it failed so the UI can show the NFR-07 quota toast
// instead of silently dropping the write. Use this on the finalize/export screen where
// a failed "remember what I exported" write should be visible to the user.
export function savePaperChecked(state: PaperState): SaveResult {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    mirrorToNamespace(state)
    return { ok: true, quotaExceeded: false }
  } catch (e) {
    const quotaExceeded = isQuotaExceeded(e)
    console.error('Failed to save paper state (quotaExceeded=' + quotaExceeded + '):', e)
    return { ok: false, quotaExceeded }
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

// ── P15: app-wide settings ────────────────────────────────────────────────────
// Settings that apply to the whole app (this browser), not to one paper. Stored
// under `ars_global_settings`. Today this is only the opt-in Claim-Faithfulness
// Audit toggle (ARS_CLAIM_AUDIT), which defaults OFF (FR-41).
export interface GlobalSettings {
  claimAuditEnabled: boolean
}

// The defaults applied when nothing is saved (or the saved blob is corrupt/partial).
// claimAuditEnabled defaults OFF — the audit is strictly opt-in.
export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  claimAuditEnabled: false,
}

// Load the app-wide settings, merged over the defaults so a partial/older blob (or a
// corrupt one) still yields a complete, valid GlobalSettings object.
export function loadGlobalSettings(): GlobalSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_GLOBAL_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<GlobalSettings>
    return { ...DEFAULT_GLOBAL_SETTINGS, ...parsed }
  } catch (e) {
    console.error('Failed to load global settings:', e)
    return { ...DEFAULT_GLOBAL_SETTINGS }
  }
}

// Persist the app-wide settings.
export function saveGlobalSettings(settings: GlobalSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch (e) {
    console.error('Failed to save global settings:', e)
  }
}

// Generate a unique paper ID based on timestamp.
export function generatePaperId(): string {
  return `paper-${Date.now()}`
}

// ── P18: per-paper namespace — index, list, delete, switch-current ─────────────
// A compact summary stored in the index so the home "Previous Papers" panel can list
// papers without parsing every full blob.
export interface PaperSummary {
  id: string
  topic: string
  paperType: string
  updatedAt: string
}

function readIndex(): PaperSummary[] {
  try {
    const raw = localStorage.getItem(PAPERS_INDEX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as PaperSummary[]) : []
  } catch (e) {
    console.error('Failed to read papers index:', e)
    return []
  }
}

function writeIndex(list: PaperSummary[]): void {
  try {
    localStorage.setItem(PAPERS_INDEX_KEY, JSON.stringify(list))
  } catch (e) {
    console.error('Failed to write papers index:', e)
  }
}

// Insert or update this paper's summary in the index (newest first by updatedAt).
function upsertPaperIndex(state: PaperState): void {
  const summary: PaperSummary = {
    id: state.id,
    topic: state.config?.topic ?? '(untitled)',
    paperType: state.config?.paperType ?? '',
    updatedAt: state.updatedAt,
  }
  const others = readIndex().filter((p) => p.id !== state.id)
  const next = [summary, ...others].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  writeIndex(next)
}

// List all saved papers (for the Previous Papers panel). Falls back to reconstructing a
// single-entry index from the legacy current slot if the index is empty but a paper
// exists (back-compat for papers saved before P18 added the index).
export function listPapers(): PaperSummary[] {
  const index = readIndex()
  if (index.length > 0) return index
  const current = loadPaper()
  if (current) {
    upsertPaperIndex(current)
    return readIndex()
  }
  return []
}

// Delete one paper: its namespaced slot + index entry, and — if it is the current
// working paper — the legacy current slot too (eviction path, NFR-08). Returns true on
// success. EH-11: only the explicitly-targeted paper's artifacts are removed.
export function deletePaper(id: string): boolean {
  try {
    localStorage.removeItem(paperKey(id))
    writeIndex(readIndex().filter((p) => p.id !== id))
    const current = loadPaper()
    if (current && current.id === id) {
      localStorage.removeItem(STORAGE_KEY)
    }
    return true
  } catch (e) {
    console.error('Failed to delete paper:', e)
    return false
  }
}

// Make a previously-saved paper the current working paper (load its namespaced blob into
// the legacy current slot every page reads). Returns the paper, or null if not found.
export function setCurrentPaper(id: string): PaperState | null {
  try {
    const raw = localStorage.getItem(paperKey(id))
    if (!raw) return null
    const state = JSON.parse(raw) as PaperState
    localStorage.setItem(STORAGE_KEY, raw)
    return state
  } catch (e) {
    console.error('Failed to switch current paper:', e)
    return null
  }
}

// Cheap, stable string hash of the Stage-1 research inputs (topic + research question).
// Think of it like a checksum: same inputs -> same string, different inputs -> different string.
// It is ONLY an equality check for the FR-04 Stage-1 skip (OQ-04) — i.e. "did the inputs
// change since the last approved research run?" — NOT a cryptographic hash. (P18 uses
// SHA-256 for real content hashing.) We use FNV-1a (a tiny, well-known non-crypto hash)
// over the two fields joined by a NUL-equivalent separator so the field boundary cannot be forged.
export function researchInputHash(config: PaperConfig): string {
  // Keep the source file text-only: use the escaped NUL sequence instead of a literal NUL byte.
  const input = `${config.topic ?? ''}\u0000${config.researchQuestion ?? ''}`

  // FNV-1a 32-bit: start from a fixed offset, then for each char XOR it in and
  // multiply by the FNV prime. Math.imul keeps the multiply in correct 32-bit overflow.
  let hash = 0x811c9dc5 // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) // FNV prime = 16777619
  }

  // Return as an unsigned base-36 string (compact, alphanumeric).
  return (hash >>> 0).toString(36)
}
