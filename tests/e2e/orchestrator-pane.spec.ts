// FP-2 — the orchestrator conversation pane (Agent Studio centre channel).
//
// These verify the FP-2 deliverables end-to-end:
//   • the chat is a PERSISTENT docked pane on wide screens (not a floating toggle);
//   • each pipeline state produces exactly ONE Decision-Dashboard checkpoint card;
//   • a card's action NAVIGATES to the page that owns the real control;
//   • BLOCKING gate cards route TO the gate, never past it (iron-rule guarantee);
//   • below lg the pane collapses to the P20 floating panel (mobile fallback).
//
// Like the rest of the suite, every test seeds deterministic localStorage and blocks the API,
// so no live Claude call is made.

import { test, expect } from '@playwright/test'
import {
  seedPaper,
  blockApi,
  paperAt_awaiting_section_review,
  paperAt_2_5_fail_awaiting,
  paperAt_4_5_pass_export_ready,
} from './helpers'

test.describe('FP-2 — orchestrator conversation pane', () => {
  test.beforeEach(async ({ page }) => {
    await blockApi(page)
  })

  test('docked pane + input render on a pipeline route (desktop)', async ({ page }) => {
    await seedPaper(page, paperAt_awaiting_section_review())
    await page.goto('/pipeline/write')

    await expect(page.locator('[data-testid="orchestrator-pane"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible()
    // It is docked, not the floating toggle.
    await expect(page.locator('[data-testid="chat-toggle"]')).toHaveCount(0)
  })

  test('CP-04 draft checkpoint card appears for awaiting-section-review', async ({ page }) => {
    await seedPaper(page, paperAt_awaiting_section_review())
    await page.goto('/pipeline/write')

    await expect(page.locator('[data-checkpoint="CP-04"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="checkpoint-open-CP-04"]')).toBeVisible()
    // Exactly one card for this checkpoint.
    await expect(page.locator('[data-checkpoint="CP-04"]')).toHaveCount(1)
  })

  test('CP-05 integrity card is BLOCKING and routes TO the gate, never past it', async ({ page }) => {
    await seedPaper(page, paperAt_2_5_fail_awaiting())
    await page.goto('/pipeline/integrity')

    const card = page.locator('[data-checkpoint="CP-05"]')
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText('BLOCKING GATE')

    // The only action takes the user to the gate page itself — not the post-gate review route.
    const open = page.locator('[data-testid="checkpoint-open-CP-05"]')
    await expect(open).toBeVisible()
    await open.click()
    await expect(page).toHaveURL(/\/pipeline\/integrity/)
    await expect(page).not.toHaveURL(/\/pipeline\/review/)
  })

  test('checkpoint action navigates across routes (export-ready → finalize)', async ({ page }) => {
    await seedPaper(page, paperAt_4_5_pass_export_ready())
    await page.goto('/pipeline/write')

    const open = page.locator('[data-testid="checkpoint-open-CP-12"]')
    await expect(open).toBeVisible({ timeout: 10_000 })
    await open.click()
    await expect(page).toHaveURL(/\/pipeline\/finalize/, { timeout: 10_000 })
  })

  test('collapses to the floating panel on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 })
    await seedPaper(page, paperAt_awaiting_section_review())
    await page.goto('/pipeline/write')

    // Floating toggle is shown; the docked pane is not.
    await expect(page.locator('[data-testid="chat-toggle"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="orchestrator-pane"]')).toHaveCount(0)
  })
})
