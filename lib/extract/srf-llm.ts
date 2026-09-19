// Nemotron extraction for one SRF zone section, followed by a deterministic judge.
//
// Nemotron must return, for every value, the exact quote that states it. The judge then
// accepts a value only if (1) the quote exists in the source, (2) it sits inside the period
// the value is attributed to, and (3) the value is actually supported by the quote.
// Rejections are kept with a reason — they are the eval's failure analysis.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { extractJSON, NEMOTRON_MODEL } from '../nemotron';
import { cleanValue, numericFor } from '../normalize';
import type { SrfSegment } from '../adapters/srf';

export const PROMPT_VERSION = 'srf-v1';
export const LLM_FIELDS = ['ripCurrentRisk', 'surfHeight', 'thunderstormPotential', 'waterTemperature', 'longshoreCurrent'] as const;
export type LlmFieldName = (typeof LLM_FIELDS)[number];

const SYSTEM = `You extract values from one zone of an NWS Surf Zone Forecast.

Return JSON: {"periods": [{"label": string, "fields": [{"field": string, "subArea": string | null, "value": string, "quote": string}]}]}

Periods: one entry per period header — a line starting with "." such as ".TODAY...", ".REST OF TODAY...", ".SUNDAY...", ".MONDAY...". Use the header name as label, e.g. "MONDAY".

Fields — include one ONLY if the text explicitly states it for that period. Never infer, estimate, or carry values between periods. If it is not stated, leave it out.
- ripCurrentRisk: value exactly "None", "Low", "Moderate", or "High", only when the text states that category for rip currents.
- thunderstormPotential: value exactly "None", "Low", "Moderate", or "High", only when the text states that category for thunderstorm potential. Phrases like "a chance of thunderstorms" are not a category — leave the field out.
- surfHeight: the stated surf wording, e.g. "2 to 3 feet" or "around 2 feet".
- waterTemperature: the stated water or surf temperature wording.
- longshoreCurrent: only if the text mentions a longshore current; value is that wording.

subArea: if the text gives separate values for named areas (e.g. "North of Cape Hatteras...Moderate."), make one entry per area with its name; otherwise null.

quote: copy the exact text that states the value, character for character. Do not paraphrase, correct, or shorten it.`;

export interface LlmField {
  periodLabel: string;
  field: LlmFieldName;
  subArea: string | null;
  value: string;
  quote: string;
}

export interface CheckedField extends LlmField {
  status: 'accepted' | 'rejected';
  reason: string | null;       // why the judge rejected it
  charStart: number | null;    // offsets into the full product text
  charEnd: number | null;
  rawSpan: string | null;
}

export interface SegmentExtraction {
  model: string;
  think: boolean;
  promptVersion: string;
  latencyMs: number;
  cached: boolean;
  parsed: boolean;             // false when the model returned nothing usable
  fields: CheckedField[];
}

const norm = (s: string) => s.replace(/[.\s]+/g, ' ').trim().toUpperCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Finds the quote in `text`, tolerating only whitespace differences and dot-leader length.
function findQuote(text: string, quote: string, from: number, to: number): { start: number; end: number } | null {
  const pattern = quote.trim()
    .split(/(\.{2,}|\s+)/)
    .filter(Boolean)
    .map((part) => (/^\.{2,}$/.test(part) ? '\\.{2,}' : /^\s+$/.test(part) ? '\\s+' : escapeRe(part)))
    .join('');
  if (!pattern) return null;
  const m = new RegExp(pattern).exec(text.slice(from, to));
  return m ? { start: from + m.index, end: from + m.index + m[0].length } : null;
}

const NUMBER_WORDS: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6' };
const numbersIn = (s: string) =>
  (s.toLowerCase().match(/\d+|one|two|three|four|five|six/g) ?? []).map((n) => NUMBER_WORDS[n] ?? n);

function supportReason(f: LlmField): string | null {
  const q = f.quote.toLowerCase();
  if (f.field === 'ripCurrentRisk' || f.field === 'thunderstormPotential') {
    if (!/^(none|low|moderate|high)$/i.test(f.value)) return 'value_not_a_category';
    if (!new RegExp(`\\b${f.value.toLowerCase()}\\b`).test(q)) return 'value_not_in_quote';
    return null;
  }
  if (f.field === 'longshoreCurrent') return /longshore/i.test(f.quote) ? null : 'value_not_in_quote';
  const qNums = new Set(numbersIn(f.quote));
  if (!numbersIn(f.value).every((n) => qNums.has(n))) return 'number_not_in_quote';
  if (f.field === 'surfHeight' && !numericFor('surfHeight', f.value) && !numericFor('surfHeight', f.quote)) return 'unparseable_surf';
  return null;
}

// The judge. Pure and deterministic — this is what decides whether Nemotron's output is used.
export function judge(text: string, seg: SrfSegment, raw: unknown): { parsed: boolean; fields: CheckedField[] } {
  const periods = (raw as { periods?: unknown })?.periods;
  if (!Array.isArray(periods)) return { parsed: false, fields: [] };
  const out: CheckedField[] = [];

  for (const p of periods as { label?: unknown; fields?: unknown }[]) {
    const periodLabel = typeof p?.label === 'string' ? p.label : '';
    const known = seg.periods.find((sp) => norm(sp.label) === norm(periodLabel));
    for (const f of (Array.isArray(p?.fields) ? p.fields : []) as Record<string, unknown>[]) {
      const cand: LlmField = {
        periodLabel,
        field: f.field as LlmFieldName,
        subArea: typeof f.subArea === 'string' && f.subArea.trim() ? f.subArea.trim() : null,
        value: String(f.value ?? '').trim(),
        quote: String(f.quote ?? ''),
      };
      const reject = (reason: string): CheckedField =>
        ({ ...cand, status: 'rejected', reason, charStart: null, charEnd: null, rawSpan: null });

      if (!LLM_FIELDS.includes(cand.field)) { out.push(reject('unknown_field')); continue; }
      if (!cand.value || !cand.quote.trim()) { out.push(reject('empty_value_or_quote')); continue; }
      if (!known) { out.push(reject('unknown_period')); continue; }

      const inPeriod = findQuote(text, cand.quote, known.charStart, Math.max(known.charEnd, known.charStart));
      if (!inPeriod) {
        const anywhere = findQuote(text, cand.quote, seg.charStart, seg.charEnd);
        out.push(reject(anywhere ? 'quote_in_wrong_period' : 'quote_not_in_source'));
        continue;
      }
      const why = supportReason(cand);
      if (why) { out.push(reject(why)); continue; }

      if (cand.field === 'ripCurrentRisk' || cand.field === 'thunderstormPotential')
        cand.value = cand.value.charAt(0).toUpperCase() + cand.value.slice(1).toLowerCase();
      else cand.value = cleanValue(cand.value);   // same cleanup as the regex path ("Around 2 feet." → "Around 2 feet")
      out.push({ ...cand, status: 'accepted', reason: null,
                 charStart: inPeriod.start, charEnd: inPeriod.end, rawSpan: text.slice(inPeriod.start, inPeriod.end) });
    }
  }
  return { parsed: true, fields: out };
}

const CACHE_DIR = path.join('.cache', 'nemotron');

export async function extractSegment(text: string, seg: SrfSegment, opts: { think?: boolean } = {}): Promise<SegmentExtraction> {
  const think = !!opts.think;
  const section = text.slice(seg.charStart, seg.charEnd);
  const key = createHash('sha256').update([NEMOTRON_MODEL, think, PROMPT_VERSION, section].join('\u0000')).digest('hex');
  const cacheFile = path.join(CACHE_DIR, `${key}.json`);

  let raw: unknown = null, latencyMs = 0, cached = false;
  if (fs.existsSync(cacheFile)) {
    ({ raw, latencyMs } = JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
    cached = true;
  } else {
    const t = Date.now();
    raw = await extractJSON(SYSTEM, section, { think });
    latencyMs = Date.now() - t;
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ raw, latencyMs }));
  }
  const { parsed, fields } = judge(text, seg, raw);
  return { model: NEMOTRON_MODEL, think, promptVersion: PROMPT_VERSION, latencyMs, cached, parsed, fields };
}
