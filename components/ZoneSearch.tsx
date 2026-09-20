'use client';

import { useMemo, useRef, useState } from 'react';
import { buildSearchIndex, searchIndex, type SearchEntry } from '@/lib/search';

// Search over the names already parsed from the forecasts: beaches, zone names, zone IDs and
// states. Entirely client-side — no geocoder, no API, nothing that can fail on a beach with one
// bar of signal. Matching lives in lib/search.ts, which is unit tested against the real zone data.
// Selecting a result flies to that forecast zone: we have beach names, not beach coordinates.

export default function ZoneSearch({ geo, onSelect }: {
  geo: GeoJSON.FeatureCollection | null;
  onSelect: (zoneId: string) => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const index = useMemo(() => buildSearchIndex(geo), [geo]);
  const results = useMemo(() => searchIndex(index, q), [index, q]);
  const noCoverage = q.trim().length >= 2 && results.length === 0;

  const choose = (e: SearchEntry) => {
    onSelect(e.zoneId);
    setQ(e.label);
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative mt-3">
      <input
        ref={inputRef}
        type="search"
        value={q}
        placeholder="Search a beach, zone or state"
        aria-label="Search for a beach, forecast zone or state"
        role="combobox"
        aria-expanded={open && (results.length > 0 || noCoverage)}
        aria-controls="search-results"
        autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}   // let a click land first
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && results[active]) { e.preventDefault(); choose(results[active]); }
          else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
        }}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900
                   placeholder:text-slate-400 focus-visible:border-[var(--brand-blue-deep)]
                   focus-visible:outline-2 focus-visible:outline-[var(--brand-blue)]"
      />

      {open && (results.length > 0 || noCoverage) && (
        <ul id="search-results" role="listbox"
            className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {noCoverage ? (
            <li className="px-3 py-2 text-sm leading-snug text-slate-600">
              No coverage for “{q.trim()}”. Shore covers NWS coastal forecast zones in 13 East Coast states.
            </li>
          ) : results.map((e, i) => (
            <li key={`${e.zoneId}-${e.label}-${i}`} role="option" aria-selected={i === active}>
              <button
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => choose(e)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left ${i === active ? 'bg-[var(--brand-sand-soft)]' : ''}`}
              >
                <span className="truncate text-sm font-medium text-slate-900">{e.label}</span>
                <span className="shrink-0 text-[11px] text-slate-500">{e.isBeach ? e.sub : `zone · ${e.sub}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
