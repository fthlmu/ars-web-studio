// Quick Tools — prompt builder (QT0).
//
// THE reusable abstraction. Every QT phase routes through these three pure
// functions, so getting them right once means QT2–QT7 only ever add DATA
// (a registry entry + a map entry), never new prompt-assembly logic.
//
//   resolveSystemPrompt(mode)  → the system prompt string (or "ships in QTx")
//   buildUserMessage(mode, in) → the user message (MODE directive + inputs)
//   validateInputs(mode, in)   → fail fast with a clear message
//
// Why a separate file from run.ts:
//   run.ts is the *transport* (wrap callAgent, stream chunks). This file is the
//   *composition* (turn a ToolMode + inputs into the (system, user) pair). They
//   change for different reasons — the transport is fixed; the composition grows
//   as modes are added — so they live apart. The SKILL+dir builder is the part
//   the user flagged as "reused by every later phase," so it gets its own home.

import {
  STRUCTURE_ARCHITECT_PROMPT,
  DRAFT_WRITER_PROMPT,
  CITATION_COMPLIANCE_PROMPT,
  ABSTRACT_BILINGUAL_PROMPT,
} from '@/lib/ars-agents'
import type { PaperConfig } from '@/lib/types'
import type {
  ToolMode,
  IntakeType,
  BundledAgentRef,
  SkillRef,
} from './registry'

// ─── The inputs a runner collects (QT1 fills these) ──────────────────────────
// One bag for all modes. A mode reads only the keys its `intake[]` declares.

export interface ToolInputs {
  topic?: string                     // intake: 'topic'
  paperText?: string                 // intake: 'byo-paper'
  comments?: string                  // intake: 'comments'
  claims?: string                    // intake: 'claims'
  config?: PaperConfig               // intake: 'config'
  options?: Record<string, string>   // optionFields (venue, targetFormat, …)
}

// ─── Prompt maps: the SINGLE integration point for later QT phases ───────────
//
// To wire a new mode, a future phase adds its bundled prompt here — nothing in
// registry.ts or run.ts changes. A ref that is NOT in the map means "not bundled
// yet" → the runner throws ToolNotReadyError with the phase name. This is why
// the maps are `Partial<Record<…>>`: the type lists every eventual ref, but only
// the currently-bundled ones have values.

const ARS_AGENT_PROMPTS: Partial<Record<BundledAgentRef, string>> = {
  // Bundled in P3 — available in QT0:
  structure_architect: STRUCTURE_ARCHITECT_PROMPT,
  draft_writer: DRAFT_WRITER_PROMPT,
  citation_compliance: CITATION_COMPLIANCE_PROMPT,
  abstract_bilingual: ABSTRACT_BILINGUAL_PROMPT,
  // QT3: disclosure   ·  QT4: peer_reviewer  ·  QT5: revision_coach
  // QT6: source_verification, synthesis_agent
  //   → add each here as `scripts/bundle-agents.mjs` bundles it.
}

const ARS_SKILL_PROMPTS: Partial<Record<SkillRef, string>> = {
  // None bundled in QT0. Filled by later phases:
  //   QT3: 'academic-paper'           (academic-paper/SKILL.md)
  //   QT4: 'academic-paper-reviewer'  (academic-paper-reviewer/SKILL.md)
  //   QT6: 'deep-research'            (deep-research/SKILL.md)
}

// ─── A typed "not built yet" error the runner + UI can recognize ─────────────

export class ToolNotReadyError extends Error {
  constructor(public readonly mode: ToolMode) {
    super(
      `"${mode.label}" is not wired yet — it ships in ${mode.deliversInPhase}.`,
    )
    this.name = 'ToolNotReadyError'
  }
}

// Thrown when the user hits Run without the inputs a mode requires.
export class MissingInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingInputError'
  }
}

// ─── Guard: is this mode something the runner should call the API for? ───────
// Launchers (pipeline) and pure client-side transforms (export-helper) are NOT
// API calls — the runner handles those by navigating / calling a P6 helper.

export function isApiMode(mode: ToolMode): boolean {
  return mode.promptSource.kind === 'bundled-agent' || mode.promptSource.kind === 'skill-dir'
}

// ─── 1. Resolve the SYSTEM prompt ────────────────────────────────────────────

export function resolveSystemPrompt(mode: ToolMode): string {
  const src = mode.promptSource
  switch (src.kind) {
    case 'bundled-agent': {
      const prompt = ARS_AGENT_PROMPTS[src.ref]
      if (!prompt) throw new ToolNotReadyError(mode) // ref typed but not bundled yet
      return prompt
    }
    case 'skill-dir': {
      const prompt = ARS_SKILL_PROMPTS[src.skill]
      if (!prompt) throw new ToolNotReadyError(mode)
      return prompt
    }
    case 'export-helper':
    case 'pipeline':
      // These never reach the API path. Calling this is a programmer error.
      throw new Error(
        `resolveSystemPrompt called on a non-API mode "${mode.id}" (kind=${src.kind}).`,
      )
  }
}

// ─── 2. Build the USER message (MODE directive + inputs) ─────────────────────
//
// Declarative + generic: one builder serves all modes. For skill-dir it leads
// with `MODE: <key>` (mirrors ARS's own routing); then an optional per-mode
// directive; then each declared input as a labeled markdown section. No mode
// needs a bespoke builder, which is what keeps QT2–QT7 to pure data edits.

const INPUT_HEADINGS: Record<IntakeType, string> = {
  topic: 'Topic',
  config: 'Paper Configuration',
  'byo-paper': 'Paper',
  comments: 'Reviewer Comments',
  claims: 'Claims to Verify',
}

export function buildUserMessage(mode: ToolMode, inputs: ToolInputs): string {
  const parts: string[] = []

  // (a) SKILL+dir routing line — the abstraction's signature move.
  if (mode.promptSource.kind === 'skill-dir' && mode.promptModeKey) {
    parts.push(`MODE: ${mode.promptModeKey}`)
  }

  // (b) Optional per-mode instruction (also lets one agent serve two modes).
  if (mode.directive) {
    parts.push(mode.directive)
  }

  // (c) Each declared input as a labeled section, in the mode's declared order.
  for (const type of mode.intake) {
    const section = renderInput(type, inputs)
    if (section) parts.push(section)
  }

  // (d) Extra option fields (venue, target format, gold set, …).
  if (mode.optionFields && mode.optionFields.length > 0 && inputs.options) {
    const lines = mode.optionFields
      .map((f) => {
        const v = inputs.options?.[f.key]
        return v ? `- ${f.label}: ${v}` : null
      })
      .filter(Boolean)
    if (lines.length > 0) parts.push(`## Options\n${lines.join('\n')}`)
  }

  return parts.join('\n\n').trim()
}

function renderInput(type: IntakeType, inputs: ToolInputs): string | null {
  const heading = INPUT_HEADINGS[type]
  switch (type) {
    case 'topic':
      return inputs.topic ? `## ${heading}\n${inputs.topic}` : null
    case 'byo-paper':
      return inputs.paperText ? `## ${heading}\n${inputs.paperText}` : null
    case 'comments':
      return inputs.comments ? `## ${heading}\n${inputs.comments}` : null
    case 'claims':
      return inputs.claims ? `## ${heading}\n${inputs.claims}` : null
    case 'config':
      return inputs.config
        ? `## ${heading}\n\`\`\`json\n${JSON.stringify(inputs.config, null, 2)}\n\`\`\``
        : null
  }
}

// ─── 3. Validate inputs (fail fast, friendly message) ────────────────────────

export function validateInputs(mode: ToolMode, inputs: ToolInputs): void {
  for (const type of mode.intake) {
    if (!hasInput(type, inputs)) {
      throw new MissingInputError(`"${mode.label}" needs the "${INPUT_HEADINGS[type]}" input.`)
    }
  }
  for (const field of mode.optionFields ?? []) {
    if (field.required && !inputs.options?.[field.key]?.trim()) {
      throw new MissingInputError(`"${mode.label}" needs "${field.label}".`)
    }
  }
}

function hasInput(type: IntakeType, inputs: ToolInputs): boolean {
  switch (type) {
    case 'topic':
      return !!inputs.topic?.trim()
    case 'byo-paper':
      return !!inputs.paperText?.trim()
    case 'comments':
      return !!inputs.comments?.trim()
    case 'claims':
      return !!inputs.claims?.trim()
    case 'config':
      return !!inputs.config
  }
}
