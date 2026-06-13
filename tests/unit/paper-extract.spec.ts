// FP-1 unit tests — the paper-artifact channel (extract → sanitize → validate).
//
// These feed REAL polluted transcripts (the exact telemetry the bundled draft_writer prompt
// commands the model to emit: metadata tables, manifests, ref/anchor markers, word-count
// blocks, refusals) through the channel and assert that only clean paper prose survives.
//
// Pure-function tests: no `page` fixture, no browser, no dev server (see playwright.unit.config.ts).

import { test, expect } from '@playwright/test'
import {
  extractSection,
  extractOutline,
  extractAbstract,
  validatePaperContent,
} from '@/lib/paper-extract'
import { sanitizePaperContent } from '@/lib/strip-agent-notes'

// A realistic, heavily-polluted draft_writer reply: preamble, a clean section inside the
// markers, then word-count tracking, a Draft Metadata table, a Claim Intent Manifest, a
// [PRE-COMMITMENT-ACKNOWLEDGED] tag, and a sign-off — all OUTSIDE the markers.
const POLLUTED_SECTION = `Here is the Methodology section for your paper:

<<<PAPER_SECTION>>>
## Methodology

This study employs a mixed-methods design (Creswell, 2018) <!--ref:creswell2018--><!--anchor:page:12-->. The quantitative strand uses a survey instrument validated in prior work [Smith, 2024], administered to a purposive sample selected for its relevance to the research questions. Participants were recruited through professional networks, a technique well suited to exploratory inquiry (Patton, 2015).

The qualitative strand complements the survey with semi-structured interviews, each lasting approximately forty-five minutes and transcribed verbatim for analysis. Thematic analysis follows the six-phase approach of Braun and Clarke (2006), ensuring analytic rigour and traceability from raw transcript to reported theme. Triangulation across the two strands strengthens the credibility of the resulting interpretations. [MATERIAL GAP: no pilot-study data was provided]

### Data Analysis

Survey responses were summarised with descriptive statistics, while interview data were coded inductively and then organised into higher-order themes. Convergence between the strands is reported where it occurs, and divergence is treated as an analytic prompt rather than an error to be explained away.
<<<END_PAPER_SECTION>>>

Section: Methodology
Target: 400 words
Actual: 180 words
Deviation: -55%
Running Total: 180 / 6000 words

### Draft Metadata
| Metric | Value |
|--------|-------|
| Total Word Count | 180 |
| Citations Used | 4 |

\`\`\`json
{ "manifest_version": "1.0", "manifest_id": "M-1", "emitted_by": "draft_writer_agent", "claims": [] }
\`\`\`

[PRE-COMMITMENT-ACKNOWLEDGED]

Let me know if you'd like me to expand the Data Analysis subsection.`

test.describe('extractSection — polluted draft_writer transcript', () => {
  // targetWords 200 ≈ the fixture's length; the validation gate (40% floor) is exercised
  // directly in the "validatePaperContent" describe block below.
  const result = extractSection(POLLUTED_SECTION, { heading: 'Methodology', targetWords: 200 })

  test('the section is accepted as valid', () => {
    expect(result.valid).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  test('clean prose is preserved (heading, citation placeholder, material gap)', () => {
    expect(result.content).toContain('## Methodology')
    expect(result.content).toContain('[Smith, 2024]')
    expect(result.content).toContain('[MATERIAL GAP')
    expect(result.content).toContain('### Data Analysis')
  })

  test('no channel-bleed artifacts survive into the paper content', () => {
    const c = result.content
    expect(c).not.toContain('PAPER_SECTION') // delimiter
    expect(c).not.toContain('<!--')          // ref/anchor/html comments
    expect(c).not.toContain('creswell2018')  // ref slug routed out
    expect(c).not.toContain('Running Total')  // word-count tracking
    expect(c).not.toContain('Draft Metadata')
    expect(c).not.toContain('manifest_id')
    expect(c).not.toContain('PRE-COMMITMENT-ACKNOWLEDGED')
    expect(c).not.toContain('Here is the')    // preamble
    expect(c).not.toContain('Let me know')    // sign-off
  })

  test('citation slugs are recovered into the structured list', () => {
    expect(result.citations).toContain('creswell2018')
  })

  test('the chatter is routed to the conversation channel as notes', () => {
    expect(result.notes.length).toBeGreaterThan(0)
  })
})

test.describe('sanitizePaperContent — score sections emitted INSIDE the section', () => {
  // A model that dumps a Word Count table and Dimension Scores *inside* the prose.
  const RAW = `## Results

The system achieved a 23% improvement over baseline (Lee, 2025). Subsequent trials confirmed the effect across three independent datasets, and the variance remained within acceptable bounds throughout the evaluation period reported in this section.

### Word Count by Section

| Section | Target | Actual |
|---------|--------|--------|
| Results | 500 | 510 |

## Dimension Scores

### D1: section_completeness

pass — all required content is present.`

  const { content } = sanitizePaperContent(RAW)

  test('keeps the real prose', () => {
    expect(content).toContain('## Results')
    expect(content).toContain('23% improvement')
  })

  test('strips the metadata/score sections and their tables', () => {
    expect(content).not.toContain('Word Count by Section')
    expect(content).not.toContain('Dimension Scores')
    expect(content).not.toContain('section_completeness')
    expect(content).not.toContain('| Section')
  })
})

test.describe('sanitizePaperContent — markers, word-count block, sign-off', () => {
  const { content, citations, notes } = sanitizePaperContent(
    `Intro prose (Kim, 2024) <!--ref:kim2024--><!--anchor:none:-->.

Section: Intro
Target: 100 words
Actual: 5 words

I hope this helps!`,
  )

  test('routes ref markers to citations and drops anchors', () => {
    expect(citations).toEqual(['kim2024'])
    expect(content).not.toContain('<!--')
  })

  test('removes the word-count block and the trailing sign-off', () => {
    expect(content).not.toContain('Running Total')
    expect(content).not.toContain('Target: 100 words')
    expect(content).not.toContain('I hope this helps')
    expect(content).toContain('Intro prose')
    expect(notes.length).toBeGreaterThan(0)
  })
})

test.describe('extractSection — fallbacks', () => {
  test('no markers: slices from the first heading and drops preamble', () => {
    const raw = `Sure! Here's the Introduction you asked for.

## Introduction

Academic publishing has changed substantially over the past decade (Jones, 2023). This introduction situates the present study within that shifting landscape and motivates the research questions that follow, drawing on a range of prior contributions to frame the gap that the study sets out to address in detail.`
    const r = extractSection(raw, { heading: 'Introduction', targetWords: 60 })
    expect(r.valid).toBe(true)
    expect(r.content.startsWith('## Introduction')).toBe(true)
    expect(r.content).not.toContain('Sure!')
  })

  test('truncated stream (open marker, no close) still extracts the body', () => {
    const raw = `<<<PAPER_SECTION>>>
## Background

Prior work on this topic spans several disciplines (Ng, 2022). The background reviews the most relevant contributions and explains how they collectively motivate the questions this study pursues across the following sections of the paper.`
    const r = extractSection(raw, { heading: 'Background', targetWords: 50 })
    expect(r.content).toContain('## Background')
    expect(r.content).not.toContain('PAPER_SECTION')
    expect(r.valid).toBe(true)
  })
})

test.describe('validatePaperContent — the rejection gate', () => {
  test('refusal with no heading is rejected', () => {
    const v = validatePaperContent("I'm sorry, but I cannot write this section without your data.", {
      requireHeading: false,
    })
    expect(v.ok).toBe(false)
    expect(v.reason).toBe('refusal-or-question')
  })

  test('content under 40% of the target length is rejected', () => {
    const v = validatePaperContent('## Methods\n\nToo short.', {
      heading: 'Methods',
      targetWords: 1000,
      requireHeading: true,
    })
    expect(v.ok).toBe(false)
    expect(v.reason).toBe('too-short')
  })

  test('missing target heading is rejected', () => {
    const long = '## Conclusion\n\n' + 'word '.repeat(200)
    const v = validatePaperContent(long, { heading: 'Methodology', requireHeading: true })
    expect(v.ok).toBe(false)
    expect(v.reason).toBe('missing-heading')
  })

  test('clean, long-enough, correctly-headed content passes', () => {
    const long = '## Methodology\n\n' + 'word '.repeat(200)
    const v = validatePaperContent(long, { heading: 'Methodology', targetWords: 400, requireHeading: true })
    expect(v.ok).toBe(true)
  })
})

test.describe('extractOutline — B4 structured section list', () => {
  const OUTLINE = `<<<PAPER_OUTLINE>>>
## Paper Outline
### Structure pattern: IMRaD
#### 1. Introduction (~900 words)
**Purpose**: frame the problem
#### 2. Methodology (~1200 words)
**Purpose**: describe the design
<<<END_PAPER_OUTLINE>>>

\`\`\`json
{ "sections": [ { "heading": "Introduction", "targetWords": 900 }, { "heading": "Methodology", "targetWords": 1200 } ] }
\`\`\``

  test('derives the section list from the JSON block, not from headings', () => {
    const r = extractOutline(OUTLINE, { wordCount: 2100, fallbackHeadings: ['A', 'B', 'C'] })
    expect(r.usedFallback).toBe(false)
    expect(r.sections.map((s) => s.heading)).toEqual(['Introduction', 'Methodology'])
    expect(r.sections[0].targetWords).toBe(900)
  })

  test('the human outline excludes the json block and the delimiters', () => {
    const r = extractOutline(OUTLINE, { wordCount: 2100, fallbackHeadings: ['A', 'B', 'C'] })
    expect(r.outline).toContain('Paper Outline')
    expect(r.outline).not.toContain('"sections"')
    expect(r.outline).not.toContain('PAPER_OUTLINE')
  })

  test('missing JSON surfaces the paper-type fallback defaults', () => {
    const noJson = `<<<PAPER_OUTLINE>>>
## Paper Outline
#### 1. Introduction (~900 words)
<<<END_PAPER_OUTLINE>>>`
    const r = extractOutline(noJson, { wordCount: 3000, fallbackHeadings: ['Introduction', 'Body', 'Conclusion'] })
    expect(r.usedFallback).toBe(true)
    expect(r.sections.map((s) => s.heading)).toEqual(['Introduction', 'Body', 'Conclusion'])
  })
})

test.describe('extractAbstract — lenient, quality-report routed out', () => {
  const RAW = `<<<PAPER_ABSTRACT>>>
**Abstract (English).** This study examines how academic writing tools shape authorship, drawing on a mixed-methods design and reporting convergent evidence across two strands of data collection and analysis.

**Keywords:** authorship, writing tools, mixed methods.
<<<END_PAPER_ABSTRACT>>>

### Abstract Quality Report
| Metric | Value |
|--------|-------|
| Length | 45 |`

  const r = extractAbstract(RAW)

  test('keeps the abstract and keywords', () => {
    expect(r.valid).toBe(true)
    expect(r.content).toContain('Abstract (English)')
    expect(r.content).toContain('Keywords')
  })

  test('routes the quality report out of the paper content', () => {
    expect(r.content).not.toContain('Abstract Quality Report')
    expect(r.content).not.toContain('| Metric')
    expect(r.notes.length).toBeGreaterThan(0)
  })
})
