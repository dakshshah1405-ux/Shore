// Lists stored alerts that touch our surf zones, and which zones they touch.
process.loadEnvFile?.('.env.local');

import fs from 'node:fs';
import { db } from '../lib/db';

async function main() {
  const ours = new Set<string>(
    JSON.parse(fs.readFileSync('public/zones.geojson', 'utf8')).features.map((f: { properties: { zoneId: string } }) => f.properties.zoneId),
  );
  const rows = (await db().query('select event, severity, expires, zones from alerts order by event')) as
    { event: string; severity: string; expires: string | null; zones: string[] }[];
  const hits = rows.filter((r) => r.zones.some((z) => ours.has(z)));
  console.log(`${rows.length} active alerts stored; ${hits.length} touch our ${ours.size} surf zones`);
  for (const r of hits)
    console.log(`  ${r.event.padEnd(30)} ${String(r.severity).padEnd(9)} until ${r.expires ? new Date(r.expires).toISOString() : '—'}  ${r.zones.filter((z) => ours.has(z)).join(',')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
