// FP-1 — Channel-separation E2E.
//
// Goal (the FP-1 Verify): only clean paper prose is ever persisted to Section.content.
// We mock /api/generate to return a HEAVILY polluted draft_writer reply (preamble,
// delimiter markers, ref/anchor citation markers, a word-count tracking block, a Draft
// Metadata table, a Claim Intent Manifest, a [PRE-COMMITMENT-ACKNOWLEDGED] tag, and a
// sign-off) and assert that what lands in localStorage is clean prose with none of it.
//
// Two paths are covered, because FP-1 requires they behave identically:
//   1. fresh generation (runSectionLoop)
//   2. retry of an existing section (retrySection, via the Draft-Review "Regenerate")

import { test, expect, type Page } from '@playwright/test'

const ISO = '2026-06-12T00:00:00.000Z'

const FP1_CONFIG = {
  topic: 'Channel separation test',
  researchQuestion: 'Does the paper channel stay clean?',
  paperType: 'imrad',
  citationFormat: 'IEEE',
  outputFormats: ['markdown'],
  language: 'English',
  bilingualAbstract: false,
  wordCount: 2000,
  existingMaterials: {},
  authors: [{ name: 'Test', affiliation: 'X', creditRoles: ['Writing – original draft'], isCorresponding: true }],
  fundingSources: [],
  mode: 'full',
}

// A polluted draft_writer reply for a given heading: clean section inside the markers,
// every flavour of channel-bleed telemetry outside (and one ref/anchor pair inside).
function pollutedReply(heading: string): string {
  return [
    `Here is the ${heading} section you requested:`,
    ``,
    `<<<PAPER_SECTION>>>`,
    `## ${heading}`,
    ``,
    `SENTINEL_PROSE_OK. This section presents clean academic prose for ${heading} (Lee, 2025) <!--ref:lee2025--><!--anchor:page:3-->. The argument develops across several sentences so that the validation gate, which requires a realistic minimum length, is comfortably satisfied by the content the model returns here for the ${heading} section of the paper. [MATERIAL GAP: pilot data not supplied]`,
    `<<<END_PAPER_SECTION>>>`,
    ``,
    `Section: ${heading}`,
    `Target: 100 words`,
    `Actual: 60 words`,
    `Running Total: 60 / 2000 words`,
    ``,
    `### Draft Metadata`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Word Count | 60 |`,
    ``,
    '```json',
    `{ "manifest_id": "M-x", "emitted_by": "draft_writer_agent", "claims": [] }`,
    '```',
    ``,
    `[PRE-COMMITMENT-ACKNOWLEDGED]`,
    ``,
    `Let me know if you would like changes.`,
  ].join('\n')
}

// Route /api/generate → a polluted SSE response whose heading matches the requested section.
async function mockPollutedGenerate(page: Page): Promise<void> {
  await page.route('**/api/generate', (route) => {
    const body = route.request().postData() ?? ''
    let heading = 'Section'
    try {
      const parsed = JSON.parse(body) as { userMessage?: string }
      const m = parsed.userMessage?.match(/Write the section titled:\s*\*\*"([^"]+)"\*\*/)
      if (m) heading = m[1]
    } catch {
      // fall back to the generic heading
    }
    const sse = `data: ${JSON.stringify({ text: pollutedReply(heading) })}\n\ndata: [DONE]\n\n`
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sse,
    })
  })
}

async function readSections(page: Page): Promise<Array<{ heading: string; content: string; status: string }>> {
  const raw = await page.evaluate(() => localStorage.getItem('ars-paper-state'))
  const st = raw ? JSON.parse(raw) : null
  return (st?.sections ?? []) as Array<{ heading: string; content: string; status: string }>
}

// The core assertion: a persisted section is clean prose and nothing else.
function assertClean(content: string, heading: string): void {
  expect(content).toContain(`## ${heading}`)
  expect(content).toContain('SENTINEL_PROSE_OK')
  expect(content).toContain('[MATERIAL GAP')          // real material gap is preserved
  expect(content).not.toContain('PAPER_SECTION')      // delimiter
  expect(content).not.toContain('<!--')               // ref/anchor/html comments
  expect(content).not.toContain('lee2025')            // ref slug routed out
  expect(content).not.toContain('Draft Metadata')
  expect(content).not.toContain('| Metric')           // no pipe-table artifact
  expect(content).not.toContain('Running Total')      // no word-count block
  expect(content).not.toContain('manifest_id')
  expect(content).not.toContain('PRE-COMMITMENT')
  expect(content).not.toContain('Here is the')        // no preamble
  expect(content).not.toContain('Let me know')        // no sign-off
}

test.describe('FP-1 — channel separation', () => {

  test('fresh generation persists only clean prose (runSectionLoop)', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(([s, iso]) => {
      localStorage.setItem('ars-paper-state', JSON.stringify({
        id: 'paper-fp1-gen',
        config: s,
        outline: '## Introduction\n## Methodology',
        outlineApproved: true,
        outlineSections: [
          { heading: 'Introduction', targetWords: 100 },
          { heading: 'Methodology', targetWords: 100 },
        ],
        sections: [
          { id: '0', heading: 'Introduction', level: 1, content: '', wordCount: 0, status: 'pending' },
          { id: '1', heading: 'Methodology', level: 1, content: '', wordCount: 0, status: 'pending' },
        ],
        generationStatus: 'running',
        createdAt: iso,
        updatedAt: iso,
      }))
    }, [FP1_CONFIG, ISO] as const)

    await mockPollutedGenerate(page)
    await page.goto('/pipeline/write')

    // Wait until both sections finish generating.
    await expect.poll(async () => {
      const secs = await readSections(page)
      return secs.length > 0 && secs.every((s) => s.status === 'done')
    }, { timeout: 30_000 }).toBe(true)

    const secs = await readSections(page)
    assertClean(secs[0].content, 'Introduction')
    assertClean(secs[1].content, 'Methodology')
  })

  test('retry of a section is just as clean (retrySection via Draft Review)', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(([s, iso]) => {
      localStorage.setItem('ars-paper-state', JSON.stringify({
        id: 'paper-fp1-retry',
        config: s,
        outline: '## Introduction\n## Methodology',
        outlineApproved: true,
        outlineSections: [
          { heading: 'Introduction', targetWords: 100 },
          { heading: 'Methodology', targetWords: 100 },
        ],
        sections: [
          { id: '0', heading: 'Introduction', level: 1, content: '## Introduction\n\nExisting clean intro.', wordCount: 40, status: 'done' },
          // Simulate a pre-FP-1 polluted section that the user wants to regenerate.
          { id: '1', heading: 'Methodology', level: 1, content: '## Methodology\n\nOld text. Running Total: 5 / 2000 words', wordCount: 40, status: 'done' },
        ],
        generationStatus: 'done',
        createdAt: iso,
        updatedAt: iso,
      }))
    }, [FP1_CONFIG, ISO] as const)

    await mockPollutedGenerate(page)
    await page.goto('/pipeline/write')

    // The Draft-Review gate renders in the done state. Regenerate the Methodology row.
    const methRow = page.locator('li', { hasText: 'Methodology' })
    await expect(methRow.getByRole('button', { name: 'Regenerate' })).toBeVisible({ timeout: 15_000 })
    await methRow.getByRole('button', { name: 'Regenerate' }).click()

    // Wait until the regenerated Methodology content carries the fresh sentinel.
    await expect.poll(async () => {
      const secs = await readSections(page)
      return secs.find((s) => s.heading === 'Methodology')?.content ?? ''
    }, { timeout: 30_000 }).toContain('SENTINEL_PROSE_OK')

    const secs = await readSections(page)
    assertClean(secs.find((s) => s.heading === 'Methodology')!.content, 'Methodology')
  })
})
