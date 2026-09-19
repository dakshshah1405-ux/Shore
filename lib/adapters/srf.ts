// Deterministic parser for the NWS Surf Zone Forecast (SRF) text product.
//
// Every extracted value keeps the exact source line and its character offsets
// into the product text, so the UI can show where each number came from.
//
// Known format drift it handles (all seen in real products):
//   - footnote markers on labels vary by office ("Rip Current Risk*" vs "Rip Current Risk")
//   - field order varies (GYX lists rip current risk last)
//   - values wrap onto deeply indented continuation lines
//   - zones split into sub-areas ("Rip Current Risk*..." then "   North of Cape Hatteras...Moderate.")
//   - extended-outlook periods written as prose (".MONDAY...Surf height around 2 feet. ...")
// Prose periods are captured as text only; extracting fields from them is Nemotron's job.

import { parseUgc } from '../ugc';
import { canonicalField, cleanValue } from '../normalize';
import type { FieldName } from '../types';

export interface SrfField {
  label: string;               // source label without footnote markers
  field: FieldName | null;     // null for labels we don't map (logged as drift)
  subArea: string | null;
  value: string;
  rawSpan: string;
  charStart: number;
  charEnd: number;
}

export interface SrfPeriod {
  label: string;               // 'REST OF TODAY', 'SUNDAY'
  prose: string | null;        // set for prose-only outlook periods
  fields: SrfField[];
  charStart: number;
  charEnd: number;
}

export interface SrfSegment {
  zones: string[];
  zoneName: string | null;
  beaches: string[];
  headlines: string[];
  periods: SrfPeriod[];
}

interface Line { text: string; start: number; end: number }

// Splits into lines while tracking offsets into the original text; tolerates \r\n.
function toLines(text: string): Line[] {
  const out: Line[] = [];
  let pos = 0;
  for (const raw of text.split('\n')) {
    const t = raw.replace(/\r$/, '');
    out.push({ text: t, start: pos, end: pos + t.length });
    pos += raw.length + 1;
  }
  return out;
}

const RE_UGC_START = /^[A-Z]{2}[CZ]\d{3}/;
const RE_UGC_END = /\d{6}-\s*$/;
const RE_TIMESTAMP = /^\d{3,4} (AM|PM) [A-Z]{3,4} /;
const RE_PERIOD = /^\.([A-Z][A-Z .'\/-]*?)\.\.\.(.*)$/;   // all-caps name only
const RE_FIELD = /^([A-Z][A-Za-z ]*?)\**\.{2,}(.*)$/;
const RE_SUBAREA = /^\s{2,7}(\S.*?)\.{2,}(.*)$/;
const RE_CONTINUATION = /^\s{8,}(\S.*)$/;

function splitBeaches(s: string): string[] {
  return s
    .replace(/^Including the beaches of\s*/i, '')
    .split(/,\s*(?:and\s+)?|\s+and\s+/)
    .map((b) => b.trim())
    .filter(Boolean);
}

export function parseSrf(text: string): SrfSegment[] {
  const lines = toLines(text);
  const segments: SrfSegment[] = [];

  // Segment boundaries are "$$" lines.
  const bounds: [number, number][] = [];
  let from = 0;
  lines.forEach((l, i) => {
    if (l.text.trim() === '$$') { bounds.push([from, i]); from = i + 1; }
  });
  bounds.push([from, lines.length]);

  for (const [a, b] of bounds) {
    let i = a;
    while (i < b && !RE_UGC_START.test(lines[i].text)) i++;
    if (i >= b) continue;   // product header or trailing boilerplate: no zones

    // UGC block may wrap across lines; it ends at the DDHHMM expiry.
    let ugc = '';
    while (i < b) {
      ugc += lines[i].text;
      if (RE_UGC_END.test(lines[i++].text)) break;
    }
    const seg: SrfSegment = { zones: parseUgc(ugc), zoneName: null, beaches: [], headlines: [], periods: [] };

    // Zone name: the next line ending in "-".
    while (i < b && !lines[i].text.trim()) i++;
    if (i < b && lines[i].text.trim().endsWith('-')) {
      seg.zoneName = lines[i].text.trim().replace(/-$/, '').trim();
      i++;
    }

    // "Including the beaches of ..." runs until the issuance timestamp line.
    if (i < b && /^Including the beaches of/i.test(lines[i].text)) {
      let beachText = '';
      while (i < b && !RE_TIMESTAMP.test(lines[i].text) && lines[i].text.trim()) beachText += ' ' + lines[i++].text;
      seg.beaches = splitBeaches(beachText.trim());
    }

    let period: SrfPeriod | null = null;
    let last: SrfField | null = null;          // for continuation lines
    let subParent: string | null = null;       // label awaiting sub-area lines
    let headline: string | null = null;

    for (; i < b; i++) {
      const l = lines[i];
      const t = l.text;
      if (t.trim() === '&&') break;            // definitions boilerplate follows

      // Official headline, possibly wrapped: "...MODERATE RIP CURRENT RISK ... EVENING..."
      if (headline !== null) {
        headline += ' ' + t.trim();
        if (t.trim().endsWith('...')) { seg.headlines.push(headline.replace(/^\.\.\.|\.\.\.$/g, '').trim()); headline = null; }
        continue;
      }
      if (!period && t.startsWith('...')) {
        if (t.trim().length > 3 && t.trim().endsWith('...') && t.trim() !== '...') {
          seg.headlines.push(t.trim().replace(/^\.\.\.|\.\.\.$/g, '').trim());
        } else headline = t.trim();
        continue;
      }

      let m;
      if ((m = t.match(RE_PERIOD))) {
        if (period) period.charEnd = lines[i - 1].end;
        const prose = m[2].trim();
        period = { label: m[1].trim(), prose: prose || null, fields: [], charStart: l.start, charEnd: l.end };
        seg.periods.push(period);
        last = null; subParent = null;
        continue;
      }
      if (!period) continue;

      if (!t.trim()) { last = null; continue; }

      if (period.prose !== null && !RE_FIELD.test(t)) {   // prose period wraps
        period.prose += ' ' + t.trim();
        period.charEnd = l.end;
        continue;
      }

      if ((m = t.match(RE_FIELD))) {
        const label = m[1].trim();
        const value = m[2];
        if (!value.trim()) {                     // "Rip Current Risk*..." then sub-area lines follow
          subParent = label; last = null;
          continue;
        }
        subParent = null;
        last = { label, field: canonicalField(label), subArea: null, value: cleanValue(value),
                 rawSpan: text.slice(l.start, l.start + t.trimEnd().length), charStart: l.start, charEnd: l.start + t.trimEnd().length };
        period.fields.push(last);
        continue;
      }

      if (subParent && (m = t.match(RE_SUBAREA))) {
        last = { label: subParent, field: canonicalField(subParent), subArea: m[1].trim(), value: cleanValue(m[2]),
                 rawSpan: text.slice(l.start, l.start + t.trimEnd().length), charStart: l.start, charEnd: l.start + t.trimEnd().length };
        period.fields.push(last);
        continue;
      }

      if (last && (m = t.match(RE_CONTINUATION))) {
        last.value = cleanValue(last.value + ' ' + m[1]);
        last.charEnd = l.start + t.trimEnd().length;
        last.rawSpan = text.slice(last.charStart, last.charEnd);
      }
    }
    if (period) period.charEnd = Math.max(period.charEnd, period.fields.at(-1)?.charEnd ?? 0);
    segments.push(seg);
  }
  return segments;
}
