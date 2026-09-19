// Prints the computed risk for every zone (today) so the ladder can be eyeballed against the source.
process.loadEnvFile?.('.env.local');

import { getZoneConditions } from '../lib/conditions';

async function main() {
  const all = await getZoneConditions();
  const today = all.filter((c) => c.period === 'today').sort((a, b) => a.zoneId.localeCompare(b.zoneId));
  const counts: Record<string, number> = {};
  for (const c of today) {
    counts[c.risk] = (counts[c.risk] ?? 0) + 1;
    console.log(`${c.zoneId.padEnd(7)} ${c.risk.padEnd(9)} ${c.zoneName.padEnd(30)} ${c.firedRule}`);
  }
  console.log('\n', counts, `| ${today.length} zones today, ${all.length} zone-periods total`);
}

main().catch((e) => { console.error(e); process.exit(1); });
