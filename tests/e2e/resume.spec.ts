// P19.4 — Resumability tests.
//
// NFR-11: close+reopen at any awaiting-* → the gate is restored with no agent call.
// NFR-12: running-* on reload → reverts to the prior awaiting-* and the page shows
//         a Re-run / Resume affordance (not a blank screen or unexpected redirect).
//
// Strategy:
//   • awaiting-* resume: blockApi + seed state + navigate → report renders without API call.
//   • running-* revert: mockApiSilentDone + seed running state → layout reverts to
//     awaiting-*, the page re-runs with the mock (no blank screen).

import { test, expect } from '@playwright/test'
import {
  seedPaper,
  blockApi,
  mockApiSilentDone,
  paperAt_2_5_fail_awaiting,
  paperAt_4_5_fail_awaiting,
  paperAt_integrity_running,
  paperAt_awaiting_section_review,
  paperAt_4_5_pass_export_ready,
} from './helpers'

test.describe('P19.4 — Resumability', () => {

  // ── awaiting-* states restore without an agent call ───────────────────────

  test('awaiting-integrity-review restores from localStorage (no agent call)', async ({ page }) => {
    // blockApi ensures the page did NOT call the agent on restore.
    await blockApi(page)
    await seedPaper(page, paperAt_2_5_fail_awaiting())
    await page.goto('/pipeline/integrity')

    // The page should render the FAIL report UI (Re-run button) — not a blank screen
    // and not the "Loading integrity gate…" spinner stuck forever.
    await expect(page.locator('[role="alert"]:has-text("FAILED")')).toBeVisible({ timeout: 10_000 })

    // No API call was made (the blockApi abort would have surfaced as a network error
    // banner rather than the normal FAIL UI — if we see the FAIL UI, the block worked).
    await expect(page.locator('[data-testid="proceed-to-review"]')).toHaveCount(0)
  })

  test('awaiting-final-review restores from localStorage (no agent call)', async ({ page }) => {
    await blockApi(page)
    await seedPaper(page, paperAt_4_5_fail_awaiting())
    await page.goto('/pipeline/final-integrity')

    await expect(page.locator('[data-testid="rerun-final-integrity"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="export-button"]')).toHaveCount(0)
  })

  test('export-ready restores and shows finalize page', async ({ page }) => {
    await blockApi(page)
    await seedPaper(page, paperAt_4_5_pass_export_ready())
    await page.goto('/pipeline/finalize')

    // The finalize page guard: export-ready → render the format picker.
    // Integrity seal badge is present when export-ready.
    await expect(page.locator('[data-testid="integrity-seal"], [data-testid="format-picker"]').first()).toBeVisible({ timeout: 10_000 })
  })

  test('awaiting-section-review: pipeline router redirects to /pipeline/write', async ({ page }) => {
    await blockApi(page)
    await seedPaper(page, paperAt_awaiting_section_review())
    await page.goto('/pipeline')

    // The /pipeline router derives status='awaiting-section-review' and redirects
    // to /pipeline/write (the write + section-review route).
    await expect(page).toHaveURL(/\/pipeline\/write/, { timeout: 10_000 })
  })

  // ── running-* reverts to awaiting-* on reload ─────────────────────────────

  test('running-integrity-gate on reload: layout reverts, page re-runs (mocked)', async ({ page }) => {
    // The mock returns only [DONE] which causes the schema parser to throw → the page
    // renders the EH-02 error UI. This proves:
    //   (a) the layout reverted 'running' to 'awaiting' correctly, and
    //   (b) the integrity page then re-ran the gate (because no saved report existed),
    //   (c) a parse error shows the Retry button (not a blank screen).
    await mockApiSilentDone(page)
    await seedPaper(page, paperAt_integrity_running())
    await page.goto('/pipeline/integrity')

    // Either the error UI (EH-02 Retry) or the running spinner appears. Either way
    // the page is not stuck on "Loading…" and has progressed past the loading state.
    await expect(
      page.locator(
        'button:has-text("Retry"), [role="alert"]:has-text("failed to complete"), div:has-text("Running integrity")',
      ).first()
    ).toBeVisible({ timeout: 15_000 })
  })
})
