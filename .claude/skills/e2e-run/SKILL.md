---
name: e2e-run
description: Run the full Playwright E2E suite and show only failures with their error messages
---

Run the Playwright test suite for ars-web-studio and surface only what failed.

Steps:
1. Run: `cd "D:\OneDrive\AI_Brain_Fathul\projects\vibe-code-paper-generator\projects\ars-web-studio" && pnpm test 2>&1`
2. Parse the output:
   - If all tests pass: report "✅ All tests passed — X passed, Y skipped" and stop.
   - If any tests fail: for each failing test, show:
     - Test file and test name
     - The error message (first 10 lines only)
     - Whether a screenshot was saved (check `test-results/`)
3. End with a count: "X failed / Y passed / Z skipped"

Do NOT show passing test output. Keep the report tight — failures only.

After showing results, ask: "Would you like me to fix any of these failures?"
