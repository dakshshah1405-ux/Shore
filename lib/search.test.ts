// Search tests against the real zone data. Run: npx tsx --test lib/search.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSearchIndex, editDistance, normalize, searchIndex } from './search';

const geo = JSON.parse(fs.readFileSync('public/zones.geojson', 'utf8')) as GeoJSON.FeatureCollection;
const index = buildSearchIndex(geo);
const top = (q: string) => searchIndex(index, q)[0]?.label;
const labels = (q: string) => searchIndex(index, q).map((e) => e.label);

test('the index covers zones and their beaches', () => {
  assert.ok(index.length > 200, `expected a few hundred entries, got ${index.length}`);
  assert.ok(index.some((e) => e.label === 'Rehoboth Beach' && e.isBeach));
  assert.ok(index.some((e) => e.label === 'Hatteras Island' && !e.isBeach));
});

test('exact and prefix matches', () => {
  assert.equal(top('rehoboth beach'), 'Rehoboth Beach');
  assert.equal(top('rehoboth'), 'Rehoboth Beach');
  assert.equal(top('nags'), 'Nags Head');
});

test('typos: missing letter, wrong letter, transposition, doubled letter', () => {
  assert.equal(top('rhoboth'), 'Rehoboth Beach', 'missing e');
  assert.equal(top('rehiboth'), 'Rehoboth Beach', 'wrong vowel');
  assert.equal(top('rehobtoh'), 'Rehoboth Beach', 'transposed th');
  assert.equal(top('rehobboth'), 'Rehoboth Beach', 'doubled b');
});

test('missing spaces and extra whitespace', () => {
  assert.equal(top('nagshead'), 'Nags Head');
  assert.equal(top('   nags   head   '), 'Nags Head');
});

test('punctuation is ignored', () => {
  assert.ok(labels('st augustine').some((l) => l.startsWith('St. Augustine')));
  assert.ok(labels('st. augustine').some((l) => l.startsWith('St. Augustine')));
});

test('words can be given in any order', () => {
  assert.equal(top('beach rehoboth'), 'Rehoboth Beach');
});

test('zone ids, with or without a space', () => {
  assert.equal(searchIndex(index, 'NCZ203')[0]?.zoneId, 'NCZ203');
  assert.equal(searchIndex(index, 'ncz 203')[0]?.zoneId, 'NCZ203');
});

test('states match, by name and abbreviation', () => {
  assert.ok(searchIndex(index, 'delaware').length > 0);
  assert.ok(searchIndex(index, 'north carolina').every((e) => e.zoneId.startsWith('NC')));
});

test('places we do not cover return nothing rather than a wrong guess', () => {
  for (const q of ['pittsburgh', 'denver', 'lake michigan', 'zzzzzzzz'])
    assert.deepEqual(searchIndex(index, q), [], `${q} should not match`);
});

test('queries that are too short return nothing', () => {
  for (const q of ['', ' ', 'a', '.']) assert.deepEqual(searchIndex(index, q), []);
});

test('results stay varied: no more than three entries from one zone', () => {
  const counts = new Map<string, number>();
  for (const e of searchIndex(index, 'beach')) counts.set(e.zoneId, (counts.get(e.zoneId) ?? 0) + 1);
  for (const [zone, n] of counts) assert.ok(n <= 3, `${zone} contributed ${n} results`);
});

test('a two-letter typo in a short word does not match everything', () => {
  assert.deepEqual(searchIndex(index, 'xyz'), []);
});

test('normalize and editDistance behave', () => {
  assert.equal(normalize('  St. Augustine—South  '), 'st augustine south');
  assert.equal(editDistance('rehoboth', 'rehobtoh'), 1, 'transposition costs 1');
  assert.equal(editDistance('nags', 'nags'), 0);
  assert.equal(editDistance('abc', 'xyz', 2), 3, 'beyond the cutoff');
});
