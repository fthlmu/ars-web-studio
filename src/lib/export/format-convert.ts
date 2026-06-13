// QT2: Raw-text format conversion for the format-convert Quick Tool.
//
// The P6 helpers (buildLatex, buildTypstDocument) take a PaperState, but the
// format-convert tool receives a raw pasted document — no PaperState in scope.
// Solution: synthesize a minimal PaperState from the raw text, then delegate
// to the existing P6 helpers. Zero code duplication; same rendering logic.

import type { PaperState, Section } from '@/lib/types'
import { buildLatex } from './latex'

function syntheticState(rawText: string): PaperState {
  // Try to pull a title from the first H1 heading.
  const titleMatch = rawText.match(/^#\s+(.+)$/m)
  const title = titleMatch?.[1]?.trim() ?? 'Document'
  const body = titleMatch ? rawText.replace(titleMatch[0], '').trim() : rawText.trim()

  const section: Section = {
    id: 'main',
    heading: title,
    level: 1,
    // Raw markdown — content.ts's contentToMarkdown() detects non-HTML and
    // returns it unchanged, so the P6 LaTeX/Typst converters work correctly.
    content: body,
    wordCount: body.split(/\s+/).filter(Boolean).length,
    status: 'done',
  }

  return {
    id: 'format-convert',
    config: {
      topic: title,
      researchQuestion: '',
      paperType: 'conference',
      citationFormat: 'IEEE',
      outputFormats: ['latex'],
      language: 'English',
      bilingualAbstract: false,
      wordCount: section.wordCount,
      existingMaterials: {},
      authors: [],
      fundingSources: [],
      mode: 'format-convert',
    },
    outline: '',
    outlineApproved: true,
    sections: [section],
    generationStatus: 'done',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/** Convert raw markdown text to a self-contained IEEEtran LaTeX document. */
export function rawTextToLatex(rawText: string): string {
  return buildLatex(syntheticState(rawText))
}

/** Build a PaperState suitable for sending to /api/export-pdf. */
export function rawTextToPaperState(rawText: string): PaperState {
  return syntheticState(rawText)
}

/** Derive file extension from a user-supplied format string. */
export function formatToExtension(format: string): 'md' | 'tex' | 'pdf' {
  const f = format.toLowerCase().trim()
  if (f === 'latex' || f === 'tex') return 'tex'
  if (f === 'pdf') return 'pdf'
  return 'md'
}

/** Returns true for the two synchronous (non-API) conversion paths. */
export function isDownloadableFormat(format: string): boolean {
  return formatToExtension(format) !== 'pdf'
}

/** MIME type for the download blob. */
export function formatMimeType(ext: 'md' | 'tex' | 'pdf'): string {
  if (ext === 'tex') return 'text/x-tex'
  if (ext === 'pdf') return 'application/pdf'
  return 'text/markdown'
}

/** Synchronous conversion for markdown and latex paths (returns null for pdf). */
export function convertTextSync(
  rawText: string,
  format: string,
): string | null {
  const ext = formatToExtension(format)
  if (ext === 'md') return rawText.trim()
  if (ext === 'tex') return rawTextToLatex(rawText)
  return null // pdf is async (API call)
}
