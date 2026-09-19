// Fetches the latest SRF from every East Coast office and stores it. Safe to re-run:
// products already in the database are skipped.  Run: npx tsx scripts/ingest.ts

process.loadEnvFile?.('.env.local');

import { EAST_COAST_WFOS, latestProduct, sleep } from '../lib/nws';
import { ingestSrf } from '../lib/ingest/srf';

async function main() {
  let stored = 0, skipped = 0, failed = 0, obs = 0;
  for (const wfo of EAST_COAST_WFOS) {
    try {
      const prod = await latestProduct('SRF', wfo);
      if (!prod) { console.log(`${wfo}: no SRF`); continue; }
      const r = await ingestSrf(prod);
      if (r.skipped) { skipped++; console.log(`${wfo}: already stored (${prod.issuanceTime})`); }
      else { stored++; obs += r.observations; console.log(`${wfo}: ${r.zones} zones, ${r.observations} values (${prod.issuanceTime})`); }
    } catch (e) {
      failed++;
      console.error(`${wfo}: FAILED ${(e as Error).message}`);
    }
    await sleep(300);
  }
  console.log(`\nstored ${stored}, skipped ${skipped}, failed ${failed}, ${obs} values`);
  process.exit(failed ? 1 : 0);
}

main();
