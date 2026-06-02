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

  // ── P9: Stage 1 (Research) results ──
  // All OPTIONAL so a paper saved under P0–P8 still loads cleanly (DR-01 back-compat):
  // an old save simply has none of these fields, and the app treats research as "not done yet".
  rqBrief?: RQBrief                  // the research-question brief (Stage 1, agent 1)
  bibliography?: Bibliography        // the verified source list (Stage 1, agents 2–3)
  synthesis?: SynthesisReport        // themes / gaps / debates (Stage 1, agent 4)
  researchApproved?: boolean         // true once the user clicks "Approve Research"
  researchHash?: string              // fingerprint of the inputs that produced this research (FR-04 skip)
  researchStatus?: 'idle' | 'running' | 'awaiting-approval' | 'approved' | 'error'

  // ── P10: Stage 2.5 (Integrity Gate) results ──
  // Same DR-01 back-compat rule as the P9 block above: ALL optional, so a paper
  // saved under P0–P9 (which never ran the integrity gate) still loads cleanly —
  // an old save just has none of these and the app treats integrity as "not run yet".
  integrityReports?: IntegrityReport[]   // every integrity run (Stage 2.5 now, 4.5 in P15); newest pushed last
  integrityPassDate?: string | null      // ISO time the user PASSED the gate (null/absent = never passed)
  complianceHistory?: ComplianceEntry[]  // append-only audit trail (Stage 6 record); never rewritten
  integrityStatus?: 'idle' | 'running' | 'awaiting-review' | 'passed' | 'failed' | 'error'

  // ── P11: Stage 3 (Review) results ──
  // Same DR-01 back-compat rule as the P9/P10 blocks above: ALL optional, so a
  // paper saved under P0–P10 (which never ran peer review) still loads cleanly —
  // an old save just has none of these and the app treats review as "not run yet".
  // Stage 3 only runs on a 2.5-PASS draft, so these are populated AFTER the
  // integrity gate above.
  scoringPlan?: ScoringPlan                 // Schema 13 — the paper-blind pre-commitment (Phase 1)
  reviewReport?: ReviewerScoreSet           // Schema 6 — the 5-reviewer Review Report (Phase 2)
  revisionRoadmap?: RoadmapItem[]           // Schema 7 items extracted from the review (full parser is P13)
  reviewDecision?: EditorialDecision        // the user's chosen editorial outcome (binding once picked)
  // Where the review UI is in its two-phase lifecycle. Mirrors integrityStatus above.
  reviewStatus?: 'idle' | 'running-phase1' | 'running-phase2' | 'awaiting-decision' | 'accepted' | 'revision' | 'rejected' | 'error'
  revisionLoopCount?: number                // incremented on a Reject (P11.9); formally finalized in P13/P18
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

// ── P9: Stage 1 (Research) handoff schema types ──
// These describe the JSON that the deep-research agents hand off to each other,
// like a fixed connector pinout between stages: each agent fills its block, the
// next stage reads it. If a required field is missing, the pipeline aborts (the
// schema parsers enforce this). Every field is camelCase.

// How the research is conducted overall. Drives later methodology choices.
export type MethodologyType = 'qualitative' | 'quantitative' | 'mixed'

// FINER = a 5-axis score for judging a research question. Each axis is rated 1–10.
// (Feasible, Interesting, Novel, Ethical, Relevant.)
export interface FinerScores { feasible: number; interesting: number; novel: number; ethical: number; relevant: number }   // each 1-10

// The boundaries of the research: what's in, what's out, and the context it lives in.
export interface RQScope { inScope: string[]; outOfScope: string[]; domain: string; timeframe: string; geography: string; population: string }

// The Research-Question Brief — output of the rq_formulator agent (Stage 1, step 1).
export interface RQBrief {
  researchQuestion: string
  subQuestions: string[]            // 2-5
  finerScores: FinerScores
  scope: RQScope
  methodologyType: MethodologyType
  theoreticalFramework: string
  keywords: string[]                // 5-10
  methodologyRecommendations?: string[]
}

// What kind of publication a source is.
export type SourceType = 'journal_article' | 'book' | 'chapter' | 'conference' | 'report' | 'thesis' | 'preprint' | 'web'

// Source quality bucket: tier_1 = top journal … tier_4 = grey literature.
export type QualityTier = 'tier_1' | 'tier_2' | 'tier_3' | 'tier_4'

// How central a source is to the paper.
export type Relevance = 'core' | 'supporting' | 'peripheral'

// One entry in the bibliography — a single literature source with its quality ratings.
export interface BibSource {
  id: string
  title: string
  authors: string
  year: number
  doi: string                       // '' if none
  citation: string
  type: SourceType
  evidenceTier: number              // 1-7
  qualityTier: QualityTier
  relevance: Relevance
  relevanceScore: number            // 1-10
  annotation: string
  verified: boolean                 // DOI/existence confirmed by source_verification
  excluded?: boolean                // user toggle (UI-local), default false/omitted
}

// How the literature search was run — the "lab notebook" of the search step.
export interface SearchStrategy { databases: string[]; keywords: string[]; inclusionCriteria: string[]; exclusionCriteria: string[]; dateRange: string }

// The Bibliography — output of literature_searcher + source_verification (Stage 1, steps 2–3).
export interface Bibliography { sources: BibSource[]; searchStrategy: SearchStrategy; coverageAssessment: string; minimumSources: number }

// How well-supported a synthesis theme is across the sources.
export type ThemeStrength = 'strong' | 'moderate' | 'emerging'

// One recurring idea found across multiple sources, with the sources that back it or contradict it.
export interface SynthesisTheme { name: string; description: string; supportingSources: string[]; contradictingSources: string[]; strength: ThemeStrength }

// A point of disagreement in the literature: two opposing positions and the evidence for each.
export interface SynthesisDebate { positionA: string; positionB: string; sourcesA: string[]; sourcesB: string[]; evidenceBalance: string }

// The Synthesis Report — output of the synthesis_agent (Stage 1, step 4).
export interface SynthesisReport { themes: SynthesisTheme[]; researchGaps: string[]; keyDebates: SynthesisDebate[]; consensusAreas: string[]; methodologyRecommendations?: string[]; theoreticalImplications?: string[] }

// ── P9: Research orchestration (UI progress + bundled result) ──

// Progress tick reported as each research agent runs, e.g. "Agent 3 of 5 — Synthesis".
export interface ResearchProgress { agentName: string; completed: number; total: number }

// The three Stage-1 artifacts bundled together — the full output of runResearch().
export interface ResearchResult { rqBrief: RQBrief; bibliography: Bibliography; synthesis: SynthesisReport }

// ── P10: Stage 2.5 (Integrity Gate) handoff schema types ──
// The integrity_verification agent inspects the draft for the 7 AI-research
// failure modes (Lu et al. 2026) and hands back a Schema-5 JSON block. Think of
// this like a test-fixture report: 7 channels (M1..M7), each with a pass/fail
// reading and the probe used to measure it. The agent's own verdict is ADVISORY —
// the binding decision is recomputed by deriveGateDecision() in integrity.ts.

// The 7 failure-mode ids, in canonical order. M1..M7 — see concept-ars-failure-modes.
export type FailureModeId = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'M7'

// The reading for one failure mode:
//   CLEAR                 — checked and no sign of the failure
//   SUSPECTED             — evidence the failure is present (always blocks)
//   INSUFFICIENT_EVIDENCE — could not be verified (e.g. no run logs supplied).
//     For hard-block modes this blocks; for soft modes it allows a bounded override.
export type ModeVerdict = 'CLEAR' | 'SUSPECTED' | 'INSUFFICIENT_EVIDENCE'

// One mode's full result row, as rendered in the 7-row integrity table.
export interface FailureModeResult {
  modeId: FailureModeId
  modeName: string            // e.g. "Hallucinated citation"
  verdict: ModeVerdict
  detectionQuestion: string   // the question the agent answered to reach the verdict
  evidence: string            // the agent's reasoning (shown in the per-mode <details> body)
}

// The full integrity report for one gate run (Stage 2.5 now; 4.5 reuses this in P15).
export interface IntegrityReport {
  stage: '2.5' | '4.5'
  // The agent's SELF-REPORTED verdict. Advisory only — UI trusts deriveGateDecision().
  verdict: 'PASS' | 'PASS_WITH_CONDITIONS' | 'FAIL'
  modes: FailureModeResult[]              // exactly 7 rows, one per id, ordered M1..M7
  citationIntegrityScore: number          // 0.0 – 1.0 (1.0 = all citations look real)
  fabricationRiskScore: number            // 0.0 – 1.0 (1.0 = high risk of fabricated results)
  overallIssues: { serious: number; medium: number; minor: number }
  overrideReason?: string                 // set ONLY via the bounded 2.5 override flow
  timestamp: string                       // ISO 8601 (caller stamps it if the agent omits it)
}

// One section of a draft, in the flat plain-text form the integrity agent reads.
// (Distinct from the editor's HTML `Section` — this is the handoff projection.)
export interface DraftSection {
  sectionId: string
  heading: string
  targetWords: number
  content: string             // plain text; may contain [MATERIAL GAP ...] tags
  materialGapCount: number    // count of /\[MATERIAL GAP[^\]]*\]/g matches in content
}

// The whole paper draft handed to the integrity agent (Schema 4). schemaId is a
// literal 4 so the parser can assert it and reject a mis-routed block.
export interface PaperDraft {
  schemaId: 4
  versionLabel: string        // e.g. "paper_draft_v1"
  sections: DraftSection[]
  wordCountTotal: number
}

// One append-only audit entry. This is the Stage-6 "what happened, by whom, why"
// log — it is NEVER rewritten, only appended to (immutable history).
export interface ComplianceEntry {
  timestamp: string
  action: 'integrity_pass' | 'override' | 'schema_retry' | 'edit_after_pass' | 'content_frozen'
  agentId: string
  reason?: string             // REQUIRED when action === 'override' (the permanent override rationale)
}

// ── P11: Stage 3 (Review) handoff schema types ──
// Stage 3 is a TWO-PHASE peer review, run ONLY on a draft that PASSED the Stage
// 2.5 integrity gate. Think of it like a double-blind measurement protocol:
//   Phase 1 (PAPER-BLIND): the 5 reviewers pre-commit a scoring plan (Schema 13)
//     WITHOUT seeing any paper content — only config/title + the dimension list.
//     This locks in "what we'll grade on" before anyone reads the draft, so the
//     rubric can't be reverse-engineered to flatter (or punish) the paper.
//   Phase 2 (PAPER-VISIBLE): the reviewers now see the full draft PLUS the Phase-1
//     plan, and emit the 5-reviewer Review Report (Schema 6).
// The agent's own editorialDecision is ADVISORY — the BINDING decision is
// recomputed by deriveReviewDecision() in review.ts (mirrors deriveGateDecision).

// The 5 reviewer roles. EIC = Editor-in-Chief; R1/R2/R3 = referees; DA = Devil's
// Advocate (its critical flag can OVERRIDE a numeric pass — see review.ts).
export type ReviewerRole = 'EIC' | 'R1' | 'R2' | 'R3' | 'DA'

// The four editorial outcomes, in descending order of how clean the paper is.
export type EditorialDecision = 'Accept' | 'Minor Revision' | 'Major Revision' | 'Reject'

// How aligned the 5 reviewers were:
//   CONSENSUS-4 — 4+ reviewers agree on the outcome
//   CONSENSUS-3 — 3 reviewers agree (a weaker majority)
//   SPLIT       — no clear majority
//   DA-CRITICAL — the Devil's Advocate raised a critical flag (overrides a pass)
export type ReviewConsensus = 'CONSENSUS-4' | 'CONSENSUS-3' | 'SPLIT' | 'DA-CRITICAL'

// The 5-axis rubric each reviewer scores. Each axis is 0–100 (unlike the 1–10
// FINER axes in Stage 1 — different stage, different scale).
export interface ReviewerDimensionScores {
  novelty: number
  methodology: number
  clarity: number
  contribution: number
  citation: number
} // each 0-100

// One reviewer's full scorecard — what role, their numbers, and their comments.
export interface ReviewerReport {
  role: ReviewerRole
  reviewerName: string                 // human label; defaults to the role string if the agent omits it
  overallScore: number                 // 0-100
  dimensions: ReviewerDimensionScores
  keyComments: string[]                // free-form notes (default [] — not hard-required)
  requiredChanges: string[]            // change requests (default [] — not hard-required)
  recommendation: EditorialDecision    // this reviewer's own advisory call
}

// One row of the stage-3 vs stage-3' score comparison. Populated ONLY at Stage 3'
// (the post-revision re-review in P14) — defined now so P14 reuses this shape.
export interface ScoreTrajectoryEntry {
  dimension: string
  stage3: number
  stage3Prime: number
  delta: number
}

// The whole Schema-6 Review Report — the bundled output of Phase 2.
export interface ReviewerScoreSet {
  sprintContractId: string             // ties Phase-2 back to the Phase-1 scoring plan
  reviewers: ReviewerReport[]          // exactly 5: EIC, R1, R2, R3, DA
  editorialDecision: EditorialDecision // the agent's ADVISORY decision (review.ts recomputes the binding one)
  consensus: ReviewConsensus
  confidenceScore: number              // 0-100
  daCritical: boolean                  // true if the Devil's Advocate raised a critical flag
  revisionRoadmap?: RoadmapItem[]      // Schema-7 items embedded in the report (leniently parsed in P11; full parser is P13)
  scoreTrajectory?: ScoreTrajectoryEntry[]  // only present at Stage 3' (P14)
}

// A lightweight Schema-7 revision item. The FULL Schema-7 parser arrives in P13;
// we define the type HERE so P13 reuses it and the review report can already
// carry an advisory roadmap. priority is the only hard-required classifier.
export interface RoadmapItem {
  id: string
  description: string
  reviewer?: string                    // which reviewer raised it (role string)
  type?: 'Major' | 'Minor' | 'Editorial'
  priority: 'must_fix' | 'should_fix' | 'consider'
  targetSection?: string               // which paper section it touches
  suggestedAction?: string             // the recommended fix
}

// One dimension of the Phase-1 (paper-blind) scoring plan: what the reviewers
// said they would look for, BEFORE seeing the paper.
export interface ScoringPlanDimension {
  dimensionId: string                  // e.g. 'novelty'
  whatToLookFor: string                // the rubric criterion committed in advance
  whatTriggersBlock?: string           // optional: what would force a low/blocking score
  whatTriggersWarn?: string            // optional: what would warrant a warning
}

// Schema 13 — the paper-blind pre-commitment. `committed` is true once a valid
// plan parses: emitting a valid plan IS the act of committing to it.
export interface ScoringPlan {
  sprintContractId: string             // shared id linking the plan to its Phase-2 report
  committed: boolean
  dimensions: ScoringPlanDimension[]
}

// Convenience bundle: both halves of a completed two-phase review together — the
// full output of the (P11) runReview() orchestration.
export interface ReviewResult {
  scoringPlan: ScoringPlan
  reviewReport: ReviewerScoreSet
}
