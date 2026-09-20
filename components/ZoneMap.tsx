'use client';

import { useEffect, useRef } from 'react';
import { bbox } from '@turf/turf';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MLMap, GeoJSONSource, ExpressionSpecification } from 'maplibre-gl';
import { RISK } from '@/lib/present';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const EAST_COAST: [[number, number], [number, number]] = [[-82.5, 24.4], [-66.8, 45.3]];

const byRisk = (key: 'color' | 'ink'): ExpressionSpecification => [
  'match', ['get', 'risk'],
  'official', RISK.official[key], 'high', RISK.high[key], 'elevated', RISK.elevated[key],
  'lower', RISK.lower[key], RISK.unknown[key],
];

// Basemap palette: warm sand land against cool muted water. Deliberately no green, orange, red or
// purple — those belong to the risk scale, and the basemap must never compete with it.
const LAND = '#F4EEE3';
const LAND_TINT = '#ECE4D6';   // parks, landuse
const BUILDING = '#E4DBCB';
const WATER = '#BCD6E4';
const WATER_LINE = '#9FC2D6';

function paintBasemap(map: MLMap) {
  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id;
    const srcLayer = (layer as { 'source-layer'?: string })['source-layer'];
    try {
      if (layer.type === 'background') map.setPaintProperty(id, 'background-color', LAND);
      else if (srcLayer === 'water')
        map.setPaintProperty(id, layer.type === 'line' ? 'line-color' : 'fill-color',
          layer.type === 'line' ? WATER_LINE : WATER);
      else if (srcLayer === 'building') map.setPaintProperty(id, 'fill-color', BUILDING);
      else if (srcLayer === 'park' || srcLayer === 'landcover' || srcLayer === 'landuse')
        map.setPaintProperty(id, 'fill-color', LAND_TINT);
    } catch {
      // A basemap layer that doesn't take this paint property: leave it as the style had it.
    }
  }
}

// Diagonal hatch for zones without data, so "unknown" never reads as a flat color.
function hatchImage() {
  const size = 12;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if ((x + y) % 6 < 2) { const i = (y * size + x) * 4; data.set([79, 90, 96, 150], i); }
  }
  return { width: size, height: size, data };
}

interface Props {
  zones: GeoJSON.FeatureCollection | null;
  labels: GeoJSON.FeatureCollection | null;
  selected: string | null;
  onSelect: (zoneId: string | null) => void;
  focus: { zoneId: string; n: number } | null;   // search result to fly to
}

export default function ZoneMap({ zones, labels, selected, onSelect, focus }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const latest = useRef({ zones, labels, selected, onSelect });
  latest.current = { zones, labels, selected, onSelect };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { Map, NavigationControl, AttributionControl, setWorkerUrl } = await import('maplibre-gl');
      if (cancelled || !container.current) return;
      // MapLibre can't find its worker inside Next's bundle; serve it from public/ instead.
      setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
      const map = new Map({
        container: container.current,
        style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
        bounds: EAST_COAST,
        fitBoundsOptions: { padding: 24 },
        attributionControl: false,
      });
      mapRef.current = map;
      map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
      map.addControl(new AttributionControl({ compact: true }), 'bottom-right');

      map.on('load', () => {
        paintBasemap(map);
        map.addImage('hatch', hatchImage());
        map.addSource('zones', { type: 'geojson', data: latest.current.zones ?? EMPTY });
        map.addSource('labels', { type: 'geojson', data: latest.current.labels ?? EMPTY });

        map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: {
          'fill-color': byRisk('color'),
          'fill-opacity': ['case', ['get', 'dim'], 0.07, 0.42],
        } });
        map.addLayer({ id: 'zones-hatch', type: 'fill', source: 'zones', filter: ['==', ['get', 'risk'], 'unknown'],
          paint: { 'fill-pattern': 'hatch' } });
        map.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: {
          'line-color': byRisk('ink'),
          'line-width': 1.2,
          'line-opacity': ['case', ['get', 'dim'], 0.25, 0.9],
        } });
        map.addLayer({ id: 'zones-selected', type: 'line', source: 'zones',
          filter: ['==', ['get', 'zoneId'], latest.current.selected ?? ''],
          paint: { 'line-color': '#0B1B24', 'line-width': 3.5 } });
        // Text labels so risk is never communicated by color alone.
        map.addLayer({ id: 'zones-label', type: 'symbol', source: 'labels', minzoom: 5.2, layout: {
          'text-field': ['upcase', ['get', 'riskLabel']],
          'text-font': ['Open Sans Bold'],
          'text-size': 11,
          'text-letter-spacing': 0.06,
        }, paint: {
          'text-color': byRisk('ink'),
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.6,
          'text-opacity': ['case', ['get', 'dim'], 0.3, 1],
        } });

        map.on('click', (e) => {
          const hit = map.queryRenderedFeatures(e.point, { layers: ['zones-fill'] })[0];
          latest.current.onSelect((hit?.properties?.zoneId as string) ?? null);
        });
        map.on('mouseenter', 'zones-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'zones-fill', () => { map.getCanvas().style.cursor = ''; });
        ready.current = true;
      });
    })();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; ready.current = false; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    (map.getSource('zones') as GeoJSONSource | undefined)?.setData(zones ?? EMPTY);
    (map.getSource('labels') as GeoJSONSource | undefined)?.setData(labels ?? EMPTY);
  }, [zones, labels]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    map.setFilter('zones-selected', ['==', ['get', 'zoneId'], selected ?? '']);
  }, [selected]);

  // Fly to a zone chosen from search. maxZoom keeps small zones from filling the screen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current || !focus) return;
    const feature = zones?.features.find((f) => f.properties?.zoneId === focus.zoneId);
    if (!feature) return;
    const [w, s, e, n] = bbox(feature as GeoJSON.Feature);
    map.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: 9, duration: 900 });
  }, [focus, zones]);

  // MapLibre's stylesheet sets `position: relative` on the map element, and unlayered CSS beats
  // Tailwind's layered utilities — so the Tailwind sizing lives on a wrapper MapLibre never touches,
  // and the map element is sized with an inline style.
  return (
    <div className="absolute inset-0">
      <div ref={container} style={{ width: '100%', height: '100%' }} aria-label="Map of East Coast surf zones" />
    </div>
  );
}
