// Shared test helpers for ARS Web Studio E2E tests (P19).
//
// Strategy: all tests seed localStorage with deterministic paper states and
// mock /api/generate + /api/coaching routes so no live Claude API calls are
// made. This makes tests CI-safe and avoids burning quota.

import type { Page } from '@playwright/test'

// ── SSE mock responses ────────────────────────────────────────────────────────

// The /api/generate and /api/coaching routes emit SSE lines ending in [DONE].
// Tests that trigger an API call (e.g. error-recovery tests) receive this mock.
export const DONE_SSE = 'data: [DONE]\n\n'

// A "safe null" SSE mock: emits [DONE] with no text events.
// Causes a parse error in schema parsers → triggers the EH-02/EH-05 error UI.
// Use this when the test goal is to verify the error banner appears.
export async function mockApiSilentDone(page: Page): Promise<void> {
  await page.route('**/api/generate', (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: DONE_SSE,
    }),
  )
  await page.route('**/api/coaching', (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: DONE_SSE,
    }),
  )
}

// Block all API calls — causes a network error if the page accidentally calls
// the API. Use when a test asserts no agent call occurs on resume.
export async function blockApi(page: Page): Promise<void> {
  await page.route('**/api/generate', (route) => route.abort())
  await page.route('**/api/coaching', (route) => route.abort())
}

// ── Paper state factories ─────────────────────────────────────────────────────

// Minimal valid PaperConfig for tests.
const BASE_CONFIG = {
  topic: 'Beamforming for 5G Phased Arrays',
  researchQuestion: 'How does hybrid beamforming improve SNR in mm-wave bands?',
  paperType: 'imrad',
  citationFormat: 'IEEE',
  outputFormats: ['markdown'],
  language: 'English',
  bilingualAbstract: false,
  wordCount: 5000,
  existingMaterials: {},
  authors: [
    {
      name: 'Fathul',
      affiliation: 'KAIST MALAB',
      creditRoles: ['Conceptualization', 'Writing – original draft'],
      isCorresponding: true,
    },
  ],
  fundingSources: [],
  mode: 'full',
}

// Two minimal sections — enough to pass the sections.length > 0 guard.
const BASE_SECTIONS = [
  {
    id: 's1',
    heading: 'Introduction',
    level: 1,
    content: '<p>Introduction to hybrid beamforming.</p>',
    wordCount: 100,
    status: 'done',
  },
  {
    id: 's2',
    heading: 'Methodology',
    level: 1,
    content: '<p>We use a 1024-element phased array.</p>',
    wordCount: 100,
    status: 'done',
  },
]

// A minimal 7-mode IntegrityReport where EVERY mode is CLEAR (→ 2.5/4.5 PASS).
export function makePassReport(stage: '2.5' | '4.5') {
  return {
    stage,
    verdict: 'PASS' as const,
    timestamp: '2026-06-03T00:00:00.000Z',
    citationIntegrityScore: 0.97,
    fabricationRiskScore: 0.03,
    overallIssues: { serious: 0, medium: 0, minor: 0 },
    modes: [
      { modeId: 'M1', verdict: 'CLEAR', score: 0.95, evidence: 'Run log present', modeName: 'Implementation bug passing AI self-review', detectionQuestion: '...' },
      { modeId: 'M2', verdict: 'CLEAR', score: 0.95, evidence: 'All citations verified', modeName: 'Hallucinated citation', detectionQuestion: '...' },
      { modeId: 'M3', verdict: 'CLEAR', score: 0.95, evidence: 'Results verified', modeName: 'Hallucinated experimental result', detectionQuestion: '...' },
      { modeId: 'M4', verdict: 'CLEAR', score: 0.95, evidence: 'No shortcuts', modeName: 'Shortcut reliance', detectionQuestion: '...' },
      { modeId: 'M5', verdict: 'CLEAR', score: 0.95, evidence: 'Findings verified', modeName: 'Bug reframed as novel insight', detectionQuestion: '...' },
      { modeId: 'M6', verdict: 'CLEAR', score: 0.95, evidence: 'Methodology sound', modeName: 'Fabricated methodology', detectionQuestion: '...' },
      { modeId: 'M7', verdict: 'CLEAR', score: 0.95, evidence: 'Framing correct', modeName: 'Frame lock', detectionQuestion: '...' },
    ],
  }
}

// A minimal 7-mode IntegrityReport where M1 is SUSPECTED (→ 2.5 FAIL / 4.5 FAIL).
export function makeFailReport(stage: '2.5' | '4.5') {
  return {
    stage,
    verdict: 'FAIL' as const,
    timestamp: '2026-06-03T00:00:00.000Z',
    citationIntegrityScore: 0.62,
    fabricationRiskScore: 0.85,
    overallIssues: { serious: 1, medium: 0, minor: 0 },
    modes: [
      { modeId: 'M1', verdict: 'SUSPECTED', score: 0.1, evidence: 'No run log found for the key experiment', modeName: 'Implementation bug passing AI self-review', detectionQuestion: '...' },
      { modeId: 'M2', verdict: 'CLEAR', score: 0.95, evidence: 'Citations verified', modeName: 'Hallucinated citation', detectionQuestion: '...' },
      { modeId: 'M3', verdict: 'CLEAR', score: 0.95, evidence: 'Results verified', modeName: 'Hallucinated experimental result', detectionQuestion: '...' },
      { modeId: 'M4', verdict: 'CLEAR', score: 0.95, evidence: 'No shortcuts', modeName: 'Shortcut reliance', detectionQuestion: '...' },
      { modeId: 'M5', verdict: 'CLEAR', score: 0.95, evidence: 'Findings verified', modeName: 'Bug reframed as novel insight', detectionQuestion: '...' },
      { modeId: 'M6', verdict: 'CLEAR', score: 0.95, evidence: 'Methodology sound', modeName: 'Fabricated methodology', detectionQuestion: '...' },
      { modeId: 'M7', verdict: 'CLEAR', score: 0.95, evidence: 'Framing correct', modeName: 'Frame lock', detectionQuestion: '...' },
    ],
  }
}

// A minimal ReviewerScoreSet for testing (5 reviewers, Minor revision decision).
const MOCK_REVIEW_REPORT = {
  sprintContractId: 'sc-test-001',
  reviewers: [
    { role: 'EIC', reviewerName: 'Editor-in-Chief', overallScore: 75, dimensions: { novelty: 70, methodology: 80, clarity: 75, contribution: 75, citation: 75 }, keyComments: ['Overall solid work.'], requiredChanges: ['Address clarity of methodology section.'], recommendation: 'Minor Revision' },
    { role: 'R1',  reviewerName: 'Referee 1',        overallScore: 70, dimensions: { novelty: 68, methodology: 72, clarity: 68, contribution: 70, citation: 72 }, keyComments: ['Good contribution.'],   requiredChanges: ['Add more citations.'],                             recommendation: 'Minor Revision' },
    { role: 'R2',  reviewerName: 'Referee 2',        overallScore: 72, dimensions: { novelty: 72, methodology: 70, clarity: 72, contribution: 73, citation: 73 }, keyComments: ['Acceptable work.'],    requiredChanges: ['Minor revision needed.'],                          recommendation: 'Minor Revision' },
    { role: 'R3',  reviewerName: 'Referee 3',        overallScore: 68, dimensions: { novelty: 65, methodology: 68, clarity: 68, contribution: 69, citation: 70 }, keyComments: ['Needs improvement.'],  requiredChanges: ['Expand evaluation.'],                              recommendation: 'Minor Revision' },
    { role: 'DA',  reviewerName: "Devil's Advocate", overallScore: 73, dimensions: { novelty: 70, methodology: 75, clarity: 73, contribution: 72, citation: 74 }, keyComments: ['No critical issues.'], requiredChanges: [],                                                  recommendation: 'Minor Revision' },
  ],
  consensus: 'CONSENSUS-3',
  editorialDecision: 'Minor Revision',
  confidenceScore: 73,
  daCritical: false,
}

// A minimal RevisionRoadmap for tests.
const MOCK_REVISION_PLAN = {
  mustFix: [{ id: 'rf1', text: 'Clarify the methodology section end-to-end.', status: 'resolved' }],
  shouldFix: [{ id: 'rf2', text: 'Add 3 more citations for beamforming literature.', status: 'pending' }],
  consider: [],
}

// A minimal PaperDraft (Schema 4) for tests.
const MOCK_REVISED_DRAFT = {
  sections: [
    { id: 's1', heading: 'Introduction',  content: '<p>Revised introduction with additional context.</p>', targetWords: 1000, materialGapCount: 0 },
    { id: 's2', heading: 'Methodology',   content: '<p>Revised methodology with detailed steps.</p>',    targetWords: 2000, materialGapCount: 0 },
  ],
  totalWords: 300,
}

// A coaching thread with 8 user messages (triggers the max-8-round cap).
function makeCoachingThread(rounds: number): Array<{ role: string; content: string }> {
  const msgs: Array<{ role: string; content: string }> = [
    { role: 'eic', content: 'Let us reflect on the reviewers\' comments together.' },
  ]
  for (let i = 1; i <= rounds; i++) {
    msgs.push({ role: 'user', content: `Round ${i}: My response to the EIC coaching.` })
    msgs.push({ role: 'eic',  content: `Good point. Let us explore this further.` })
  }
  return msgs
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

// Write a paper state to localStorage. Always navigates to '/' first to
// establish the origin before the evaluate call.
export async function seedPaper(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.goto('/')
  await page.evaluate((s) => {
    localStorage.setItem('ars-paper-state', JSON.stringify(s))
  }, state)
}

// ── Pre-built paper states ────────────────────────────────────────────────────
// Each function returns a complete PaperState for a specific pipeline position.

export function paperAt_2_5_fail_awaiting(): Record<string, unknown> {
  return {
    id: 'paper-test-2-5-fail',
    config: BASE_CONFIG,
    outline: 'Introduction\nMethodology\nResults\nConclusion',
    outlineApproved: true,
    sections: BASE_SECTIONS,
    generationStatus: 'done',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    integrityStatus: 'awaiting-review',
    integrityReports: [makeFailReport('2.5')],
  }
}

export function paperAt_2_5_pass(): Record<string, unknown> {
  const report = makePassReport('2.5')
  return {
    id: 'paper-test-2-5-pass',
    config: BASE_CONFIG,
    outline: 'Introduction\nMethodology\nResults\nConclusion',
    outlineApproved: true,
    sections: BASE_SECTIONS,
    generationStatus: 'done',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    integrityStatus: 'passed',
    integrityPassDate: '2026-06-03T01:00:00.000Z',
    integrityReports: [report],
    complianceHistory: [{ timestamp: '2026-06-03T01:00:00.000Z', action: 'integrity_pass', agentId: 'user' }],
  }
}

export function paperAt_4_5_fail_awaiting(): Record<string, unknown> {
  const report25 = makePassReport('2.5')
  const report45 = makeFailReport('4.5')
  return {
    id: 'paper-test-4-5-fail',
    config: BASE_CONFIG,
    outline: 'Introduction\nMethodology\nResults\nConclusion',
    outlineApproved: true,
    sections: BASE_SECTIONS,
    generationStatus: 'done',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    integrityStatus: 'passed',
    integrityPassDate: '2026-06-03T01:00:00.000Z',
    integrityReports: [report25, report45],
    complianceHistory: [{ timestamp: '2026-06-03T01:00:00.000Z', action: 'integrity_pass', agentId: 'user' }],
    reviewReport: MOCK_REVIEW_REPORT,
    reviewStatus: 'accepted',
    finalIntegrityStatus: 'awaiting-review',
    pipelineStatus: 'running-final-gate',
  }
}

export function paperAt_4_5_pass_export_ready(): Record<string, unknown> {
  const report25 = makePassReport('2.5')
  const report45 = makePassReport('4.5')
  return {
    id: 'paper-test-export-ready',
    config: BASE_CONFIG,
    outline: 'Introduction\nMethodology\nResults\nConclusion',
    outlineApproved: true,
    sections: BASE_SECTIONS,
    generationStatus: 'done',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    integrityStatus: 'passed',
    integrityPassDate: '2026-06-03T01:00:00.000Z',
    integrityReports: [report25, report45],
    complianceHistory: [
      { timestamp: '2026-06-03T01:00:00.000Z', action: 'integrity_pass', agentId: 'user' },
      { timestamp: '2026-06-03T02:00:00.000Z', action: 'integrity_pass', agentId: 'user' },
    ],
    reviewReport: MOCK_REVIEW_REPORT,
    reviewStatus: 'accepted',
    finalIntegrityStatus: 'passed',
    finalIntegrityPassDate: '2026-06-03T02:00:00.000Z',
    pipelineStatus: 'export-ready',
  }
}

export function paperAt_re_review_loop_cap(): Record<string, unknown> {
  const report25 = makePassReport('2.5')
  return {
    id: 'paper-test-loop-cap',
    config: BASE_CONFIG,
    outline: 'Introduction\nMethodology\nResults\nConclusion',
    outlineApproved: true,
    sections: BASE_SECTIONS,
    generationStatus: 'done',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    integrityStatus: 'passed',
    integrityPassDate: '2026-06-03T01:00:00.000Z',
    integrityReports: [report25],
    complianceHistory: [{ timestamp: '2026-06-03T01:00:00.000Z', action: 'integrity_pass', agentId: 'user' }],
    reviewReport: MOCK_REVIEW_REPORT,
    reviewStatus: 'revision',
    revisionLoopCount: 2,  // AT the cap → re-review-request-final-revision must be ABSENT
    revisedDraft: MOCK_REVISED_DRAFT,
    revisionStatus: 're-review',
    reReviewReport: {
      ...MOCK_REVIEW_REPORT,
      reviewers: MOCK_REVIEW_REPORT.reviewers.slice(0, 3), // EIC + R1 + R2 only (narrow re-review)
      rrMatrix: [],
      residualIssues: [],
    },
    reReviewStatus: 'awaiting-decision',
  }
}

export function paperAt_coaching_p12_cap(): Record<string, unknown> {
  const report25 = makePassReport('2.5')
  return {
    id: 'paper-test-coaching-p12-cap',
    config: BASE_CONFIG,
    outline: 'Introduction\nMethodology\nResults\nConclusion',
    outlineApproved: true,
    sections: BASE_SECTIONS,
    generationStatus: 'done',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    integrityStatus: 'passed',
    integrityPassDate: '2026-06-03T01:00:00.000Z',
    integrityReports: [report25],
    complianceHistory: [{ timestamp: '2026-06-03T01:00:00.000Z', action: 'integrity_pass', agentId: 'user' }],
    reviewReport: MOCK_REVIEW_REPORT,
    reviewStatus: 'revision',
    reviewDecision: 'Minor Revision', // coaching page guards on this field
    revisionRoadmap: MOCK_REVISION_PLAN,
    coachingThread: makeCoachingThread(8), // 8 user turns → at the max-8 cap
    coachingRoundCount: 8,
    coachingStatus: 'cap-reached',
  }
}

export function paperAt_coaching_residual_cap(): Record<string, unknown> {
  const report25 = makePassReport('2.5')
  return {
    id: 'paper-test-residual-cap',
    config: BASE_CONFIG,
    outline: 'Introduction\nMethodology\nResults\nConclusion',
    outlineApproved: true,
    sections: BASE_SECTIONS,
    generationStatus: 'done',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    integrityStatus: 'passed',
    integrityPassDate: '2026-06-03T01:00:00.000Z',
    integrityReports: [report25],
    complianceHistory: [{ timestamp: '2026-06-03T01:00:00.000Z', action: 'integrity_pass', agentId: 'user' }],
    reviewReport: MOCK_REVIEW_REPORT,
    reviewStatus: 'revision',
    revisionLoopCount: 1,
    revisedDraft: MOCK_REVISED_DRAFT,
    revisionStatus: 're-review',
    reReviewReport: {
      ...MOCK_REVIEW_REPORT,
      reviewers: MOCK_REVIEW_REPORT.reviewers.slice(0, 3),
      rrMatrix: [],
      residualIssues: [],
    },
    reReviewStatus: 'awaiting-decision',
    residualCoachingThread: makeCoachingThread(5), // 5 user turns → at the max-5 cap
    residualCoachingRoundCount: 5,
    residualCoachingStatus: 'cap-reached',
  }
}

export function paperAt_integrity_running(): Record<string, unknown> {
  return {
    id: 'paper-test-running',
    config: BASE_CONFIG,
    outline: 'Introduction\nMethodology\nResults\nConclusion',
    outlineApproved: true,
    sections: BASE_SECTIONS,
    generationStatus: 'done',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    integrityStatus: 'running', // was in-flight when the tab was closed
    // No integrityReports — the run was interrupted before it completed.
  }
}

export function paperAt_awaiting_section_review(): Record<string, unknown> {
  return {
    id: 'paper-test-section-review',
    config: BASE_CONFIG,
    outline: 'Introduction\nMethodology\nResults\nConclusion',
    outlineApproved: true,
    sections: BASE_SECTIONS,
    generationStatus: 'done',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    // No integrity-related fields → awaiting-section-review status
  }
}

// Paper without 2.5 PASS — used for the invariant/bypass audit.
// integrityStatus='awaiting-review' so the integrity page RESTORES the saved FAIL
// report instead of calling startGate() (which would require blockApi to intercept).
export function paperWithout25Pass(): Record<string, unknown> {
  return {
    id: 'paper-test-no-25-pass',
    config: BASE_CONFIG,
    outline: 'Introduction\nMethodology\nResults\nConclusion',
    outlineApproved: true,
    sections: BASE_SECTIONS,
    generationStatus: 'done',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    integrityStatus: 'awaiting-review',
    integrityReports: [makeFailReport('2.5')],
    // No integrityPassDate → 2.5 was never passed
  }
}

// Paper with 2.5 PASS but without 4.5 PASS — used for the invariant/bypass audit.
export function paperWith25PassOnly(): Record<string, unknown> {
  const report25 = makePassReport('2.5')
  return {
    id: 'paper-test-25-only',
    config: BASE_CONFIG,
    outline: 'Introduction\nMethodology\nResults\nConclusion',
    outlineApproved: true,
    sections: BASE_SECTIONS,
    generationStatus: 'done',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    integrityStatus: 'passed',
    integrityPassDate: '2026-06-03T01:00:00.000Z',
    integrityReports: [report25],
    complianceHistory: [{ timestamp: '2026-06-03T01:00:00.000Z', action: 'integrity_pass', agentId: 'user' }],
    reviewReport: MOCK_REVIEW_REPORT,
    reviewStatus: 'accepted',
    finalIntegrityStatus: 'failed', // 4.5 ran but FAILED
    pipelineStatus: 'running-final-gate',
  }
}
