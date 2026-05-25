// ARS agent prompt registry.
// Import from here — never import individual agent files directly.
// All prompts are bundled at build time; no network fetch at runtime.

export { STRUCTURE_ARCHITECT_PROMPT } from './structure_architect'
export { DRAFT_WRITER_PROMPT }        from './draft_writer'
export { CITATION_COMPLIANCE_PROMPT } from './citation_compliance'
export { ABSTRACT_BILINGUAL_PROMPT }  from './abstract_bilingual'
