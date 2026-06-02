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
// P15 Stage 4→5: opt-in claim-faithfulness audit (ARS_CLAIM_AUDIT, default off).
export { CLAIM_AUDIT_PROMPT } from './claim_audit'
// P16 Stage 5: formatter agent (verified_only) — deterministic impl in ars-client.formatPaper.
export { FORMATTER_PROMPT } from './formatter'
// P17 Stage 6: process-summary narrator + collaboration-depth observer (advisory only).
export { PROCESS_SUMMARY_PROMPT } from './process_summary'
export { COLLABORATION_DEPTH_PROMPT } from './collaboration_depth'
