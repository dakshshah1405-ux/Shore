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

// Basemap palette: muted sage land against ocean blue. The land green is deliberately low
// saturation, because the risk scale's "lower" is also green — keeping the basemap desaturated
// lets a saturated risk fill still read on top of it. Zone labels carry the wording regardless,
// so risk is never conveyed by colour alone.
const LAND = '#BBCCA8';
const LAND_TINT = '#AEC298';   // parks, landuse
const BUILDING = '#A5BA8D';
const WATER = '#A1C3DD';
const WATER_LINE = '#85AAC9';

function paintBasemap(map: MLMap, satellite = false) {
  paintPlaceLabels(map, satellite);
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

// Public-domain aerial imagery from USGS/USDA The National Map. No key, no billing, and it keeps
// every source in this project a U.S. government one. Note the ArcGIS tile path is {z}/{y}/{x}.
// It carries no imagery over open ocean, so those tiles 404 and our water colour shows through.
const USGS_IMAGERY = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
const USGS_ATTRIBUTION = 'Imagery: USGS/USDA <a href="https://basemap.nationalmap.gov/">The National Map</a> orthoimagery — periodic, not live';

// The basemap carries place labels ranked by size. We show the big cities from the overview zoom
// down, hide hamlets/suburbs/villages entirely, and hold towns back until you're zoomed well in —
// the map should orient you by city, not clutter the coast with every small place.
const CITY_MINZOOM: Record<string, number> = {
  place_city_dot_r2: 3,   // largest cities
  place_city_dot_r4: 4,
  place_city_dot_r7: 5,
  place_state: 4,
};
const HIDE_PLACES = ['place_hamlet', 'place_suburbs', 'place_villages'];

function paintPlaceLabels(map: MLMap, satellite: boolean) {
  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id;
    if ((layer as { 'source-layer'?: string })['source-layer'] !== 'place') continue;
    try {
      if (HIDE_PLACES.includes(id)) { map.setLayoutProperty(id, 'visibility', 'none'); continue; }
      if (id === 'place_town') map.setLayerZoomRange(id, 11, 16);
      else if (CITY_MINZOOM[id] !== undefined) map.setLayerZoomRange(id, CITY_MINZOOM[id], layer.maxzoom ?? 24);
      if (layer.type === 'symbol') {
        map.setPaintProperty(id, 'text-color', satellite ? '#FFFFFF' : '#31413A');
        map.setPaintProperty(id, 'text-halo-color', satellite ? 'rgba(0,0,0,0.75)' : '#FFFFFF');
        map.setPaintProperty(id, 'text-halo-width', 1.5);
      }
    } catch {
      // Not every place layer takes every property; leave those as the style had them.
    }
  }
}

// Risk fills have to stay legible over busy photography, so they get stronger over imagery.
function setSatelliteStyling(map: MLMap, on: boolean) {
  map.setPaintProperty('zones-fill', 'fill-opacity', ['case', ['get', 'dim'], on ? 0.10 : 0.05, on ? 0.55 : 0.42]);
  map.setPaintProperty('zones-line', 'line-width', on ? 1.8 : 1.2);
  map.setPaintProperty('zones-label', 'text-halo-width', on ? 2.2 : 1.6);
  map.setPaintProperty('zones-label', 'text-color', on ? '#0B1B24' : byRisk('ink'));
  paintPlaceLabels(map, on);
}

interface Props {
  zones: GeoJSON.FeatureCollection | null;
  labels: GeoJSON.FeatureCollection | null;
  selected: string | null;
  onSelect: (zoneId: string | null) => void;
  focus: { zoneId: string; n: number } | null;   // search result to fly to
  satellite: boolean;
}

export default function ZoneMap({ zones, labels, selected, onSelect, focus, satellite }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const latest = useRef({ zones, labels, selected, onSelect, satellite });
  latest.current = { zones, labels, selected, onSelect, satellite };

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
        paintBasemap(map, latest.current.satellite);
        map.addImage('hatch', hatchImage());
        map.addSource('zones', { type: 'geojson', data: latest.current.zones ?? EMPTY });
        map.addSource('labels', { type: 'geojson', data: latest.current.labels ?? EMPTY });

        // Insert the zone layers beneath the basemap's labels so city names stay readable on top.
        const firstLabel = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;

        map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: {
          'fill-color': byRisk('color'),
          'fill-opacity': ['case', ['get', 'dim'], 0.07, 0.42],
        } }, firstLabel);
        map.addLayer({ id: 'zones-hatch', type: 'fill', source: 'zones', filter: ['==', ['get', 'risk'], 'unknown'],
          paint: { 'fill-pattern': 'hatch' } }, firstLabel);
        map.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: {
          'line-color': byRisk('ink'),
          'line-width': 1.2,
          'line-opacity': ['case', ['get', 'dim'], 0.25, 0.9],
        } }, firstLabel);
        map.addLayer({ id: 'zones-selected', type: 'line', source: 'zones',
          filter: ['==', ['get', 'zoneId'], latest.current.selected ?? ''],
          paint: { 'line-color': '#0B1B24', 'line-width': 3.5 } }, firstLabel);
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
          // Filtered-out zones drop their label entirely: keeping the risk word on a greyed zone
          // made filtering hard to read at a glance.
          'text-opacity': ['case', ['get', 'dim'], 0, 1],
        } });

        // Imagery sits above the basemap's own fills but below the risk zones, so place labels
        // from the basemap still render on top of it.
        map.addSource('usgs-imagery', { type: 'raster', tiles: [USGS_IMAGERY], tileSize: 256, maxzoom: 16, attribution: USGS_ATTRIBUTION });
        map.addLayer({ id: 'usgs-imagery', type: 'raster', source: 'usgs-imagery',
          layout: { visibility: latest.current.satellite ? 'visible' : 'none' } }, 'zones-fill');
        setSatelliteStyling(map, latest.current.satellite);

        // Tiles are missing over open ocean by design; don't fill the console with those.
        map.on('error', (e) => {
          const status = (e as unknown as { error?: { status?: number } }).error?.status;
          if (status !== 404) console.error(e.error ?? e);
        });

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    map.setLayoutProperty('usgs-imagery', 'visibility', satellite ? 'visible' : 'none');
    setSatelliteStyling(map, satellite);
  }, [satellite]);

  // Fly to a zone, whether chosen from search or clicked on the map. Selecting always opens the
  // detail panel, so the padding leaves room for it — on the right on desktop, at the bottom on
  // phones — otherwise the zone lands behind the panel. maxZoom stops small zones filling the screen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current || !focus) return;
    // Read zones from the ref, not the dependency array: filtering rebuilds the zones object on
    // every change, and depending on it here made adjusting a filter fly the camera.
    const feature = latest.current.zones?.features.find((f) => f.properties?.zoneId === focus.zoneId);
    if (!feature) return;
    const [w, s, e, n] = bbox(feature as GeoJSON.Feature);
    const wide = window.innerWidth >= 768;
    map.fitBounds([[w, s], [e, n]], {
      padding: {
        top: 60,
        right: wide ? 460 : 40,
        bottom: wide ? 60 : Math.round(window.innerHeight * 0.5),
        left: wide ? 400 : 40,   // clear of the controls column
      },
      maxZoom: 9,
      duration: 900,
    });
  }, [focus]);

  // MapLibre's stylesheet sets `position: relative` on the map element, and unlayered CSS beats
  // Tailwind's layered utilities — so the Tailwind sizing lives on a wrapper MapLibre never touches,
  // and the map element is sized with an inline style.
  return (
    <div className="absolute inset-0">
      <div ref={container} style={{ width: '100%', height: '100%' }} aria-label="Map of East Coast surf zones" />
    </div>
  );
}
