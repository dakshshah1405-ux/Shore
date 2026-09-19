// Role: Nemotron as adjudicator. When the deterministic parser and Nemotron's extraction
// disagree about the same field, Nemotron is shown the source text and reasons about which
// reading is correct. It decides WHAT THE DOCUMENT SAYS — never how dangerous the beach is.
// The risk ladder in lib/risk.ts remains the sole authority on risk.
//
// Structure: the network call (adjudicate) is separate from the decision application
// (applyAdjudications), which is pure and unit-testable. reconcile.ts stays pure.

import { extractJSON } from '../nemotron';
import { hazardRank, numericFor } from '../normalize';
import type { SrfSegment } from '../adapters/srf';
import type { Disagreement, ReconciledValue } from './reconcile';
import type { FieldName } from '../types';

export type Choice = 'parser' | 'nemotron' | 'neither';

export interface AdjudicationCase {
  id: string;                    // periodLabel|field|subArea
  periodLabel: string;
  field: FieldName;
  subArea: string | null;
  parserValue: string | null;    // null when the parser produced nothing here
  parserSpan: string | null;     // the parser's source span, for the deterministic pre-check
  nemotronValue: string;
  nemotronQuote: string;
  nemotronSpan: string | null;   // verified span + offsets, so an adjudicated value keeps provenance
  nemotronCharStart: number | null;
  nemotronCharEnd: number | null;
  excerpt: string;               // the period's text, so the model reasons over the real source
}

export interface Decision { id: string; choice: Choice; reason: string }

export interface AppliedAdjudication {
  id: string; choice: Choice; reason: string;
  outcome: 'kept_parser' | 'took_nemotron' | 'added_missing' | 'refused_downgrade' | 'flagged_neither' | 'no_decision';
}

const norm = (s: string) => s.replace(/[.\s]+/g, ' ').trim().toUpperCase();

export function buildCases(text: string, seg: SrfSegment, disagreements: Disagreement[]): AdjudicationCase[] {
  return disagreements.map((d) => {
    const p = seg.periods.find((sp) => norm(sp.label) === norm(d.periodLabel));
    const excerpt = p ? text.slice(p.charStart, Math.max(p.charEnd, p.charStart)) : text.slice(seg.charStart, seg.charEnd);
    return {
      id: `${d.periodLabel}|${d.field}|${d.subArea ?? ''}`,
      periodLabel: d.periodLabel, field: d.field, subArea: d.subArea,
      parserValue: d.regex, parserSpan: d.regexSpan, nemotronValue: d.nemotron, nemotronQuote: d.nemotronQuote,
      nemotronSpan: d.nemotronSpan, nemotronCharStart: d.nemotronCharStart, nemotronCharEnd: d.nemotronCharEnd, excerpt,
    };
  });
}

// Fields whose value is a fixed category, and which SRF always states on a single line.
const CATEGORICAL: FieldName[] = ['ripCurrentRisk', 'thunderstormPotential', 'waterspoutRisk'];
const SINGLE_LINE: FieldName[] = [...CATEGORICAL, 'surfHeight', 'waterTemperature'];

// Deterministic pre-check: some parser values are provably wrong from the format alone, so the
// question never reaches Nemotron. Cheaper, and it removes a chance for the model to err.
export function preCheck(cases: AdjudicationCase[]): { decisions: Decision[]; remaining: AdjudicationCase[] } {
  const decisions: Decision[] = [];
  const remaining: AdjudicationCase[] = [];
  for (const c of cases) {
    if (c.parserValue === null) { remaining.push(c); continue; }
    if (CATEGORICAL.includes(c.field) && hazardRank(c.parserValue) === null) {
      decisions.push({ id: c.id, choice: 'nemotron', reason: `parser value "${c.parserValue}" is not a valid category for ${c.field}` });
      continue;
    }
    if (SINGLE_LINE.includes(c.field) && c.parserSpan?.includes('\n')) {
      decisions.push({ id: c.id, choice: 'nemotron', reason: `parser value spans multiple source lines; ${c.field} is stated on one line` });
      continue;
    }
    remaining.push(c);
  }
  return { decisions, remaining };
}

const SYSTEM = `You are resolving disagreements about what a National Weather Service Surf Zone Forecast says.

For each case you get: the exact source text for one forecast period, the value a deterministic text parser read, and the value a language model read with the line it quoted.

Decide which reading matches the source text.
- "parser": the parser's value is what the text states.
- "nemotron": the parser is wrong or missed a value the text clearly states.
- "neither": neither matches the text.

Rules:
- Judge only what the text SAYS. Never judge whether the forecast is correct, and never assess danger.
- If the parser value is null, it found nothing; choose "nemotron" only if the text clearly states the value.
- Quote-check before deciding: the quoted line must actually appear in the source text.
- reason: under 20 words, citing the text.

Return JSON: {"decisions": [{"id": string, "choice": "parser"|"nemotron"|"neither", "reason": string}]}`;

export async function adjudicate(cases: AdjudicationCase[]): Promise<{ decisions: Decision[]; model: string | null }> {
  if (!cases.length) return { decisions: [], model: null };
  const user = cases.map((c) => [
    `--- case ${c.id} ---`,
    `field: ${c.field}${c.subArea ? ` (sub-area: ${c.subArea})` : ''}, period: ${c.periodLabel}`,
    `parser read: ${c.parserValue === null ? 'NOTHING (no value found)' : JSON.stringify(c.parserValue)}`,
    `model read: ${JSON.stringify(c.nemotronValue)} quoting ${JSON.stringify(c.nemotronQuote)}`,
    `source text:\n${c.excerpt}`,
  ].join('\n')).join('\n\n');

  const res = await extractJSON<{ decisions?: Decision[] }>(SYSTEM, user);
  const raw = Array.isArray(res.data?.decisions) ? res.data!.decisions! : [];
  const byId = new Map(cases.map((c) => [c.id, c]));
  const decisions = raw
    .filter((d) => d && byId.has(d.id) && ['parser', 'nemotron', 'neither'].includes(d.choice))
    .map((d) => ({ id: d.id, choice: d.choice, reason: String(d.reason ?? '').slice(0, 200) }));
  return { decisions, model: res.model };
}

// True when moving from `from` to `to` would reduce a stated hazard. Categorical fields compare
// by rank; measured fields compare by upper bound.
export function wouldLower(field: FieldName, from: string, to: string): boolean {
  const a = hazardRank(from), b = hazardRank(to);
  if (a !== null && b !== null) return b < a;
  const na = numericFor(field, from), nb = numericFor(field, to);
  if (na && nb) return nb.max < na.max;
  return false;
}

// Pure. Applies decisions under one hard rule: adjudication may add a missing value, confirm the
// parser, or raise a hazard — it may never lower one. A downgrade is refused and recorded.
export function applyAdjudications(
  values: ReconciledValue[], cases: AdjudicationCase[], decisions: Decision[], model: string | null,
): { values: ReconciledValue[]; applied: AppliedAdjudication[] } {
  const out = [...values];
  const applied: AppliedAdjudication[] = [];
  const decisionFor = new Map(decisions.map((d) => [d.id, d]));

  for (const c of cases) {
    const d = decisionFor.get(c.id);
    if (!d) { applied.push({ id: c.id, choice: 'parser', reason: 'no decision returned', outcome: 'no_decision' }); continue; }
    const i = out.findIndex((v) => `${v.periodLabel}|${v.field}|${v.subArea ?? ''}` === c.id);
    const record = (outcome: AppliedAdjudication['outcome']) => applied.push({ id: c.id, choice: d.choice, reason: d.reason, outcome });

    if (d.choice === 'parser') {
      if (i >= 0) out[i] = { ...out[i], extractor: 'adjudicated', confidence: 'medium', model, adjudicationReason: d.reason };
      record('kept_parser');
      continue;
    }
    if (d.choice === 'neither') {
      if (i >= 0) out[i] = { ...out[i], confidence: 'low', adjudicationReason: d.reason };
      record('flagged_neither');
      continue;
    }
    // choice === 'nemotron'
    if (i < 0) {
      // The parser produced nothing here, so adding a value only increases what we know.
      // Requires the verified span: a value without real provenance is never stored.
      if (c.nemotronSpan === null || c.nemotronCharStart === null || c.nemotronCharEnd === null) {
        record('no_decision');
        continue;
      }
      out.push({
        periodLabel: c.periodLabel, periodIndex: null, field: c.field, subArea: c.subArea,
        value: c.nemotronValue, rawSpan: c.nemotronSpan, charStart: c.nemotronCharStart, charEnd: c.nemotronCharEnd,
        extractor: 'adjudicated', confidence: 'medium', model, adjudicationReason: d.reason,
      });
      record('added_missing');
      continue;
    }
    if (wouldLower(c.field, out[i].value, c.nemotronValue)) {
      out[i] = { ...out[i], confidence: 'low', adjudicationReason: `downgrade refused: ${d.reason}` };
      record('refused_downgrade');
      continue;
    }
    out[i] = { ...out[i], value: c.nemotronValue, extractor: 'adjudicated', confidence: 'medium', model, adjudicationReason: d.reason };
    record('took_nemotron');
  }
  return { values: out, applied };
}
