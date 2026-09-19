// Replays reconciliation on the latest stored SRF for each office and prints every place the
// parser and Nemotron disagreed. Uses cached Nemotron responses, so it costs no API calls
// when the documents were already ingested.   npx tsx scripts/show-disagreements.ts [WFO ...]
process.loadEnvFile?.('.env.local');

import { db } from '../lib/db';
import { parseSrf } from '../lib/adapters/srf';
import { extractSegment } from '../lib/extract/srf-llm';
import { reconcile } from '../lib/extract/reconcile';

async function main() {
  const only = process.argv.slice(2).map((s) => s.toUpperCase());
  const docs = (await db().query(`
    select distinct on (substring(text from 'SRF([A-Z]{3})')) id, text, substring(text from 'SRF([A-Z]{3})') as wfo
    from documents where source_id = 'nws-srf'
    order by substring(text from 'SRF([A-Z]{3})'), issued_at desc`)) as { id: string; text: string; wfo: string }[];

  let total = 0;
  for (const d of docs) {
    if (only.length && !only.includes(d.wfo)) continue;
    for (const seg of parseSrf(d.text)) {
      const ex = await extractSegment(d.text, seg);
      const { disagreements } = reconcile(seg, ex.fields);
      for (const x of disagreements) {
        total++;
        console.log(`\n${d.wfo} ${seg.zones[0]} ${seg.zoneName} · ${x.periodLabel} · ${x.field}${x.subArea ? ` [${x.subArea}]` : ''}${ex.cached ? '' : ' (live call)'}`);
        console.log(`  parser:   ${x.regex ?? '(no value under this sub-area)'}`);
        console.log(`  nemotron: ${x.nemotron}   quote=${JSON.stringify(x.nemotronQuote)}`);
      }
    }
  }
  console.log(`\n${total} disagreements`);
}

main().catch((e) => { console.error(e); process.exit(1); });
