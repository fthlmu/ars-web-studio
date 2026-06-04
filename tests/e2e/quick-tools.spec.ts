// QT0–QT7: Playwright E2E coverage for the Quick Tools (/tools) flows.
//
// Covers:
//   QT0  — /tools catalog: heading, family sections, search filter, card nav
//   QT1  — unknown mode fallback; intake input gating (disabled Run until filled)
//   API  — 1-shot run (mocked SSE) → output panel → Copy/Download; 429 error path
//   QT2  — export-helper (paper-format-convert): client-side, no API mock needed
//   Launcher — navigate to /pipeline or /intake; fallback links present
//   QT7  — interactive runner: seed input, Start button gating, chat thread, composer
//
// Strategy: all /api/generate and /api/tools-chat calls are mocked — no live
// Claude quota is burned.  Exact label/id references come from the input
// component source (TopicInput id="topic-input", PaperInput id="paper-input",
// CommentsInput id="comments-input", option fields id="opt-<key>").

import { test, expect, type Page } from '@playwright/test'

// ── SSE mock helpers ───────────────────────────────────────────────────────

const MOCK_TEXT = 'Mock ARS agent output. Section 1: Introduction to beamforming.'

// Fulfill /api/generate with a single text chunk followed by [DONE].
async function mockGenerate(page: Page, text = MOCK_TEXT): Promise<void> {
  const body = `data: ${JSON.stringify({ text })}\n\ndata: [DONE]\n\n`
  await page.route('**/api/generate', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body,
    }),
  )
}

// Fulfill /api/generate with HTTP 429.
async function mockGenerate429(page: Page): Promise<void> {
  await page.route('**/api/generate', (route) =>
    route.fulfill({
      status: 429,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Rate limit exceeded' }),
    }),
  )
}

// Fulfill /api/tools-chat (interactive runner) with a single text chunk.
async function mockChat(page: Page, text = MOCK_TEXT): Promise<void> {
  const body = `data: ${JSON.stringify({ text })}\n\ndata: [DONE]\n\n`
  await page.route('**/api/tools-chat', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body,
    }),
  )
}

// ── QT0: Catalog page (/tools) ─────────────────────────────────────────────

test.describe('QT0 – /tools catalog', () => {

  test('renders heading and all 4 family section headings', async ({ page }) => {
    await page.goto('/tools')
    await expect(page.getByRole('heading', { name: 'Quick Tools', level: 1 })).toBeVisible()
    // Family headings are h2 (aria-labelledby on <section>); text matching is enough
    await expect(page.getByText('Deep Research', { exact: true })).toBeVisible()
    await expect(page.getByText('Academic Paper', { exact: true })).toBeVisible()
    await expect(page.getByText('Academic Paper Reviewer', { exact: true })).toBeVisible()
    await expect(page.getByText('Academic Pipeline', { exact: true })).toBeVisible()
  })

  test('search box filters modes by label', async ({ page }) => {
    await page.goto('/tools')
    await page.getByLabel('Search tools').fill('outline')
    // "Outline Only" card should remain visible
    await expect(page.getByText('Outline Only')).toBeVisible()
    // An unrelated mode card should be hidden
    await expect(page.getByText('Full Review (EIC + R1/R2/R3 + DA)')).not.toBeVisible()
  })

  test('search shows "No tools match" when nothing matches', async ({ page }) => {
    await page.goto('/tools')
    await page.getByLabel('Search tools').fill('xyzzy-no-such-tool-abcdef')
    await expect(page.getByText(/No tools match/)).toBeVisible()
  })

  test('mode card links to /tools/[modeId]', async ({ page }) => {
    await page.goto('/tools')
    // Click the "Outline Only" card (paper-outline mode)
    await page.getByText('Outline Only').first().click()
    await expect(page).toHaveURL(/\/tools\/paper-outline/)
  })

  test('homepage "Quick Tools" link navigates to /tools', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Quick Tools' }).click()
    await expect(page).toHaveURL(/\/tools$/)
    await expect(page.getByRole('heading', { name: 'Quick Tools' })).toBeVisible()
  })
})

// ── QT1: Unknown mode + intake input gating ────────────────────────────────

test.describe('QT1 – mode runner: unknown mode + input gating', () => {

  test('unknown modeId shows "Unknown tool" + back link to /tools', async ({ page }) => {
    await page.goto('/tools/nonexistent-mode-xyz-1234')
    await expect(page.getByText(/Unknown tool/)).toBeVisible()
    // Unknown-mode page renders "← Back to Quick Tools"
    await expect(page.getByRole('link', { name: '← Back to Quick Tools' })).toBeVisible()
  })

  test('topic intake renders TopicInput (id=topic-input)', async ({ page }) => {
    await page.goto('/tools/paper-outline')
    await expect(page.locator('#topic-input')).toBeVisible()
    await expect(page.getByLabel('Topic / prompt')).toBeVisible()
  })

  test('byo-paper intake renders PaperInput (id=paper-input)', async ({ page }) => {
    await page.goto('/tools/paper-abstract')
    await expect(page.locator('#paper-input')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Paper' })).toBeVisible()
  })

  test('comments intake renders CommentsInput (id=comments-input)', async ({ page }) => {
    await page.goto('/tools/paper-revision-coach')
    await expect(page.locator('#comments-input')).toBeVisible()
    await expect(page.getByLabel('Reviewer Comments')).toBeVisible()
  })

  test('Run button disabled until topic is filled (paper-outline)', async ({ page }) => {
    await page.goto('/tools/paper-outline')
    const runButton = page.getByRole('button', { name: 'Run →' })
    await expect(runButton).toBeDisabled()
    await page.getByLabel('Topic / prompt').fill('Beamforming for 5G phased arrays')
    await expect(runButton).toBeEnabled()
  })

  test('Run button disabled until ALL required inputs present (paper-revision)', async ({ page }) => {
    // paper-revision requires intake: ['byo-paper', 'comments']
    await page.goto('/tools/paper-revision')
    const runButton = page.getByRole('button', { name: 'Run →' })
    await expect(runButton).toBeDisabled()
    // Fill paper only → still disabled
    await page.locator('#paper-input').fill('Some paper text.')
    await expect(runButton).toBeDisabled()
    // Fill comments too → enabled
    await page.getByLabel('Reviewer Comments').fill('R1: Please expand methodology.')
    await expect(runButton).toBeEnabled()
  })

  test('required option field also gates Run (paper-disclosure)', async ({ page }) => {
    // paper-disclosure intake: ['byo-paper'] + optionFields: [{key:'venue', required:true}]
    await page.goto('/tools/paper-disclosure')
    const runButton = page.getByRole('button', { name: 'Run →' })
    await expect(runButton).toBeDisabled()
    await page.locator('#paper-input').fill('My paper text.')
    // Still disabled — venue field not yet filled
    await expect(runButton).toBeDisabled()
    // Fill the required venue option
    await page.locator('#opt-venue').fill('IEEE Access')
    await expect(runButton).toBeEnabled()
  })

  test('skill-dir mode shows approximation warning when mode.approximation=true', async ({ page }) => {
    // research-quick has approximation: true
    await page.goto('/tools/research-quick')
    await expect(page.getByText(/Lightweight approximation/)).toBeVisible()
  })

  test('skill-dir mode shows long-prompt cloud-model hint', async ({ page }) => {
    // All skill-dir modes (promptSource.kind === 'skill-dir') show the amber hint
    await page.goto('/tools/research-quick')
    await expect(page.getByText(/long SKILL prompt.*cloud model/i)).toBeVisible()
  })
})

// ── API modes — 1-shot run flow (mocked SSE) ─────────────────────────────

test.describe('API modes – 1-shot run → streaming → done', () => {

  test('paper-outline (bundled-agent, topic): Run → output → Copy + Download .md', async ({ page }) => {
    await mockGenerate(page)
    await page.goto('/tools/paper-outline')
    await page.getByLabel('Topic / prompt').fill('Beamforming for 5G phased arrays')
    await page.getByRole('button', { name: 'Run →' }).click()
    // Output panel: mocked text appears in the aria-live region
    await expect(page.locator('[aria-live="polite"]').first()).toContainText(MOCK_TEXT, { timeout: 10_000 })
    // Done state: Copy and Download .md buttons
    await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /Download .md/ })).toBeVisible()
  })

  test('paper-abstract (bundled-agent, byo-paper): Run → output appears', async ({ page }) => {
    await mockGenerate(page)
    await page.goto('/tools/paper-abstract')
    await page.locator('#paper-input').fill('# Introduction\nThis paper studies beamforming.')
    await page.getByRole('button', { name: 'Run →' }).click()
    await expect(page.locator('[aria-live="polite"]').first()).toContainText(MOCK_TEXT, { timeout: 10_000 })
  })

  test('paper-citation-check (bundled-agent, byo-paper): Run → output appears', async ({ page }) => {
    await mockGenerate(page)
    await page.goto('/tools/paper-citation-check')
    await page.locator('#paper-input').fill('Sample paper with [Smith 2023] citation.')
    await page.getByRole('button', { name: 'Run →' }).click()
    await expect(page.locator('[aria-live="polite"]').first()).toContainText(MOCK_TEXT, { timeout: 10_000 })
  })

  test('paper-revision-coach (bundled-agent, comments): Run → output appears', async ({ page }) => {
    await mockGenerate(page)
    await page.goto('/tools/paper-revision-coach')
    await page.getByLabel('Reviewer Comments').fill('R1: Expand the methodology section in detail.')
    await page.getByRole('button', { name: 'Run →' }).click()
    await expect(page.locator('[aria-live="polite"]').first()).toContainText(MOCK_TEXT, { timeout: 10_000 })
  })

  test('research-quick (skill-dir, topic): Run → output appears', async ({ page }) => {
    await mockGenerate(page)
    await page.goto('/tools/research-quick')
    await page.getByLabel('Topic / prompt').fill('RF beamforming antenna arrays')
    await page.getByRole('button', { name: 'Run →' }).click()
    await expect(page.locator('[aria-live="polite"]').first()).toContainText(MOCK_TEXT, { timeout: 10_000 })
  })

  test('research-fact-check (bundled-agent, claims): Run → output appears', async ({ page }) => {
    await mockGenerate(page)
    await page.goto('/tools/research-fact-check')
    await page.getByLabel('Claims to Verify').fill('Claim: 5G uses mmWave frequencies above 24 GHz.')
    await page.getByRole('button', { name: 'Run →' }).click()
    await expect(page.locator('[aria-live="polite"]').first()).toContainText(MOCK_TEXT, { timeout: 10_000 })
  })

  test('paper-disclosure (skill-dir, byo-paper + venue option): Run → output', async ({ page }) => {
    await mockGenerate(page)
    await page.goto('/tools/paper-disclosure')
    await page.locator('#paper-input').fill('This paper investigates beamforming methods.')
    await page.locator('#opt-venue').fill('IEEE Access')
    await page.getByRole('button', { name: 'Run →' }).click()
    await expect(page.locator('[aria-live="polite"]').first()).toContainText(MOCK_TEXT, { timeout: 10_000 })
  })

  test('review-quick (skill-dir, byo-paper): Run → output appears', async ({ page }) => {
    await mockGenerate(page)
    await page.goto('/tools/review-quick')
    await page.locator('#paper-input').fill('A paper about mm-wave phased arrays for 5G base stations.')
    await page.getByRole('button', { name: 'Run →' }).click()
    await expect(page.locator('[aria-live="polite"]').first()).toContainText(MOCK_TEXT, { timeout: 10_000 })
  })
})

// ── API modes — error handling ────────────────────────────────────────────

test.describe('API modes – error states', () => {

  test('429 from /api/generate shows "Failed" banner + Try again button', async ({ page }) => {
    await mockGenerate429(page)
    await page.goto('/tools/paper-outline')
    await page.getByLabel('Topic / prompt').fill('Topic for rate-limit test')
    await page.getByRole('button', { name: 'Run →' }).click()
    // Error UI: "Failed" heading and "Try again" reset button
    await expect(page.getByText('Failed')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  test('"Try again" resets to idle — Run → button re-enabled', async ({ page }) => {
    await mockGenerate429(page)
    await page.goto('/tools/paper-outline')
    await page.getByLabel('Topic / prompt').fill('Topic')
    await page.getByRole('button', { name: 'Run →' }).click()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible({ timeout: 10_000 })
    // Click Try again → back to idle state
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('button', { name: 'Run →' })).toBeEnabled({ timeout: 5_000 })
  })
})

// ── QT2: Export-helper (paper-format-convert) — client-side, no API mock ──

test.describe('QT2 – export-helper (paper-format-convert)', () => {

  test('renders Format Convert heading and client-side hint', async ({ page }) => {
    await page.goto('/tools/paper-format-convert')
    await expect(page.getByRole('heading', { name: 'Format Convert' })).toBeVisible()
    // The "client-side conversion" note explains no API is needed
    await expect(page.getByText(/Client-side conversion/)).toBeVisible()
  })

  test('Convert button disabled until paper + target format both filled', async ({ page }) => {
    await page.goto('/tools/paper-format-convert')
    const convertButton = page.getByRole('button', { name: 'Convert →' })
    await expect(convertButton).toBeDisabled()
    // Fill paper only → still disabled
    await page.locator('#paper-input').fill('# My Paper\n\nSection content.')
    await expect(convertButton).toBeDisabled()
    // Fill target format → enabled
    await page.locator('#opt-targetFormat').fill('markdown')
    await expect(convertButton).toBeEnabled()
  })

  test('convert to markdown produces preview + Copy and Download buttons', async ({ page }) => {
    await page.goto('/tools/paper-format-convert')
    await page.locator('#paper-input').fill('# My Paper\n\nThis section describes our method.')
    await page.locator('#opt-targetFormat').fill('markdown')
    await page.getByRole('button', { name: 'Convert →' }).click()
    // Preview pre element with aria-label="Converted output"
    await expect(page.getByLabel('Converted output')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible()
  })
})

// ── Launcher modes — navigate away ────────────────────────────────────────

test.describe('Launcher modes – navigation', () => {

  test('research-full shows "Open in Pipeline →" button', async ({ page }) => {
    await page.goto('/tools/research-full')
    await expect(page.getByRole('button', { name: 'Open in Pipeline →' })).toBeVisible()
  })

  test('research-full "Open in Pipeline →" navigates away from /tools', async ({ page }) => {
    await page.goto('/tools/research-full')
    await page.getByRole('button', { name: 'Open in Pipeline →' }).click()
    // Should navigate to /pipeline (or /intake if pipeline redirects without state)
    await expect(page).toHaveURL(/\/(pipeline|intake)/, { timeout: 8_000 })
  })

  test('paper-full "Open in Pipeline →" navigates to /intake', async ({ page }) => {
    await page.goto('/tools/paper-full')
    await page.getByRole('button', { name: 'Open in Pipeline →' }).click()
    await expect(page).toHaveURL(/\/intake/, { timeout: 8_000 })
  })

  test('pipeline-mid-entry-2-5 shows fallback link to research-quality-review', async ({ page }) => {
    await page.goto('/tools/pipeline-mid-entry-2-5')
    const fallbackLink = page.getByRole('link', { name: 'Use the nearest standalone tool instead →' })
    await expect(fallbackLink).toBeVisible()
    await expect(fallbackLink).toHaveAttribute('href', '/tools/research-quality-review')
  })

  test('pipeline-mid-entry-4 fallback link points to paper-revision', async ({ page }) => {
    await page.goto('/tools/pipeline-mid-entry-4')
    const fallbackLink = page.getByRole('link', { name: 'Use the nearest standalone tool instead →' })
    await expect(fallbackLink).toBeVisible()
    await expect(fallbackLink).toHaveAttribute('href', '/tools/paper-revision')
  })
})

// ── QT7: Interactive runner (delivery: 'interactive') ─────────────────────

test.describe('QT7 – interactive runner', () => {

  test('research-socratic: "Start conversation →" renders and is disabled without topic', async ({ page }) => {
    await page.goto('/tools/research-socratic')
    const startButton = page.getByRole('button', { name: 'Start conversation →' })
    await expect(startButton).toBeVisible()
    await expect(startButton).toBeDisabled()
  })

  test('research-socratic: Start button enabled once topic is filled', async ({ page }) => {
    await page.goto('/tools/research-socratic')
    await page.getByLabel('Topic / prompt').fill('Phased-array beamforming for 5G')
    await expect(page.getByRole('button', { name: 'Start conversation →' })).toBeEnabled()
  })

  test('research-socratic: start conversation → assistant bubble + follow-up composer', async ({ page }) => {
    await mockChat(page)
    await page.goto('/tools/research-socratic')
    await page.getByLabel('Topic / prompt').fill('Phased-array beamforming for 5G')
    await page.getByRole('button', { name: 'Start conversation →' }).click()
    // Assistant bubble appears with mocked text
    await expect(page.getByText('Assistant')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(MOCK_TEXT)).toBeVisible({ timeout: 10_000 })
    // Follow-up composer is rendered
    await expect(page.getByLabel('Your reply')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send →' })).toBeVisible()
  })

  test('research-socratic: "Send →" disabled when reply textarea is empty', async ({ page }) => {
    await mockChat(page)
    await page.goto('/tools/research-socratic')
    await page.getByLabel('Topic / prompt').fill('Phased-array beamforming for 5G')
    await page.getByRole('button', { name: 'Start conversation →' }).click()
    await expect(page.getByRole('button', { name: 'Send →' })).toBeVisible({ timeout: 10_000 })
    // Send → disabled when reply is empty
    await expect(page.getByRole('button', { name: 'Send →' })).toBeDisabled()
    // Type a reply → Send → becomes enabled
    await page.getByLabel('Your reply').fill('Tell me more about array gain.')
    await expect(page.getByRole('button', { name: 'Send →' })).toBeEnabled()
  })

  test('paper-plan: topic seed + Start conversation → renders', async ({ page }) => {
    // paper-plan also delivery: 'interactive', intake: ['topic']
    await page.goto('/tools/paper-plan')
    await expect(page.getByRole('button', { name: 'Start conversation →' })).toBeVisible()
    await expect(page.getByLabel('Topic / prompt')).toBeVisible()
  })

  test('review-guided: byo-paper seed + Start conversation → renders', async ({ page }) => {
    // review-guided delivery: 'interactive', intake: ['byo-paper']
    await page.goto('/tools/review-guided')
    await expect(page.getByRole('button', { name: 'Start conversation →' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Paper' })).toBeVisible()
    // Disabled without paper
    await expect(page.getByRole('button', { name: 'Start conversation →' })).toBeDisabled()
  })
})
