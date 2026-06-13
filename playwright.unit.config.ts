import { defineConfig } from '@playwright/test'

// FP-1 unit-test config — fast, pure-function tests for the paper-artifact channel
// (paper-extract / sanitizer v2 / validation gate).
//
// These specs import library modules and assert directly; they never use the `page`
// fixture, so no browser is launched. There is intentionally NO `webServer` here, so the
// unit suite runs without booting the Next dev server. Run with: `pnpm test:unit`.
//
// The full E2E suite still lives under tests/e2e and is driven by playwright.config.ts.
export default defineConfig({
  testDir: './tests/unit',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  projects: [{ name: 'unit' }],
})
