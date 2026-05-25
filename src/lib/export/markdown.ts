import type { PaperState } from '@/lib/types'
import { paperAuthorsLine, sectionMarkdown } from './content'

export function buildMarkdown(paper: PaperState): string {
  const affiliations = paper.config.authors
    .map((author) => author.affiliation)
    .filter(Boolean)

  const header = [
    `# ${paper.config.topic}`,
    '',
    `**Authors:** ${paperAuthorsLine(paper)}`,
    affiliations.length > 0 ? `**Affiliations:** ${affiliations.join('; ')}` : '',
    `**Citation format:** ${paper.config.citationFormat}`,
    `**Generated:** ${new Date(paper.updatedAt).toLocaleDateString()}`,
  ].filter(Boolean)

  return [
    ...header,
    '',
    ...paper.sections.map(sectionMarkdown),
    '',
  ].join('\n\n')
}
