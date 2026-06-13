'use client'

// Quick Tools — ars_tool_* localStorage helpers (QT1).
// All keys are namespaced with ars_tool_ to avoid collision with the pipeline's ars-* keys.
// These are the two fields worth persisting: paper text survives a reload so the user
// doesn't have to re-paste a long document; comments likewise.

const KEYS = {
  paper: 'ars_tool_paper',
  comments: 'ars_tool_comments',
} as const

export function saveImportedPaper(text: string): void {
  try {
    localStorage.setItem(KEYS.paper, text)
  } catch (e) {
    console.error('Failed to save imported paper:', e)
  }
}

export function loadImportedPaper(): string | null {
  try {
    return localStorage.getItem(KEYS.paper)
  } catch (e) {
    console.error('Failed to load imported paper:', e)
    return null
  }
}

export function clearImportedPaper(): void {
  try {
    localStorage.removeItem(KEYS.paper)
  } catch (e) {
    console.error('Failed to clear imported paper:', e)
  }
}

export function saveReviewerComments(text: string): void {
  try {
    localStorage.setItem(KEYS.comments, text)
  } catch (e) {
    console.error('Failed to save reviewer comments:', e)
  }
}

export function loadReviewerComments(): string | null {
  try {
    return localStorage.getItem(KEYS.comments)
  } catch (e) {
    console.error('Failed to load reviewer comments:', e)
    return null
  }
}

export function clearReviewerComments(): void {
  try {
    localStorage.removeItem(KEYS.comments)
  } catch (e) {
    console.error('Failed to clear reviewer comments:', e)
  }
}
