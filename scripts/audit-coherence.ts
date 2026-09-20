// Offline QA: audit every live zone for internal contradictions and report them.
// Deliberately NOT in the request path — the website never calls Nemotron, so no model outage or
// latency can affect what a beachgoer sees. Run before a demo, or after a pipeline change.
//   npx tsx scripts/audit-coherence.ts [--limit N]
process.loadEnvFile?.('.env.local');

import { getZoneConditions } from '../lib/conditions';
import { auditZone, recomputeCheck } from '../lib/audit/coherence';

async function main() {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
  const zones = (await getZoneConditions()).filter((c) => c.period === 'today').slice(0, limit);

  let flagged = 0;
  for (const z of zones) {
    const recompute = recomputeCheck(z);
    const model = (await auditZone(z)).result;
    if (recompute.coherent && model.coherent) continue;
    flagged++;
    console.log(`\n${z.zoneId} ${z.zoneName} — ${z.risk} (${z.firedRule})`);
    if (!recompute.coherent) console.log(`  deterministic: ${recompute.issue}`);
    if (!model.coherent) console.log(`  nemotron:      ${model.issue}`);
  }
  console.log(`\n${zones.length} zones audited, ${flagged} flagged for review`);
}

main().catch((e) => { console.error(e); process.exit(1); });
