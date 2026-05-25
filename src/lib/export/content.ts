import type { PaperState, Section } from '@/lib/types'

export function safeFilename(title: string, extension: string): string {
  const base = title
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'paper'
  return `${base}.${extension}`
}

export function decodeHtml(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
}

export function stripHtml(input: string): string {
  return decodeHtml(input)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function attrValue(tag: string, attr: string): string {
  const pattern = new RegExp(`${attr}=["']([^"']*)["']`, 'i')
  return decodeHtml(tag.match(pattern)?.[1] ?? '')
}

function replaceTiptapMath(html: string): string {
  return html
    .replace(/<[^>]*data-type=["']block-math["'][^>]*>/gi, (tag) => `\n\n$$${attrValue(tag, 'data-latex')}$$\n\n`)
    .replace(/<[^>]*data-type=["']inline-math["'][^>]*>/gi, (tag) => `$${attrValue(tag, 'data-latex')}$`)
}

export function contentToMarkdown(content: string): string {
  if (!content.trim()) return ''
  if (!content.trimStart().startsWith('<')) return content.trim()

  let text = replaceTiptapMath(content)

  text = text
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n')
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n\n#### $1\n\n')
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '\n\n> $1\n\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/(ul|ol)>/gi, '\n\n')
    .replace(/<(ul|ol)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')

  return decodeHtml(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function startsWithHeading(markdown: string, heading: string): boolean {
  const first = markdown.trimStart().split('\n')[0] ?? ''
  const normalizedFirst = first.replace(/^#+\s+/, '').trim().toLowerCase()
  return normalizedFirst === heading.trim().toLowerCase()
}

export function sectionMarkdown(section: Section): string {
  const body = contentToMarkdown(section.content)
  if (!body) return `## ${section.heading}`
  return startsWithHeading(body, section.heading)
    ? body
    : `## ${section.heading}\n\n${body}`
}

export function paperAuthorsLine(paper: PaperState): string {
  const names = paper.config.authors.map((author) => author.name).filter(Boolean)
  return names.length > 0 ? names.join(', ') : 'Author not specified'
}

export function totalWords(paper: PaperState): number {
  return paper.sections.reduce((sum, section) => {
    const words = stripHtml(contentToMarkdown(section.content)).split(/\s+/).filter(Boolean)
    return sum + words.length
  }, 0)
}
