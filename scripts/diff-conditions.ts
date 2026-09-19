// Compares two /api/conditions snapshots and separates code effects from real forecast updates.
//
// A zone whose forecast was reissued between snapshots is expected to differ. A zone whose
// forecast is unchanged must NOT differ — any change there is a code regression.
//
//   npx tsx scripts/diff-conditions.ts before.json after.json

import fs from 'node:fs';

interface Obs { value: string | null; subArea: string | null; extractor: string; confidence: string }
interface Zone {
  zoneId: string; period: string; risk: string; firedRule: string; issuedAt: string;
  observations: Record<string, Obs[]>;
}

// Strip a UTF-8 BOM: PowerShell's Out-File writes one, and JSON.parse rejects it.
const load = (p: string): Map<string, Zone> =>
  new Map((JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')).zones as Zone[])
    .map((z) => [`${z.zoneId}|${z.period}`, z]));

const fingerprint = (z: Zone) =>
  Object.entries(z.observations).sort(([a], [b]) => a.localeCompare(b))
    .map(([field, list]) => `${field}=${list.map((o) => `${o.subArea ?? ''}:${o.value}`).join(';')}`).join(' | ');

const [beforePath, afterPath] = process.argv.slice(2);
const before = load(beforePath), after = load(afterPath);

const onlyBefore = [...before.keys()].filter((k) => !after.has(k));
const onlyAfter = [...after.keys()].filter((k) => !before.has(k));
let sameDoc = 0, sameDocChanged = 0, newDoc = 0, riskChanged = 0;

for (const [key, b] of before) {
  const a = after.get(key);
  if (!a) continue;
  const reissued = a.issuedAt !== b.issuedAt;
  if (reissued) { newDoc++; continue; }
  sameDoc++;
  const fb = fingerprint(b), fa = fingerprint(a);
  if (fb !== fa || a.risk !== b.risk || a.firedRule !== b.firedRule) {
    sameDocChanged++;
    console.log(`\nUNEXPECTED CHANGE (same forecast) ${key}`);
    if (a.risk !== b.risk) console.log(`  risk: ${b.risk} → ${a.risk}`);
    if (a.firedRule !== b.firedRule) console.log(`  rule: ${b.firedRule} → ${a.firedRule}`);
    if (fb !== fa) { console.log(`  before: ${fb}`); console.log(`  after:  ${fa}`); }
  }
  if (a.risk !== b.risk) riskChanged++;
}

console.log(`\nzone-periods: ${before.size} before, ${after.size} after` +
  (onlyBefore.length ? `, ${onlyBefore.length} disappeared: ${onlyBefore.slice(0, 5).join(',')}` : '') +
  (onlyAfter.length ? `, ${onlyAfter.length} new: ${onlyAfter.slice(0, 5).join(',')}` : ''));
console.log(`forecast reissued (differences expected): ${newDoc}`);
console.log(`same forecast: ${sameDoc}, of which changed: ${sameDocChanged}`);
console.log(sameDocChanged === 0
  ? 'PASS — no code-caused changes where the forecast was unchanged'
  : 'REVIEW — changes above are not explained by a new forecast');
process.exit(sameDocChanged === 0 ? 0 : 1);
