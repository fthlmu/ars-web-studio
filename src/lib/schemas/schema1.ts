// P9 Schema 1 — parses the rq_formulator agent's output into an RQBrief.
//
// The agent ends its reply with one fenced ```json block. extractJsonBlock
// (in index.ts) pulls that object out; here we VALIDATE it field-by-field.
// Every missing or wrong-typed field is collected by name, and if any are bad
// we throw HandoffIncompleteError so the pipeline aborts instead of moving on
// with a half-formed research question.

import type { RQBrief, FinerScores, RQScope, MethodologyType } from '@/lib/types'
import { extractJsonBlock } from './index'
import { HandoffIncompleteError } from './errors'

// ── small defensive guards (never let a nested access throw a raw TypeError) ──

// True only for a plain object (not null, not an array).
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// True for a non-empty string after trimming whitespace.
function isNonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

// True for an array of strings with at least `min` entries.
function isStringArray(v: unknown, min: number): v is string[] {
  return Array.isArray(v) && v.length >= min && v.every((x) => typeof x === 'string')
}

// The five FINER score names every brief must carry (each 1-10).
const FINER_KEYS: (keyof FinerScores)[] = ['feasible', 'interesting', 'novel', 'ethical', 'relevant']

// The allowed methodology types.
const METHODOLOGY_TYPES: MethodologyType[] = ['qualitative', 'quantitative', 'mixed']

// Parse + validate the rq_formulator output. Throws HandoffIncompleteError if
// any required field is missing or invalid.
export function parseSchema1(raw: string): RQBrief {
  const data = extractJsonBlock(raw)
  const missing: string[] = []

  // The top-level value must be an object; if not, every field is "missing".
  if (!isObject(data)) {
    throw new HandoffIncompleteError('schema1', ['(root is not a JSON object)'])
  }

  // researchQuestion — non-empty string
  if (!isNonEmptyString(data.researchQuestion)) missing.push('researchQuestion')

  // subQuestions — string[] with at least 1 entry
  if (!isStringArray(data.subQuestions, 1)) missing.push('subQuestions')

  // finerScores — object with numeric feasible/interesting/novel/ethical/relevant.
  // We coerce each with Number(); NaN means it was missing or non-numeric.
  const finer = data.finerScores
  if (!isObject(finer)) {
    missing.push('finerScores')
  } else {
    for (const key of FINER_KEYS) {
      const n = Number((finer as Record<string, unknown>)[key])
      if (Number.isNaN(n)) missing.push('finerScores.' + key)
    }
  }

  // scope — object with inScope[], outOfScope[], domain, timeframe, geography, population
  const scope = data.scope
  if (!isObject(scope)) {
    missing.push('scope')
  } else {
    const s = scope as Record<string, unknown>
    if (!Array.isArray(s.inScope)) missing.push('scope.inScope')
    if (!Array.isArray(s.outOfScope)) missing.push('scope.outOfScope')
    if (typeof s.domain !== 'string') missing.push('scope.domain')
    if (typeof s.timeframe !== 'string') missing.push('scope.timeframe')
    if (typeof s.geography !== 'string') missing.push('scope.geography')
    if (typeof s.population !== 'string') missing.push('scope.population')
  }

  // methodologyType — must be one of the allowed literals
  if (!METHODOLOGY_TYPES.includes(data.methodologyType as MethodologyType)) {
    missing.push('methodologyType')
  }

  // theoreticalFramework — string (may be empty, but must exist as a string)
  if (typeof data.theoreticalFramework !== 'string') missing.push('theoreticalFramework')

  // keywords — string[] with at least 1 entry
  if (!isStringArray(data.keywords, 1)) missing.push('keywords')

  if (missing.length > 0) {
    throw new HandoffIncompleteError('schema1', missing)
  }

  // All checks passed — build a clean, coerced RQBrief. (Past the guards above,
  // the casts here are safe because we verified each field's shape.)
  const finerObj = data.finerScores as Record<string, unknown>
  const finerScores: FinerScores = {
    feasible: Number(finerObj.feasible),
    interesting: Number(finerObj.interesting),
    novel: Number(finerObj.novel),
    ethical: Number(finerObj.ethical),
    relevant: Number(finerObj.relevant),
  }

  const s = data.scope as Record<string, unknown>
  const scopeObj: RQScope = {
    inScope: (s.inScope as unknown[]).map((x) => String(x)),
    outOfScope: (s.outOfScope as unknown[]).map((x) => String(x)),
    domain: String(s.domain),
    timeframe: String(s.timeframe),
    geography: String(s.geography),
    population: String(s.population),
  }

  const brief: RQBrief = {
    researchQuestion: String(data.researchQuestion),
    subQuestions: (data.subQuestions as string[]).map((x) => String(x)),
    finerScores,
    scope: scopeObj,
    methodologyType: data.methodologyType as MethodologyType,
    theoreticalFramework: String(data.theoreticalFramework),
    keywords: (data.keywords as string[]).map((x) => String(x)),
  }

  // methodologyRecommendations is optional — include it only when it is a string[].
  if (isStringArray(data.methodologyRecommendations, 1)) {
    brief.methodologyRecommendations = (data.methodologyRecommendations as string[]).map((x) => String(x))
  }

  return brief
}
