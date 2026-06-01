// Barrel export for all 5 deep-research agent prompts used in P9 Stage 1.
// The first 3 are bundled locally in this subdir; the last 2 live in the parent
// ars-agents/ dir (source_verification + synthesis_agent are shared with other stages).

export { RQ_FORMULATOR_PROMPT }        from './rq_formulator'
export { LITERATURE_SEARCHER_PROMPT }  from './literature_searcher'
export { METHODOLOGY_SELECTOR_PROMPT } from './methodology_selector'
export { SOURCE_VERIFICATION_PROMPT }  from '../source_verification'
export { SYNTHESIS_AGENT_PROMPT }      from '../synthesis_agent'
