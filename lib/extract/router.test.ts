// Deterministic router tests (no network). Run: npx tsx --test lib/extract/router.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { headerRoute, keywordRoute } from './router';

const read = (dir: string, f: string) => fs.readFileSync(path.join('data', dir, f), 'utf8');

test('the header check recognises a Surf Zone Forecast', () => {
  assert.equal(headerRoute(read('samples', 'srf-MHX.txt')).schema, 'srf');
});

test('the header check rejects other NWS products', () => {
  for (const f of fs.readdirSync(path.join('data', 'ood')))
    assert.equal(headerRoute(read('ood', f)).schema, 'none', `${f} should not route to srf`);
});

test('the keyword baseline is fooled by products that merely discuss rip currents', () => {
  // Documented failure: a Hazardous Weather Outlook contains the phrase "Rip Current Risk".
  assert.equal(keywordRoute(read('ood', 'HWO-MHX.txt')).schema, 'srf');
  assert.equal(headerRoute(read('ood', 'HWO-MHX.txt')).schema, 'none', 'the header check is not fooled');
});

test('the header check goes blind when the header is stripped', () => {
  const text = read('samples', 'srf-MHX.txt');
  const lines = text.split('\n');
  const stripped = lines.slice(lines.findIndex((l) => /^[A-Z]{2}[CZ]\d{3}/.test(l))).join('\n');
  assert.equal(headerRoute(stripped).schema, 'none', 'this is the case Nemotron is needed for');
});
