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

  // ── P12: Stage 3→4 (Coaching Loop) state ──
  // Same DR-01 back-compat rule as the P9/P10/P11 blocks above: ALL optional, so a
  // paper saved under P0–P11 (which never ran coaching) still loads cleanly — an old
  // save just has none of these and the app treats coaching as "not started yet".
  // Entered from the P11 review "Request Revision" decision; exits (Skip / cap-reached /
  // user Proceed) into the Stage-4 revision executor built in P13.
  coachingThread?: CoachingMessage[]        // the full EIC↔author dialogue, persisted verbatim (reload-safe)
  coachingRoundCount?: number               // completed author replies; bounded loop invariant (max 8 — FR-28)
  // Where the coaching UI is in its lifecycle. 'proceed-revision' is the handoff into
  // the P13 Stage-4 revision executor (Skip, cap-reached, or a user Proceed all land here).
  coachingStatus?: 'idle' | 'round-0' | 'in-progress' | 'cap-reached' | 'proceed-revision' | 'error'

  // ── P13: Stage 4 (Revision) results ──
  // Same DR-01 back-compat rule as every block above: ALL optional, so a paper
  // saved under P0–P12 (which never ran the revision executor) still loads cleanly.
  // Entered from the P12 coaching 'proceed-revision' handoff. The revision_coach_agent
  // rewrites the draft against the reviewers' report + roadmap + coaching context.
  //
  // IRON RULE (P13.7): the ORIGINAL draft (the editor's `sections` above) is NEVER
  // overwritten by this stage — the revised content lands in `revisedDraft` as a
  // SEPARATE field, so a failed/abandoned revision always leaves the source intact
  // and the Delta Report has a stable "before" to diff against.
  revisionPlan?: RevisionRoadmap            // Schema 7 — the structured roadmap (must/should/consider)
  revisedDraft?: PaperDraft                 // Schema 4 — the revised draft (separate from `sections`)
  deltaReport?: DeltaReport                 // per-section before→after data the Delta Report view diffs
  // Where the revision UI is in its lifecycle. Mirrors reviewStatus/coachingStatus above.
  // 're-review' / 'final-gate' are the two FR-05/FR-33 exits (handoffs into P14 / P15).
  revisionStatus?: 'idle' | 'running' | 'awaiting-approval' | 're-review' | 'final-gate' | 'error'
  // revisionLoopCount (declared in the P11 block above) is the iron-rule loop counter:
  // incremented on a revision Approve here; <2 routes to re-review, ==2 to the final gate.

  // ── P14: Stage 3'/4' (Re-Review / Re-Revise) state ──
  // Same DR-01 back-compat rule as every block above: ALL optional, so a paper saved
  // under P0–P13 (which never ran the re-review loop) still loads cleanly.
  //
  // Entered from the P13 revise Approve handoff when revisionLoopCount < 2 (the
  // 're-review' route). A NARROW 3-agent panel re-scores the REVISED draft, produces an
  // R&R Traceability Matrix + a per-dimension Score Trajectory vs Stage 3, and the human
  // either requests one final revision (the single permitted RE-REVISE) or accepts and
  // advances to the Stage-4.5 final gate.
  //
  // IRON RULE #2 (max 2 revision loops / max 1 RE-REVISE): `reReviseUsed` records that the
  // one permitted re-revise has been consumed. Once it is true — OR revisionLoopCount has
  // reached 2 — the "Request Final Revision" control is ABSENT FROM THE DOM and the only
  // forward exit is the final gate. (This field formally lives on PipelineState in P18.2;
  // it is declared here as optional so the re-review route can enforce the cap before P18.)
  reReviewReport?: ReviewerScoreSet         // Schema 6' — the narrow re-review (+ rrMatrix, scoreTrajectory, residualIssues)
  reReviseUsed?: boolean                    // the single permitted RE-REVISE has been consumed (iron rule 2)
  // Where the re-review UI is in its lifecycle. 'final-gate' is the handoff into P15.
  reReviewStatus?: 'idle' | 'running' | 'awaiting-decision' | 'final-gate' | 'error'

  // Residual coaching (Stage 3'→4', max 5 rounds). Kept in SEPARATE fields from the P12
  // coaching block above so the first coaching thread is never clobbered. 'proceed-revision'
  // is the handoff into the Stage-4' RE-REVISE (the revise route in re-revise mode).
  residualCoachingThread?: CoachingMessage[]
  residualCoachingRoundCount?: number       // bounded loop invariant (max 5 — FR-36)
  residualCoachingStatus?: 'idle' | 'round-0' | 'in-progress' | 'cap-reached' | 'proceed-revision' | 'error'

  // ── P15: Stage 4.5 (Final Integrity Gate, ZERO-TOLERANCE) + opt-in Claim Audit ──
  // Same DR-01 back-compat rule as every block above: ALL optional, so a paper saved
  // under P0–P14 (which never ran the final gate) still loads cleanly.
  //
  // The Stage-4.5 integrity RUNS reuse the SAME `integrityReports[]` array above (each
  // entry carries its own `stage`, so a 4.5 report is just one with stage === '4.5');
  // the latest stage-'2.5' entry is what the Stage-2.5 comparison column diffs against.
  // These fields record the 4.5-SPECIFIC outcome distinct from the 2.5 gate:
  finalIntegrityPassDate?: string | null    // ISO time the 4.5 gate PASSED (null/absent = never)
  // Where the 4.5 gate UI is in its lifecycle. Mirrors integrityStatus above. 'failed' is
  // a zero-tolerance block (a SUSPECTED/INSUFFICIENT verdict), NOT an exception ('error').
  finalIntegrityStatus?: 'idle' | 'running' | 'awaiting-review' | 'passed' | 'failed' | 'error'
  // The high-level pipeline phase. P15 only needs the two states around the final gate;
  // P18 widens this into the full 20-state machine (additive — a wider union supersedes).
  pipelineStatus?: PipelineStatus

  // Opt-in L3 Claim-Faithfulness Audit (Stage 4→5, ARS_CLAIM_AUDIT). Runs ONCE on the
  // finalize screen when enabled + export-ready; its HIGH-WARN findings drive the
  // formatter REFUSE guard (PDF/LaTeX removed, Markdown stays). Absent = never run.
  claimAuditFindings?: ClaimAuditFinding[]
  claimAuditStatus?: 'idle' | 'running' | 'done' | 'error'

  // ── P16: Stage 5 (Finalize / Export) ──
  // Same DR-01 back-compat rule as every block above: OPTIONAL, so a paper saved
  // under P0–P15 still loads cleanly. Which export formats the user has downloaded
  // from the finalize screen (e.g. ['markdown','pdf']). Append-only set; used for the
  // "already exported" hint and the Stage-6 process summary. Absent = nothing exported.
  exportedFormats?: string[]

  // ── P17: Stage 6 (Process Summary) results ──
  // Same DR-01 back-compat rule as every block above: ALL optional, so a paper saved
  // under P0–P16 (which never ran the process summary) still loads cleanly.
  //
  // Stage 6 is ADVISORY and runs AFTER the first export — it never re-blocks the
  // pipeline. The LLM-derived parts (the self-reflection narrative + agent
  // disagreements, and the 4-dimension collaboration depth) live in processSummary;
  // the Failure-Mode Audit Log is assembled LOCALLY from integrityReports +
  // complianceHistory at render time (no LLM call) and is therefore NOT stored here.
  processSummary?: ProcessSummary
  processSummaryStatus?: 'idle' | 'running' | 'done' | 'error'

  // ── P18: Navigation + State Orchestration ──────────────────────────────────────
  // Same DR-01 back-compat rule as every block above: ALL optional, so a paper saved
  // under P0–P17 still loads cleanly — an old save just has none of these and the app
  // derives them. These fields make the unified /pipeline router + sidebar + Material
  // Passport possible WITHOUT retrofitting every stage page.
  //
  // The 12-checkpoint sidebar reads `checkpointIndex` (0..12): the count of cleared
  // checkpoints. It is LIVE state — pipeline-router.ts derives it from the per-stage
  // *Status fields and the orchestrator persists it, so the sidebar never re-computes
  // from scratch and a reload restores the exact tracker position.
  checkpointIndex?: number
  // The Material Passport verification status (Schema 9). Written explicitly ONLY by the
  // STALE-on-edit hook (passport.ts) — every other value is derived in schemas/schema9.ts
  // from the integrity dates + complianceHistory, so the persisted field is just the
  // STALE latch that survives a reload (FR-49). Exactly VERIFIED/UNVERIFIED/STALE.
  materialVerification?: VerificationStatus
  // The SHA-256 of the section text, recomputed by the STALE-on-edit hook after each edit
  // (NFR-15 audit fingerprint). Recorded for the compliance trail; STALE detection itself
  // is the edit-after-pass event, not a hash inequality (see passport.ts).
  contentHash?: string
  // Monotonic version label for the Material Passport (Schema 9), e.g. "paper_draft_v1".
  // Bumped as the draft advances through revision loops; absent → defaults to v1.
  versionLabel?: string
}

// ── P18: PipelineState — the orchestration view of a paper (DR-01) ──────────────
// PipelineState IS a PaperState. The plan calls for `PipelineState extends PaperState`;
// because the whole PaperState blob is what storage persists (and every stage page reads
// PaperState), the P18 orchestration fields above live ON PaperState as OPTIONAL members
// so old saves still load. This interface is the typed name the router/sidebar use to make
// that intent explicit — it adds NO required fields, so it can never break a P0–P17 save.
export type PipelineState = PaperState

// ── P17: Stage 6 (Process Summary) types ──────────────────────────────────────
// The AI Self-Reflection Report + the Collaboration Depth chart + the local
// Failure-Mode Audit Log. Most of this is assembled in software (process-summary.ts);
// only the reflection narrative + disagreements and the collaboration scores come
// from the two Stage-6 agents.

// One row of the execution timeline — a pipeline stage that ran, was skipped, or
// failed. Built locally from PaperState (the *Status fields across P9–P16).
export interface PipelineTraceEntry {
  stage: string                                    // e.g. "Stage 1 — Research"
  label: string                                    // human label of what happened
  status: 'completed' | 'skipped' | 'failed' | 'not-run'
  detail?: string                                  // optional extra context (counts, dates)
}

// One key decision the human made during the run (outline edit, 2.5 override, coaching
// rounds, editorial decision). Built locally from PaperState.
export interface ProcessKeyDecision {
  label: string                                    // short title of the decision
  detail: string                                   // what was decided / the value
}

// Which model ran a given stage. Built locally from the active ModelConfig (the app
// does not record a per-stage model, so the configured model is attributed to every
// stage that ran — see process-summary.ts).
export interface ModelStageEntry {
  stage: string
  model: string
}

// The AI Self-Reflection Report. timeline / keyDecisions / modelPerStage are built
// locally; narrative + agentDisagreements come from the process_summary_agent.
export interface AISelfReflection {
  timeline: PipelineTraceEntry[]
  keyDecisions: ProcessKeyDecision[]
  modelPerStage: ModelStageEntry[]
  agentDisagreements: string[]
  narrative?: string                               // the agent's reflective prose (optional)
}

// The Collaboration Depth scores — four dimensions, each an integer 1–5, plus a Zone
// label. Produced by the collaboration_depth_agent. null when the data was too thin to
// score (the chart then renders a text fallback).
export interface CollaborationDepth {
  delegationIntensity: number                      // 1-5
  cognitiveVigilance: number                       // 1-5
  cognitiveReallocation: number                    // 1-5
  zoneClassification: number                       // 1-5 (overall placement)
  zoneLabel: string                                // e.g. "Co-Creation"
  rationale?: string
}

// The bundled, LLM-derived Stage-6 output persisted on PaperState. The Failure-Mode
// Audit Log is NOT here — it is assembled locally at render time.
export interface ProcessSummary {
  selfReflection: AISelfReflection
  collaborationDepth: CollaborationDepth | null    // null = chart shows the text fallback
}

// One row of the locally-assembled Failure-Mode Audit Log (FR-47): the mode, its verdict
// at the 2.5 gate and at the 4.5 gate, and whether a bounded 2.5 override was applied
// (with its permanent reason — FR-19 override surfacing). Built from integrityReports +
// complianceHistory with NO LLM call.
export interface FailureModeAuditEntry {
  modeId: FailureModeId
  modeName: string
  verdict25: ModeVerdict | null                    // verdict at Stage 2.5 (null = no 2.5 run)
  verdict45: ModeVerdict | null                    // verdict at Stage 4.5 (null = no 4.5 run)
  overrideApplied: boolean                         // a bounded 2.5 override let this mode through
  overrideReason?: string                          // the permanent rationale (when overridden)
}

// ── P12: one turn of the EIC Socratic coaching dialogue ──
// role 'eic' is the Editor-in-Chief coach (assistant); 'user' is the author. Persisted
// inside PaperState.coachingThread so a mid-coaching reload restores the thread verbatim
// (EH-07). Mirrors the ChatMessage shape used by the Quick Tools interactive runner, but
// labelled for this stage so the reviewer (P14) thread can reuse the same component.
export interface CoachingMessage {
  role: 'eic' | 'user'
  content: string
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
  // Anthropic only. Controls how much Claude thinks before answering.
  // Low = fast & cheap; xhigh = slow & thorough. Only supported on Sonnet 4.6+ and Opus 4.7+.
  // When set, adaptive thinking is also enabled (Claude shows its reasoning progress).
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

// The presets shown in the model dropdown. Order matters — index 0 is the default.
// (Cloud secrets like a real OpenAI/Anthropic key are NEVER stored here; the server
// supplies those from environment variables. Local models use the literal key 'local'.)
export const DEFAULT_MODELS: ModelConfig[] = [
  { provider: 'anthropic', model: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Anthropic, recommended)', effort: 'high' },
  { provider: 'anthropic', model: 'claude-opus-4-8', label: 'Claude Opus 4.8 (Anthropic, most capable)', effort: 'high' },
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

// ── P18: the full 20-state pipeline status machine (FR-01) ──────────────────────
// The single high-level phase the /pipeline router reads to decide which stage route
// to render (gate-to-route map in pipeline-router.ts). P15 introduced a NARROW 2-state
// version of this union (`running-final-gate` | `export-ready`); P18 WIDENS it to all
// 20 states. Additive — every value P15 wrote is still a member, so old saves and P15
// code keep working (DR-01). State-name convention (read it like a state machine):
//   'running-*' / 'generating-*' — an agent is (or WAS) executing. NOT resumable on a
//       cold reload (NFR-12): resume reverts these to the matching gate so the human
//       re-runs rather than waiting on a dead in-flight stream.
//   'awaiting-*' / 'coaching' — a human gate. Fully resumable: reopening lands on the
//       exact gate with NO agent call on mount (FR-02, FR-03, NFR-11).
//   'idle' (pre-generation, → /intake) · 'export-ready' (4.5 PASSED, export permitted) ·
//   'error' (a stage surfaced an unrecoverable error; last route + banner).
// Names match the UX gate-to-route map exactly. A single `coaching` value covers BOTH
// the Stage-3→4 (max 8) and the Stage-3'→4' residual (max 5) coaching — the coaching
// route self-selects the mode from the residualCoaching* fields.
export type PipelineStatus =
  | 'idle'
  | 'running-research'
  | 'awaiting-research-review'
  | 'generating-outline'
  | 'awaiting-outline-review'
  | 'generating-sections'
  | 'awaiting-section-review'
  | 'running-integrity-gate'
  | 'awaiting-integrity-review'
  | 'running-peer-review'
  | 'awaiting-peer-review'
  | 'coaching'
  | 'running-revision'
  | 'awaiting-revision-review'
  | 'running-re-review'
  | 'awaiting-re-review'
  | 'running-final-gate'
  | 'awaiting-final-review'
  | 'export-ready'
  | 'error'

// ── P18: Material Passport (Schema 9, DR-05) verification status ────────────────
// EXACTLY three values — there is no fourth. An "override logged" indication is NOT a
// status value; it is DERIVED from (an override record in complianceHistory) AND
// (status !== 'VERIFIED') — never stored as an enum (FR-49, DR-05). See schemas/schema9.ts.
//   VERIFIED   — a fresh, override-free integrity PASS covers the current content (<24 h)
//   UNVERIFIED — never passed, a pass aged past 24 h with no edit, or a bounded override
//   STALE      — content changed after a PASS; the integrity gate must be re-run
export type VerificationStatus = 'VERIFIED' | 'UNVERIFIED' | 'STALE'

// One finding from the opt-in Claim-Faithfulness Audit. Severity drives the formatter
// REFUSE guard: a single HIGH-WARN removes the PDF/LaTeX export paths (Markdown stays).
//   OK        — the claim is faithfully supported by the cited evidence
//   LOW-WARN  — a minor overreach / soft mismatch (advisory; export still allowed)
//   HIGH-WARN — the claim materially overstates or misattributes its evidence (REFUSE)
export type ClaimAuditSeverity = 'OK' | 'LOW-WARN' | 'HIGH-WARN'

export interface ClaimAuditFinding {
  id: string
  claim: string                 // the paper's claim being audited
  section?: string              // which section the claim appears in
  severity: ClaimAuditSeverity
  explanation: string           // why the auditor assigned this severity
  suggestedFix?: string         // optional: how to bring the claim back in line with the evidence
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
  delta: number              // stage3Prime - stage3 (negative = the score dropped)
}

// ── P14: Stage 3' (Re-Review) — R&R Traceability Matrix ──
// How well a single original reviewer comment was addressed by the revision. The
// re-review agent assigns one of these per original comment so the author can see,
// at a glance, which reviewer concerns the revision actually closed.
export type RRResolutionStatus = 'Resolved' | 'Partially Resolved' | 'Unresolved'

// One row of the Revise-and-Resubmit Traceability Matrix: an original reviewer
// comment, what the revision did about it, and the re-reviewer's resolution verdict.
export interface RRMatrixRow {
  id: string
  comment: string             // the original Stage-3 reviewer comment / required change
  revision: string            // what the revision did to address it
  status: RRResolutionStatus  // the re-reviewer's verdict on how well it was resolved
  reviewer?: string           // which Stage-3 reviewer raised it (role string)
  targetSection?: string      // which paper section it touches
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
  scoreTrajectory?: ScoreTrajectoryEntry[]  // only present at Stage 3' (P14) — computed in software vs Stage 3
  rrMatrix?: RRMatrixRow[]             // only present at Stage 3' (P14) — the R&R Traceability Matrix
  residualIssues?: string[]            // only present at Stage 3' (P14) — issues the re-review still flags
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

// ── P13: Stage 4 (Revision) handoff schema types ──
// Schema 7 — the full, GROUPED Revision Roadmap the revision_coach_agent produces
// from the reviewers' report. P11 already carried a flat advisory `RoadmapItem[]`;
// here we group the same items by priority so the checklist can render must_fix first
// (red, blocking-by-convention), then should_fix, then consider (both advisory).
// Every item is a RoadmapItem (the type defined above) whose `priority` matches the
// bucket it sits in. The parser (schema7.ts) enforces that grouping.
export interface RevisionRoadmap {
  mustFix: RoadmapItem[]      // priority === 'must_fix'   — the reviewers' blocking changes
  shouldFix: RoadmapItem[]    // priority === 'should_fix' — strongly recommended
  consider: RoadmapItem[]     // priority === 'consider'   — optional improvements
  summary?: string            // the agent's one-line framing of the revision (optional)
}

// One section's before→after record for the Delta Report. We store the plain-text
// OLD and NEW content (not a pre-computed diff) so the DeltaReportView can run the
// word-level diff at render time with the `diff` library — keeping localStorage small.
export interface DeltaSection {
  heading: string             // the section heading (the match key between old and new)
  changed: boolean            // true when oldContent !== newContent (the agent revised it)
  oldContent: string          // the original section text (the "before")
  newContent: string          // the revised section text (the "after")
  changeSummary?: string      // the agent's note on WHAT changed in this section (optional)
}

// The whole Delta Report — one row per section plus a count + summary. Built locally
// by runRevision() from the original draft vs the agent's revised sections; the agent
// supplies per-section change summaries, the diff itself is computed in software.
export interface DeltaReport {
  sections: DeltaSection[]    // one entry per section, in paper order
  changedCount: number        // how many sections actually changed (sections.filter(changed).length)
  summary: string             // a human one-paragraph overview of the revision
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

// ── Agent Chat (P20) ──────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  /** Which pipeline stage this message was sent from */
  stage?: string
}

export interface ChatThread {
  messages: ChatMessage[]
  /** Pending user instructions to include in the next agent call */
  pendingInstructions: string[]
}
