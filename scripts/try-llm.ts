// Runs Nemotron + the judge on chosen zones and prints every accepted and rejected value.
//   npx tsx scripts/try-llm.ts srf-GYX.txt:NHZ014 srf-MHX.txt:NCZ205 srf-ILM.txt:NCZ106 [--think]
process.loadEnvFile?.('.env.local');

import fs from 'node:fs';
import path from 'node:path';
import { parseSrf } from '../lib/adapters/srf';
import { extractSegment } from '../lib/extract/srf-llm';

async function main() {
  const think = process.argv.includes('--think');
  const targets = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  for (const t of targets) {
    const [file, zone] = t.split(':');
    const text = fs.readFileSync(path.join('data', 'samples', file), 'utf8');
    const seg = parseSrf(text).find((s) => s.zones.includes(zone));
    if (!seg) { console.log(`${t}: zone not found`); continue; }
    const r = await extractSegment(text, seg, { think });
    const acc = r.fields.filter((f) => f.status === 'accepted');
    const rej = r.fields.filter((f) => f.status === 'rejected');
    console.log(`\n=== ${t} (${seg.zoneName}) · ${r.latencyMs} ms${r.cached ? ' cached' : ''} · parsed=${r.parsed} · ${acc.length} accepted, ${rej.length} rejected`);
    for (const f of acc)
      console.log(`  ✓ ${f.periodLabel.padEnd(14)} ${f.field.padEnd(22)} ${(f.subArea ? `[${f.subArea}] ` : '') + f.value}   ⟵ ${JSON.stringify(f.rawSpan)}`);
    for (const f of rej)
      console.log(`  ✗ ${f.periodLabel.padEnd(14)} ${f.field.padEnd(22)} ${f.value}   (${f.reason}) quote=${JSON.stringify(f.quote)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
