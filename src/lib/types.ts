// Core TypeScript types shared across the entire app.
// Think of this like a signal protocol definition — every module agrees on these shapes.

// The 13-parameter record produced by the intake wizard.
// This is the input to the ARS pipeline.
export interface PaperConfig {
  topic: string
  researchQuestion: string
  paperType: 'imrad' | 'lit_review' | 'theoretical' | 'case_study' | 'policy_brief' | 'conference'
  targetJournal?: string
  citationFormat: 'APA7' | 'Chicago' | 'MLA' | 'IEEE' | 'Vancouver'
  outputFormats: string[]           // ['markdown', 'latex', 'pdf']
  language: string                  // e.g. 'English'
  bilingualAbstract: boolean
  wordCount: number
  existingMaterials: Record<string, boolean>  // e.g. { bibliography: true, draft: false }
  authors: Author[]
  styleProfile?: string             // optional writing sample notes
  fundingSources: string[]
  mode: 'full' | 'outline-only' | 'revision' | 'abstract-only' | 'lit-review' | 'format-convert' | 'citation-check'
}

// One author entry. CRediT roles = standard academic contribution taxonomy.
export interface Author {
  name: string
  affiliation: string
  email?: string
  creditRoles: string[]             // e.g. ['Conceptualization', 'Writing – original draft']
  isCorresponding: boolean
}

// One section of the paper (e.g. Introduction, Methodology).
// content is HTML string from Tiptap editor.
export interface Section {
  id: string
  heading: string
  level: number                     // 1 = top-level section, 2 = subsection
  content: string                   // Tiptap HTML output
  wordCount: number
  status: 'pending' | 'generating' | 'done' | 'edited'
}

// The full paper state saved to localStorage.
// This is the single source of truth for the entire app session.
export interface PaperState {
  id: string                        // unique paper ID (timestamp-based)
  config: PaperConfig
  outline: string                   // raw outline text from structure_architect agent
  outlineApproved: boolean
  sections: Section[]
  generationStatus: 'idle' | 'running' | 'done' | 'error'
  createdAt: string                 // ISO date string
  updatedAt: string                 // ISO date string
}

// ── P8: Multi-model adapter ──
// Lets the app talk to different "engines" (LLMs), not just Claude.
// Think of it like a radio that can tune to multiple bands: the same signal
// path (our prompts) feeds whichever transmitter (provider) you select.
export interface ModelConfig {
  provider: 'anthropic' | 'openai-compatible'
  model: string
  baseURL?: string   // openai-compatible only. Ollama: http://localhost:11434/v1 ; LM Studio: http://localhost:1234/v1
  apiKey?: string    // openai-compatible only. Use 'local' for Ollama/LM Studio. Do NOT put real cloud keys in presets.
  label: string      // display name shown in the model dropdown
}

// The presets shown in the model dropdown. Order matters — index 0 is the default.
// (Cloud secrets like a real OpenAI/Anthropic key are NEVER stored here; the server
// supplies those from environment variables. Local models use the literal key 'local'.)
export const DEFAULT_MODELS: ModelConfig[] = [
  { provider: 'anthropic', model: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (Anthropic)' },
  { provider: 'anthropic', model: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (Anthropic, fast)' },
  { provider: 'openai-compatible', model: 'llama3.1:8b', baseURL: 'http://localhost:11434/v1', apiKey: 'local', label: 'Llama 3.1 8B (Ollama, local)' },
  { provider: 'openai-compatible', model: 'qwen2.5:14b', baseURL: 'http://localhost:11434/v1', apiKey: 'local', label: 'Qwen 2.5 14B (Ollama, local)' },
  { provider: 'openai-compatible', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', label: 'GPT-4o (OpenAI)' },
]
