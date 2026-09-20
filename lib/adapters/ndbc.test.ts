// NDBC adapter tests. No network. Run:
//   npx tsx --test lib/adapters/ndbc.test.ts
//
// The first test is the one that matters: the same provenance invariant the SRF parser is held
// to — every rawSpan must be the literal slice of the source at its own offsets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseNdbc } from './ndbc';

const FIXTURE = path.join('data', 'samples', 'ndbc-41025.txt');
const text = fs.readFileSync(FIXTURE, 'utf8');
const parsed = parseNdbc(text, '41025', { retrievedAt: '2026-09-20T05:40:00.000Z' });
const all = Object.values(parsed.observations).flat();

test('provenance: every rawSpan is the exact slice of the source at its offsets', () => {
  assert.ok(all.length > 0, 'expected at least one observation');
  const errors = all.filter((o) => o.rawSpan !== text.slice(o.charStart!, o.charEnd!));
  assert.deepEqual(errors.map((o) => o.field), [], '0 span errors');
});

test('the positional header is read as column names and units', () => {
  assert.equal(parsed.columns[0], 'YY');
  assert.ok(parsed.columns.includes('WVHT'));
  assert.equal(parsed.units[parsed.columns.indexOf('WVHT')], 'm');
  assert.equal(parsed.units[parsed.columns.indexOf('WTMP')], 'degC');
});

test('values keep the source wording and its published unit', () => {
  assert.equal(parsed.observations.waterTemperature?.[0].value, '28.6 degC');
  assert.equal(parsed.observations.winds?.[0].value, '5.0 m/s');
});

test('numbers convert into the units the rest of Shore uses', () => {
  assert.equal(parsed.observations.waterTemperature?.[0].numeric?.unit, 'F');
  assert.equal(parsed.observations.waterTemperature?.[0].numeric?.max, 83.5);   // 28.6 degC
  assert.equal(parsed.observations.surfHeight?.[0].numeric?.max, 4.6);          // 1.4 m
  assert.equal(parsed.observations.winds?.[0].numeric?.max, 11.2);              // 5.0 m/s
});

test('MM in the newest row falls back to an older row, and keeps that row\'s timestamp', () => {
  // The newest row (05:10) reports WVHT as MM; the most recent stated wave height is 04:50.
  assert.equal(parsed.latestObservedAt, '2026-09-20T05:10:00.000Z');
  assert.equal(parsed.observations.waterTemperature?.[0].issuedAt, '2026-09-20T05:10:00.000Z');
  assert.equal(parsed.observations.surfHeight?.[0].issuedAt, '2026-09-20T04:50:00.000Z');
});

test('a buoy reading is labelled as a buoy reading, never as a beach', () => {
  for (const o of all) {
    assert.match(o.subArea ?? '', /^NDBC 41025 —/);
    assert.equal(o.sourceId, 'ndbc');
    assert.equal(o.sourceUrl, 'https://www.ndbc.noaa.gov/data/realtime2/41025.txt');
  }
});

const HEAD =
  '#YY  MM DD hh mm WDIR WSPD GST  WVHT  WTMP\n' +
  '#yr  mo dy hr mn degT m/s  m/s     m  degC\n';

test('a column that is missing everywhere yields no observation, not a guess', () => {
  const doc = HEAD + '2026 09 20 05 10 120  5.0  7.0    MM  28.6\n2026 09 20 05 00 110  5.0  7.0    MM  28.6\n';
  const p = parseNdbc(doc, '41025');
  assert.equal(p.observations.surfHeight, undefined);
  assert.ok(p.missing.includes('WVHT'));
  assert.ok(p.read.includes('WTMP'));
});

test('a reading older than the staleness bound is dropped rather than shown as current', () => {
  // Wave height exists, but only in a row four hours behind the newest observation.
  const doc = HEAD +
    '2026 09 20 05 10 120  5.0  7.0    MM  28.6\n' +
    '2026 09 20 01 10 120  5.0  7.0   1.4  28.6\n';
  const p = parseNdbc(doc, '41025');
  assert.equal(p.observations.surfHeight, undefined, 'a 4-hour-old wave height must not be presented as current');
  assert.ok(p.observations.waterTemperature, 'the current water temperature is still read');
});
