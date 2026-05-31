// Quick Tools — runner / dispatcher (QT0).
//
// The transport layer. `runToolMode` is the single entry point the generic
// runner page calls: it validates inputs, composes (system, user) via the
// prompt-builder, and streams the result through the EXISTING P8 callAgent →
// /api/generate → SSE path. No new server route, no new streaming logic — QT
// reuses the pipeline's transport exactly (playbook hard rule #2).
//
// Signal-flow framing:
//   runToolMode = the "transmit" button. It doesn't know what a mode means; it
//   just patches the right prompt into callAgent and relays the stream back.
//   What each mode means lives in registry.ts (data) + prompt-builder.ts (compose).

import { callAgent } from '@/lib/ars-client'
import type { ModelConfig } from '@/lib/types'
import type { ToolMode } from './registry'
import {
  type ToolInputs,
  resolveSystemPrompt,
  buildUserMessage,
  validateInputs,
  isApiMode,
} from './prompt-builder'

/**
 * Run a Quick Tool mode and stream its output.
 *
 * @param mode         - the ToolMode chosen by the user (from the registry)
 * @param inputs       - the collected inputs (QT1 fills these)
 * @param onChunk      - called with each text chunk as it streams in
 * @param modelConfig  - which model to use; pass loadModelConfig() from the page
 * @returns            - the full accumulated output text
 *
 * Throws:
 *   - MissingInputError  if a required input/option is absent (caught → inline hint)
 *   - ToolNotReadyError  if the mode's agent/skill isn't bundled yet (→ "ships in QTx")
 *   - Error              if called on a launcher/export mode (programmer error — the
 *                        runner must branch on delivery/kind BEFORE calling this)
 *   - Error              network / API errors bubble up from callAgent
 */
export async function runToolMode(
  mode: ToolMode,
  inputs: ToolInputs,
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig,
): Promise<string> {
  // Launchers (pipeline) and client-side transforms (export-helper) must never
  // reach the API. The page is responsible for navigating / calling the export
  // helper instead; if we got here for one of those, it's a wiring bug.
  if (!isApiMode(mode)) {
    throw new Error(
      `runToolMode cannot run mode "${mode.id}" (promptSource.kind=${mode.promptSource.kind}). ` +
        `Launchers navigate; export-helper modes call a P6 helper. Branch before calling runToolMode.`,
    )
  }

  // Fail fast with a friendly message before any network work.
  validateInputs(mode, inputs)

  // Compose the (system, user) pair. resolveSystemPrompt throws ToolNotReadyError
  // if the agent/skill this mode points at hasn't been bundled in its QT phase yet.
  const systemPrompt = resolveSystemPrompt(mode)
  const userMessage = buildUserMessage(mode, inputs)

  // Reuse the P8 streaming primitive verbatim. Same path the pipeline uses.
  return callAgent(systemPrompt, userMessage, onChunk, modelConfig)
}
