// ARS Client — orchestrates calls to ARS agents via the /api/generate route.
//
// Think of this like a signal chain:
//   ars-client (orchestrator) → /api/generate (server route) → Claude API → SSE stream back
//
// Each function here corresponds to one ARS pipeline stage:
//   generateOutline()  → structure_architect_agent
//   generateSection()  → draft_writer_agent
//   checkCitations()   → citation_compliance_agent
//   generateAbstract() → abstract_bilingual_agent

import {
  STRUCTURE_ARCHITECT_PROMPT,
  DRAFT_WRITER_PROMPT,
  CITATION_COMPLIANCE_PROMPT,
  ABSTRACT_BILINGUAL_PROMPT,
  // P10 Stage 2.5: the integrity-gate agent prompt (reused at Stage 4.5 in P15).
  INTEGRITY_VERIFICATION_PROMPT,
  // P11 Stage 3: the bundled peer-reviewer prompt (reused, NOT re-bundled).
  PEER_REVIEWER_PROMPT,
  // P13 Stage 4: the bundled revision-coach prompt (the REVISE executor).
  REVISION_COACH_PROMPT,
  // P15 Stage 4→5: the opt-in claim-faithfulness audit prompt.
  CLAIM_AUDIT_PROMPT,
  // P16 Stage 5: the formatter agent prompt (verified_only). The artifact generation is
  // deterministic (P6 builders); this constant documents the formatter's contract.
  FORMATTER_PROMPT,
  // P17 Stage 6: process-summary narrator + collaboration-depth observer (advisory only).
  PROCESS_SUMMARY_PROMPT,
  COLLABORATION_DEPTH_PROMPT,
} from './ars-agents'
// P17 Stage 6: local (no-LLM) assembly of the timeline / key decisions / model-per-stage
// that ground the two Stage-6 agents and render in the self-reflection report.
import { buildPipelineTrace, buildKeyDecisions, buildModelPerStage } from './process-summary'
// P16 Stage 5: the shipped P6 export builders the formatter routes its output through.
import { buildMarkdown } from './export/markdown'
import { buildLatex } from './export/latex'
import { buildDocHtml } from './export/docx'
import { safeFilename } from './export/content'
import type { ExportFormat } from './export/refuse-guard'
// P9: the 5 deep-research agent prompts that make up the Stage-1 research chain.
// (This module is created by the deep-research agent in parallel; same path/names.)
import {
  RQ_FORMULATOR_PROMPT,
  LITERATURE_SEARCHER_PROMPT,
  SOURCE_VERIFICATION_PROMPT,
  SYNTHESIS_AGENT_PROMPT,
  METHODOLOGY_SELECTOR_PROMPT,
} from './ars-agents/deep-research'
// P9: the JSON handoff parsers + the error they throw when a field is missing.
// P10 adds parseSchema5 (the integrity report parser).
// P11 adds parseSchema6 (Review Report) + parseSchema13 (paper-blind Scoring Plan).
import {
  parseSchema1,
  parseSchema2,
  parseSchema3,
  parseSchema5,
  parseSchema6,
  parseSchema7,
  parseSchema13,
  parseClaimAudit,
  extractJsonBlock,
  HandoffIncompleteError,
} from './schemas'
import type {
  PaperConfig,
  Section,
  ModelConfig,
  ResearchProgress,
  ResearchResult,
  RQBrief,
  Bibliography,
  SynthesisReport,
  MethodologyType,
  // P10 Stage 2.5 types: the whole-paper state, the draft handoff, and the report.
  PaperState,
  PaperDraft,
  DraftSection,
  IntegrityReport,
  // P11 Stage 3 (Review): the paper-blind scoring plan (Schema 13) and the
  // 5-reviewer review report (Schema 6) produced by the two-phase Sprint Contract.
  ScoringPlan,
  ReviewerScoreSet,
  ReviewerDimensionScores,
  // P12 Stage 3→4 (Coaching): the advisory revision roadmap items the EIC coaches against,
  // plus one persisted coaching turn (fed into the P13 revision context).
  RoadmapItem,
  CoachingMessage,
  // P14 Stage 3' (Re-Review): one row of the per-dimension Stage-3 vs Stage-3' comparison,
  // computed in software by runReReview from the two review reports.
  ScoreTrajectoryEntry,
  // P13 Stage 4 (Revision): the grouped roadmap (Schema 7), the per-section before→after
  // Delta Report, and its rows — produced by runRevision().
  RevisionRoadmap,
  DeltaReport,
  DeltaSection,
  // P15 Stage 4→5 (Claim Audit): one claim-faithfulness finding (OK/LOW-WARN/HIGH-WARN).
  ClaimAuditFinding,
  // P17 Stage 6 (Process Summary): the bundled self-reflection + collaboration depth.
  ProcessSummary,
  AISelfReflection,
  CollaborationDepth,
} from './types'

// ─── Core streaming primitive ────────────────────────────────────────────────

/**
 * Optional extras for callAgent. Lets the research orchestrator tag a call with
 * "this is agent N of 5" (progressMeta) and listen for the matching 'progress'
 * frame the server echoes back (onProgress). Existing callers pass nothing here,
 * so their behaviour is unchanged.
 */
export interface CallAgentOptions {
  onProgress?: (p: ResearchProgress) => void
  progressMeta?: ResearchProgress
  // P11 IR-03: optional data-access metadata. When set, it is forwarded to the
  // server's IR-03 guard, which can 403 a verified_only agent called before its
  // legal stage. Existing callers omit this, so the fields arrive undefined and the
  // guard is skipped (back-compat). dataAccessLevel labels what the agent may see;
  // agentId + pipelineStatus tell the server whether this is a legal call point.
  access?: { dataAccessLevel: 'raw' | 'verified_only'; agentId: string; pipelineStatus: string }
}

/**
 * Calls /api/generate and streams the response back chunk by chunk.
 *
 * @param agentPrompt  - The ARS agent's system prompt
 * @param userMessage  - The task/context to send to that agent
 * @param onChunk      - Called with each text chunk as it arrives (for live UI updates)
 * @param modelConfig  - Which model to route to (Anthropic or an OpenAI-compatible one). Optional — the server defaults to Claude Sonnet 4.5 if omitted.
 * @param opts         - Optional P9 progress hooks (progressMeta sent up, onProgress called when the server echoes a 'progress' frame).
 * @returns            - The full accumulated response text
 */
export async function callAgent(
  agentPrompt: string,
  userMessage: string,
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig,
  opts?: CallAgentOptions
): Promise<string> {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // progressMeta is forwarded so the server can echo a 'progress' SSE frame (IR-04).
    // P11 IR-03: the access fields (when present) let the server reject a verified_only
    // agent called before its legal stage. Absent => undefined => guard skipped.
    body: JSON.stringify({
      agentPrompt,
      userMessage,
      modelConfig,
      progressMeta: opts?.progressMeta,
      dataAccessLevel: opts?.access?.dataAccessLevel,
      agentId: opts?.access?.agentId,
      pipelineStatus: opts?.access?.pipelineStatus,
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(`API error ${response.status}: ${err.error ?? response.statusText}`)
  }

  if (!response.body) {
    throw new Error('No response body from /api/generate')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // SSE messages are separated by double newlines: "data: {...}\n\n"
    const lines = buffer.split('\n\n')
    buffer = lines.pop() ?? ''   // keep the incomplete last chunk for next iteration

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (payload === '[DONE]') break

      let parsed: { text?: string; error?: string; progress?: ResearchProgress }
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue // skip truly malformed JSON frames
      }
      if (parsed.error) throw new Error(parsed.error)
      // P9: a 'progress' frame means the server is reporting "Agent N of 5" (IR-04).
      if (parsed.progress && opts?.onProgress) {
        opts.onProgress(parsed.progress)
      }
      if (parsed.text) {
        fullText += parsed.text
        onChunk(parsed.text)
      }
    }
  }

  return fullText
}

// ─── Pipeline stage 1: Generate outline ─────────────────────────────────────

/**
 * Calls the structure_architect_agent to generate a paper outline.
 * Output is a numbered section list with word count allocations.
 */
export async function generateOutline(
  config: PaperConfig,
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig
): Promise<string> {
  const userMessage = `
You are generating a structured outline for an academic paper. Here is the Paper Configuration Record:

\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

Generate a complete, numbered section outline for this paper type (${config.paperType}).
For each section, specify:
- Section number and title
- Approximate word count allocation (must sum to ${config.wordCount} words total)
- 2–3 bullet points describing what the section should cover

Follow the paper structure patterns for ${config.paperType} papers.
`.trim()

  return callAgent(STRUCTURE_ARCHITECT_PROMPT, userMessage, onChunk, modelConfig)
}

// ─── Pipeline stage 2: Generate one section ─────────────────────────────────

/**
 * Calls the draft_writer_agent to write a single paper section.
 * Passes the full outline and all previously written sections for coherence.
 */
export async function generateSection(
  config: PaperConfig,
  outline: string,
  completedSections: Section[],
  targetSectionHeading: string,
  targetWordCount: number,
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig
): Promise<string> {
  // Build context from already-completed sections
  const priorContent =
    completedSections.length > 0
      ? completedSections
          .map((s) => `## ${s.heading}\n\n${stripHtml(s.content)}`)
          .join('\n\n---\n\n')
      : '(No sections written yet — this is the first section.)'

  const userMessage = `
You are writing one section of an academic paper. Here is the full context:

## Paper Configuration
\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

## Approved Outline
${outline}

## Previously Completed Sections
${priorContent}

## Your Task
Write the section titled: **"${targetSectionHeading}"**

Requirements:
- Target word count: approximately ${targetWordCount} words (±15% is acceptable)
- Citation format: ${config.citationFormat}
- Language: ${config.language}
- Use TEEL paragraph structure (Topic → Evidence → Explanation → Link)
- Every factual claim must include a citation placeholder: [Author, Year] or [1] for IEEE
- Do NOT write any other section — only "${targetSectionHeading}"
- Output clean markdown (## for section heading, ### for subsections)
`.trim()

  return callAgent(DRAFT_WRITER_PROMPT, userMessage, onChunk, modelConfig)
}

// ─── Pipeline stage 3: Citation check ────────────────────────────────────────

/**
 * Calls the citation_compliance_agent on the full paper text.
 * Returns a citation audit report with corrections.
 */
export async function checkCitations(
  config: PaperConfig,
  fullPaperText: string,
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig
): Promise<string> {
  const userMessage = `
Perform a citation compliance check on the following academic paper draft.

Citation format required: **${config.citationFormat}**

## Full Paper Text
${fullPaperText}

Check for:
1. Orphan in-text citations (cited but not in reference list)
2. Orphan references (in reference list but never cited)
3. Format compliance for the ${config.citationFormat} style
4. DOI completeness
5. Self-citation ratio

Output a Citation Audit Report, then the corrected reference list.
`.trim()

  return callAgent(CITATION_COMPLIANCE_PROMPT, userMessage, onChunk, modelConfig)
}

// ─── Pipeline stage 4: Bilingual abstract ────────────────────────────────────

/**
 * Calls the abstract_bilingual_agent to write the bilingual abstract.
 * Uses all completed sections as context.
 */
export async function generateAbstract(
  config: PaperConfig,
  completedSections: Section[],
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig
): Promise<string> {
  const fullText = completedSections
    .map((s) => `## ${s.heading}\n\n${stripHtml(s.content)}`)
    .join('\n\n---\n\n')

  const secondLanguage = config.language === 'English' ? 'Korean (한국어)' : 'English'

  const userMessage = `
Write a bilingual abstract for the following academic paper.

Paper topic: ${config.topic}
Primary language: ${config.language}
Second language: ${secondLanguage}
Citation format: ${config.citationFormat}

## Full Paper (all sections)
${fullText}

Write:
1. Abstract in ${config.language} (150–300 words, 5-component structure: Background, Purpose, Method, Findings, Implications)
2. Abstract in ${secondLanguage} (same structure, independently written — NOT a translation)
3. Keywords in both languages (5–7 each)
4. Abstract Quality Report table
`.trim()

  return callAgent(ABSTRACT_BILINGUAL_PROMPT, userMessage, onChunk, modelConfig)
}

// ─── Helper: estimate word count per section ─────────────────────────────────

/**
 * Returns the approximate word count for a section based on paper type and heading.
 * Used by the pipeline to tell the draft_writer how long to write.
 */
export function getSectionWordCount(
  totalWords: number,
  paperType: PaperConfig['paperType'],
  sectionHeading: string
): number {
  const heading = sectionHeading.toLowerCase()

  const WEIGHTS: Record<PaperConfig['paperType'], Record<string, number>> = {
    imrad: {
      introduction: 0.12,
      'literature review': 0.22,
      methodology: 0.18,
      results: 0.22,
      discussion: 0.18,
      conclusion: 0.08,
    },
    lit_review: {
      introduction: 0.10,
      'search strategy': 0.10,
      'thematic synthesis': 0.60,
      'gaps': 0.12,
      conclusion: 0.08,
    },
    theoretical: {
      introduction: 0.12,
      background: 0.20,
      'theoretical framework': 0.35,
      propositions: 0.18,
      implications: 0.10,
      conclusion: 0.05,
    },
    case_study: {
      introduction: 0.10,
      'case background': 0.20,
      analysis: 0.35,
      findings: 0.20,
      discussion: 0.10,
      conclusion: 0.05,
    },
    policy_brief: {
      'executive summary': 0.10,
      'problem statement': 0.20,
      'evidence review': 0.35,
      'options analysis': 0.20,
      recommendations: 0.15,
    },
    conference: {
      introduction: 0.15,
      'related work': 0.20,
      methodology: 0.25,
      results: 0.25,
      conclusion: 0.15,
    },
  }

  const typeWeights = WEIGHTS[paperType] ?? {}

  // Try to find an exact match first, then a partial match
  const exactMatch = typeWeights[heading]
  if (exactMatch) return Math.round(totalWords * exactMatch)

  const partialKey = Object.keys(typeWeights).find((k) => heading.includes(k) || k.includes(heading))
  if (partialKey) return Math.round(totalWords * typeWeights[partialKey])

  // Default: 15% of total (reasonable fallback for unexpected section names)
  return Math.round(totalWords * 0.15)
}

// ─── Helper: strip HTML tags for plain text ───────────────────────────────────

/**
 * Strips HTML tags from Tiptap editor HTML output.
 * Used when sending section content to the Claude API (it doesn't need HTML).
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')    // replace tags with space
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')     // collapse multiple spaces
    .trim()
}

// ═══════════════════════════════════════════════════════════════════════════
// P9: STAGE 1 — RESEARCH ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════════════
//
// runResearch() drives a fixed 5-agent chain (a focused web subset of the ARS
// 13-agent deep-research pipeline). Think of it as a signal chain where each
// stage's output feeds the next:
//
//   0. Research Question   (rq_formulator)       → RQBrief        [parseSchema1]
//   1. Literature Search   (literature_searcher) → Bibliography   [parseSchema2]
//   2. Source Verification (source_verification) → Bibliography   [parseSchema2]
//   3. Synthesis           (synthesis_agent)     → SynthesisReport[parseSchema3]
//   4. Methodology         (methodology_selector)→ patch (enrichment, non-blocking)
//
// Each agent must end its reply with one machine-readable JSON block; the matching
// parser turns that block into a typed object. A missing field aborts the chain
// (HandoffIncompleteError) — we retry that one step ONCE, then surface a
// ResearchStageError so the page can resume from that exact checkpoint.

// ─── Error: lets the page resume from the failed agent ──────────────────────

/**
 * Thrown when a research step fails even after its single retry. Carries the
 * index of the step that failed and whatever artifacts we accumulated before it,
 * so the page can call runResearch again with resume = { startIndex, prior }.
 */
export class ResearchStageError extends Error {
  constructor(
    message: string,
    public failedIndex: number,
    public partial: Partial<ResearchResult>
  ) {
    super(message)
    this.name = 'ResearchStageError'
  }
}

// ─── Callback surface the page subscribes to ────────────────────────────────

export interface RunResearchCallbacks {
  // Fired before a step starts (completed = i) and after it finishes (completed = i+1).
  onProgress: (p: ResearchProgress) => void
  // Fired with each streamed text chunk, tagged with the agent that produced it.
  onAgentChunk?: (agentName: string, chunk: string) => void
  // Fired after each step with the current partial accumulator (so the page can persist).
  onArtifact?: (partial: Partial<ResearchResult>) => void
}

// ─── Machine-readable output contracts appended to each agent's userMessage ──
//
// We append a strict instruction so the agent ends its reply with exactly one
// fenced json block using the EXACT camelCase keys each parser expects. Software
// parses this block; a missing field aborts the pipeline.

const OUTPUT_CONTRACT_INTRO =
  'MACHINE-READABLE OUTPUT (required): after any analysis, end your reply with ' +
  'exactly one fenced json code block containing a single JSON object with EXACTLY ' +
  'the fields listed below. No comments, no trailing commas. Software parses this ' +
  'block; a missing field aborts the pipeline.'

const CONTRACT_RQ = `${OUTPUT_CONTRACT_INTRO}
Required JSON shape (RQBrief):
{
  "researchQuestion": string,
  "subQuestions": string[],            // 2-5 items
  "finerScores": { "feasible": number, "interesting": number, "novel": number, "ethical": number, "relevant": number },  // each 1-10
  "scope": { "inScope": string[], "outOfScope": string[], "domain": string, "timeframe": string, "geography": string, "population": string },
  "methodologyType": "qualitative" | "quantitative" | "mixed",
  "theoreticalFramework": string,
  "keywords": string[]                 // 5-10 items
}`

const CONTRACT_LITERATURE = `${OUTPUT_CONTRACT_INTRO}
Required JSON shape (Bibliography):
{
  "sources": [
    {
      "id": string, "title": string, "authors": string, "year": number,
      "doi": string, "citation": string,
      "type": "journal_article" | "book" | "chapter" | "conference" | "report" | "thesis" | "preprint" | "web",
      "evidenceTier": number,          // 1-7
      "qualityTier": "tier_1" | "tier_2" | "tier_3" | "tier_4",
      "relevance": "core" | "supporting" | "peripheral",
      "relevanceScore": number,        // 1-10
      "annotation": string,
      "verified": boolean
    }
  ],
  "searchStrategy": { "databases": string[], "keywords": string[], "inclusionCriteria": string[], "exclusionCriteria": string[], "dateRange": string },
  "coverageAssessment": string,
  "minimumSources": number
}`

const CONTRACT_VERIFICATION = `${OUTPUT_CONTRACT_INTRO}
Return the SAME Bibliography JSON shape as the literature search, but set "verified"
true or false per source based on whether its DOI / existence can be confirmed. When a
source cannot be verified, fold a short note into that source's "annotation". Keep every
field present for every source:
{
  "sources": [
    {
      "id": string, "title": string, "authors": string, "year": number,
      "doi": string, "citation": string,
      "type": "journal_article" | "book" | "chapter" | "conference" | "report" | "thesis" | "preprint" | "web",
      "evidenceTier": number, "qualityTier": "tier_1" | "tier_2" | "tier_3" | "tier_4",
      "relevance": "core" | "supporting" | "peripheral",
      "relevanceScore": number, "annotation": string, "verified": boolean
    }
  ],
  "searchStrategy": { "databases": string[], "keywords": string[], "inclusionCriteria": string[], "exclusionCriteria": string[], "dateRange": string },
  "coverageAssessment": string,
  "minimumSources": number
}`

const CONTRACT_SYNTHESIS = `${OUTPUT_CONTRACT_INTRO}
Required JSON shape (SynthesisReport):
{
  "themes": [
    { "name": string, "description": string, "supportingSources": string[], "contradictingSources": string[], "strength": "strong" | "moderate" | "emerging" }
  ],
  "researchGaps": string[],
  "keyDebates": [
    { "positionA": string, "positionB": string, "sourcesA": string[], "sourcesB": string[], "evidenceBalance": string }
  ],
  "consensusAreas": string[],
  "methodologyRecommendations": string[],
  "theoreticalImplications": string[]
}`

const CONTRACT_METHODOLOGY = `${OUTPUT_CONTRACT_INTRO}
Required JSON shape (methodology patch — enrichment only):
{
  "methodologyType": "qualitative" | "quantitative" | "mixed",
  "theoreticalFramework": string,
  "methodologyRecommendations": string[]
}`

// Shape of the small enrichment patch returned by the methodology_selector step.
interface MethodologyPatch {
  methodologyType?: MethodologyType
  theoreticalFramework?: string
  methodologyRecommendations?: string[]
}

// The five step names, in order. total = 5 everywhere.
const RESEARCH_STEP_NAMES = [
  'Research Question',
  'Literature Search',
  'Source Verification',
  'Synthesis',
  'Methodology',
] as const

// Helper: render the config as a JSON context block for an agent message.
function configBlock(config: PaperConfig): string {
  return `## Paper Configuration\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\``
}

// Helper: render a prior artifact as a labelled JSON context block (or a note if absent).
function priorBlock(label: string, value: unknown): string {
  if (value === undefined || value === null) {
    return `## ${label}\n(not available yet)`
  }
  return `## ${label}\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
}

// ─── Per-step message builders ──────────────────────────────────────────────

function buildRqMessage(config: PaperConfig): string {
  return `
You are the research-question formulator. Using the paper configuration below,
formulate a focused research question, sub-questions, a FINER feasibility scoring,
a clear scope, a recommended methodology type, a theoretical framework, and keywords.

${configBlock(config)}

${CONTRACT_RQ}
`.trim()
}

function buildLiteratureMessage(config: PaperConfig, rqBrief: RQBrief): string {
  return `
You are the literature searcher. Using the research-question brief and configuration
below, assemble an annotated bibliography of credible sources with evidence tiers,
quality tiers, relevance, and a search strategy.

${configBlock(config)}

${priorBlock('Research-Question Brief', rqBrief)}

${CONTRACT_LITERATURE}
`.trim()
}

function buildVerificationMessage(config: PaperConfig, bibliography: Bibliography): string {
  return `
You are the source-verification agent. Review every source in the bibliography below
and confirm whether each one exists and is correctly cited (DOI / existence check).
Set "verified" true or false per source and, where a source cannot be verified, fold a
short note into its "annotation". Return the full bibliography with all fields intact.

${configBlock(config)}

${priorBlock('Bibliography (to verify)', bibliography)}

${CONTRACT_VERIFICATION}
`.trim()
}

function buildSynthesisMessage(
  config: PaperConfig,
  rqBrief: RQBrief,
  bibliography: Bibliography
): string {
  return `
You are the synthesis agent. Using the research question and the verified bibliography
below, synthesise the literature into themes, research gaps, key debates, consensus
areas, methodology recommendations, and theoretical implications.

${configBlock(config)}

${priorBlock('Research-Question Brief', rqBrief)}

${priorBlock('Verified Bibliography', bibliography)}

${CONTRACT_SYNTHESIS}
`.trim()
}

function buildMethodologyMessage(
  config: PaperConfig,
  rqBrief: RQBrief,
  synthesis: SynthesisReport
): string {
  return `
You are the methodology selector. Using the research question and the synthesis below,
confirm or refine the methodology type, the theoretical framework, and concrete
methodology recommendations. This is an enrichment pass — keep it concise.

${configBlock(config)}

${priorBlock('Research-Question Brief', rqBrief)}

${priorBlock('Synthesis Report', synthesis)}

${CONTRACT_METHODOLOGY}
`.trim()
}

// ─── Methodology patch parser (lenient — enrichment only) ───────────────────
//
// Reuses the same "last fenced json block, else last {...}" extraction the real
// schema parsers use. We keep it tiny and forgiving: the worst case is we skip
// the enrichment, never abort the whole research stage.
function parseMethodologyPatch(raw: string): MethodologyPatch {
  // Prefer the last ```json fenced block; fall back to the last {...} object.
  const fenced = [...raw.matchAll(/```json\s*([\s\S]*?)```/gi)]
  let jsonText: string | undefined
  if (fenced.length > 0) {
    jsonText = fenced[fenced.length - 1][1].trim()
  } else {
    const lastOpen = raw.lastIndexOf('{')
    const lastClose = raw.lastIndexOf('}')
    if (lastOpen !== -1 && lastClose > lastOpen) {
      jsonText = raw.slice(lastOpen, lastClose + 1)
    }
  }
  if (!jsonText) throw new Error('no JSON object found in methodology patch')

  const obj = JSON.parse(jsonText) as Record<string, unknown>
  const patch: MethodologyPatch = {}

  if (obj.methodologyType === 'qualitative' || obj.methodologyType === 'quantitative' || obj.methodologyType === 'mixed') {
    patch.methodologyType = obj.methodologyType
  }
  if (typeof obj.theoreticalFramework === 'string') {
    patch.theoreticalFramework = obj.theoreticalFramework
  }
  if (Array.isArray(obj.methodologyRecommendations)) {
    patch.methodologyRecommendations = obj.methodologyRecommendations.filter(
      (x): x is string => typeof x === 'string'
    )
  }
  return patch
}

// ─── The orchestrator ───────────────────────────────────────────────────────

/**
 * Runs the 5-agent Stage-1 research chain. Streams progress + artifacts through
 * the callbacks. Resumable: pass resume = { startIndex, prior } to pick up from a
 * step that previously failed instead of starting over.
 *
 * @param config       - The Paper Configuration Record (the research inputs)
 * @param callbacks    - Progress / chunk / artifact hooks the page subscribes to
 * @param modelConfig  - Which model to route every step to (optional)
 * @param resume       - Optional checkpoint: { startIndex, prior } from a ResearchStageError
 * @returns            - The full ResearchResult { rqBrief, bibliography, synthesis }
 */
export async function runResearch(
  config: PaperConfig,
  callbacks: RunResearchCallbacks,
  modelConfig?: ModelConfig,
  resume?: { startIndex: number; prior: Partial<ResearchResult> }
): Promise<ResearchResult> {
  const total = RESEARCH_STEP_NAMES.length // 5

  // Accumulator seeded from any resume checkpoint, so a retry keeps prior work.
  const acc: Partial<ResearchResult> = {
    rqBrief: resume?.prior.rqBrief,
    bibliography: resume?.prior.bibliography,
    synthesis: resume?.prior.synthesis,
  }

  // Remember which sources the user previously excluded (by id), so a re-verify
  // pass on resume does not silently un-exclude them.
  const priorExcludedIds = new Set<string>(
    (resume?.prior.bibliography?.sources ?? [])
      .filter((s) => s.excluded)
      .map((s) => s.id)
  )

  const startIndex = resume?.startIndex ?? 0

  for (let i = startIndex; i < total; i++) {
    const name = RESEARCH_STEP_NAMES[i]

    // "Starting step i" — completed = i out of total.
    callbacks.onProgress({ agentName: name, completed: i, total })

    // ── Step 4 (Methodology) is ENRICHMENT — wrap separately so a parse failure
    // never aborts the whole research stage (it just logs and keeps going). ──
    if (i === 4) {
      try {
        const message = buildMethodologyMessage(
          config,
          acc.rqBrief as RQBrief,
          acc.synthesis as SynthesisReport
        )
        const raw = await callAgent(
          METHODOLOGY_SELECTOR_PROMPT,
          message,
          (chunk) => callbacks.onAgentChunk?.(name, chunk),
          modelConfig,
          { progressMeta: { agentName: name, completed: i, total } }
        )
        const patch = parseMethodologyPatch(raw)

        // Merge the patch into the existing brief + synthesis (all already present).
        if (acc.rqBrief) {
          if (patch.methodologyType) acc.rqBrief.methodologyType = patch.methodologyType
          if (patch.theoreticalFramework) acc.rqBrief.theoreticalFramework = patch.theoreticalFramework
          if (patch.methodologyRecommendations) {
            acc.rqBrief.methodologyRecommendations = patch.methodologyRecommendations
          }
        }
        if (acc.synthesis && patch.methodologyRecommendations) {
          acc.synthesis.methodologyRecommendations = patch.methodologyRecommendations
        }
      } catch (err) {
        // Non-blocking: log and continue. NEVER leave this catch empty (NFR-16).
        console.warn('[runResearch] methodology enrichment (step 4) skipped:', err)
      }

      callbacks.onProgress({ agentName: name, completed: i + 1, total })
      callbacks.onArtifact?.({ ...acc })
      continue
    }

    // ── Steps 0-3: blocking. Run with a single auto-retry on HandoffIncompleteError. ──
    const runStep = async (): Promise<RQBrief | Bibliography | SynthesisReport> => {
      let message: string
      if (i === 0) message = buildRqMessage(config)
      else if (i === 1) message = buildLiteratureMessage(config, acc.rqBrief as RQBrief)
      else if (i === 2) message = buildVerificationMessage(config, acc.bibliography as Bibliography)
      else message = buildSynthesisMessage(config, acc.rqBrief as RQBrief, acc.bibliography as Bibliography)

      const prompt =
        i === 0 ? RQ_FORMULATOR_PROMPT :
        i === 1 ? LITERATURE_SEARCHER_PROMPT :
        i === 2 ? SOURCE_VERIFICATION_PROMPT :
        SYNTHESIS_AGENT_PROMPT

      const raw = await callAgent(
        prompt,
        message,
        (chunk) => callbacks.onAgentChunk?.(name, chunk),
        modelConfig,
        { progressMeta: { agentName: name, completed: i, total } }
      )

      // Parse with the matching schema parser. A missing field throws HandoffIncompleteError.
      if (i === 0) return parseSchema1(raw)
      if (i === 1 || i === 2) return parseSchema2(raw)
      return parseSchema3(raw)
    }

    let parsed: RQBrief | Bibliography | SynthesisReport
    try {
      parsed = await runStep()
    } catch (err) {
      if (err instanceof HandoffIncompleteError) {
        // Retry this SAME step exactly once (rebuild + call + parse again).
        console.warn(`[runResearch] step ${i} (${name}) handoff incomplete, retrying once:`, err.message)
        try {
          parsed = await runStep()
        } catch (retryErr) {
          const msg = retryErr instanceof Error ? retryErr.message : String(retryErr)
          throw new ResearchStageError(msg, i, { ...acc })
        }
      } else {
        // Any other failure (network, server error) also surfaces as a resumable checkpoint.
        const msg = err instanceof Error ? err.message : String(err)
        throw new ResearchStageError(msg, i, { ...acc })
      }
    }

    // ── Accumulate the parsed artifact into the running result. ──
    if (i === 0) {
      acc.rqBrief = parsed as RQBrief
    } else if (i === 1) {
      acc.bibliography = parsed as Bibliography
    } else if (i === 2) {
      // Re-parsed bibliography with verified flags applied. Re-apply any user
      // exclusions (by id) that existed before this resume, so verification does
      // not wipe the user's exclude choices.
      const verified = parsed as Bibliography
      if (priorExcludedIds.size > 0) {
        verified.sources = verified.sources.map((s) =>
          priorExcludedIds.has(s.id) ? { ...s, excluded: true } : s
        )
      }
      acc.bibliography = verified

      // M2 guard (EH-01): if NOT A SINGLE source could be verified, abort with a
      // resumable error whose message the page recognises to show the blocking
      // "Return to Intake" state.
      // Treat anything that is not explicitly `true` as unverified, so a missing/
      // undefined `verified` flag still trips the blocking guard (don't let an
      // un-set flag sneak unverifiable sources past the gate).
      const allUnverified = verified.sources.every((s) => s.verified !== true)
      if (allUnverified) {
        throw new ResearchStageError('No verifiable sources were found.', 2, { ...acc })
      }
    } else if (i === 3) {
      acc.synthesis = parsed as SynthesisReport
    }

    // "Finished step i" — completed = i+1 — and hand the partial up for persistence.
    callbacks.onProgress({ agentName: name, completed: i + 1, total })
    callbacks.onArtifact?.({ ...acc })
  }

  // All five steps done. The three blocking artifacts are guaranteed present.
  return {
    rqBrief: acc.rqBrief as RQBrief,
    bibliography: acc.bibliography as Bibliography,
    synthesis: acc.synthesis as SynthesisReport,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// P10: STAGE 2.5 — INTEGRITY GATE ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════════════
//
// After the draft sections are written (P5) the paper must pass an academic
// INTEGRITY GATE before it can advance to peer review. Think of it like a
// continuity / DRC check on a finished PCB layout: before you send the board
// out, an independent checker scans for 7 known failure classes (M1..M7) and
// reports a verdict per class. We:
//
//   1. project the editor's HTML sections into a flat plain-text PaperDraft
//      (Schema 4) — buildPaperDraft();
//   2. hand that draft to the integrity_verification agent and FORCE it to end
//      with one Schema-5 JSON block (exactly 7 modes M1..M7 + both scores +
//      overallIssues) — runIntegrityGate();
//   3. parse + validate that block with parseSchema5 (retry once on a missing
//      field, then rethrow), and stamp the timestamp if the agent omitted it.
//
// The binding pass/fail decision is NOT made here — it is recomputed by
// deriveGateDecision() in integrity.ts. This module only produces the report.
// The SAME runIntegrityGate is reused at Stage 4.5 in P15 (hence the stage param).

// The regex that marks a "no source covers this claim" gap. ONE definition,
// reused for both the per-section count and the total — keep it in sync with the
// editor decoration (material-gap-mark.ts) and SectionReviewGate.
const MATERIAL_GAP_REGEX = /\[MATERIAL GAP[^\]]*\]/g

// Count the [MATERIAL GAP ...] tags in a plain-text string. Uses a fresh match
// each call (String.match with /g returns all matches or null) so the shared
// regex's lastIndex never leaks between calls.
function countMaterialGaps(text: string): number {
  const matches = text.match(MATERIAL_GAP_REGEX)
  return matches ? matches.length : 0
}

/**
 * Projects the live editor PaperState into the flat Schema-4 PaperDraft the
 * integrity agent reads. Each editor Section (HTML) becomes a DraftSection with:
 *   - content    : plain text via stripHtml (the agent never needs HTML markup)
 *   - targetWords: the planned length for that section (getSectionWordCount)
 *   - materialGapCount: recomputed from the plain text (never trust a stored count)
 *
 * @param state - the whole paper state from localStorage
 * @returns     - a Schema-4 PaperDraft (schemaId 4, versionLabel 'paper_draft_v1')
 */
export function buildPaperDraft(state: PaperState): PaperDraft {
  const sections: DraftSection[] = state.sections.map((s) => {
    const content = stripHtml(s.content)
    return {
      sectionId: s.id,
      heading: s.heading,
      // Planned target length for this heading (same helper the pipeline uses).
      targetWords: getSectionWordCount(state.config.wordCount, state.config.paperType, s.heading),
      content,
      // Recompute from the plain text — do not trust any pre-stored count.
      materialGapCount: countMaterialGaps(content),
    }
  })

  // Total words = sum of each section's plain-text word count. Split on runs of
  // whitespace; filter empties so a trailing space does not inflate the count.
  const wordCountTotal = sections.reduce((sum, s) => {
    const words = s.content.split(/\s+/).filter((w) => w.length > 0)
    return sum + words.length
  }, 0)

  return {
    schemaId: 4,
    versionLabel: 'paper_draft_v1',
    sections,
    wordCountTotal,
  }
}

// ─── Schema-5 output contract appended to the integrity agent's userMessage ──
//
// Mirrors the P9 CONTRACT_* pattern: we append a strict instruction so the agent
// ends its reply with exactly one fenced json block matching IntegrityReport,
// with EXACTLY 7 mode rows M1..M7, both 0..1 scores, and the overallIssues object.
// Software (parseSchema5) parses this block; a missing field aborts the gate.
const CONTRACT_INTEGRITY = `${OUTPUT_CONTRACT_INTRO}
Required JSON shape (IntegrityReport — Schema 5). The "modes" array MUST contain
EXACTLY 7 objects, one for EACH id M1, M2, M3, M4, M5, M6, M7 (no duplicates, none
omitted), in that order:
{
  "stage": "2.5",
  "verdict": "PASS" | "PASS_WITH_CONDITIONS" | "FAIL",   // your advisory self-assessment
  "modes": [
    { "modeId": "M1", "modeName": "Implementation bug passing AI self-review", "verdict": "CLEAR" | "SUSPECTED" | "INSUFFICIENT_EVIDENCE", "detectionQuestion": string, "evidence": string },
    { "modeId": "M2", "modeName": "Hallucinated citation",                      "verdict": "CLEAR" | "SUSPECTED" | "INSUFFICIENT_EVIDENCE", "detectionQuestion": string, "evidence": string },
    { "modeId": "M3", "modeName": "Hallucinated experimental result",          "verdict": "CLEAR" | "SUSPECTED" | "INSUFFICIENT_EVIDENCE", "detectionQuestion": string, "evidence": string },
    { "modeId": "M4", "modeName": "Shortcut reliance",                         "verdict": "CLEAR" | "SUSPECTED" | "INSUFFICIENT_EVIDENCE", "detectionQuestion": string, "evidence": string },
    { "modeId": "M5", "modeName": "Bug reframed as novel insight",             "verdict": "CLEAR" | "SUSPECTED" | "INSUFFICIENT_EVIDENCE", "detectionQuestion": string, "evidence": string },
    { "modeId": "M6", "modeName": "Methodology fabrication",                   "verdict": "CLEAR" | "SUSPECTED" | "INSUFFICIENT_EVIDENCE", "detectionQuestion": string, "evidence": string },
    { "modeId": "M7", "modeName": "Frame-lock",                                "verdict": "CLEAR" | "SUSPECTED" | "INSUFFICIENT_EVIDENCE", "detectionQuestion": string, "evidence": string }
  ],
  "citationIntegrityScore": number,   // 0.0 - 1.0 (1.0 = every citation looks real/verifiable)
  "fabricationRiskScore": number,     // 0.0 - 1.0 (1.0 = high risk of fabricated data/results)
  "overallIssues": { "serious": number, "medium": number, "minor": number }
}`

// Render the draft as plain text the agent can read end-to-end: each section's
// heading followed by its plain-text body (which may contain [MATERIAL GAP] tags).
function draftBlock(draft: PaperDraft): string {
  const body = draft.sections
    .map((s) => `## ${s.heading} (target ~${s.targetWords} words)\n\n${s.content}`)
    .join('\n\n---\n\n')
  return `## Paper Draft (${draft.versionLabel}, ~${draft.wordCountTotal} words)\n${body}`
}

/**
 * Runs the Stage-2.5 integrity gate over a finished draft. Streams the agent's
 * reasoning through onChunk, forces a Schema-5 JSON block, parses + validates it
 * (retry ONCE on a missing field, then rethrow — mirrors runResearch), and stamps
 * the timestamp if the agent omitted it.
 *
 * @param draft       - the Schema-4 PaperDraft (from buildPaperDraft)
 * @param config      - the Paper Configuration Record (citation format, topic, etc.)
 * @param stage       - '2.5' now, '4.5' when reused after revision in P15 (NOT hard-coded)
 * @param onChunk     - called with each streamed text chunk (live UI updates)
 * @param modelConfig - which model to route to (optional; server defaults to Sonnet)
 * @returns           - the parsed, timestamp-stamped IntegrityReport
 */
export async function runIntegrityGate(
  draft: PaperDraft,
  config: PaperConfig,
  stage: '2.5' | '4.5',
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig
): Promise<IntegrityReport> {
  // Build the single user message: config context + the full draft + the strict
  // Schema-5 output contract. The stage is embedded so the agent knows which gate
  // it is running (pre-review 2.5 vs post-revision 4.5).
  const userMessage = `
You are the academic integrity verification gatekeeper running pipeline Stage ${stage}.
Inspect the paper draft below for the 7 known AI-research failure modes (M1..M7) and
report a verdict for EACH mode. Base every verdict on evidence visible in the draft and
configuration; where you cannot verify a mode (e.g. no run logs or raw data are provided),
mark it INSUFFICIENT_EVIDENCE rather than guessing CLEAR.

${configBlock(config)}

${draftBlock(draft)}

${CONTRACT_INTEGRITY}
`.trim()

  // One call = one parse attempt. Factored so the retry path is identical.
  const runOnce = async (): Promise<IntegrityReport> => {
    const raw = await callAgent(INTEGRITY_VERIFICATION_PROMPT, userMessage, onChunk, modelConfig)
    const parsed = parseSchema5(raw)
    // Pin the stage to the gate that PRODUCED this report — never trust the agent's
    // echoed stage. The prompt names both gates (2.5 / 4.5) and is reused verbatim at
    // 4.5, so the agent could echo the wrong literal; if it did, the header would
    // render the wrong "Stage X" and any future per-stage logic would key off the
    // wrong stamp. The requested `stage` param is the single source of truth.
    return parsed.stage === stage ? parsed : { ...parsed, stage }
  }

  let report: IntegrityReport
  try {
    report = await runOnce()
  } catch (err) {
    if (err instanceof HandoffIncompleteError) {
      // Retry the SAME call exactly once (mirrors runResearch's single auto-retry).
      console.warn('[runIntegrityGate] schema5 handoff incomplete, retrying once:', err.message)
      report = await runOnce() // a second failure throws out of this function (rethrow)
    } else {
      // Network / server / non-handoff failure — surface it to the caller (the page
      // turns this into the EH-02 "Integrity check failed to complete. Retry?" state).
      throw err
    }
  }

  // parseSchema5 leaves timestamp '' when the agent omits it — stamp it with the
  // current ISO-8601 time, the same call storage.ts / the research page use.
  if (report.timestamp === '') {
    report = { ...report, timestamp: new Date().toISOString() }
  }

  return report
}

// ═══════════════════════════════════════════════════════════════════════════
// P15: STAGE 4.5 — FINAL INTEGRITY GATE (zero-tolerance) + CLAIM AUDIT
// ═══════════════════════════════════════════════════════════════════════════
//
// The final gate REUSES the exact Stage-2.5 machinery — same agent, same Schema-5
// contract, same parser/retry — only the stage literal changes to '4.5'. The
// DIFFERENT, stricter pass/fail rule lives in final-integrity.ts
// (deriveFinalGateDecision), NOT here: this function only PRODUCES the report. Both
// export paths (P11 Accept, P13/P14 post-revision) call this one function so a single
// report shape and a single zero-tolerance rule apply no matter how the paper arrived.

/**
 * Runs the Stage-4.5 FINAL integrity gate over the (possibly revised) draft. A thin
 * wrapper over runIntegrityGate pinned to stage '4.5' — kept as its own named export
 * so call sites read as "final gate", and so the stage literal is never typo'd inline.
 *
 * @param draft       - the Schema-4 PaperDraft (from buildPaperDraft)
 * @param config      - the Paper Configuration Record
 * @param onChunk     - called with each streamed text chunk (live UI updates)
 * @param modelConfig - which model to route to (optional)
 * @returns           - the parsed, timestamp-stamped IntegrityReport (stage === '4.5')
 */
export async function runFinalGate(
  draft: PaperDraft,
  config: PaperConfig,
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig,
): Promise<IntegrityReport> {
  return runIntegrityGate(draft, config, '4.5', onChunk, modelConfig)
}

// ─── Claim-Faithfulness Audit output contract (appended to the agent's message) ──
const CONTRACT_CLAIM_AUDIT = `${OUTPUT_CONTRACT_INTRO}
Required JSON shape (claim-audit result). "findings" MUST be an array; emit ONE object
per substantive claim you flag (LOW-WARN or HIGH-WARN), plus optionally any notable OK
claims. A faithful paper may legitimately yield an EMPTY findings array — do not invent
findings:
{
  "findings": [
    {
      "id": string,                                  // a short stable id, e.g. "cf-1"
      "claim": string,                               // the exact claim being audited
      "section": string,                             // the section it appears in
      "severity": "OK" | "LOW-WARN" | "HIGH-WARN",
      "explanation": string,                         // why this severity
      "suggestedFix": string                         // how to align the claim with its evidence
    }
  ]
}`

/**
 * Runs the opt-in Claim-Faithfulness Audit over a finished, export-ready paper. Streams
 * the agent, forces the findings JSON block, parses it leniently (an empty findings
 * array is VALID — a clean paper), and retries ONCE on a structurally-broken reply.
 *
 * @param draft       - the Schema-4 PaperDraft being audited
 * @param config      - the Paper Configuration Record (citation format, topic, etc.)
 * @param onChunk     - called with each streamed text chunk (live UI updates)
 * @param modelConfig - which model to route to (optional)
 * @returns           - the flat ClaimAuditFinding[] (may be empty)
 */
export async function runClaimAudit(
  draft: PaperDraft,
  config: PaperConfig,
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig,
): Promise<ClaimAuditFinding[]> {
  const userMessage = `
You are auditing the faithfulness of every substantive claim in the FINAL paper below.
The paper has already passed integrity verification — do NOT re-verify references or data.
For each substantive claim, judge whether the strength of the claim matches the strength
of the evidence the paper presents for it, and assign OK / LOW-WARN / HIGH-WARN.

${configBlock(config)}

${draftBlock(draft)}

${CONTRACT_CLAIM_AUDIT}
`.trim()

  const runOnce = async (): Promise<ClaimAuditFinding[]> => {
    const raw = await callAgent(CLAIM_AUDIT_PROMPT, userMessage, onChunk, modelConfig)
    return parseClaimAudit(raw)
  }

  try {
    return await runOnce()
  } catch (err) {
    if (err instanceof HandoffIncompleteError) {
      // Retry the SAME call once on a broken block (mirrors runIntegrityGate).
      console.warn('[runClaimAudit] claim-audit block unusable, retrying once:', err.message)
      return runOnce() // a second failure throws out of this function (rethrow)
    }
    throw err
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// P16: STAGE 5 — FINALIZE / FORMATTER (FR-43)
// ═══════════════════════════════════════════════════════════════════════════
//
// The formatter (formatter_agent, data_access: verified_only) renders an export-ready,
// integrity-cleared paper into a publication format. In this app that rendering is
// DETERMINISTIC: it reuses the shipped P6 builders rather than a live LLM call, so the
// verified, frozen content can never be silently altered at the formatting step (which
// would violate verified_only). The bundled FORMATTER_PROMPT documents the contract; this
// object exposes the agent metadata so call sites can reason about it explicitly.
export const FORMATTER_AGENT = {
  id: 'formatter_agent',
  dataAccess: 'verified_only' as const,
  // The bundled system prompt (used if a live formatting pass is ever wired in).
  prompt: FORMATTER_PROMPT,
} as const

// The text-based export formats the formatter can build entirely in the browser. PDF is
// handled separately via the /api/export-pdf Typst route (it needs a server subprocess).
export type TextExportFormat = Exclude<ExportFormat, 'pdf'>

// One formatted artifact ready for download: the suggested filename, the file contents,
// and the MIME type to stamp on the Blob.
export interface FormattedArtifact {
  format: TextExportFormat
  filename: string
  content: string
  mimeType: string
}

/**
 * Formats an export-ready paper into a downloadable text artifact (Markdown / LaTeX /
 * DOCX) by routing through the shipped P6 builders. PDF is intentionally NOT handled
 * here — it goes through the /api/export-pdf Typst route. Callers must already have
 * confirmed the format is permitted by the REFUSE guard (computeRefuseGuard); this
 * function does not re-derive that decision.
 *
 * @param paper  - the export-ready PaperState
 * @param format - 'markdown' | 'latex' | 'docx'
 * @returns      - the formatted artifact (filename + content + MIME type)
 */
export function formatPaper(paper: PaperState, format: TextExportFormat): FormattedArtifact {
  switch (format) {
    case 'markdown':
      return {
        format,
        filename: safeFilename(paper.config.topic, 'md'),
        content: buildMarkdown(paper),
        mimeType: 'text/markdown;charset=utf-8',
      }
    case 'latex':
      return {
        format,
        filename: safeFilename(paper.config.topic, 'tex'),
        content: buildLatex(paper),
        mimeType: 'application/x-tex;charset=utf-8',
      }
    case 'docx':
      // HTML-based .doc (see export/docx.ts): Word opens it as an editable document.
      return {
        format,
        filename: safeFilename(paper.config.topic, 'doc'),
        content: buildDocHtml(paper),
        mimeType: 'application/msword;charset=utf-8',
      }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// P11: STAGE 3 — REVIEW ORCHESTRATION (two-phase Sprint Contract)
// ═══════════════════════════════════════════════════════════════════════════
//
// Stage 3 runs peer review as a TWO-PHASE Sprint Contract — like calibrating a
// measurement rig BEFORE connecting the device under test, so the test plan can't
// be bent to flatter the result:
//
//   Phase 1 (PAPER-BLIND):  the editorial board pre-commits a scoring plan
//                           (Schema 13) WITHOUT seeing any draft content — only
//                           the config/title/metadata + the dimension list. This
//                           locks in "what good looks like" before the paper can
//                           influence the rubric.  → runReviewPhase1 → ScoringPlan
//
//   Phase 2 (PAPER-VISIBLE): the same board, now holding the committed plan,
//                            reads the full draft and scores it against the
//                            pre-committed rubric, emitting the 5-reviewer Review
//                            Report (Schema 6).      → runReviewPhase2 → ReviewerScoreSet
//
// The two are INDEPENDENT exported functions on purpose (FR-22 / EH-03): if Phase 2
// fails to parse, the page can retry Phase 2 ALONE against the already-committed
// plan — it must never silently re-run Phase 1 (that would discard the blind
// pre-commitment and defeat the whole point). Each function does one call = one
// parse attempt, retrying ONCE on HandoffIncompleteError then rethrowing — the
// exact runOnce pattern runIntegrityGate uses.
//
// Both phases reuse PEER_REVIEWER_PROMPT (already bundled) and tag every call with
// IR-03 access metadata { verified_only, peer_reviewer_agent, running-peer-review }
// so the server's IR-03 guard confirms review only runs on a verified (2.5-PASS) paper.

// IR-03 access tag shared by BOTH review phases. The peer reviewer is verified_only
// (it must only see a paper that already cleared the integrity gate), and Stage 3
// runs under the running-peer-review pipeline status — a legal point per VERIFIED_ONLY_OK.
const REVIEW_ACCESS = {
  dataAccessLevel: 'verified_only',
  agentId: 'peer_reviewer_agent',
  pipelineStatus: 'running-peer-review',
} as const

// The five rubric dimensions the board pre-commits to and later scores against.
// One definition, used in BOTH the Phase-1 plan contract and (implicitly) Phase 2.
const REVIEW_DIMENSIONS = ['Novelty', 'Methodology', 'Clarity', 'Contribution', 'Citation'] as const

// ─── Phase-1 output contract: the paper-blind Scoring Plan (Schema 13) ──────────
//
// Mirrors the CONTRACT_* pattern. Phase 1 is PAPER-BLIND: this contract is appended
// to a message that contains ONLY the config — never any section/draft content.
const CONTRACT_SCORING_PLAN = `${OUTPUT_CONTRACT_INTRO}
You are the Stage-3 editorial board PRE-COMMITTING a scoring plan BEFORE you have seen
any of the paper's content. Commit, in advance, what you will look for on each of the five
dimensions ${REVIEW_DIMENSIONS.join(', ')} — and what would trigger a blocking vs a warning
score. Do NOT speculate about the paper's content; you have not read it yet.
Required JSON shape (ScoringPlan — Schema 13):
{
  "sprintContractId": string,            // a unique id for this review contract
  "committed": true,
  "dimensions": [                        // EXACTLY one object per dimension below
    { "dimensionId": string,             // one of: ${REVIEW_DIMENSIONS.join(', ')}
      "whatToLookFor": string,           // the rubric criterion committed in advance
      "whatTriggersBlock": string,       // what would force a low/blocking score
      "whatTriggersWarn": string }       // what would warrant a warning
  ]
}`

// ─── Phase-2 output contract: the 5-reviewer Review Report (Schema 6) ───────────
//
// Phase 2 is PAPER-VISIBLE: the message carries the config + the committed Phase-1
// plan + the full draft. The board MUST score against the pre-committed plan.
const CONTRACT_REVIEW = `${OUTPUT_CONTRACT_INTRO}
You are a 5-reviewer editorial panel scoring the paper AGAINST the pre-committed scoring
plan above. The five roles are EIC (Editor-in-Chief), R1, R2, R3 (referees), and DA
(Devil's Advocate). Emit EXACTLY one reviewer object per role (5 total), each scoring all
five dimensions (novelty, methodology, clarity, contribution, citation) and an overall
score, all on a 0-100 scale.
Decision thresholds (overall 0-100): >= 80 Accept, 65-79 Minor Revision, 50-64 Major
Revision, < 50 Reject. A DA critical flag OVERRIDES a numeric pass — if the Devil's
Advocate raises a critical concern, set daCritical true (and/or consensus "DA-CRITICAL")
and the paper cannot be Accepted regardless of the numbers.
Required JSON shape (ReviewerScoreSet — Schema 6):
{
  "sprintContractId": string,            // echo the id from the scoring plan above
  "reviewers": [                         // EXACTLY 5 objects, one per role EIC, R1, R2, R3, DA
    { "role": "EIC" | "R1" | "R2" | "R3" | "DA",
      "reviewerName": string,
      "overallScore": number,            // 0-100
      "dimensions": { "novelty": number, "methodology": number, "clarity": number, "contribution": number, "citation": number },  // each 0-100
      "keyComments": string[],
      "requiredChanges": string[],
      "recommendation": "Accept" | "Minor Revision" | "Major Revision" | "Reject" }
  ],
  "editorialDecision": "Accept" | "Minor Revision" | "Major Revision" | "Reject",
  "consensus": "CONSENSUS-4" | "CONSENSUS-3" | "SPLIT" | "DA-CRITICAL",
  "confidenceScore": number,             // 0-100
  "daCritical": boolean,
  "revisionRoadmap": [                    // advisory — concrete fixes the authors should make
    { "id": string, "description": string, "reviewer": string,
      "type": "Major" | "Minor" | "Editorial",
      "priority": "must_fix" | "should_fix" | "consider",
      "targetSection": string, "suggestedAction": string }
  ]
}`

/**
 * Phase 1 of the Sprint Contract — PAPER-BLIND. The editorial board pre-commits a
 * scoring plan (Schema 13) from the config ALONE; the message MUST NOT contain any
 * section/draft content. Streams the agent's reasoning through onChunk, forces the
 * Schema-13 block, parses it (retry ONCE on a missing field, then rethrow). Tags the
 * call with IR-03 access metadata so the server confirms this runs on a verified paper.
 *
 * @param config       - the Paper Configuration Record (the ONLY context Phase 1 sees)
 * @param onChunk       - called with each streamed text chunk (live UI updates)
 * @param modelConfig  - which model to route to (optional; server defaults to Sonnet)
 * @returns            - the parsed ScoringPlan (committed pre-commitment)
 */
export async function runReviewPhase1(
  config: PaperConfig,
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig
): Promise<ScoringPlan> {
  // PAPER-BLIND message: config context + a short instruction + the Schema-13 contract.
  // Deliberately NO draftBlock / section content here — that is the whole point of Phase 1.
  const userMessage = `
You are the Stage-3 editorial board running Phase 1 of a two-phase peer-review Sprint
Contract. This phase is PAPER-BLIND: you have NOT been shown the paper draft. Using only
the configuration below, pre-commit a scoring plan for the five rubric dimensions before
any content can influence your rubric.

${configBlock(config)}

${CONTRACT_SCORING_PLAN}
`.trim()

  // One call = one parse attempt. Factored so the retry path is identical.
  const runOnce = async (): Promise<ScoringPlan> => {
    const raw = await callAgent(PEER_REVIEWER_PROMPT, userMessage, onChunk, modelConfig, {
      access: REVIEW_ACCESS,
    })
    // parseSchema13 throws HandoffIncompleteError if sprintContractId or dimensions[] are missing.
    return parseSchema13(raw)
  }

  try {
    return await runOnce()
  } catch (err) {
    if (err instanceof HandoffIncompleteError) {
      // Retry the SAME call exactly once (mirrors runIntegrityGate's single auto-retry).
      console.warn('[runReviewPhase1] schema13 handoff incomplete, retrying once:', err.message)
      return await runOnce() // a second failure throws out of this function (rethrow)
    }
    // Network / server / non-handoff failure (incl. an IR-03 403) — surface to the caller.
    throw err
  }
}

/**
 * Phase 2 of the Sprint Contract — PAPER-VISIBLE. The same board, now holding the
 * committed Phase-1 scoring plan, reads the full draft and emits the 5-reviewer Review
 * Report (Schema 6). Streams through onChunk, forces the Schema-6 block, parses it
 * (retry ONCE then rethrow). Same IR-03 access metadata + PEER_REVIEWER_PROMPT.
 *
 * IMPORTANT (FR-22 / EH-03): this does NOT re-run Phase 1. It takes the already-committed
 * scoringPlan as an argument, so the page can retry Phase 2 alone without discarding the
 * blind pre-commitment. Keep the two phases decoupled.
 *
 * @param config       - the Paper Configuration Record
 * @param draft        - the Schema-4 PaperDraft (from buildPaperDraft) — the paper being scored
 * @param scoringPlan  - the committed Phase-1 plan the panel must score against
 * @param onChunk      - called with each streamed text chunk (live UI updates)
 * @param modelConfig  - which model to route to (optional; server defaults to Sonnet)
 * @returns            - the parsed ReviewerScoreSet (5 reviewers + advisory decision)
 */
export async function runReviewPhase2(
  config: PaperConfig,
  draft: PaperDraft,
  scoringPlan: ScoringPlan,
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig
): Promise<ReviewerScoreSet> {
  // PAPER-VISIBLE message: config + the committed plan (priorBlock) + the full draft
  // (draftBlock, reused from the integrity gate) + the Schema-6 contract.
  const userMessage = `
You are the Stage-3 editorial board running Phase 2 of the two-phase peer-review Sprint
Contract. You now have the full paper draft AND the scoring plan you committed in Phase 1.
Score the paper against that pre-committed plan and produce the 5-reviewer review report.

${configBlock(config)}

${priorBlock('Pre-committed Scoring Plan (Sprint Contract)', scoringPlan)}

${draftBlock(draft)}

${CONTRACT_REVIEW}
`.trim()

  // One call = one parse attempt. Factored so the retry path is identical.
  const runOnce = async (): Promise<ReviewerScoreSet> => {
    const raw = await callAgent(PEER_REVIEWER_PROMPT, userMessage, onChunk, modelConfig, {
      access: REVIEW_ACCESS,
    })
    // parseSchema6 throws HandoffIncompleteError if the 5 reviewers / required fields are missing.
    return parseSchema6(raw)
  }

  try {
    return await runOnce()
  } catch (err) {
    if (err instanceof HandoffIncompleteError) {
      // Retry the SAME call exactly once (mirrors runIntegrityGate's single auto-retry).
      console.warn('[runReviewPhase2] schema6 handoff incomplete, retrying once:', err.message)
      return await runOnce() // a second failure throws out of this function (rethrow)
    }
    // Network / server / non-handoff failure (incl. an IR-03 403) — surface to the caller.
    throw err
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// P14: STAGE 3' — RE-REVIEW ORCHESTRATION (narrow 3-agent team)
// ═══════════════════════════════════════════════════════════════════════════
//
// After a revision is approved (and one revision loop remains), the REVISED draft is
// re-scored by a NARROW panel — the Editor-in-Chief plus two referees (R1, R2), and
// the Devil's Advocate ONLY if a DA-CRITICAL flag fired at Stage 3. Think of it like a
// focused re-test of just the channels that failed the first bench check, rather than a
// full re-run of the whole acceptance suite.
//
// runReReview() reuses PEER_REVIEWER_PROMPT (no new bundle) but with a re-review contract
// that ALSO asks for an R&R Traceability Matrix (one row per original reviewer comment →
// what the revision did → Resolved/Partially/Unresolved) and a residual-issues list. The
// per-dimension Score Trajectory (Stage 3 → Stage 3' → delta) is NOT trusted from the
// agent — runReReview computes it deterministically from the two review reports, so the
// regression checkpoint can never be gamed by a bad agent number.

// IR-03 access tag for the re-review. Same verified_only reviewer, under the
// running-re-review pipeline status (a legal verified-only point, like running-peer-review).
const RE_REVIEW_ACCESS = {
  dataAccessLevel: 'verified_only',
  agentId: 'peer_reviewer_agent',
  pipelineStatus: 'running-re-review',
} as const

// The 5 rubric dimension keys, paired with the camelCase keys on ReviewerDimensionScores,
// so the software-computed Score Trajectory averages the same axes the panel scored.
const TRAJECTORY_DIMENSIONS: { key: keyof ReviewerDimensionScores; label: string }[] = [
  { key: 'novelty', label: 'Novelty' },
  { key: 'methodology', label: 'Methodology' },
  { key: 'clarity', label: 'Clarity' },
  { key: 'contribution', label: 'Contribution' },
  { key: 'citation', label: 'Citation' },
]

// Average a panel's score on ONE dimension across its reviewers (rounded 0-100).
// Returns 0 for an empty panel (defensive — the parser guarantees ≥3 reviewers at 3').
function avgDimension(review: ReviewerScoreSet, key: keyof ReviewerDimensionScores): number {
  const xs = review.reviewers.map((r) => r.dimensions[key])
  if (xs.length === 0) return 0
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
}

/**
 * Computes the per-dimension Score Trajectory from the Stage-3 review and the Stage-3'
 * re-review — deterministically, in software (never trusting the agent's numbers). Each
 * row is the panel AVERAGE on that dimension at each stage; delta = stage3Prime - stage3
 * (negative = the score dropped, which the UI flags as a regression when the drop > 3).
 */
export function computeScoreTrajectory(
  stage3: ReviewerScoreSet,
  stage3Prime: ReviewerScoreSet,
): ScoreTrajectoryEntry[] {
  return TRAJECTORY_DIMENSIONS.map(({ key, label }) => {
    const a = avgDimension(stage3, key)
    const b = avgDimension(stage3Prime, key)
    return { dimension: label, stage3: a, stage3Prime: b, delta: b - a }
  })
}

// ─── Re-review output contract appended to the re-review agent's userMessage ────
//
// Narrow team + R&R matrix + residual issues. The DA line is conditional: the caller
// substitutes it depending on whether a DA-CRITICAL fired at Stage 3.
function buildReReviewContract(includeDA: boolean): string {
  const team = includeDA
    ? 'EXACTLY 4 reviewer objects: EIC (Editor-in-Chief), R1, R2, and DA (Devil\'s Advocate — included because a DA-CRITICAL flag fired at Stage 3)'
    : 'EXACTLY 3 reviewer objects: EIC (Editor-in-Chief), R1, and R2 (no DA — none was critical at Stage 3)'
  return `${OUTPUT_CONTRACT_INTRO}
You are a NARROW re-review panel re-scoring a REVISED paper against the original Stage-3
review. Emit ${team}, each scoring all five dimensions (novelty, methodology, clarity,
contribution, citation) and an overall score, all 0-100.
Decision thresholds (overall 0-100): >= 80 Accept, 65-79 Minor Revision, 50-64 Major
Revision, < 50 Reject. A DA critical flag OVERRIDES a numeric pass.
ALSO produce an R&R Traceability Matrix: one row PER original reviewer required-change /
roadmap item, recording what the revision did and whether it is now resolved.
Required JSON shape (ReviewerScoreSet — Schema 6'):
{
  "sprintContractId": string,
  "reviewers": [
    { "role": "EIC" | "R1" | "R2"${includeDA ? ' | "DA"' : ''},
      "reviewerName": string,
      "overallScore": number,
      "dimensions": { "novelty": number, "methodology": number, "clarity": number, "contribution": number, "citation": number },
      "keyComments": string[],
      "requiredChanges": string[],
      "recommendation": "Accept" | "Minor Revision" | "Major Revision" | "Reject" }
  ],
  "editorialDecision": "Accept" | "Minor Revision" | "Major Revision" | "Reject",
  "consensus": "CONSENSUS-4" | "CONSENSUS-3" | "SPLIT" | "DA-CRITICAL",
  "confidenceScore": number,
  "daCritical": boolean,
  "rrMatrix": [
    { "id": string, "comment": string,            // the ORIGINAL Stage-3 reviewer comment
      "revision": string,                          // what the revision actually did about it
      "status": "Resolved" | "Partially Resolved" | "Unresolved",
      "reviewer": string, "targetSection": string }
  ],
  "residualIssues": string[]                       // issues the re-review still flags (may be [])
}`
}

/**
 * Runs the Stage-3' narrow re-review over the REVISED draft. Streams the agent's
 * reasoning through onChunk, forces the Schema-6' block (narrow team + R&R matrix +
 * residual issues), parses it in re-review mode (retry ONCE on a missing field, then
 * rethrow), then attaches the SOFTWARE-computed Score Trajectory vs Stage 3.
 *
 * @param config       - the Paper Configuration Record
 * @param revisedDraft - the revised Schema-4 draft being re-scored (paper.revisedDraft)
 * @param stage3Review - the original Stage-3 Review Report (for the trajectory + the matrix input)
 * @param roadmap      - the advisory Stage-3 roadmap items the revision worked from
 * @param onChunk      - called with each streamed text chunk (live UI updates)
 * @param modelConfig  - which model to route to (optional; server defaults to Sonnet)
 * @returns            - the parsed re-review ReviewerScoreSet (+ rrMatrix, residualIssues, scoreTrajectory)
 */
export async function runReReview(
  config: PaperConfig,
  revisedDraft: PaperDraft,
  stage3Review: ReviewerScoreSet,
  roadmap: RoadmapItem[],
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig,
): Promise<ReviewerScoreSet> {
  // DA joins the narrow team ONLY if it tripped the critical interlock at Stage 3.
  const includeDA = stage3Review.daCritical || stage3Review.consensus === 'DA-CRITICAL'

  // The original required-changes/roadmap, listed so the agent can build the R&R matrix.
  const originalComments =
    roadmap.length > 0
      ? roadmap
          .map((item) => `  - [${item.priority}] (${item.reviewer ?? 'reviewer'}) ${item.description}`)
          .join('\n')
      : stage3Review.reviewers
          .flatMap((r) => r.requiredChanges.map((c) => `  - (${r.role}) ${c}`))
          .join('\n') || '  (no explicit required changes were recorded at Stage 3)'

  const userMessage = `
You are the Stage-3' narrow re-review panel. A revised paper returns for re-scoring after
peer review and revision. Re-score the REVISED draft against the original Stage-3 review,
and trace each original reviewer comment to what the revision did about it.

${configBlock(config)}

${priorBlock('Original Stage-3 Review Report (Schema 6)', stage3Review)}

## Original reviewer comments / roadmap (build one R&R matrix row per item)
${originalComments}

${draftBlock(revisedDraft)}

${buildReReviewContract(includeDA)}
`.trim()

  // One call = one parse attempt. Factored so the retry path is identical (mirrors P11).
  const runOnce = async (): Promise<ReviewerScoreSet> => {
    const raw = await callAgent(PEER_REVIEWER_PROMPT, userMessage, onChunk, modelConfig, {
      access: RE_REVIEW_ACCESS,
    })
    // re-review mode: only the narrow team is required; rrMatrix/residualIssues parsed leniently.
    const report = parseSchema6(raw, { mode: 'reReview' })
    // Overwrite the (advisory) trajectory with the deterministic software-computed one.
    report.scoreTrajectory = computeScoreTrajectory(stage3Review, report)
    return report
  }

  try {
    return await runOnce()
  } catch (err) {
    if (err instanceof HandoffIncompleteError) {
      console.warn('[runReReview] schema6 (re-review) handoff incomplete, retrying once:', err.message)
      return await runOnce() // a second failure throws out of this function (rethrow)
    }
    // Network / server / non-handoff failure (incl. an IR-03 403) — surface to the caller.
    throw err
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// P12: STAGE 3→4 — EIC SOCRATIC COACHING
// ═══════════════════════════════════════════════════════════════════════════
//
// After a "Request Revision" review decision, the Editor-in-Chief coaches the
// author through the revision BEFORE the Stage-4 executor rewrites anything.
// Think of it like a design review with your advisor: instead of handing you the
// fixed layout, they ask the pointed questions that make YOU see what to change —
// so you understand the revision, not just receive it.
//
// There is no dedicated Socratic-coach agent in the ARS bundle (revision_coach is
// the Stage-4 EXECUTOR — it parses comments into a roadmap and rewrites; it is
// bundled + used in P13). So, per the plan's fallback, coaching is driven from the
// Schema 6/7 context with a short EIC system prompt defined here.
//
// Transport is a real multi-turn dialogue over /api/coaching (see lib/coaching.ts),
// NOT callAgent — coaching is a back-and-forth, not a one-shot. This module only
// supplies (1) the system prompt and (2) the seed message that opens the dialogue.

/**
 * The EIC Socratic coaching system prompt. Short and self-contained (the plan's
 * fallback when no dedicated coach agent exists). The model plays the Editor-in-Chief
 * coaching the author through their revision via focused Socratic questions.
 */
export const COACHING_SYSTEM_PROMPT = `You are the Editor-in-Chief (EIC) of an academic journal, coaching an author through the revision of their paper after a peer-review "Request Revision" decision.

Your method is SOCRATIC. You do not rewrite the paper and you do not hand the author finished fixes. Instead you ask pointed, one-at-a-time questions that lead the author to discover what must change and why — grounding every question in the reviewers' report and the revision roadmap you are given.

Rules for every turn:
- Ask ONE focused question or raise ONE concrete issue per turn. Never dump a checklist.
- Tie each question to a specific reviewer concern or roadmap item (name it).
- Prioritise the must_fix items first, then should_fix, then consider.
- Acknowledge the author's answer briefly, then move them forward.
- Keep each turn short (a few sentences). This is a dialogue, not an essay.
- You are coaching, not approving: do not declare the paper accepted or finished.
- The coaching loop is bounded (the author may end it and proceed to revision at any time). When you sense the author understands the key fixes, say so and suggest they proceed to the revision step.`

/**
 * Builds the SEED message that opens the coaching dialogue. This is the FIRST
 * user-role turn: it hands the EIC the paper context, the editorial decision, the
 * five reviewers' headline concerns, and the advisory revision roadmap, then asks
 * the EIC to open with its first Socratic question. The author has not spoken yet —
 * this message exists only to give the coach its grounding and elicit turn 1.
 *
 * @param config   - the Paper Configuration Record (topic, type, citation format)
 * @param review   - the Schema-6 Review Report (5 reviewers + decision + consensus)
 * @param roadmap  - the advisory Schema-7 roadmap items (may be empty)
 * @returns        - the seed user message string
 */
export function buildCoachingSeed(
  config: PaperConfig,
  review: ReviewerScoreSet,
  roadmap: RoadmapItem[]
): string {
  // Compact per-reviewer summary: role, overall score, and their required changes.
  const reviewerLines = review.reviewers
    .map((r) => {
      const changes =
        r.requiredChanges.length > 0
          ? r.requiredChanges.map((c) => `      - ${c}`).join('\n')
          : '      - (no specific required changes)'
      return `  ${r.role} (overall ${r.overallScore}/100, recommends ${r.recommendation}):\n${changes}`
    })
    .join('\n')

  // The roadmap, leading with must_fix so the coach opens on the highest-priority issue.
  const roadmapLines =
    roadmap.length > 0
      ? roadmap
          .map(
            (item) =>
              `  - [${item.priority}] ${item.description}` +
              (item.targetSection ? ` (section: ${item.targetSection})` : '')
          )
          .join('\n')
      : '  (no structured roadmap was provided — coach from the reviewer concerns above)'

  return `
A paper has received a "${review.editorialDecision}" decision (consensus: ${review.consensus}) in peer review and now enters the revision-coaching step. Coach the author through the revision.

## Paper
- Topic: ${config.topic}
- Type: ${config.paperType}
- Citation format: ${config.citationFormat}

## Reviewer concerns (Schema 6)
${reviewerLines}

## Revision roadmap (advisory, Schema 7)
${roadmapLines}

Open the coaching dialogue now: greet the author briefly, then ask your FIRST Socratic question about the single highest-priority issue. One question only.
`.trim()
}

// ═══════════════════════════════════════════════════════════════════════════
// P13: STAGE 4 — REVISION EXECUTOR (revision_coach_agent)
// ═══════════════════════════════════════════════════════════════════════════
//
// After coaching, the revision_coach_agent REWRITES the paper. Unlike the EIC coach
// (which only asked questions), this agent does the work: it reads the reviewers'
// report, the structured roadmap, and the coaching dialogue, then returns (1) the
// grouped Revision Roadmap (Schema 7) and (2) the REVISED sections. From those plus
// the ORIGINAL draft, runRevision() builds the revised Schema-4 draft and a per-section
// Delta Report (the actual word-diff is rendered later by DeltaReportView).
//
// IRON RULE (P13.7): this function NEVER mutates the original draft it is handed —
// it returns a NEW revisedDraft, so a failed/abandoned revision leaves the source
// intact and the Delta Report always has a stable "before".

// One revised section as the agent returns it (before we reconcile it with the
// original draft to recover sectionId / targetWords).
interface RawRevisedSection {
  heading: string
  content: string
  changed?: boolean
  changeSummary?: string
}

// The full output of a revision run: the grouped roadmap, the revised Schema-4 draft,
// and the Delta Report the UI diffs. Returned by runRevision().
export interface RevisionResult {
  roadmap: RevisionRoadmap
  revisedDraft: PaperDraft
  deltaReport: DeltaReport
}

// ─── Revision output contract appended to the revision agent's userMessage ──────
//
// One fenced json block carrying BOTH the grouped roadmap (parsed by parseSchema7)
// and the revised sections (parsed locally). The agent rewrites against the roadmap;
// software computes the diff — so we do NOT ask the agent for a diff.
const CONTRACT_REVISION = `${OUTPUT_CONTRACT_INTRO}
You are the revision executor. Using the reviewers' report, the revision roadmap, the
coaching dialogue, and the current draft above, REWRITE the paper to address every
must_fix item (and as many should_fix / consider items as are warranted). Then report
both the roadmap you worked from AND your revised sections.
Required JSON shape:
{
  "roadmap": {
    "summary": string,                   // one-line framing of the revision
    "mustFix":   [ { "id": string, "description": string, "reviewer": string, "type": "Major" | "Minor" | "Editorial", "targetSection": string, "suggestedAction": string } ],
    "shouldFix": [ { "id": string, "description": string, "reviewer": string, "type": "Major" | "Minor" | "Editorial", "targetSection": string, "suggestedAction": string } ],
    "consider":  [ { "id": string, "description": string, "reviewer": string, "type": "Major" | "Minor" | "Editorial", "targetSection": string, "suggestedAction": string } ]
  },
  "revisedSections": [                    // ONE object per section of the paper, in order, using the SAME headings as the draft above
    { "heading": string,                  // must match the draft section heading
      "content": string,                  // the FULL revised plain-text content of that section (rewrite where needed; copy verbatim where unchanged)
      "changed": boolean,                 // true if you changed this section
      "changeSummary": string }           // one sentence on what changed (or "no change")
  ],
  "revisionSummary": string               // a short paragraph describing the overall revision
}`

// Render the coaching dialogue as a readable transcript block for the agent (or a note
// when coaching was skipped). EIC turns are the coach; user turns are the author.
function coachingBlock(thread: CoachingMessage[]): string {
  if (!thread || thread.length === 0) {
    return '## Coaching dialogue\n(the author skipped coaching — none took place)'
  }
  const lines = thread
    .map((m) => `${m.role === 'eic' ? 'EIC' : 'Author'}: ${m.content}`)
    .join('\n\n')
  return `## Coaching dialogue (Stage 3→4)\n${lines}`
}

// Normalise a heading for matching the agent's revised sections back to the original
// draft sections: trim + collapse whitespace + lowercase. Two headings that differ
// only in spacing/case still match the same original section.
function normHeading(h: string): string {
  return h.trim().replace(/\s+/g, ' ').toLowerCase()
}

// Pull the revised sections out of the raw agent reply. Throws HandoffIncompleteError
// when the array is absent/empty or no item has both a heading and content — so a
// reply that returned only the roadmap aborts (and the single upstream retry fires).
function parseRevisedSections(raw: string): RawRevisedSection[] {
  const data = extractJsonBlock(raw)
  const arr =
    typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>).revisedSections
      : undefined
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new HandoffIncompleteError('schema7', ['revisedSections'])
  }
  const out: RawRevisedSection[] = []
  arr.forEach((rawItem) => {
    if (typeof rawItem !== 'object' || rawItem === null) return
    const r = rawItem as Record<string, unknown>
    if (typeof r.heading !== 'string' || r.heading.trim().length === 0) return
    if (typeof r.content !== 'string') return
    const item: RawRevisedSection = { heading: String(r.heading), content: String(r.content) }
    if (typeof r.changed === 'boolean') item.changed = r.changed
    if (typeof r.changeSummary === 'string') item.changeSummary = String(r.changeSummary)
    out.push(item)
  })
  if (out.length === 0) {
    throw new HandoffIncompleteError('schema7', ['revisedSections (no valid item)'])
  }
  return out
}

// Reconcile the agent's revised sections with the ORIGINAL draft, producing the new
// Schema-4 draft + the Delta Report. Pure: original is read, never mutated (P13.7).
function buildRevisedDraftAndDelta(
  config: PaperConfig,
  original: PaperDraft,
  revised: RawRevisedSection[],
  revisionSummary: string,
): { revisedDraft: PaperDraft; deltaReport: DeltaReport } {
  // Index the revised sections by normalised heading for O(1) lookup.
  const revisedByHeading = new Map<string, RawRevisedSection>()
  for (const r of revised) revisedByHeading.set(normHeading(r.heading), r)

  const draftSections: DraftSection[] = []
  const deltaSections: DeltaSection[] = []
  const matchedHeadings = new Set<string>()

  // Walk the ORIGINAL sections in order — they define paper order and carry the
  // bookkeeping (sectionId / targetWords) the agent does not echo back.
  for (const orig of original.sections) {
    const key = normHeading(orig.heading)
    const match = revisedByHeading.get(key)
    if (match) matchedHeadings.add(key)
    const oldContent = orig.content
    const newContent = match ? match.content : oldContent
    // Trust the agent's `changed` flag when given; otherwise diff the text ourselves.
    const changed = match
      ? (typeof match.changed === 'boolean' ? match.changed : newContent.trim() !== oldContent.trim())
      : false

    draftSections.push({
      sectionId: orig.sectionId,
      heading: orig.heading,
      targetWords: orig.targetWords,
      content: newContent,
      materialGapCount: countMaterialGaps(newContent),
    })
    const deltaRow: DeltaSection = {
      heading: orig.heading,
      changed,
      oldContent,
      newContent,
    }
    if (match?.changeSummary) deltaRow.changeSummary = match.changeSummary
    deltaSections.push(deltaRow)
  }

  // Any revised section that did NOT match an original heading is a NEW section the
  // agent added — append it (no "before"), so nothing the agent wrote is dropped.
  for (const r of revised) {
    const key = normHeading(r.heading)
    if (matchedHeadings.has(key)) continue
    draftSections.push({
      sectionId: 'revised-' + key.replace(/[^a-z0-9]+/g, '-'),
      heading: r.heading,
      targetWords: getSectionWordCount(config.wordCount, config.paperType, r.heading),
      content: r.content,
      materialGapCount: countMaterialGaps(r.content),
    })
    const deltaRow: DeltaSection = {
      heading: r.heading,
      changed: true,
      oldContent: '',
      newContent: r.content,
    }
    if (r.changeSummary) deltaRow.changeSummary = r.changeSummary
    deltaSections.push(deltaRow)
  }

  const wordCountTotal = draftSections.reduce((sum, s) => {
    return sum + s.content.split(/\s+/).filter((w) => w.length > 0).length
  }, 0)

  const revisedDraft: PaperDraft = {
    schemaId: 4,
    versionLabel: 'paper_draft_revised',
    sections: draftSections,
    wordCountTotal,
  }
  const deltaReport: DeltaReport = {
    sections: deltaSections,
    changedCount: deltaSections.filter((d) => d.changed).length,
    summary: revisionSummary,
  }
  return { revisedDraft, deltaReport }
}

/**
 * Runs the Stage-4 revision. Streams the agent's reasoning through onChunk, forces a
 * single JSON block (grouped roadmap + revised sections), parses both, then builds the
 * revised Schema-4 draft and the Delta Report from the ORIGINAL draft (never mutated).
 * Retries ONCE on a HandoffIncompleteError, then rethrows — the exact runOnce pattern
 * runReviewPhase2 / runIntegrityGate use.
 *
 * @param config        - the Paper Configuration Record
 * @param original      - the Schema-4 draft being revised (from buildPaperDraft) — read-only
 * @param review        - the Schema-6 Review Report the revision must address
 * @param coaching      - the persisted coaching thread (may be empty if skipped)
 * @param onChunk       - called with each streamed text chunk (live UI updates)
 * @param modelConfig   - which model to route to (optional; server defaults to Sonnet)
 * @returns             - the roadmap + revised draft + delta report
 */
export async function runRevision(
  config: PaperConfig,
  original: PaperDraft,
  review: ReviewerScoreSet,
  coaching: CoachingMessage[],
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig,
): Promise<RevisionResult> {
  const userMessage = `
You are the Stage-4 revision executor. A paper received a "${review.editorialDecision}" decision
in peer review and has been coached through the issues. Rewrite the paper to address the
reviewers' concerns and the revision roadmap, then report the roadmap and your revised sections.

${configBlock(config)}

${priorBlock('Peer Review Report (Schema 6)', review)}

${coachingBlock(coaching)}

${draftBlock(original)}

${CONTRACT_REVISION}
`.trim()

  // One call = one parse attempt. Factored so the retry path is identical (EH-04).
  const runOnce = async (): Promise<RevisionResult> => {
    const raw = await callAgent(REVISION_COACH_PROMPT, userMessage, onChunk, modelConfig)
    // Both parsers throw HandoffIncompleteError('schema7', …) on a gap → single retry.
    const roadmap = parseSchema7(raw)
    const revised = parseRevisedSections(raw)
    // revisionSummary is best-effort prose; default to the roadmap summary or a stub.
    const data = extractJsonBlock(raw)
    const revisionSummary =
      typeof data === 'object' &&
      data !== null &&
      typeof (data as Record<string, unknown>).revisionSummary === 'string'
        ? String((data as Record<string, unknown>).revisionSummary)
        : roadmap.summary ?? 'Revision completed.'
    const { revisedDraft, deltaReport } = buildRevisedDraftAndDelta(
      config,
      original,
      revised,
      revisionSummary,
    )
    return { roadmap, revisedDraft, deltaReport }
  }

  try {
    return await runOnce()
  } catch (err) {
    if (err instanceof HandoffIncompleteError) {
      console.warn('[runRevision] schema7 handoff incomplete, retrying once:', err.message)
      return await runOnce() // a second failure throws out of this function (rethrow)
    }
    // Network / server / non-handoff failure — surface to the caller (EH-04 Retry).
    throw err
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// P17: STAGE 6 — PROCESS SUMMARY (process_summary + collaboration_depth)
// ═══════════════════════════════════════════════════════════════════════════
//
// Stage 6 is ADVISORY and runs AFTER the first export — it NEVER re-blocks the pipeline.
// Two halves:
//   • LOCAL (no LLM, process-summary.ts): the execution timeline, the key decisions, the
//     model-per-stage list, AND the Failure-Mode Audit Log. These render even if the
//     agents fail (FR-47), so the paper download is never held hostage to Stage 6.
//   • LLM (here): the process_summary_agent writes the reflective NARRATIVE + logs agent
//     DISAGREEMENTS; the collaboration_depth_agent scores the 4 collaboration dimensions.
//
// The collaboration_depth_agent is the SAME observer deliberately SKIPPED at the integrity
// gates (2.5/4.5) — it only describes the collaboration here, after the fact, and can
// never influence a blocking decision.
//
// Parsing is LENIENT (this is advisory): a malformed narrative block degrades to the raw
// streamed prose; a malformed/out-of-range collaboration block degrades to null (the chart
// then shows its text fallback). Only a network/agent THROW propagates — the page turns
// that into a non-blocking "Stage-6 failed → Retry" with the local sections still shown.

// Agent metadata (mirrors FORMATTER_AGENT) — both Stage-6 agents read verified_only data.
export const PROCESS_SUMMARY_AGENT = {
  id: 'process_summary_agent',
  dataAccess: 'verified_only' as const,
  prompt: PROCESS_SUMMARY_PROMPT,
} as const

export const COLLABORATION_DEPTH_AGENT = {
  id: 'collaboration_depth_agent',
  dataAccess: 'verified_only' as const,
  prompt: COLLABORATION_DEPTH_PROMPT,
} as const

// ─── Output contracts appended to each Stage-6 agent's userMessage ─────────────
const CONTRACT_PROCESS_SUMMARY = `${OUTPUT_CONTRACT_INTRO}
Required JSON shape (process summary). Ground every statement in the execution trace and
review context above; do not invent stages or disagreements:
{
  "narrative": string,                 // 1-3 short paragraphs reflecting honestly on the run
  "agentDisagreements": string[]       // points where agents materially disagreed (may be [])
}`

const CONTRACT_COLLABORATION = `${OUTPUT_CONTRACT_INTRO}
Required JSON shape (collaboration depth). Each score is an INTEGER 1-5 based on the trace:
{
  "delegationIntensity": number,       // 1-5
  "cognitiveVigilance": number,        // 1-5
  "cognitiveReallocation": number,     // 1-5
  "zoneClassification": number,        // 1-5 (overall placement)
  "zoneLabel": string,                 // e.g. "Co-Creation"
  "rationale": string                  // one or two sentences
}`

// Render the locally-built trace + decisions + model list as a context block the agents
// reason from. Keeps both agents grounded in the SAME ground-truth trace.
function processTraceBlock(reflection: AISelfReflection): string {
  const timeline = reflection.timeline
    .map((t) => `  - ${t.stage}: ${t.label} [${t.status}]${t.detail ? ` (${t.detail})` : ''}`)
    .join('\n')
  const decisions = reflection.keyDecisions
    .map((d) => `  - ${d.label}: ${d.detail}`)
    .join('\n')
  const models = reflection.modelPerStage
    .map((m) => `  - ${m.stage}: ${m.model}`)
    .join('\n')
  return `## Execution timeline\n${timeline}\n\n## Key human decisions\n${decisions}\n\n## Model per stage\n${models}`
}

// Clamp a value to an integer in [1,5], or return null if it is not a finite number.
function clampScore(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.min(5, Math.max(1, Math.round(v)))
}

// Lenient parse of the process_summary_agent reply. Falls back to the raw prose (minus any
// JSON block) as the narrative when the block is absent/broken — never throws on bad JSON.
function parseProcessSummaryReply(raw: string): { narrative: string; agentDisagreements: string[] } {
  try {
    const data = extractJsonBlock(raw)
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>
      const narrative = typeof obj.narrative === 'string' ? obj.narrative.trim() : ''
      const agentDisagreements = Array.isArray(obj.agentDisagreements)
        ? obj.agentDisagreements.filter((x): x is string => typeof x === 'string')
        : []
      if (narrative.length > 0 || agentDisagreements.length > 0) {
        return { narrative, agentDisagreements }
      }
    }
  } catch {
    // fall through to the prose fallback
  }
  // Fallback: strip any fenced block and use the streamed prose as the narrative.
  const prose = raw.replace(/```[\s\S]*?```/g, '').trim()
  return { narrative: prose, agentDisagreements: [] }
}

// Lenient parse of the collaboration_depth_agent reply → CollaborationDepth | null. Returns
// null when the block is missing or any of the four scores is not a usable number (the
// chart then renders its text fallback).
function parseCollaborationReply(raw: string): CollaborationDepth | null {
  let data: unknown
  try {
    data = extractJsonBlock(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>
  const di = clampScore(obj.delegationIntensity)
  const cv = clampScore(obj.cognitiveVigilance)
  const cr = clampScore(obj.cognitiveReallocation)
  const zc = clampScore(obj.zoneClassification)
  if (di === null || cv === null || cr === null || zc === null) return null
  const zoneLabel = typeof obj.zoneLabel === 'string' && obj.zoneLabel.trim().length > 0
    ? obj.zoneLabel.trim()
    : ['', 'Manual', 'AI-Assisted', 'Co-Creation', 'AI-Led / Human-Supervised', 'Autonomous'][zc] ?? 'Co-Creation'
  const depth: CollaborationDepth = {
    delegationIntensity: di,
    cognitiveVigilance: cv,
    cognitiveReallocation: cr,
    zoneClassification: zc,
    zoneLabel,
  }
  if (typeof obj.rationale === 'string' && obj.rationale.trim().length > 0) {
    depth.rationale = obj.rationale.trim()
  }
  return depth
}

/**
 * Runs the Stage-6 process summary. Builds the LOCAL trace/decisions/model list from the
 * paper state, then calls the two Stage-6 agents for the reflective narrative + agent
 * disagreements and the 4-dimension collaboration depth. Parsing is lenient (advisory):
 * a bad narrative block degrades to the raw prose; a bad collaboration block degrades to
 * null. A network/agent THROW propagates so the page can offer a non-blocking retry.
 *
 * @param state       - the export-ready PaperState (read-only here)
 * @param onChunk     - called with each streamed text chunk (live UI updates)
 * @param modelConfig - which model to route to (optional; server defaults to Sonnet)
 * @returns           - the ProcessSummary (selfReflection + collaborationDepth|null)
 */
export async function runProcessSummary(
  state: PaperState,
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig,
): Promise<ProcessSummary> {
  // ── LOCAL half: the ground-truth trace, key decisions, model-per-stage. ──
  const modelLabel = modelConfig?.label ?? 'Claude Sonnet 4.5 (default)'
  const reflection: AISelfReflection = {
    timeline: buildPipelineTrace(state),
    keyDecisions: buildKeyDecisions(state),
    modelPerStage: buildModelPerStage(state, modelLabel),
    agentDisagreements: [],
  }
  const traceBlock = processTraceBlock(reflection)

  // Compact review context so the narrator can spot disagreements (decision + consensus).
  const reviewContext = state.reviewReport
    ? priorBlock('Peer Review Report (Schema 6)', {
        editorialDecision: state.reviewReport.editorialDecision,
        consensus: state.reviewReport.consensus,
        daCritical: state.reviewReport.daCritical,
        residualIssues: state.reReviewReport?.residualIssues,
      })
    : '## Peer Review\n(no peer-review report on record)'

  // ── Agent 1: the AI Self-Reflection narrative + disagreements. ──
  const summaryMessage = `
You are writing the Stage-6 AI Self-Reflection Report for a finished, exported paper.
Reflect honestly on how it was produced, using ONLY the trace and context below.

## Paper
- Topic: ${state.config.topic}
- Type: ${state.config.paperType}

${traceBlock}

${reviewContext}

${CONTRACT_PROCESS_SUMMARY}
`.trim()

  const summaryRaw = await callAgent(PROCESS_SUMMARY_PROMPT, summaryMessage, onChunk, modelConfig)
  const { narrative, agentDisagreements } = parseProcessSummaryReply(summaryRaw)
  reflection.narrative = narrative
  reflection.agentDisagreements = agentDisagreements

  // ── Agent 2: the collaboration-depth scores (observer; advisory). ──
  const collabMessage = `
You are the collaboration-depth observer rating a finished AI-assisted writing run. Score
the four dimensions (each 1-5) and classify the Zone, using ONLY the trace below.

${traceBlock}

${CONTRACT_COLLABORATION}
`.trim()

  let collaborationDepth: CollaborationDepth | null = null
  try {
    const collabRaw = await callAgent(COLLABORATION_DEPTH_PROMPT, collabMessage, onChunk, modelConfig)
    collaborationDepth = parseCollaborationReply(collabRaw)
  } catch (err) {
    // Non-blocking: the collaboration chart is the LEAST essential Stage-6 part — log and
    // continue with a null depth (the chart shows its text fallback). NEVER empty (NFR-16).
    console.warn('[runProcessSummary] collaboration-depth step skipped:', err)
  }

  return { selfReflection: reflection, collaborationDepth }
}
