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
} from './ars-agents'
import type { PaperConfig, Section, ModelConfig } from './types'

// ─── Core streaming primitive ────────────────────────────────────────────────

/**
 * Calls /api/generate and streams the response back chunk by chunk.
 *
 * @param agentPrompt  - The ARS agent's system prompt
 * @param userMessage  - The task/context to send to that agent
 * @param onChunk      - Called with each text chunk as it arrives (for live UI updates)
 * @param modelConfig  - Which model to route to (Anthropic or an OpenAI-compatible one). Optional — the server defaults to Claude Sonnet 4.5 if omitted.
 * @returns            - The full accumulated response text
 */
export async function callAgent(
  agentPrompt: string,
  userMessage: string,
  onChunk: (text: string) => void,
  modelConfig?: ModelConfig
): Promise<string> {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentPrompt, userMessage, modelConfig }),
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

      try {
        const parsed = JSON.parse(payload) as { text?: string; error?: string }
        if (parsed.error) throw new Error(parsed.error)
        if (parsed.text) {
          fullText += parsed.text
          onChunk(parsed.text)
        }
      } catch {
        // Ignore malformed SSE lines
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
