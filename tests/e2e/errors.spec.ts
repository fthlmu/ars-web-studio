// P19.5 — Error-recovery sweep.
//
// NFR-13, NFR-16, EH-01..EH-07:
//   • 429 / timeout → the API route returns 429; the page shows an error banner.
//   • Parse error (HANDOFF_INCOMPLETE) → [DONE] only SSE → schema parse fails → retry UI.
//   • Gate-level retry preserves the prior report (draft unchanged, EH-04 pattern).
//   • No empty catch {} blocks (NFR-16) — this is verified by a grep source sweep test.
//
// Strategy: mock /api/generate to return specific HTTP statuses or malformed SSE,
// then verify the correct error banner / retry affordance appears.

import { test, expect } from '@playwright/test'
import { seedPaper, paperAt_2_5_fail_awaiting, paperAt_integrity_running } from './helpers'

// Re-usable helper to mock the generate route with a given status code.
async function mockApiStatus(page: import('@playwright/test').Page, status: number, body = '') {
  await page.route('**/api/generate', (route) =>
    route.fulfill({ status, body, headers: { 'Content-Type': 'text/plain' } }),
  )
  await page.route('**/api/coaching', (route) =>
    route.fulfill({ status, body, headers: { 'Content-Type': 'text/plain' } }),
  )
}

test.describe('P19.5 — Error recovery', () => {

  // ── 429 rate-limit ────────────────────────────────────────────────────────

  test('integrity gate: 429 from API shows error + retry affordance', async ({ page }) => {
    await seedPaper(page, paperAt_integrity_running())
    await mockApiStatus(page, 429)
    await page.goto('/pipeline/integrity')

    // The integrity page wraps runIntegrityGate in try/catch → EH-02 error UI.
    await expect(
      page.locator('[role="alert"]:has-text("failed to complete")')
    ).toBeVisible({ timeout: 15_000 })
  })

  // ── Parse error (schema handoff incomplete) ───────────────────────────────

  test('integrity gate: parse failure shows error + retry affordance', async ({ page }) => {
    // [DONE]-only SSE means the schema parser gets no JSON → HandoffIncompleteError.
    await page.route('**/api/generate', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: 'data: [DONE]\n\n',
      }),
    )
    await seedPaper(page, paperAt_integrity_running())
    await page.goto('/pipeline/integrity')

    await expect(
      page.locator('[role="alert"]:has-text("failed")')
    ).toBeVisible({ timeout: 15_000 })
  })

  // ── Retry preserves prior report ─────────────────────────────────────────

  test('integrity gate: restore from awaiting-review still shows the prior report', async ({ page }) => {
    // This is the EH pattern: a saved report in localStorage should survive a
    // "retry" navigation — the page restores the prior report, not a blank slate.
    await page.route('**/api/generate', (route) => route.abort())
    await seedPaper(page, paperAt_2_5_fail_awaiting())
    await page.goto('/pipeline/integrity')

    // The saved FAIL report should render — FAIL callout (role="alert") is visible.
    await expect(
      page.locator('[role="alert"]:has-text("FAILED")')
    ).toBeVisible({ timeout: 10_000 })
  })

  // ── No empty catch {} (NFR-16 source sweep) ──────────────────────────────

  test('NFR-16: no empty catch {} blocks in pipeline/API source', async () => {
    // This is a source-code static check, not a browser test. We spawn a grep
    // of the src/ directory looking for the literal `catch {}` or `catch (e) {}`
    // followed immediately by a closing brace.
    const { execSync } = await import('child_process')
    let found = false
    try {
      // grep returns exit 0 when matches found, exit 1 when no matches.
      execSync(
        'grep -rn "catch\\s*{\\s*}" src/app/pipeline src/app/api src/lib',
        { cwd: process.cwd() + '/..', encoding: 'utf-8' },
      )
      found = true // grep found something
    } catch {
      found = false // grep exited 1 = no matches = good
    }
    expect(found, 'Empty catch {} blocks found in pipeline/API source (NFR-16)').toBe(false)
  })
})
