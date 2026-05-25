import type { PaperState } from '@/lib/types'
import { contentToMarkdown, paperAuthorsLine, startsWithHeading } from './content'

function escapeLatexText(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

function escapeLatexPreservingMath(input: string): string {
  const parts = input.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g)
  return parts.map((part) => {
    if (part.startsWith('$$') || part.startsWith('$')) return part
    return escapeLatexText(part)
  }).join('')
}

function inlineMarkdownToLatex(input: string): string {
  let text = escapeLatexPreservingMath(input)
  text = text.replace(/\*\*([^*]+)\*\*/g, '\\textbf{$1}')
  text = text.replace(/\*([^*]+)\*/g, '\\emph{$1}')
  text = text.replace(/`([^`]+)`/g, '\\texttt{$1}')
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
  return text
}

function removeDuplicateSectionHeading(markdown: string, heading: string): string {
  const lines = markdown.trim().split('\n')
  if (startsWithHeading(markdown, heading)) lines.shift()
  return lines.join('\n').trim()
}

function markdownBodyToLatex(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let inItemize = false
  let inEnumerate = false

  function closeLists() {
    if (inItemize) {
      out.push('\\end{itemize}')
      inItemize = false
    }
    if (inEnumerate) {
      out.push('\\end{enumerate}')
      inEnumerate = false
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      closeLists()
      out.push('')
      continue
    }

    const heading = line.match(/^(#{2,4})\s+(.+)$/)
    if (heading) {
      closeLists()
      const level = heading[1].length
      const title = inlineMarkdownToLatex(heading[2])
      out.push(level <= 2 ? `\\subsection{${title}}` : `\\subsubsection{${title}}`)
      continue
    }

    const bullet = line.match(/^[-*]\s+(.+)$/)
    if (bullet) {
      if (!inItemize) {
        closeLists()
        out.push('\\begin{itemize}')
        inItemize = true
      }
      out.push(`  \\item ${inlineMarkdownToLatex(bullet[1])}`)
      continue
    }

    const numbered = line.match(/^\d+[.)]\s+(.+)$/)
    if (numbered) {
      if (!inEnumerate) {
        closeLists()
        out.push('\\begin{enumerate}')
        inEnumerate = true
      }
      out.push(`  \\item ${inlineMarkdownToLatex(numbered[1])}`)
      continue
    }

    closeLists()
    out.push(inlineMarkdownToLatex(line))
  }

  closeLists()
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function buildLatex(paper: PaperState): string {
  const authors = paper.config.authors.filter((author) => author.name.trim())
  const authorBlock = authors.length > 0
    ? authors.map((author) => {
        const affiliation = author.affiliation ? `\\\\${escapeLatexText(author.affiliation)}` : ''
        const email = author.email ? `\\\\${escapeLatexText(author.email)}` : ''
        return `${escapeLatexText(author.name)}${affiliation}${email}`
      }).join(' \\and\n')
    : escapeLatexText(paperAuthorsLine(paper))

  const sections = paper.sections.map((section) => {
    const markdown = removeDuplicateSectionHeading(contentToMarkdown(section.content), section.heading)
    return `\\section{${escapeLatexText(section.heading)}}\n${markdownBodyToLatex(markdown)}`
  })

  return [
    '\\documentclass[conference]{IEEEtran}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{cite}',
    '\\usepackage{url}',
    '\\usepackage{hyperref}',
    '',
    `\\title{${escapeLatexText(paper.config.topic)}}`,
    `\\author{${authorBlock}}`,
    '',
    '\\begin{document}',
    '\\maketitle',
    '',
    ...sections,
    '',
    '\\end{document}',
    '',
  ].join('\n\n')
}
