import { defineConfig, devices } from '@playwright/test'

// P19 Playwright config for ARS Web Studio.
// Tests run against the dev server (reuseExistingServer=true so the user can
// leave `pnpm dev` running in another terminal and tests skip the startup wait).
// All test cases seed localStorage with deterministic states and mock the
// /api/generate + /api/coaching routes to avoid burning live Claude API quota.

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // localStorage is shared within a browser context; sequential is safer
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    // Tests are entirely DOM + localStorage — no need for persistent auth storage.
    storageState: undefined,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
