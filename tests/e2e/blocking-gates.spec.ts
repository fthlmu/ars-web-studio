// P19.2 — BLOCKING-gate enforcement tests.
//
// Iron rule #1: 2.5 FAIL → proceed-to-review absent from the DOM.
// Iron rule #3: 4.5 SUSPECTED → export-button absent from the DOM
//               AND no override/acknowledge/skip anywhere.
//
// Strategy: seed localStorage with a pre-built FAIL report + the matching
// 'awaiting-review' status so the page restores from storage (no agent call).
// Block /api/generate to catch any accidental call.

import { test, expect } from '@playwright/test'
import {
  seedPaper,
  blockApi,
  paperAt_2_5_fail_awaiting,
  paperAt_4_5_fail_awaiting,
} from './helpers'

test.describe('P19.2 — Blocking gate enforcement', () => {

  test.beforeEach(async ({ page }) => {
    // Block the API so any accidental agent call causes the test to notice
    // (the page will show an error UI, not silently pass).
    await blockApi(page)
  })

  // ── Stage 2.5 FAIL ────────────────────────────────────────────────────────

  test('2.5 FAIL: proceed-to-review is absent from DOM', async ({ page }) => {
    await seedPaper(page, paperAt_2_5_fail_awaiting())
    await page.goto('/pipeline/integrity')

    // Wait for the FAIL verdict callout to render (it has role="alert" + text "FAILED").
    await expect(page.locator('[role="alert"]:has-text("FAILED")')).toBeVisible({ timeout: 10_000 })

    // The iron rule: proceed-to-review must NOT be in the DOM on a FAIL verdict.
    await expect(page.locator('[data-testid="proceed-to-review"]')).toHaveCount(0)
  })

  test('2.5 FAIL: no override textarea on SUSPECTED mode', async ({ page }) => {
    // The bounded-override control (IntegrityOverride) must be absent when M1 is SUSPECTED.
    // It only renders for BOUNDED_OVERRIDE (exclusively M2/M4/M7 INSUFFICIENT_EVIDENCE).
    await seedPaper(page, paperAt_2_5_fail_awaiting())
    await page.goto('/pipeline/integrity')

    await expect(page.locator('[role="alert"]:has-text("FAILED")')).toBeVisible({ timeout: 10_000 })

    // No override textarea (IntegrityOverride renders a textarea for the reason).
    await expect(page.locator('textarea')).toHaveCount(0)
  })

  // ── Stage 4.5 FAIL (SUSPECTED) ────────────────────────────────────────────

  test('4.5 SUSPECTED: export-button is absent from DOM', async ({ page }) => {
    await seedPaper(page, paperAt_4_5_fail_awaiting())
    await page.goto('/pipeline/final-integrity')

    // Wait for the FAIL block to render.
    await expect(page.locator('[data-testid="rerun-final-integrity"]')).toBeVisible({ timeout: 10_000 })

    // Iron rule #3: export-button must be absent — no path to export on a 4.5 FAIL.
    await expect(page.locator('[data-testid="export-button"]')).toHaveCount(0)
  })

  test('4.5 SUSPECTED: no override, acknowledge, or skip anywhere', async ({ page }) => {
    await seedPaper(page, paperAt_4_5_fail_awaiting())
    await page.goto('/pipeline/final-integrity')

    await expect(page.locator('[data-testid="rerun-final-integrity"]')).toBeVisible({ timeout: 10_000 })

    // No acknowledge checkbox (like the 2.5 PASS_WITH_CONDITIONS checkbox).
    await expect(page.locator('[role="checkbox"]')).toHaveCount(0)
    // No override textarea.
    await expect(page.locator('textarea')).toHaveCount(0)
    // No skip button (text-based check for any "skip" affordance).
    await expect(page.locator('button:has-text("skip"), button:has-text("Skip"), button:has-text("bypass")')).toHaveCount(0)
  })

  test('4.5 FAIL: only re-run and return-to-editor are the forward controls', async ({ page }) => {
    await seedPaper(page, paperAt_4_5_fail_awaiting())
    await page.goto('/pipeline/final-integrity')

    await expect(page.locator('[data-testid="rerun-final-integrity"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="return-to-editor"]')).toBeVisible()

    // The only buttons on the FAIL screen are re-run and return-to-editor.
    // (The "Back to pipeline" outline button is also acceptable.)
    const exportBtn = page.locator('[data-testid="export-button"]')
    await expect(exportBtn).toHaveCount(0)
  })
})
