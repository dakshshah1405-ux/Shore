// Builds evaluation cases by breaking real forecasts in ways that realistically defeat the
// deterministic parser, while the correct answer stays known (read from the untouched document).
//
// Why injected rather than field data: after fixing the single-dot bug Nemotron found, real
// parser/model disagreements across all 12 offices dropped to zero. Injection is the honest way
// to measure adjudication — every result from this harness must be labeled as injected.
//
// Each flaw preserves the fixed-width value column, so the document still looks like a real product.

import { parseSrf } from '../adapters/srf';
import type { FieldName } from '../types';

export type FlawType =
  | 'single_dot' | 'label_typo' | 'extra_indent' | 'subarea_single_dot' | 'continuation_swallow'
  | 'none'            // control: document untouched — nothing should break
  | 'field_deleted';  // control: the line is removed, so the correct answer is NO value

export interface InjectedCase {
  id: string;
  file: string;
  zoneId: string;
  periodLabel: string;
  field: FieldName;
  subArea: string | null;
  correctValue: string | null;   // from the untouched document; null means no value should be produced
  flaw: FlawType;
  text: string;                  // the whole document, with at most one line changed
}

const TARGET_FIELDS: FieldName[] = ['ripCurrentRisk', 'surfHeight'];

// "Rip Current Risk*...........Moderate." → "Rip Current Risk*          .Moderate."
// A single dot leader: exactly the real ILM case, where a long label ate the leader.
function singleDot(line: string): string | null {
  const m = line.match(/^(\s*\S[^.]*?)(\.{2,})(.*)$/);
  if (!m) return null;
  return `${m[1]}${' '.repeat(m[2].length - 1)}.${m[3]}`;
}

// Misspell the label, keeping the column alignment intact.
function labelTypo(line: string): string | null {
  const m = line.match(/^([A-Z][A-Za-z ]*?)(\**)(\.{2,})(.*)$/);
  if (!m || m[1].length < 6) return null;
  const typo = m[1].slice(0, 4) + m[1].slice(5);           // drop one letter
  return `${typo}${m[2]}${m[3]}.${m[4]}`;                   // one extra dot keeps the value column
}

// Indent the label so it no longer starts at the margin.
function extraIndent(line: string): string | null {
  const m = line.match(/^([A-Z][A-Za-z ]*?)(\**)(\.{2,})(.*)$/);
  if (!m || m[3].length < 3) return null;
  return `  ${m[1]}${m[2]}${m[3].slice(2)}${m[4]}`;
}

// The parser treats any deeply indented following line as a continuation of the value, so an
// indented note after a field silently corrupts it. Unlike the other flaws this makes the parser
// produce a CONFIDENTLY WRONG value rather than none — the only case where "parser wins ties" hurts.
function continuationSwallow(line: string): string | null {
  return `${line}\n${' '.repeat(28)}Expect hazardous conditions near inlets.`;
}

const FLAW_FN: Record<FlawType, (line: string) => string | null> = {
  single_dot: singleDot,
  label_typo: labelTypo,
  extra_indent: extraIndent,
  subarea_single_dot: singleDot,
  continuation_swallow: continuationSwallow,
  none: (line) => line,
  field_deleted: () => '',   // handled at document level in injectFlaws
};

// Removes the whole line containing [from, to), newline included.
function deleteLine(text: string, from: number, to: number): string {
  const start = text.lastIndexOf('\n', from) + 1;
  const nl = text.indexOf('\n', to);
  return text.slice(0, start) + text.slice(nl === -1 ? text.length : nl + 1);
}

export const ALL_FLAWS: FlawType[] = [
  'none', 'single_dot', 'label_typo', 'extra_indent', 'continuation_swallow', 'field_deleted',
];

// One flaw type at a time, so the caller can build a balanced set. A benchmark weighted toward
// one side's failure modes proves nothing, so the script requests equal counts per flaw.
export function injectFlaws(file: string, text: string, opts: { flaw: FlawType; maxPerFile?: number }): InjectedCase[] {
  const cases: InjectedCase[] = [];
  const max = opts.maxPerFile ?? 4;

  for (const seg of parseSrf(text)) {
    const period = seg.periods.find((p) => p.prose === null && p.fields.length > 0);
    if (!period || !seg.zones.length) continue;

    for (const f of period.fields) {
      if (!f.field || !TARGET_FIELDS.includes(f.field)) continue;
      // Sub-area lines only support the sub-area flaw; skip them for the others.
      if (f.subArea && opts.flaw !== 'subarea_single_dot') continue;
      if (!f.subArea && opts.flaw === 'subarea_single_dot') continue;
      const flaw = opts.flaw;
      const line = text.slice(f.charStart, f.charEnd);
      const broken = FLAW_FN[flaw](line);
      if (broken === null) continue;

      cases.push({
        id: `${file}:${seg.zones[0]}:${period.label}:${f.field}${f.subArea ? `:${f.subArea}` : ''}:${flaw}`,
        file, zoneId: seg.zones[0], periodLabel: period.label, field: f.field, subArea: f.subArea,
        correctValue: flaw === 'field_deleted' ? null : f.value, flaw,
        text: flaw === 'field_deleted'
          ? deleteLine(text, f.charStart, f.charEnd)
          : text.slice(0, f.charStart) + broken + text.slice(f.charEnd),
      });
      if (cases.length >= max) return cases;
    }
  }
  return cases;
}
