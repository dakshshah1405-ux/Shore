// Collects real NWS products that are NOT Surf Zone Forecasts, for the router evaluation.
// Several of them talk about rip currents and surf, which is the point: a keyword matcher
// routes them confidently into the wrong extractor.
//   npx tsx scripts/fetch-ood.ts

import fs from 'node:fs';
import path from 'node:path';
import { latestProduct, sleep } from '../lib/nws';

// Coastal products that mention beach hazards without SRF's per-zone field structure.
const TYPES = ['SPS', 'CFW', 'MWS', 'CWF', 'NSH', 'HWO', 'AFD'];
const WFOS = ['MHX', 'PHI', 'MFL', 'BOX', 'ILM', 'AKQ'];

async function main() {
  const dir = path.join('data', 'ood');
  fs.mkdirSync(dir, { recursive: true });
  let saved = 0;

  for (const type of TYPES) {
    for (const wfo of WFOS) {
      try {
        const prod = await latestProduct(type, wfo);
        if (!prod?.productText) continue;
        fs.writeFileSync(path.join(dir, `${type}-${wfo}.txt`), prod.productText);
        console.log(`${type}-${wfo}: ${prod.productText.length} chars`);
        saved++;
        break;   // one per type is enough
      } catch {
        // office doesn't issue this product; try the next
      }
      await sleep(250);
    }
  }
  console.log(`\nsaved ${saved} out-of-distribution products to ${dir}`);
}

main();
