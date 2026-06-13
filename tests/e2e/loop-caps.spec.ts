// P19.3 — Loop-cap enforcement tests.
//
// Iron rule #2: revisionLoopCount === 2 → "Request Final Revision" ABSENT from DOM.
// FR-28: coaching input absent at round 8 → coaching-proceed present (not auto-advance).
// FR-36: residual coaching input absent at round 5.
//
// Strategy: seed localStorage with the loop counter at the cap, navigate to the
// relevant page, and assert absence/presence of the expected controls.

import { test, expect } from '@playwright/test'
import {
  seedPaper,
  blockApi,
  paperAt_re_review_loop_cap,
  paperAt_coaching_p12_cap,
  paperAt_coaching_residual_cap,
} from './helpers'

test.describe('P19.3 — Loop-cap enforcement', () => {

  test.beforeEach(async ({ page }) => {
    await blockApi(page)
  })

  // ── Revision loop cap (max 2) ────────────────────────────────────────────

  test('revisionLoopCount===2: re-review-request-final-revision is absent', async ({ page }) => {
    await seedPaper(page, paperAt_re_review_loop_cap())
    await page.goto('/pipeline/re-review')

    // Wait for the awaiting-decision panel (either the panel or the loop-cap banner).
    await expect(
      page.locator('[data-testid="loop-cap-banner"], [data-testid="re-review-proceed-final-gate"]').first()
    ).toBeVisible({ timeout: 10_000 })

    // The "Request Final Revision" button must be absent from the DOM at the cap.
    await expect(page.locator('[data-testid="re-review-request-final-revision"]')).toHaveCount(0)
  })

  test('revisionLoopCount===2: loop-cap-banner is visible', async ({ page }) => {
    await seedPaper(page, paperAt_re_review_loop_cap())
    await page.goto('/pipeline/re-review')

    await expect(page.locator('[data-testid="loop-cap-banner"]')).toBeVisible({ timeout: 10_000 })
  })

  test('revisionLoopCount===2: only proceed-final-gate is the forward control', async ({ page }) => {
    await seedPaper(page, paperAt_re_review_loop_cap())
    await page.goto('/pipeline/re-review')

    await expect(page.locator('[data-testid="re-review-proceed-final-gate"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="re-review-request-final-revision"]')).toHaveCount(0)
  })

  // ── Coaching round cap (max 8, P12) ──────────────────────────────────────

  test('coaching at round 8: reply input is absent from DOM', async ({ page }) => {
    await seedPaper(page, paperAt_coaching_p12_cap())
    await page.goto('/pipeline/coaching')

    // Wait for the coaching thread to restore.
    await expect(page.locator('[data-testid="coaching-proceed"]')).toBeVisible({ timeout: 10_000 })

    // The reply input (Textarea) must be ABSENT — the bounded-loop invariant.
    await expect(page.locator('[data-testid="coaching-reply-input"]')).toHaveCount(0)
  })

  test('coaching at round 8: coaching-proceed button is present (no auto-advance)', async ({ page }) => {
    await seedPaper(page, paperAt_coaching_p12_cap())
    await page.goto('/pipeline/coaching')

    // The manual proceed button must exist — nothing auto-advances (FR-28).
    await expect(page.locator('[data-testid="coaching-proceed"]')).toBeVisible({ timeout: 10_000 })
  })

  // ── Residual coaching round cap (max 5, P14) ─────────────────────────────

  test('residual coaching at round 5: reply input is absent from DOM', async ({ page }) => {
    await seedPaper(page, paperAt_coaching_residual_cap())
    await page.goto('/pipeline/coaching?stage=re-review')

    // Wait for the cap state to render (the proceed button appears at cap).
    await expect(page.locator('[data-testid="coaching-proceed"]')).toBeVisible({ timeout: 10_000 })

    // Reply input must be absent at the max-5-round residual cap.
    await expect(page.locator('[data-testid="coaching-reply-input"]')).toHaveCount(0)
  })
})
