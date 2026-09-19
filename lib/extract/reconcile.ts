// Merges the deterministic parser and Nemotron for one zone segment.
//
//   both agree                 → 'reconciled', high confidence
//   they disagree              → the parser's value wins, low confidence, disagreement recorded
//   parser only                → 'regex', medium
//   Nemotron only (prose days, free-text remarks) → 'nemotron', medium
//
// A Nemotron value for a period+field the parser already covers (e.g. an un-split value
// where the parser found sub-areas) is never stored as a second answer — it's a disagreement.

import { hazardRank, numericFor, cleanValue } from '../normalize';
import type { SrfSegment } from '../adapters/srf';
import type { CheckedField } from './srf-llm';
import type { Confidence, Extractor, FieldName } from '../types';

export interface ReconciledValue {
  periodLabel: string;
  periodIndex: number | null;   // 0/1 for the first two structured periods, else null (outlook)
  field: FieldName;
  subArea: string | null;
  value: string;
  rawSpan: string;
  charStart: number;
  charEnd: number;
  extractor: Extractor;
  confidence: Confidence;
  model: string | null;         // Nemotron model involved; null for parser-only values
  adjudicationReason: string | null;
}

export interface Disagreement {
  periodLabel: string; field: FieldName; subArea: string | null;
  regex: string | null; nemotron: string; nemotronQuote: string;
  regexSpan: string | null;   // the parser's source span, for the deterministic pre-check
  // Nemotron's verified span, carried so an adjudicated value keeps real provenance.
  nemotronSpan: string | null; nemotronCharStart: number | null; nemotronCharEnd: number | null;
}

const norm = (s: string) => s.replace(/[.\s]+/g, ' ').trim().toUpperCase();
const normSub = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const key = (period: string, field: string, sub: string | null) => `${norm(period)}|${field}|${normSub(sub)}`;

export function valuesAgree(field: FieldName, a: string, b: string): boolean {
  if (field === 'ripCurrentRisk' || field === 'thunderstormPotential') {
    const ra = hazardRank(a), rb = hazardRank(b);
    return ra !== null && ra === rb;
  }
  const na = numericFor(field, a), nb = numericFor(field, b);
  if (na && nb) return na.min === nb.min && na.max === nb.max;
  return cleanValue(a).toLowerCase() === cleanValue(b).toLowerCase();
}

export function reconcile(
  seg: SrfSegment, llm: CheckedField[] | null, model: string | null = null,
): { values: ReconciledValue[]; disagreements: Disagreement[] } {
  const values: ReconciledValue[] = [];
  const disagreements: Disagreement[] = [];
  const structured = seg.periods.filter((p) => p.prose === null && p.fields.length > 0);
  const indexOf = (label: string) => {
    const i = structured.findIndex((p) => norm(p.label) === norm(label));
    return i >= 0 && i < 2 ? i : null;
  };

  const accepted = new Map<string, CheckedField>();
  for (const f of llm ?? []) if (f.status === 'accepted') accepted.set(key(f.periodLabel, f.field, f.subArea), f);
  const used = new Set<string>();
  const regexCovers = new Set<string>();   // period|field pairs the parser answered

  for (const p of structured) {
    for (const f of p.fields) {
      if (!f.field) continue;
      regexCovers.add(`${norm(p.label)}|${f.field}`);
      const k = key(p.label, f.field, f.subArea);
      const n = accepted.get(k);
      const base = { periodLabel: p.label, periodIndex: indexOf(p.label), field: f.field, subArea: f.subArea,
                     value: f.value, rawSpan: f.rawSpan, charStart: f.charStart, charEnd: f.charEnd };
      if (!n) { values.push({ ...base, extractor: 'regex', confidence: 'medium', model: null, adjudicationReason: null }); continue; }
      used.add(k);
      if (valuesAgree(f.field, f.value, n.value)) values.push({ ...base, extractor: 'reconciled', confidence: 'high', model, adjudicationReason: null });
      else {
        values.push({ ...base, extractor: 'regex', confidence: 'low', model, adjudicationReason: null });
        disagreements.push({ periodLabel: p.label, field: f.field, subArea: f.subArea, regex: f.value, regexSpan: f.rawSpan,
          nemotron: n.value, nemotronQuote: n.quote,
          nemotronSpan: n.rawSpan, nemotronCharStart: n.charStart, nemotronCharEnd: n.charEnd });
      }
    }
  }

  for (const [k, n] of accepted) {
    if (used.has(k)) continue;
    if (regexCovers.has(`${norm(n.periodLabel)}|${n.field}`)) {
      disagreements.push({ periodLabel: n.periodLabel, field: n.field, subArea: n.subArea, regex: null, regexSpan: null,
        nemotron: n.value, nemotronQuote: n.quote,
        nemotronSpan: n.rawSpan, nemotronCharStart: n.charStart, nemotronCharEnd: n.charEnd });
      continue;
    }
    values.push({
      periodLabel: n.periodLabel, periodIndex: indexOf(n.periodLabel), field: n.field, subArea: n.subArea,
      value: n.value, rawSpan: n.rawSpan!, charStart: n.charStart!, charEnd: n.charEnd!,
      extractor: 'nemotron', confidence: 'medium', model, adjudicationReason: null,
    });
  }
  return { values, disagreements };
}
