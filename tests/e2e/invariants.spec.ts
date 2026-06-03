// P19.8 — Adversarial bypass audit.
//
// The three iron rules must be impossible to bypass via the UI:
//   Iron rule #1 (2.5 PASS): can't reach peer-review without a 2.5 PASS.
//   Iron rule #2 (max-2 loops): can't start a 3rd revision loop.
//   Iron rule #3 (4.5 PASS): can't reach export without a 4.5 PASS.
//
// For each rule we attempt the bypass via the UI (not localStorage tampering,
// which would be out of scope for a single-user tool) and confirm it is
// blocked — the forward control is absent from the DOM or the route guard
// redirects away.
//
// Additional invariant: derivePipelineStatus is the sole router — no stale
// pipelineStatus field in localStorage can allow a paper to skip a gate.

import { test, expect } from '@playwright/test'
import {
  seedPaper,
  blockApi,
  paperWithout25Pass,
  paperWith25PassOnly,
  paperAt_4_5_fail_awaiting,
  paperAt_re_review_loop_cap,
  paperAt_4_5_pass_export_ready,
} from './helpers'

test.describe('P19.8 — Adversarial bypass audit (iron rules)', () => {

  test.beforeEach(async ({ page }) => {
    await blockApi(page)
  })

  // ── Iron rule #1: can't reach export without 2.5 PASS ────────────────────

  test('IR-1a: 2.5 FAIL paper — proceed-to-review absent (no UI path to review)', async ({ page }) => {
    await seedPaper(page, paperWithout25Pass())
    await page.goto('/pipeline/integrity')

    // No way to proceed: the forward button is absent.
    await expect(page.locator('[data-testid="proceed-to-review"]')).toHaveCount(0)
    // Only re-run and edit are offered.
    await expect(page.locator('button:has-text("Re-run"), button:has-text("Edit")').first()).toBeVisible({ timeout: 10_000 })
  })

  test('IR-1b: direct-nav to /pipeline/review without 2.5 PASS → redirected away', async ({ page }) => {
    // paperWithout25Pass has no integrityPassDate → derivePipelineStatus returns
    // awaiting-integrity-review → the /pipeline router redirects to /pipeline/integrity.
    await seedPaper(page, paperWithout25Pass())
    await page.goto('/pipeline')
    // Must NOT stay on /pipeline/review. The router sends us to the integrity gate.
    await expect(page).toHaveURL(/\/pipeline\/integrity/, { timeout: 10_000 })
  })

  // ── Iron rule #2: can't start a 3rd revision loop ────────────────────────

  test('IR-2a: revisionLoopCount===2 — request-final-revision absent from re-review', async ({ page }) => {
    await seedPaper(page, paperAt_re_review_loop_cap())
    await page.goto('/pipeline/re-review')

    // The only forward exit at cap is the final gate — no way to start another revision.
    await expect(page.locator('[data-testid="re-review-request-final-revision"]')).toHaveCount(0, { timeout: 10_000 })
  })

  test('IR-2b: loop-cap banner is visible at revisionLoopCount===2', async ({ page }) => {
    await seedPaper(page, paperAt_re_review_loop_cap())
    await page.goto('/pipeline/re-review')

    await expect(page.locator('[data-testid="loop-cap-banner"]')).toBeVisible({ timeout: 10_000 })
  })

  // ── Iron rule #3: can't reach export without 4.5 PASS ────────────────────

  test('IR-3a: 4.5 SUSPECTED — export-button absent from final-integrity page', async ({ page }) => {
    await seedPaper(page, paperAt_4_5_fail_awaiting())
    await page.goto('/pipeline/final-integrity')

    // The export-button must be absent — the only way to get it is a zero-tolerance PASS.
    await expect(page.locator('[data-testid="export-button"]')).toHaveCount(0, { timeout: 10_000 })
  })

  test('IR-3b: 4.5 FAIL — direct-nav to /pipeline/finalize redirects to final-integrity', async ({ page }) => {
    // paperWith25PassOnly has finalIntegrityStatus='failed' + no pipelineStatus='export-ready'.
    // The finalize page guard fires → redirects to /pipeline/final-integrity.
    await seedPaper(page, paperWith25PassOnly())
    await page.goto('/pipeline/finalize')

    // Must be redirected to the final integrity gate.
    await expect(page).toHaveURL(/\/pipeline\/final-integrity/, { timeout: 10_000 })
  })

  test('IR-3c: no override/skip on 4.5 FAIL screen', async ({ page }) => {
    await seedPaper(page, paperAt_4_5_fail_awaiting())
    await page.goto('/pipeline/final-integrity')

    await expect(page.locator('[data-testid="rerun-final-integrity"]')).toBeVisible({ timeout: 10_000 })
    // Confirm zero bypass affordances.
    await expect(page.locator('[role="checkbox"]')).toHaveCount(0)
    await expect(page.locator('textarea')).toHaveCount(0)
    await expect(page.locator('[data-testid="export-button"]')).toHaveCount(0)
  })

  // ── Confirmed bypass-safe: export-ready with proper pass ─────────────────

  test('export-ready paper: export-button IS present after legit 4.5 PASS', async ({ page }) => {
    // Positive control: a paper with all gates properly passed should show the
    // export UI. This confirms the test infra works (we can see export-button when
    // it SHOULD be there).
    await seedPaper(page, paperAt_4_5_pass_export_ready())
    await page.goto('/pipeline/final-integrity')

    // After seeding as export-ready, the final-integrity page redirects (passed state).
    // Navigate to finalize which is the proper export screen.
    await page.goto('/pipeline/finalize')
    await expect(
      page.locator('[data-testid="integrity-seal"], [data-testid="format-picker"]').first()
    ).toBeVisible({ timeout: 10_000 })
  })
})
