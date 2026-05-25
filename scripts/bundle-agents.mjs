// Bundles ARS agent markdown files into TypeScript string constants.
// Run: node scripts/bundle-agents.mjs
// Safe to re-run — regenerates from the _*.md source files.

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEST = join(__dirname, '..', 'src', 'lib', 'ars-agents')

const agents = [
  {
    md:   '_structure_architect_agent.md',
    ts:   'structure_architect.ts',
    name: 'STRUCTURE_ARCHITECT_PROMPT',
    desc: 'Designs the paper section architecture and detailed outline before drafting begins',
  },
  {
    md:   '_draft_writer_agent.md',
    ts:   'draft_writer.ts',
    name: 'DRAFT_WRITER_PROMPT',
    desc: 'Writes complete paper sections following TEEL structure with citation density enforcement',
  },
  {
    md:   '_citation_compliance_agent.md',
    ts:   'citation_compliance.ts',
    name: 'CITATION_COMPLIANCE_PROMPT',
    desc: 'Verifies and auto-corrects citation formatting; achieves zero orphan citations',
  },
  {
    md:   '_abstract_bilingual_agent.md',
    ts:   'abstract_bilingual.ts',
    name: 'ABSTRACT_BILINGUAL_PROMPT',
    desc: 'Writes bilingual abstract (English + secondary language) with 5-component structure',
  },
]

for (const agent of agents) {
  const mdPath = join(DEST, agent.md)
  const tsPath = join(DEST, agent.ts)

  let raw
  try {
    raw = readFileSync(mdPath, 'utf8')
  } catch {
    console.error(`SKIP: ${agent.md} not found — download it first`)
    continue
  }

  // Escape for TypeScript template literal:
  // 1. Escape backslashes (must be first to avoid double-escaping)
  // 2. Escape backticks
  // 3. Escape ${ (template expression start)
  const escaped = raw
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')

  const lines = [
    `// Auto-generated from ${agent.md} — do not edit manually.`,
    `// ARS agent system prompt bundled as a local constant (no runtime network fetch).`,
    `// Description: ${agent.desc}`,
    ``,
    `export const ${agent.name} = \`${escaped}\``,
    ``,
  ]

  writeFileSync(tsPath, lines.join('\n'), 'utf8')
  console.log(`✓  ${agent.ts}  (${lines.length} lines)`)
}

console.log('\nDone. All agent prompts bundled.')
