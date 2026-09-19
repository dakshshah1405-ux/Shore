import type { FieldName, NumericRange } from './types';

// Canonical field names for SRF labels. Labels arrive with or without the
// "*" / "**" footnote markers depending on the office, so those are stripped first.
// Offices also name the same field differently (CAR "Surf", OKX "Surf Temperature").
// "Tides" is deliberately unmapped: tides are out of scope.
const LABELS: Record<string, FieldName> = {
  'rip current risk': 'ripCurrentRisk',
  'surf height': 'surfHeight',
  'surf': 'surfHeight',
  'thunderstorm potential': 'thunderstormPotential',
  'uv index': 'uvIndex',
  'water temperature': 'waterTemperature',
  'surf temperature': 'waterTemperature',
  'max heat index': 'maxHeatIndex',
  'remarks': 'remarks',
  'weather': 'weather',
  'high temperature': 'highTemperature',
  'winds': 'winds',
  'waterspout risk': 'waterspoutRisk',
  'sunrise': 'sunrise',
  'sunset': 'sunset',
};

export function canonicalField(label: string): FieldName | null {
  return LABELS[label.replace(/\*/g, '').trim().toLowerCase()] ?? null;
}

// "Moderate." → "Moderate"; collapses the wrapped-line whitespace.
export function cleanValue(v: string): string {
  return v.replace(/\s+/g, ' ').trim().replace(/\.$/, '').trim();
}

// Ordinal ranks for categorical hazards, used to take the worst of sub-areas.
const RANK: Record<string, number> = { none: 0, low: 1, moderate: 2, high: 3 };

export function hazardRank(value: string | null): number | null {
  if (!value) return null;
  const r = RANK[value.toLowerCase()];
  return r === undefined ? null : r;
}

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const num = (s: string) => (NUM_WORDS[s.toLowerCase()] ?? Number(s));

// Surf height wording → feet. Returns null rather than guessing on unfamiliar phrasing.
export function parseSurf(v: string): NumericRange | null {
  const s = v.toLowerCase();
  let m;
  if ((m = s.match(/(\d+|one|two|three|four|five|six)\s*(?:to|-)\s*(\d+|one|two|three|four|five|six)\s*f(?:ee|oo)t/)))
    return { min: num(m[1]), max: num(m[2]), unit: 'ft', approximate: false };
  if ((m = s.match(/less than\s+(\d+|one|two)\s*f(?:ee|oo)t/)))
    return { min: 0, max: num(m[1]), unit: 'ft', approximate: true };
  if ((m = s.match(/(\d+|one|two)\s*f(?:ee|oo)t\s+or\s+less/)))
    return { min: 0, max: num(m[1]), unit: 'ft', approximate: true };
  if ((m = s.match(/around\s+(\d+|one|two|three|four|five|six)\s*f(?:ee|oo)t/)))
    return { min: num(m[1]), max: num(m[1]), unit: 'ft', approximate: true };
  if ((m = s.match(/(\d+)\s*f(?:ee|oo)t/)))
    return { min: +m[1], max: +m[1], unit: 'ft', approximate: false };
  return null;
}

// Water temperature wording → °F. "In the upper 70s" becomes the range 77–79,
// flagged approximate — the number is a faithful reading of the words, not a guess.
export function parseWaterTemp(v: string): NumericRange | null {
  const s = v.toLowerCase();
  let m;
  if ((m = s.match(/(\d+)\s*degrees/)))
    return { min: +m[1], max: +m[1], unit: 'F', approximate: false };
  if ((m = s.match(/(lower|mid|upper)\s+(\d)0s/))) {
    const base = +m[2] * 10;
    const [lo, hi] = m[1] === 'lower' ? [0, 3] : m[1] === 'mid' ? [4, 6] : [7, 9];
    return { min: base + lo, max: base + hi, unit: 'F', approximate: true };
  }
  if ((m = s.match(/around\s+(\d+)/)))
    return { min: +m[1], max: +m[1], unit: 'F', approximate: true };
  return null;
}

export function numericFor(field: FieldName, value: string): NumericRange | null {
  if (field === 'surfHeight') return parseSurf(value);
  if (field === 'waterTemperature') return parseWaterTemp(value);
  return null;
}
