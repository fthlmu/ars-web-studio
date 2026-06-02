// P17 — Stage-6 Process-Summary PDF route. A SEPARATE Typst compile from /api/export-pdf:
// it renders only the Stage-6 content (self-reflection, collaboration depth, failure-mode
// audit log) into a single-column report. The paper body is NOT included here.
//
// runTypst mirrors /api/export-pdf (copy-paste is fine here — keeps that route untouched).
// On a missing Typst binary it returns the SAME "Typst executable not found" marker so the
// page can show the amber "install Typst" hint and a retry, never blocking the paper.

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSummaryTypstDocument } from '@/lib/export/summary-typst'
import type { SummaryDoc } from '@/lib/export/summary-typst'

export const runtime = 'nodejs'
export const maxDuration = 60

function runTypst(inputFile: string, outputFile: string): Promise<void> {
  const candidates = [
    process.env.TYPST_PATH,
    'typst',
    'C:\\Users\\Fathul\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Typst.Typst_Microsoft.Winget.Source_8wekyb3d8bbwe\\typst-x86_64-pc-windows-msvc\\typst.exe',
  ].filter(Boolean) as string[]

  return new Promise((resolve, reject) => {
    const tryCandidate = (index: number) => {
      const command = candidates[index]
      if (!command) {
        reject(new Error('Typst executable not found. Install Typst or set TYPST_PATH.'))
        return
      }

      execFile(
        command,
        ['compile', '--root', tmpdir(), inputFile, outputFile],
        { timeout: 30000, maxBuffer: 512 * 1024 * 1024 },
        (error, _stdout, stderr) => {
          if (!error) {
            resolve()
            return
          }

          const nodeError = error as NodeJS.ErrnoException
          if (nodeError.code === 'ENOENT' && index < candidates.length - 1) {
            tryCandidate(index + 1)
            return
          }

          reject(new Error(stderr || error.message))
        }
      )
    }

    tryCandidate(0)
  })
}

// Safe ASCII filename from the doc title (mirrors export/content.safeFilename behaviour).
function safeName(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  return `${base || 'process-summary'}.pdf`
}

export async function POST(req: Request) {
  let workDir: string | null = null

  try {
    const body = (await req.json()) as { summary?: SummaryDoc }
    const summary = body.summary

    if (!summary?.title || !Array.isArray(summary.sections) || summary.sections.length === 0) {
      return Response.json({ error: 'Invalid process-summary payload.' }, { status: 400 })
    }

    workDir = await mkdtemp(join(tmpdir(), 'ars-summary-'))
    const inputFile = join(workDir, 'summary.typ')
    const outputFile = join(workDir, 'summary.pdf')

    await writeFile(inputFile, buildSummaryTypstDocument(summary), 'utf8')
    await runTypst(inputFile, outputFile)

    const pdfBytes = await readFile(outputFile)

    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName(summary.title)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ error: message }, { status: 500 })
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
