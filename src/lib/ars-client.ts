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
} from './ars-agents'
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
import { parseSchema1, parseSchema2, parseSchema3, parseSchema5, HandoffIncompleteError } from './schemas'
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
    body: JSON.stringify({ agentPrompt, userMessage, modelConfig, progressMeta: opts?.progressMeta }),
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
