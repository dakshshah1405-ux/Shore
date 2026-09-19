// Builds public/zones.geojson: one simplified polygon per coastal zone that has a
// Surf Zone Forecast. The zone list comes from the SRF products themselves, so we
// only fetch geometry for zones that actually carry beach forecasts.
//
// Run once (and again only if NWS changes its zones): npx tsx scripts/build-zones.ts
// Also refreshes data/samples/srf-<WFO>.txt for every office.

import fs from 'node:fs';
import path from 'node:path';
import { simplify } from '@turf/turf';
import { EAST_COAST_WFOS, latestProduct, nwsGet, sleep } from '../lib/nws';
import { parseSrf } from '../lib/adapters/srf';

interface ZoneInfo { wfo: string; name: string | null; beaches: string[] }
interface ZoneFeature { geometry: GeoJSON.Geometry | null; properties?: { name?: string } }

async function main() {
  const zones = new Map<string, ZoneInfo>();
  fs.mkdirSync(path.join('data', 'samples'), { recursive: true });

  for (const wfo of EAST_COAST_WFOS) {
    try {
      const prod = await latestProduct('SRF', wfo);
      if (!prod) { console.warn(`${wfo}: no SRF`); continue; }
      fs.writeFileSync(path.join('data', 'samples', `srf-${wfo}.txt`), prod.productText);
      for (const seg of parseSrf(prod.productText))
        for (const z of seg.zones) zones.set(z, { wfo, name: seg.zoneName, beaches: seg.beaches });
      console.log(`${wfo}: ok`);
    } catch (e) {
      console.warn(`${wfo}: ${(e as Error).message}`);
    }
    await sleep(300);
  }
  console.log(`${zones.size} zones found`);

  const features: GeoJSON.Feature[] = [];
  for (const [zoneId, info] of zones) {
    try {
      const f = await nwsGet<ZoneFeature>(`https://api.weather.gov/zones/forecast/${zoneId}`, 'application/geo+json');
      if (!f.geometry) { console.warn(`${zoneId}: no geometry`); continue; }
      features.push(simplify(
        {
          type: 'Feature',
          properties: { zoneId, name: info.name ?? f.properties?.name ?? zoneId, wfo: info.wfo, beaches: info.beaches },
          geometry: f.geometry,
        } as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
        { tolerance: 0.001, highQuality: false },
      ));
    } catch (e) {
      console.warn(`${zoneId}: ${(e as Error).message}`);
    }
    await sleep(300);
  }

  const out = path.join('public', 'zones.geojson');
  fs.writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }));
  console.log(`wrote ${features.length} features to ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}

main();
