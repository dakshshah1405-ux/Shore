'use client';

import { useEffect, useMemo, useState } from 'react';
import { pointOnFeature } from '@turf/turf';
import ZoneMap from './ZoneMap';
import ZonePanel from './ZonePanel';
import { RISK, RISK_ORDER } from '@/lib/present';
import { maxNumeric, worstRank } from '@/lib/risk';
import type { Period, ZoneCondition } from '@/lib/types';

interface Filters {
  rip: 'all' | 'moderate' | 'high';
  thunder: boolean;
  maxSurf: number | null;   // show zones with surf at or below this
  minWater: number | null;  // show zones with water at or above this
}
const NO_FILTERS: Filters = { rip: 'all', thunder: false, maxSurf: null, minWater: null };

// A zone matches only if it has the data to prove it. Missing data never satisfies a
// filter — "surf under 2 ft" must not highlight a zone whose surf is unknown.
function matches(c: ZoneCondition | undefined, f: Filters): boolean {
  if (f.rip === 'all' && !f.thunder && f.maxSurf === null && f.minWater === null) return true;
  if (!c) return false;
  const o = c.observations;
  if (f.rip !== 'all') {
    const r = worstRank(o.ripCurrentRisk);
    if (r === null || r < (f.rip === 'high' ? 3 : 2)) return false;
  }
  if (f.thunder) {
    const t = worstRank(o.thunderstormPotential);
    if (t === null || t < 1) return false;
  }
  if (f.maxSurf !== null) {
    const s = maxNumeric(o.surfHeight);
    if (s === null || s > f.maxSurf) return false;
  }
  if (f.minWater !== null) {
    const mins = (o.waterTemperature ?? []).map((w) => w.numeric?.min).filter((v): v is number => typeof v === 'number');
    if (!mins.length || Math.min(...mins) < f.minWater) return false;
  }
  return true;
}

export default function ShoreApp() {
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const [conditions, setConditions] = useState<ZoneCondition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('today');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/zones.geojson').then((r) => r.json()),
      fetch('/api/conditions').then((r) => r.json()),
    ]).then(([g, c]) => {
      if (c.error) throw new Error(c.error);
      setGeo(g);
      setConditions(c.zones);
    }).catch((e) => setError(e.message));
  }, []);

  const byZone = useMemo(() => {
    const m = new Map<string, ZoneCondition>();
    for (const c of conditions) if (c.period === period) m.set(c.zoneId, c);
    return m;
  }, [conditions, period]);

  const { zones, labels, matchCount } = useMemo(() => {
    if (!geo) return { zones: null, labels: null, matchCount: 0 };
    let matchCount = 0;
    const features = geo.features.map((f) => {
      const id = f.properties?.zoneId as string;
      const c = byZone.get(id);
      const risk = c?.risk ?? 'unknown';
      const ok = matches(c, filters);
      if (ok) matchCount++;
      return { ...f, properties: { ...f.properties, risk, riskLabel: RISK[risk].label, dim: !ok } };
    });
    const labels = features.map((f) => ({ ...pointOnFeature(f as GeoJSON.Feature<GeoJSON.Polygon>), properties: f.properties }));
    return {
      zones: { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection,
      labels: { type: 'FeatureCollection', features: labels } as GeoJSON.FeatureCollection,
      matchCount,
    };
  }, [geo, byZone, filters]);

  const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const zone = selected ? byZone.get(selected) : undefined;
  const counts = RISK_ORDER.map((r) => [r, [...byZone.values()].filter((c) => c.risk === r).length] as const);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#EEF3F5]">
      <ZoneMap zones={zones} labels={labels} selected={selected} onSelect={setSelected} />

      <section className="absolute top-3 left-3 z-10 w-[min(360px,calc(100vw-24px))] rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Shore</h1>
          <span className="text-[11px] font-medium text-slate-500">NWS surf zone forecasts</span>
        </div>

        <div className="mt-3 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm font-semibold" role="tablist">
          {(['today', 'tomorrow'] as Period[]).map((p) => (
            <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)}
                    className={`rounded-md py-1.5 capitalize ${period === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              {p}
            </button>
          ))}
        </div>

        <fieldset className="mt-4 space-y-3">
          <legend className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">Highlight zones</legend>
          <div className="flex flex-wrap gap-1.5">
            {([['all', 'Any rip risk'], ['moderate', 'Rip: Moderate+'], ['high', 'Rip: High']] as const).map(([v, label]) => (
              <Chip key={v} on={filters.rip === v} onClick={() => setFilters({ ...filters, rip: v })}>{label}</Chip>
            ))}
            <Chip on={filters.thunder} onClick={() => setFilters({ ...filters, thunder: !filters.thunder })}>⚡ Thunderstorms</Chip>
          </div>
          <Slider label="Calm surf" unit="ft" prefix="≤" min={1} max={8} value={filters.maxSurf}
                  onChange={(v) => setFilters({ ...filters, maxSurf: v })} />
          <Slider label="Warm water" unit="°F" prefix="≥" min={55} max={85} value={filters.minWater}
                  onChange={(v) => setFilters({ ...filters, minWater: v })} />
          {filtering && (
            <p className="flex items-center justify-between text-xs text-slate-600">
              <span><b className="text-slate-900">{matchCount}</b> of {zones?.features.length ?? 0} zones match · zones without data never match</span>
              <button onClick={() => setFilters(NO_FILTERS)} className="font-semibold text-sky-700 underline">Clear</button>
            </p>
          )}
        </fieldset>

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Couldn&apos;t load conditions: {error}</p>}
        {!error && !geo && <p className="mt-3 text-sm text-slate-500">Loading forecasts…</p>}
      </section>

      <section className="absolute bottom-3 left-3 z-10 hidden rounded-xl border border-slate-200 bg-white/95 px-3 py-2.5 shadow-md backdrop-blur sm:block" aria-label="Legend">
        <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">Assessment</p>
        <ul className="mt-1.5 space-y-1">
          {counts.map(([r, n]) => (
            <li key={r} className="flex items-center gap-2 text-xs text-slate-700">
              <span className="h-3 w-3 rounded-sm" style={{ background: RISK[r].color, backgroundImage: r === 'unknown' ? 'repeating-linear-gradient(45deg,#4F5A60 0 2px,transparent 2px 5px)' : undefined }} />
              <span className="w-24 font-medium">{RISK[r].long}</span>
              <span className="tabular-nums text-slate-400">{n}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 max-w-[220px] text-[11px] leading-snug text-slate-500">Informational only. Follow lifeguards and posted signs.</p>
      </section>

      {zone && <ZonePanel zone={zone} onClose={() => setSelected(null)} />}
    </main>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 ${
              on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'}`}>
      {children}
    </button>
  );
}

function Slider({ label, unit, prefix, min, max, value, onChange }: {
  label: string; unit: string; prefix: string; min: number; max: number;
  value: number | null; onChange: (v: number | null) => void;
}) {
  const on = value !== null;
  return (
    <div className="flex items-center gap-3">
      <label className="flex w-28 shrink-0 items-center gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" checked={on} onChange={() => onChange(on ? null : Math.round((min + max) / 2))} className="h-4 w-4 accent-slate-900" />
        {label}
      </label>
      <input type="range" min={min} max={max} value={value ?? Math.round((min + max) / 2)} disabled={!on}
             onChange={(e) => onChange(Number(e.target.value))} aria-label={`${label} threshold`}
             className="flex-1 accent-slate-900 disabled:opacity-30" />
      <span className={`w-14 text-right text-sm tabular-nums ${on ? 'font-semibold text-slate-900' : 'text-slate-400'}`}>
        {prefix}{value ?? '—'}{unit}
      </span>
    </div>
  );
}
