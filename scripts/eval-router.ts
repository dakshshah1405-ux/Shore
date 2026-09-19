// Role 2 eval: can the router tell a Surf Zone Forecast from every other NWS product, including
// ones that talk about rip currents at length?
//
// Cases: real SRF products (should route to srf) and real non-SRF products plus synthetic junk
// (should be rejected) — each in two variants:
//   full            — as issued, header intact
//   header-stripped — the WMO/AWIPS header removed, as if pasted from a web page
//
// The stripped variant is the honest test: with the header present a deterministic check is hard
// to beat, and we report that rather than hiding it.
//
//   npx tsx scripts/eval-router.ts
process.loadEnvFile?.('.env.local');

import fs from 'node:fs';
import path from 'node:path';
import { headerRoute, keywordRoute, routeDocument, type Schema } from '../lib/extract/router';

interface Case { id: string; text: string; expect: Schema; variant: 'full' | 'header-stripped' }

// Drops the WMO line, AWIPS id and title block that precede the first zone.
const stripHeader = (t: string) => {
  const lines = t.split('\n');
  const i = lines.findIndex((l) => /^[A-Z]{2}[CZ]\d{3}/.test(l));
  return i > 0 ? lines.slice(i).join('\n') : t;
};

const JUNK: [string, string][] = [
  ['junk-prose', 'Our quarterly revenue grew 12% year over year, driven by strong demand in the Northeast.\nThe board approved the dividend.'],
  ['junk-json', '{"station":"KMHX","observations":[{"t":"2026-09-19T12:00:00Z","waveHeightFt":3.2,"ripRisk":"moderate"}]}'],
  ['junk-empty', '   \n\n   '],
];

async function main() {
  const cases: Case[] = [];
  const add = (id: string, text: string, expect: Schema) => {
    cases.push({ id, text, expect, variant: 'full' });
    const stripped = stripHeader(text);
    if (stripped !== text) cases.push({ id: `${id}+stripped`, text: stripped, expect, variant: 'header-stripped' });
  };

  for (const f of fs.readdirSync(path.join('data', 'samples')).filter((f) => f.startsWith('srf-')).slice(0, 6))
    add(f, fs.readFileSync(path.join('data', 'samples', f), 'utf8'), 'srf');
  for (const f of fs.readdirSync(path.join('data', 'ood')))
    add(f, fs.readFileSync(path.join('data', 'ood', f), 'utf8'), 'none');
  for (const [id, text] of JUNK) cases.push({ id, text, expect: 'none', variant: 'full' });

  const configs = ['header baseline', 'keyword baseline', 'nemotron'] as const;
  const results: Record<string, { correct: number; total: number; misses: string[] }> = {};
  for (const c of configs) results[c] = { correct: 0, total: 0, misses: [] };
  const rows: Record<string, unknown>[] = [];

  for (const c of cases) {
    const got: Record<string, Schema> = {
      'header baseline': headerRoute(c.text).schema,
      'keyword baseline': keywordRoute(c.text).schema,
      'nemotron': (await routeDocument(c.text)).route.schema,
    };
    for (const cfg of configs) {
      results[cfg].total++;
      if (got[cfg] === c.expect) results[cfg].correct++;
      else results[cfg].misses.push(`${c.id} → ${got[cfg]} (want ${c.expect})`);
    }
    rows.push({ id: c.id, variant: c.variant, expect: c.expect, ...got });
    const mark = (s: Schema) => (s === c.expect ? ' ' : '✗');
    console.log(`${c.id.padEnd(26)} want ${c.expect.padEnd(5)} ` +
      configs.map((cfg) => `${cfg.split(' ')[0]}=${got[cfg]}${mark(got[cfg])}`).join('  '));
  }

  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
  const subset = (f: (c: Case) => boolean, cfg: string) => {
    const idx = cases.map((c, i) => [c, i] as const).filter(([c]) => f(c)).map(([, i]) => i);
    const ok = idx.filter((i) => (rows[i] as Record<string, unknown>)[cfg] === cases[i].expect).length;
    return pct(ok, idx.length);
  };

  console.log(`\n| Config | Overall | SRF recognised | Non-SRF rejected | Header-stripped |`);
  console.log(`|---|---|---|---|---|`);
  for (const cfg of configs)
    console.log(`| ${cfg} | ${pct(results[cfg].correct, results[cfg].total)} | ` +
      `${subset((c) => c.expect === 'srf', cfg)} | ${subset((c) => c.expect === 'none', cfg)} | ` +
      `${subset((c) => c.variant === 'header-stripped', cfg)} |`);

  for (const cfg of configs)
    if (results[cfg].misses.length) console.log(`\n${cfg} missed:\n  ${results[cfg].misses.join('\n  ')}`);

  fs.mkdirSync(path.join('eval', 'results'), { recursive: true });
  fs.writeFileSync(path.join('eval', 'results', 'router.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows, results }, null, 2));
  console.log(`\nwrote eval/results/router.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
