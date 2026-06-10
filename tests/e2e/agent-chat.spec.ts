import { test, expect } from '@playwright/test'

// P20 — Agent Chat Panel E2E tests.
// Verifies the collapsible chat panel renders, opens, accepts input,
// displays messages (mocked API), and persists on refresh.

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

  test('shows floating chat button (collapsed by default)', async ({ page }) => {
    const toggle = page.getByTestId('chat-toggle')
    await expect(toggle).toBeVisible()
    // Panel should NOT be visible
    await expect(page.getByTestId('chat-panel')).not.toBeVisible()
  })

  test('opens chat panel on button click', async ({ page }) => {
    await page.getByTestId('chat-toggle').click()
    const panel = page.getByTestId('chat-panel')
    await expect(panel).toBeVisible()
  })

  test('accepts user input and shows message with mocked response', async ({ page }) => {
    await page.getByTestId('chat-toggle').click()

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
    await page.getByTestId('chat-toggle').click()

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

    // Refresh the page
    await page.reload()

    // Panel preference was saved as open
    const panel = page.getByTestId('chat-panel')
    await expect(panel).toBeVisible()

    // Messages should persist from localStorage
    await expect(page.getByText('Add more references')).toBeVisible()
    await expect(page.getByText('Understood.')).toBeVisible()
  })
})
