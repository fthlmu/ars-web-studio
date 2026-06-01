// ARS agent prompt registry.
// Import from here — never import individual agent files directly.
// All prompts are bundled at build time; no network fetch at runtime.

export { STRUCTURE_ARCHITECT_PROMPT } from './structure_architect'
export { DRAFT_WRITER_PROMPT }        from './draft_writer'
export { CITATION_COMPLIANCE_PROMPT } from './citation_compliance'
export { ABSTRACT_BILINGUAL_PROMPT }  from './abstract_bilingual'
export { REVISION_COACH_PROMPT }      from './revision_coach'
export { ACADEMIC_PAPER_SKILL_PROMPT } from './academic_paper_skill'
export { DEEP_RESEARCH_SKILL_PROMPT }  from './deep_research_skill'
export { REVIEWER_SKILL_PROMPT }       from './reviewer_skill'
export { PEER_REVIEWER_PROMPT }        from './peer_reviewer'
export { SOURCE_VERIFICATION_PROMPT }  from './source_verification'
export { SYNTHESIS_AGENT_PROMPT }      from './synthesis_agent'
// P10 Stage 2.5: integrity verification gatekeeper (reused at Stage 4.5 in P15).
export { INTEGRITY_VERIFICATION_PROMPT } from './integrity_verification'
