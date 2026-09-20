// Adapter #3 end to end, against the live buoy network. Nothing is stored; this is the
// "add a source and it just works" demo. Run:
//
//   npx tsx scripts/try-ndbc.ts             # live, station 41025
//   npx tsx scripts/try-ndbc.ts 44009       # a different buoy
//   npx tsx scripts/try-ndbc.ts --fixture   # the committed sample, no network

import './load-env';
import fs from 'node:fs';
import path from 'node:path';
import { NDBC_STATIONS, ndbcUrl, parseNdbc } from '../lib/adapters/ndbc';

async function main() {
  const fixture = process.argv.includes('--fixture');
  const station = process.argv.find((a) => /^\d{5}$/.test(a)) ?? '41025';
  const url = ndbcUrl(station);

  let text: string;
  if (fixture) {
    text = fs.readFileSync(path.join('data', 'samples', `ndbc-${station}.txt`), 'utf8');
    console.log(`reading committed sample data/samples/ndbc-${station}.txt`);
  } else {
    const res = await fetch(url, { headers: { 'User-Agent': process.env.NWS_USER_AGENT ?? 'Shore/0.1' } });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    text = await res.text();
    console.log(`fetched ${url}`);
  }

  const p = parseNdbc(text, station);
  console.log(`\n${p.station.name}  (NDBC ${p.station.id})`);
  console.log(`${p.rows} observation rows · ${p.columns.length} columns · latest ${p.latestObservedAt}`);
  console.log(`\nThis document has no labels on its values — only column positions:\n`);
  console.log(text.split('\n').slice(0, 3).map((l) => `  ${l}`).join('\n'));

  console.log(`\nread ${p.read.length} of ${p.read.length + p.missing.length} columns we look for` +
    `${p.missing.length ? ` · not reported right now: ${p.missing.join(', ')}` : ''}\n`);

  for (const [field, list] of Object.entries(p.observations)) {
    for (const o of list ?? []) {
      const n = o.numeric;
      console.log(`  ${field.padEnd(18)} ${String(o.value).padEnd(12)} → ${n?.max} ${n?.unit}`);
      console.log(`  ${''.padEnd(18)} observed ${o.issuedAt}`);
      // The provenance claim, checked rather than asserted.
      const slice = text.slice(o.charStart!, o.charEnd!);
      const ok = slice === o.rawSpan;
      console.log(`  ${''.padEnd(18)} source chars ${o.charStart}–${o.charEnd} = ${JSON.stringify(slice)} ${ok ? '✓' : '✗ SPAN MISMATCH'}`);
      console.log(`  ${''.padEnd(18)} ${o.subArea}\n`);
    }
  }

  const all = Object.values(p.observations).flat();
  const bad = all.filter((o) => o!.rawSpan !== text.slice(o!.charStart!, o!.charEnd!));
  console.log(`${all.length} values, ${bad.length} span errors`);
  if (!fixture && !NDBC_STATIONS[station]) {
    console.log(`\nnote: no committed metadata for station ${station}; name and position are unknown.`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
