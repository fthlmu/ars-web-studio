import { test, expect } from '@playwright/test'

// P20 — Agent Chat Panel E2E tests, updated for FP-2.
// FP-2 promotes the chat from a floating-collapsed panel to a PERSISTENT docked pane on wide
// screens (the floating panel remains the mobile fallback). These verify the docked pane
// renders, accepts input, shows messages (mocked API), persists on refresh, and that the
// floating fallback still works on a narrow viewport.

test.describe('Agent Chat Panel', () => {
  test.beforeEach(async ({ page }) => {
    // Seed a paper in localStorage so the pipeline layout renders
    await page.goto('/')
    await page.evaluate(() => {
      const paper = {
        id: 'test-chat',
        config: {
          topic: 'Test Paper for Chat',
          paperType: 'imrad',
          citationFormat: 'IEEE',
          wordCount: 5000,
          language: 'English',
          authors: [],
          outputFormats: ['markdown'],
        },
        outline: '## Introduction\n## Methods\n## Results\n## Discussion',
        outlineApproved: true,
        sections: [
          { id: '0', heading: 'Introduction', level: 1, content: '<p>Intro content.</p>', wordCount: 50, status: 'done' },
        ],
        generationStatus: 'done',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z',
      }
      localStorage.setItem('ars-paper-state', JSON.stringify(paper))
    })
    await page.goto('/pipeline/write')
  })

  test('renders the docked orchestrator pane by default (desktop)', async ({ page }) => {
    await expect(page.getByTestId('orchestrator-pane')).toBeVisible()
    await expect(page.getByTestId('chat-input')).toBeVisible()
    // No floating toggle on desktop — the pane is always open.
    await expect(page.getByTestId('chat-toggle')).toHaveCount(0)
  })

  test('floating panel still works on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 })
    await page.goto('/pipeline/write')

    const toggle = page.getByTestId('chat-toggle')
    await expect(toggle).toBeVisible()
    await expect(page.getByTestId('chat-panel')).not.toBeVisible()
    await toggle.click()
    await expect(page.getByTestId('chat-panel')).toBeVisible()
  })

  test('accepts user input and shows message with mocked response', async ({ page }) => {
    // Mock the /api/chat endpoint
    await page.route('**/api/chat', async (route) => {
      const body = 'data: {"text":"Got it, I will make it more formal."}\n\ndata: [DONE]\n\n'
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body,
      })
    })

    const input = page.getByTestId('chat-input')
    await input.fill('Make the introduction more formal')
    await page.getByTestId('chat-send').click()

    // User message appears
    await expect(page.getByText('Make the introduction more formal')).toBeVisible()

    // Assistant response appears
    await expect(page.getByText('Got it, I will make it more formal.')).toBeVisible()
  })

  test('persists chat on refresh', async ({ page }) => {
    await page.route('**/api/chat', async (route) => {
      const body = 'data: {"text":"Understood."}\n\ndata: [DONE]\n\n'
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body,
      })
    })

    const input = page.getByTestId('chat-input')
    await input.fill('Add more references')
    await page.getByTestId('chat-send').click()
    await expect(page.getByText('Understood.')).toBeVisible()

    // Refresh the page — the docked pane persists and restores the thread from localStorage.
    await page.reload()

    await expect(page.getByTestId('orchestrator-pane')).toBeVisible()
    await expect(page.getByText('Add more references')).toBeVisible()
    await expect(page.getByText('Understood.')).toBeVisible()
  })
})
