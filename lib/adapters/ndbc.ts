// Adapter #3: NDBC buoy observations — the third document shape this pipeline reads.
//
// Where SRF is labelled fixed-width text and CAP is structured JSON, this is a positional
// numeric table with no labels on the values at all: two comment lines name the columns and
// their units, and every row after that is bare numbers whose meaning comes only from their
// position. Missing readings are the literal token `MM`. Rows are newest first.
//
//   #YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
//   #yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
//   2026 09 20 05 10 120  5.0  7.0    MM    MM    MM  MM 1015.9  26.8  28.6  21.9   MM   MM    MM
//
// Two things this adapter will not do, both of them safety rules rather than style:
//
//   1. A buoy is not a beach. These are moored offshore — 41025 sits ~35.03N 75.38W, well out
//      from the Outer Banks — so every observation carries the station in `subArea` and none of
//      this feeds the risk ladder. Wave height at a buoy is not surf height at the shore.
//   2. `MM` means missing and stays missing. It is never carried forward from an older row
//      without saying so: a value taken from an earlier row keeps *that row's* timestamp, and
//      anything older than MAX_AGE_MS is dropped to null rather than presented as current.

import type { FieldName, NumericRange, Observation } from '../types';

export interface NdbcStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

// Station metadata is NDBC's own, from the station's latest-observation feed.
export const NDBC_STATIONS: Record<string, NdbcStation> = {
  '41025': { id: '41025', name: 'Diamond Shoals, NC', lat: 35.026, lon: -75.380 },
  '44009': { id: '44009', name: 'Delaware Bay, 26 NM southeast of Cape May, NJ', lat: 38.457, lon: -74.702 },
  '41008': { id: '41008', name: 'Grays Reef, GA', lat: 31.400, lon: -80.866 },
};

export const ndbcUrl = (stationId: string) => `https://www.ndbc.noaa.gov/data/realtime2/${stationId}.txt`;

// A reading older than this is dropped rather than shown as current.
const MAX_AGE_MS = 3 * 60 * 60 * 1000;
const MISSING = 'MM';

// Which columns we read, and how each converts into the units the rest of Shore uses.
// Only three: the ones that are safety-relevant and already exist in the shared FieldName
// contract. Adding a column here does not require touching anything downstream.
const COLUMNS: { column: string; field: FieldName; unit: NumericRange['unit']; convert: (n: number) => number }[] = [
  { column: 'WVHT', field: 'surfHeight', unit: 'ft', convert: (m) => m * 3.28084 },
  { column: 'WTMP', field: 'waterTemperature', unit: 'F', convert: (c) => (c * 9) / 5 + 32 },
  { column: 'WSPD', field: 'winds', unit: 'mph', convert: (ms) => ms * 2.23694 },
];

interface Token { text: string; start: number; end: number }
interface Row { tokens: Token[]; observedAt: string | null }

export interface NdbcParse {
  station: NdbcStation;
  columns: string[];
  units: string[];
  rows: number;
  latestObservedAt: string | null;
  observations: Partial<Record<FieldName, Observation[]>>;
  /** Columns we could read a value for, and columns that were missing everywhere in range. */
  read: string[];
  missing: string[];
}

// Tokens with byte offsets, so every value can point at the exact characters it came from.
function tokenize(line: string, lineStart: number): Token[] {
  const out: Token[] = [];
  for (const m of line.matchAll(/\S+/g)) {
    const start = lineStart + (m.index ?? 0);
    out.push({ text: m[0], start, end: start + m[0].length });
  }
  return out;
}

// The first five columns are the observation time, in UTC.
function rowTime(tokens: Token[]): string | null {
  const [y, mo, d, h, mi] = tokens.slice(0, 5).map((t) => Number(t.text));
  if ([y, mo, d, h, mi].some((n) => !Number.isFinite(n))) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function parseNdbc(
  text: string,
  stationId: string,
  opts: { retrievedAt?: string } = {},
): NdbcParse {
  const station = NDBC_STATIONS[stationId] ?? { id: stationId, name: `Station ${stationId}`, lat: NaN, lon: NaN };
  const retrievedAt = opts.retrievedAt ?? new Date().toISOString();
  const sourceUrl = ndbcUrl(stationId);

  // Walk the document once, keeping each line's absolute offset.
  const header: string[][] = [];
  const rows: Row[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith('#')) {
      // The leading '#' is part of the first column name ('#YY'); strip it for matching.
      header.push(trimmed.replace(/^#/, '').trim().split(/\s+/));
    } else if (trimmed.length > 0) {
      const tokens = tokenize(line, offset);
      rows.push({ tokens, observedAt: rowTime(tokens) });
    }
    offset += line.length + 1;   // +1 for the '\n' consumed by split
  }

  const columns = header[0] ?? [];
  const units = header[1] ?? [];
  const latestObservedAt = rows.find((r) => r.observedAt)?.observedAt ?? null;
  const newestMs = latestObservedAt ? Date.parse(latestObservedAt) : NaN;

  const observations: Partial<Record<FieldName, Observation[]>> = {};
  const read: string[] = [];
  const missing: string[] = [];

  for (const spec of COLUMNS) {
    const col = columns.indexOf(spec.column);
    if (col < 0) { missing.push(spec.column); continue; }
    const unitLabel = units[col] ?? '';

    // Newest first. Take the first row that actually states a number, and keep that row's
    // own timestamp — a value read from an older row is never relabelled as current.
    let found: Observation | null = null;
    for (const row of rows) {
      const tok = row.tokens[col];
      if (!tok || tok.text === MISSING) continue;
      const n = Number(tok.text);
      if (!Number.isFinite(n)) continue;
      if (row.observedAt && Number.isFinite(newestMs) && newestMs - Date.parse(row.observedAt) > MAX_AGE_MS) break;

      const converted = Math.round(spec.convert(n) * 10) / 10;
      found = {
        field: spec.field,
        // Source wording: the token exactly as published, with the units row's own label.
        value: unitLabel ? `${tok.text} ${unitLabel}` : tok.text,
        numeric: { min: converted, max: converted, unit: spec.unit, approximate: false },
        // A buoy reading must never read as a beach reading.
        subArea: `NDBC ${station.id} — ${station.name}`,
        sourceId: 'ndbc',
        sourceUrl,
        rawSpan: tok.text,
        charStart: tok.start,
        charEnd: tok.end,
        issuedAt: row.observedAt ?? retrievedAt,
        retrievedAt,
        extractor: 'regex',
        confidence: 'high',
        model: null,
        adjudicationReason: null,
      };
      break;
    }

    if (found) { observations[spec.field] = [found]; read.push(spec.column); }
    else missing.push(spec.column);   // stays absent: no value is invented to fill the gap
  }

  return { station, columns, units, rows: rows.length, latestObservedAt, observations, read, missing };
}
