import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PaperState } from '@/lib/types'
import { buildTypstDocument } from '@/lib/export/typst-template'
import { safeFilename } from '@/lib/export/content'

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

export async function POST(req: Request) {
  let workDir: string | null = null

  try {
    const body = await req.json() as { paper?: PaperState }
    const paper = body.paper

    if (!paper?.config?.topic || !Array.isArray(paper.sections)) {
      return Response.json({ error: 'Invalid paper payload.' }, { status: 400 })
    }

    workDir = await mkdtemp(join(tmpdir(), 'ars-export-'))
    const inputFile = join(workDir, 'paper.typ')
    const outputFile = join(workDir, 'paper.pdf')

    await writeFile(inputFile, buildTypstDocument(paper), 'utf8')
    await runTypst(inputFile, outputFile)

    const pdfBytes = await readFile(outputFile)
    const filename = safeFilename(paper.config.topic, 'pdf')

    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
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
