// Quick Tools — mode registry (QT0).
//
// This file is DATA, not behavior. It encodes the §2 catalog of
// `wiki/(C) plan-quick-tools-modes.md` (all 26 ARS modes) as a typed array.
//
// Mental model (signal-flow framing):
//   A "Quick Tool" is one fixed signal path:
//       (system prompt) ──┐
//       (mode directive) ─┼──▶ callAgent() ──▶ streamed output
//       (user inputs) ────┘
//   A `ToolMode` below is just the *patch settings* for that path: which
//   prompt source feeds the system input, what directive to inject, what
//   inputs the user must supply, and how the result is delivered.
//
// The registry never imports prompts or calls the API. Resolving a mode's
// prompt and running it lives in `prompt-builder.ts` + `run.ts`. Keeping the
// catalog as inert data is what lets every later QT phase (QT2–QT7) add a
// real implementation by editing ONE map in `prompt-builder.ts` without ever
// touching this file. Get the schema right here once; reuse it everywhere.

// ─── The four ARS skill families (the four boxes in the README screenshot) ───

export type ToolFamily =
  | 'deep-research'   // deep-research skill (7 modes)
  | 'academic-paper'  // academic-paper skill (10 modes)
  | 'reviewer'        // academic-paper-reviewer skill (6 modes)
  | 'orchestrator'    // academic-pipeline orchestrator (3 entry points)

export const FAMILY_LABELS: Record<ToolFamily, string> = {
  'deep-research': 'Deep Research',
  'academic-paper': 'Academic Paper',
  reviewer: 'Academic Paper Reviewer',
  orchestrator: 'Academic Pipeline',
}

// ─── What the user must supply before a mode can run ─────────────────────────
// A mode may need several of these at once (e.g. revision = paper + comments),
// so `intake` on a ToolMode is an ARRAY of these. QT1 reads this list to decide
// which input components (PaperInput / CommentsInput / TopicInput …) to render.

export type IntakeType =
  | 'topic'     // free-text topic / prompt        → inputs.topic
  | 'config'    // reuse the P2 intake wizard's PaperConfig → inputs.config
  | 'byo-paper' // paste / upload an existing paper → inputs.paperText
  | 'comments'  // reviewer comments               → inputs.comments
  | 'claims'    // claims to fact-check            → inputs.claims

// ─── References into the bundled-prompt maps (resolved in prompt-builder.ts) ─
// These string literals are the SINGLE shared vocabulary between the registry
// and the prompt maps. A mode names the prompt it wants; the map says whether
// that prompt is bundled yet. Listing every *eventual* agent here (not just the
// ones bundled today) keeps the type exhaustive, so the compiler catches typos
// and a missing bundle surfaces at runtime as a clean "ships in QTx" error.

export type BundledAgentRef =
  // ── bundled in P3 (available in QT0) ──
  | 'structure_architect'
  | 'draft_writer'
  | 'citation_compliance'
  | 'abstract_bilingual'
  // ── bundled by later QT phases (Agent Bundle Ledger) ──
  | 'disclosure'          // QT3
  | 'peer_reviewer'       // QT4  (shared with pipeline P11)
  | 'revision_coach'      // QT5  (shared with pipeline P13)
  | 'source_verification' // QT6  (shared with pipeline P9)
  | 'synthesis_agent'     // QT6  (shared with pipeline P9)

export type SkillRef =
  | 'academic-paper'           // QT3  (academic-paper/SKILL.md)
  | 'academic-paper-reviewer'  // QT4  (academic-paper-reviewer/SKILL.md)
  | 'deep-research'            // QT6  (deep-research/SKILL.md)

// ─── Where a mode's SYSTEM prompt comes from ─────────────────────────────────
// A discriminated union: each strategy carries exactly the reference it needs.
// (This merges the plan's separate `promptSource` + `agentRef` fields into one
//  type-safe shape — see the QT0 design doc for the rationale.)

export type PromptSource =
  // A single dedicated sub-agent prompt is enough → call it directly.
  | { kind: 'bundled-agent'; ref: BundledAgentRef }
  // No single sub-agent → use the family SKILL.md as system prompt and prepend
  // a `MODE: <promptModeKey>` directive. THIS is the abstraction QT reuses most.
  | { kind: 'skill-dir'; skill: SkillRef }
  // Pure client-side transform (format-convert) — no LLM system prompt at all.
  // The runner calls a P6 export helper directly (wired in QT2).
  | { kind: 'export-helper' }
  // Launcher: this mode IS the pipeline. The card deep-links into /pipeline;
  // the runner never calls the API for it.
  | { kind: 'pipeline' }

// ─── How the output is produced / delivered ──────────────────────────────────

export type Delivery =
  | '1-shot'      // one call, stream the result
  | 'chain'       // a short multi-step chain (QT6 research / QT4 reviewer)
  | 'interactive' // multi-turn thread (QT7 chat runner)
  | 'launch'      // navigate into /pipeline; no direct call

// ─── Build readiness (drives UI + the runner's refusal of unbuilt modes) ─────
// NOTE: this is the *declared* status for card rendering. The runtime source of
// truth for "can I actually run this now?" is whether the prompt exists in the
// maps in prompt-builder.ts. The runner gates on that, not on this field.

export type ModeStatus =
  | 'ready'    // agent/helper bundled + wired; runnable once its inputs exist
  | 'launcher' // routes into /pipeline (works today for the existing flow)
  | 'planned'  // card visible; runner shows "ships in <deliversInPhase>"

// A small free-text option a mode needs beyond the big inputs (rendered by QT1).
export interface OptionField {
  key: string          // stored under inputs.options[key]
  label: string        // shown next to the field
  placeholder?: string
  required?: boolean
}

// ─── The mode itself ─────────────────────────────────────────────────────────

export interface ToolMode {
  /** URL-safe id; also the [modeId] route segment. */
  id: string
  family: ToolFamily
  /** Catalog number 1–26 from the plan (handy for cross-referencing the doc). */
  catalogNo: number
  label: string
  /** One-line example shown on the card (README-style). */
  examplePrompt: string
  /** Which inputs QT1 must collect. May be empty for pure launchers. */
  intake: IntakeType[]
  promptSource: PromptSource
  delivery: Delivery
  status: ModeStatus
  /** Which QT phase fully wires this mode (for "ships in …" messaging). */
  deliversInPhase: 'QT2' | 'QT3' | 'QT4' | 'QT5' | 'QT6' | 'QT7'
  /**
   * Lightweight stand-in (research quick-modes) — the UI MUST label these as
   * approximations, not the verified P9 corpus. Avoids the "simulation-only"
   * overclaim the user dislikes.
   */
  approximation?: boolean
  /**
   * For `skill-dir` modes: the literal name placed after `MODE:` in the user
   * message (mirrors how ARS routes its own modes). Ignored for other kinds.
   */
  promptModeKey?: string
  /**
   * Optional one-line instruction appended to the user message for ANY kind.
   * Lets one bundled agent serve two modes (e.g. revision_coach drives both
   * #11 full revised draft and #12 roadmap-only) without a new bundle.
   */
  directive?: string
  /** Small extra fields QT1 renders (venue, target format, gold-set …). */
  optionFields?: OptionField[]
  /**
   * For `pipeline` launchers: where the card navigates. Until P18's state
   * router + ?entry= params exist, mid-entry cards point at the nearest
   * standalone tool's id (see plan §2 warning, recommendation (a)).
   */
  launchHref?: string
  fallbackModeId?: string
}

// ─── THE CATALOG (all 26 modes, plan §2 as data) ─────────────────────────────

export const TOOL_MODES: ToolMode[] = [
  // ── Deep Research (7) ──────────────────────────────────────────────────────
  {
    id: 'research-full', family: 'deep-research', catalogNo: 1,
    label: 'Full Research', examplePrompt: 'Run the complete 13-agent research pipeline on a topic.',
    intake: ['topic'], promptSource: { kind: 'pipeline' }, delivery: 'launch',
    status: 'launcher', deliversInPhase: 'QT7',
    launchHref: '/pipeline', // research stage becomes available when P9 lands
  },
  {
    id: 'research-quick', family: 'deep-research', catalogNo: 2,
    label: 'Quick Brief', examplePrompt: 'A fast research brief on an emerging topic.',
    intake: ['topic'], promptSource: { kind: 'skill-dir', skill: 'deep-research' },
    delivery: '1-shot', status: 'planned', deliversInPhase: 'QT6', approximation: true,
    promptModeKey: 'quick',
  },
  {
    id: 'research-systematic-review', family: 'deep-research', catalogNo: 3,
    label: 'Systematic Review (PRISMA)', examplePrompt: 'A PRISMA-style systematic review outline on a question.',
    intake: ['topic'], promptSource: { kind: 'skill-dir', skill: 'deep-research' },
    delivery: 'chain', status: 'planned', deliversInPhase: 'QT6', approximation: true,
    promptModeKey: 'systematic-review',
  },
  {
    id: 'research-socratic', family: 'deep-research', catalogNo: 4,
    label: 'Socratic (guided)', examplePrompt: 'Refine a research question through guided Q&A.',
    intake: ['topic'], promptSource: { kind: 'skill-dir', skill: 'deep-research' },
    delivery: 'interactive', status: 'planned', deliversInPhase: 'QT7', approximation: true,
    promptModeKey: 'socratic',
  },
  {
    id: 'research-fact-check', family: 'deep-research', catalogNo: 5,
    label: 'Fact-Check', examplePrompt: 'Verify a set of factual claims against sources.',
    intake: ['claims'], promptSource: { kind: 'bundled-agent', ref: 'source_verification' },
    delivery: '1-shot', status: 'planned', deliversInPhase: 'QT6',
  },
  {
    id: 'research-lit-review', family: 'deep-research', catalogNo: 6,
    label: 'Literature Review', examplePrompt: 'A synthesized literature review on a topic.',
    intake: ['topic'], promptSource: { kind: 'skill-dir', skill: 'deep-research' },
    delivery: 'chain', status: 'planned', deliversInPhase: 'QT6', approximation: true,
    promptModeKey: 'lit-review',
  },
  {
    id: 'research-quality-review', family: 'deep-research', catalogNo: 7,
    label: 'Research-Quality Review', examplePrompt: 'Assess the research quality of a pasted paper.',
    intake: ['byo-paper'], promptSource: { kind: 'skill-dir', skill: 'deep-research' },
    delivery: '1-shot', status: 'planned', deliversInPhase: 'QT6', approximation: true,
    promptModeKey: 'research-quality',
  },

  // ── Academic Paper (10) ─────────────────────────────────────────────────────
  {
    id: 'paper-full', family: 'academic-paper', catalogNo: 8,
    label: 'Full Paper', examplePrompt: 'Generate a complete paper from an intake configuration.',
    intake: ['config'], promptSource: { kind: 'pipeline' }, delivery: 'launch',
    status: 'launcher', deliversInPhase: 'QT7', launchHref: '/intake',
  },
  {
    id: 'paper-plan', family: 'academic-paper', catalogNo: 9,
    label: 'Plan (guided)', examplePrompt: 'Plan a paper chapter-by-chapter through dialogue.',
    intake: ['topic'], promptSource: { kind: 'skill-dir', skill: 'academic-paper' },
    delivery: 'interactive', status: 'planned', deliversInPhase: 'QT7',
    promptModeKey: 'plan',
  },
  {
    id: 'paper-outline', family: 'academic-paper', catalogNo: 10,
    label: 'Outline Only', examplePrompt: 'A numbered section outline with word-count allocations.',
    intake: ['topic'], promptSource: { kind: 'bundled-agent', ref: 'structure_architect' },
    delivery: '1-shot', status: 'ready', deliversInPhase: 'QT2',
    // ↑ The QT0 verify-gate mode: structure_architect is bundled in P3, so this
    //   runs end-to-end the moment the generic runner exists.
  },
  {
    id: 'paper-revision', family: 'academic-paper', catalogNo: 11,
    label: 'Revision', examplePrompt: 'Produce a revised draft from a paper + reviewer comments.',
    intake: ['byo-paper', 'comments'], promptSource: { kind: 'bundled-agent', ref: 'revision_coach' },
    delivery: '1-shot', status: 'planned', deliversInPhase: 'QT5',
    directive: 'Produce a full revised draft that addresses every reviewer comment.',
  },
  {
    id: 'paper-revision-coach', family: 'academic-paper', catalogNo: 12,
    label: 'Revision Coach', examplePrompt: 'Turn reviewer comments into a prioritized response roadmap.',
    intake: ['comments'], promptSource: { kind: 'bundled-agent', ref: 'revision_coach' },
    delivery: '1-shot', status: 'planned', deliversInPhase: 'QT5',
    directive: 'Output a revision roadmap and response-letter skeleton ONLY — do not rewrite the paper.',
  },
  {
    id: 'paper-abstract', family: 'academic-paper', catalogNo: 13,
    label: 'Abstract Only', examplePrompt: 'A bilingual abstract + keywords from a pasted paper.',
    intake: ['byo-paper'], promptSource: { kind: 'bundled-agent', ref: 'abstract_bilingual' },
    delivery: '1-shot', status: 'ready', deliversInPhase: 'QT2',
  },
  {
    id: 'paper-lit-review', family: 'academic-paper', catalogNo: 14,
    label: 'Literature Review (paper)', examplePrompt: 'An annotated literature review in paper format.',
    intake: ['topic'], promptSource: { kind: 'skill-dir', skill: 'academic-paper' },
    delivery: 'chain', status: 'planned', deliversInPhase: 'QT3',
    promptModeKey: 'lit-review',
  },
  {
    id: 'paper-format-convert', family: 'academic-paper', catalogNo: 15,
    label: 'Format Convert', examplePrompt: 'Convert a paper between Markdown / LaTeX / Typst-PDF.',
    intake: ['byo-paper'], promptSource: { kind: 'export-helper' },
    delivery: '1-shot', status: 'ready', deliversInPhase: 'QT2',
    optionFields: [
      { key: 'targetFormat', label: 'Target format', placeholder: 'markdown | latex | pdf', required: true },
    ],
  },
  {
    id: 'paper-citation-check', family: 'academic-paper', catalogNo: 16,
    label: 'Citation Check', examplePrompt: 'Audit citations and produce a corrected reference list.',
    intake: ['byo-paper'], promptSource: { kind: 'bundled-agent', ref: 'citation_compliance' },
    delivery: '1-shot', status: 'ready', deliversInPhase: 'QT2',
  },
  {
    id: 'paper-disclosure', family: 'academic-paper', catalogNo: 17,
    label: 'AI Disclosure', examplePrompt: 'A venue-specific AI-usage disclosure statement.',
    intake: ['byo-paper'], promptSource: { kind: 'bundled-agent', ref: 'disclosure' },
    delivery: '1-shot', status: 'planned', deliversInPhase: 'QT3',
    optionFields: [
      { key: 'venue', label: 'Target venue / publisher', placeholder: 'e.g. IEEE Access', required: true },
    ],
  },

  // ── Academic Paper Reviewer (6) — all need a pasted paper ───────────────────
  {
    id: 'review-full', family: 'reviewer', catalogNo: 18,
    label: 'Full Review (EIC + R1/R2/R3 + DA)', examplePrompt: 'A full multi-reviewer peer review with a decision.',
    intake: ['byo-paper'], promptSource: { kind: 'bundled-agent', ref: 'peer_reviewer' },
    delivery: 'chain', status: 'planned', deliversInPhase: 'QT4',
  },
  {
    id: 'review-quick', family: 'reviewer', catalogNo: 19,
    label: 'Quick Assessment', examplePrompt: 'A fast accept/revise/reject read on a paper.',
    intake: ['byo-paper'], promptSource: { kind: 'skill-dir', skill: 'academic-paper-reviewer' },
    delivery: '1-shot', status: 'planned', deliversInPhase: 'QT4',
    promptModeKey: 'quick',
  },
  {
    id: 'review-guided', family: 'reviewer', catalogNo: 20,
    label: 'Guided (improve)', examplePrompt: 'An interactive pass to improve a paper section by section.',
    intake: ['byo-paper'], promptSource: { kind: 'skill-dir', skill: 'academic-paper-reviewer' },
    delivery: 'interactive', status: 'planned', deliversInPhase: 'QT7',
    promptModeKey: 'guided',
  },
  {
    id: 'review-methodology', family: 'reviewer', catalogNo: 21,
    label: 'Methodology Focus', examplePrompt: 'A review concentrating on methodological soundness.',
    intake: ['byo-paper'], promptSource: { kind: 'skill-dir', skill: 'academic-paper-reviewer' },
    delivery: '1-shot', status: 'planned', deliversInPhase: 'QT4',
    promptModeKey: 'methodology-focus',
  },
  {
    id: 'review-re-review', family: 'reviewer', catalogNo: 22,
    label: 'Re-Review (verify revisions)', examplePrompt: 'Check whether a revision addressed prior comments.',
    intake: ['byo-paper', 'comments'], promptSource: { kind: 'skill-dir', skill: 'academic-paper-reviewer' },
    delivery: '1-shot', status: 'planned', deliversInPhase: 'QT4',
    promptModeKey: 're-review',
  },
  {
    id: 'review-calibration', family: 'reviewer', catalogNo: 23,
    label: 'Calibration (gold set)', examplePrompt: 'Compare a review against a gold-standard rubric.',
    intake: ['byo-paper'], promptSource: { kind: 'skill-dir', skill: 'academic-paper-reviewer' },
    delivery: '1-shot', status: 'planned', deliversInPhase: 'QT4',
    promptModeKey: 'calibration',
    optionFields: [
      { key: 'goldSet', label: 'Gold-standard notes / rubric', placeholder: 'paste the reference assessment' },
    ],
  },

  // ── Academic Pipeline / Orchestrator (3) ────────────────────────────────────
  {
    id: 'pipeline-full-stage1', family: 'orchestrator', catalogNo: 24,
    label: 'Full Pipeline (from Stage 1)', examplePrompt: 'Start the orchestrator at Stage 1 from a configuration.',
    intake: ['config'], promptSource: { kind: 'pipeline' }, delivery: 'launch',
    status: 'launcher', deliversInPhase: 'QT7', launchHref: '/intake',
  },
  {
    id: 'pipeline-mid-entry-2-5', family: 'orchestrator', catalogNo: 25,
    label: 'Mid-Entry @ 2.5 (integrity first)', examplePrompt: 'Enter the pipeline at the integrity stage with a draft.',
    intake: ['byo-paper'], promptSource: { kind: 'pipeline' }, delivery: 'launch',
    status: 'launcher', deliversInPhase: 'QT7',
    // True mid-entry needs P10/P18. Until then, route to the nearest standalone
    // tool (plan §2, recommendation (a)): research-quality review (#7).
    fallbackModeId: 'research-quality-review',
  },
  {
    id: 'pipeline-mid-entry-4', family: 'orchestrator', catalogNo: 26,
    label: 'Mid-Entry @ Stage 4 (got reviews)', examplePrompt: 'Enter the pipeline after receiving reviewer comments.',
    intake: ['byo-paper', 'comments'], promptSource: { kind: 'pipeline' }, delivery: 'launch',
    status: 'launcher', deliversInPhase: 'QT7',
    // Fallback now → revision (#11).
    fallbackModeId: 'paper-revision',
  },
]

// ─── Lookup helpers (used by the shell + the runner) ─────────────────────────

/** O(1)-ish lookup by id. Returns undefined for an unknown [modeId] route. */
export function getMode(id: string): ToolMode | undefined {
  return TOOL_MODES.find((m) => m.id === id)
}

/** Modes grouped by family, in family display order — for the /tools page. */
export function modesByFamily(): { family: ToolFamily; label: string; modes: ToolMode[] }[] {
  const order: ToolFamily[] = ['deep-research', 'academic-paper', 'reviewer', 'orchestrator']
  return order.map((family) => ({
    family,
    label: FAMILY_LABELS[family],
    modes: TOOL_MODES.filter((m) => m.family === family),
  }))
}
