// Parser tests for the values the filters depend on. Run: npx tsx --test lib/normalize.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHeatIndex, parseSurf, parseWaterTemp, parseWind, uvRank } from './normalize';

test('wind takes the highest stated speed', () => {
  assert.deepEqual(parseWind('East winds 10 to 15 mph'), { min: 10, max: 15, unit: 'mph', approximate: false });
  assert.equal(parseWind('East winds around 15 mph')?.max, 15);
  assert.equal(parseWind('Northeast 10 to 15 mph.')?.max, 15);
  assert.equal(parseWind('North winds around 5 mph, becoming east in the afternoon')?.max, 5);
  assert.equal(parseWind('Light and variable winds, becoming east around 5 mph in the afternoon')?.max, 5);
});

test('wind with no stated number is unknown, not calm', () => {
  assert.equal(parseWind('Light and variable winds'), null, 'must not be treated as 0 mph');
  assert.equal(parseWind('Winds becoming onshore'), null);
});

test('heat index', () => {
  assert.equal(parseHeatIndex('Up to 100.')?.max, 100);
  assert.equal(parseHeatIndex('None')?.max, undefined);
});

test('uv levels rank in order, including Very High', () => {
  assert.ok(uvRank('Very High')! > uvRank('High')!);
  assert.ok(uvRank('High')! > uvRank('Moderate')!);
  assert.equal(uvRank('banana'), null);
  assert.equal(uvRank(null), null);
});

test('existing parsers still behave', () => {
  assert.deepEqual(parseSurf('2 to 3 feet'), { min: 2, max: 3, unit: 'ft', approximate: false });
  assert.equal(parseSurf('1 foot or less')?.max, 1);
  assert.equal(parseWaterTemp('In the upper 70s')?.min, 77);
  assert.equal(parseWaterTemp('62 degrees')?.max, 62);
});
