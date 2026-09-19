// Runs the deterministic SRF parser over data/samples/srf-*.txt and prints what it found.
// Also verifies every extracted span actually appears at its recorded offsets —
// if provenance is wrong, the whole traceability story is wrong.

import fs from 'node:fs';
import path from 'node:path';
import { parseSrf } from '../lib/adapters/srf';

const dir = path.join(process.cwd(), 'data', 'samples');
let spanErrors = 0;
const unmapped = new Set<string>();

for (const file of fs.readdirSync(dir).filter((f) => f.startsWith('srf-'))) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const segs = parseSrf(text);
  console.log(`\n=== ${file}: ${segs.length} segments ===`);

  for (const s of segs) {
    const first = s.periods[0];
    const rip = first?.fields.filter((f) => f.field === 'ripCurrentRisk').map((f) => (f.subArea ? `${f.subArea}: ${f.value}` : f.value));
    const surf = first?.fields.find((f) => f.field === 'surfHeight')?.value;
    const prose = s.periods.filter((p) => p.prose).length;
    console.log(
      `  ${s.zones.join(',').padEnd(14)} ${String(s.zoneName).padEnd(28)} ` +
      `periods=${s.periods.map((p) => p.label).join('|')}` +
      `  rip=[${rip?.join('; ')}] surf=${surf ?? '—'}` +
      (prose ? `  prose-periods=${prose}` : '') +
      (s.headlines.length ? `\n      HEADLINE: ${s.headlines.join(' / ')}` : ''),
    );

    for (const p of s.periods) for (const f of p.fields) {
      if (!f.field) unmapped.add(f.label);
      const actual = text.slice(f.charStart, f.charEnd);
      if (actual !== f.rawSpan) {
        spanErrors++;
        console.log(`    SPAN MISMATCH ${f.label}: expected ${JSON.stringify(f.rawSpan)} got ${JSON.stringify(actual)}`);
      }
    }
  }
}

console.log(`\nUnmapped labels (format drift to review): ${[...unmapped].join(', ') || 'none'}`);
console.log(`Provenance span errors: ${spanErrors}`);
process.exit(spanErrors ? 1 : 0);
