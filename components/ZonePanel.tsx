'use client';

import { useState } from 'react';
import type { FieldName, Observation, ZoneCondition } from '@/lib/types';
import { EXTRACTOR_LABEL, FIELD_LABEL, PRIMARY_FIELDS, RISK, SECONDARY_FIELDS, SOURCE_NAME, describeExtraction, formatEastern, hoursAgo } from '@/lib/present';

const OUTLOOK_FIELDS: FieldName[] = ['ripCurrentRisk', 'surfHeight', 'thunderstormPotential', 'waterTemperature'];

export default function ZonePanel({ zone, onClose }: { zone: ZoneCondition; onClose: () => void }) {
  const risk = RISK[zone.risk];
  const stale = Date.now() > new Date(zone.staleAfter).getTime();
  const secondary = SECONDARY_FIELDS.filter((f) => zone.observations[f]?.length);

  return (
    <aside
      className="fixed inset-x-0 bottom-0 z-20 max-h-[72vh] overflow-y-auto rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl
                 md:inset-y-3 md:right-3 md:left-auto md:max-h-none md:w-[420px] md:rounded-2xl md:border"
      aria-label={`Conditions for ${zone.zoneName}`}
    >
      {zone.alerts.map((a) => (
        <div key={a.id} className={`px-5 py-3 text-white ${/warning/i.test(a.event) ? 'bg-[#4A1D75]' : 'bg-[#7A4300]'}`}>
          <p className="text-[11px] font-bold tracking-[0.12em] uppercase">Official NWS {a.event}</p>
          <p className="mt-1 text-sm leading-snug">{a.headline}</p>
          {a.expires && <p className="mt-1 text-xs text-white/80">Until {formatEastern(a.expires)}</p>}
        </div>
      ))}

      <header className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-5 pt-4 pb-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
              {zone.zoneId} · {zone.periodLabel.toLowerCase()}
            </p>
            <h2 className="mt-0.5 text-xl leading-tight font-semibold text-balance text-slate-900">{zone.zoneName}</h2>
          </div>
          <button onClick={onClose} className="-mr-2 rounded-full p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-2"
                  aria-label="Close panel">✕</button>
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: `${risk.color}14`, boxShadow: `inset 3px 0 0 ${risk.color}` }}>
          <span className="rounded-md px-2 py-0.5 text-xs font-bold tracking-wide text-white uppercase" style={{ background: risk.color }}>
            {risk.label}
          </span>
          <span className="text-sm font-semibold" style={{ color: risk.ink }}>{risk.long}</span>
        </div>
      </header>

      <div className="space-y-5 px-5 py-4">
        {stale && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            ⚠ This forecast was issued {hoursAgo(zone.issuedAt)} hours ago and may be outdated.
          </p>
        )}

        <section>
          <h3 className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">Why</h3>
          <p className="mt-1 text-[15px] leading-relaxed text-slate-800">{zone.explanation ?? `${zone.firedRule}.`}</p>
        </section>

        {zone.headlines.map((h) => (
          <section key={h} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">Official NWS headline</p>
            <p className="mt-1 font-mono text-[13px] leading-snug text-slate-800">{h}</p>
          </section>
        ))}

        <section>
          <h3 className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">Conditions · tap a value for its source</h3>
          <dl className="mt-1 divide-y divide-slate-100">
            {PRIMARY_FIELDS.map((f) => <FieldRow key={f} field={f} obs={zone.observations[f]} />)}
            {secondary.map((f) => <FieldRow key={f} field={f} obs={zone.observations[f]} />)}
          </dl>
        </section>

        {zone.outlook.some((o) => OUTLOOK_FIELDS.some((f) => o.observations[f]?.length)) && (
          <section>
            <h3 className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">Later this week</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              The forecast writes these days as sentences. Nemotron extracted the values, and each was checked against the quoted text.
              Only what the forecast states is shown.
            </p>
            {zone.outlook.map((o) => {
              const present = OUTLOOK_FIELDS.filter((f) => o.observations[f]?.length);
              if (!present.length) return null;
              return (
                <div key={o.periodLabel} className="mt-2">
                  <p className="text-xs font-semibold text-slate-700 capitalize">{o.periodLabel.toLowerCase()}</p>
                  <dl className="divide-y divide-slate-100">
                    {present.map((f) => <FieldRow key={f} field={f} obs={o.observations[f]} />)}
                  </dl>
                </div>
              );
            })}
          </section>
        )}

        {zone.beaches.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">Beaches in this forecast zone</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-700">{zone.beaches.join(' · ')}</p>
          </section>
        )}

        <footer className="border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
          <p>Forecast issued {formatEastern(zone.issuedAt)}. Resolution is the NWS forecast zone, not an individual beach.</p>
          <p className="mt-2">
            Conditions change rapidly. Shore is an informational prototype and does not replace lifeguards, beach
            authorities, or emergency officials. Always follow posted signs and local instructions.
          </p>
        </footer>
      </div>
    </aside>
  );
}

function FieldRow({ field, obs }: { field: FieldName; obs?: Observation[] }) {
  const [open, setOpen] = useState(false);
  if (!obs?.length) {
    return (
      <div className="flex items-baseline justify-between gap-4 py-2.5">
        <dt className="text-sm text-slate-600">{FIELD_LABEL[field]}</dt>
        <dd className="text-sm text-slate-400 italic">Data unavailable</dd>
      </div>
    );
  }
  return (
    <div className="py-2.5">
      <button onClick={() => setOpen(!open)} aria-expanded={open}
              className="flex w-full items-baseline justify-between gap-4 rounded text-left focus-visible:outline-2">
        <dt className="shrink-0 text-sm text-slate-600">{FIELD_LABEL[field]}</dt>
        <dd className="text-right text-sm font-semibold text-slate-900">
          {obs.map((o, i) => (
            <span key={i} className="block">
              {o.subArea && <span className="font-normal text-slate-500">{o.subArea}: </span>}
              {o.value ?? 'Data unavailable'}
              <Badge obs={o} />
            </span>
          ))}
        </dd>
      </button>
      {open && obs.map((o, i) => <Provenance key={i} obs={o} />)}
    </div>
  );
}

// A small marker on each value: verified twice, AI-read, or a disagreement worth noticing.
function Badge({ obs }: { obs: Observation }) {
  if (obs.confidence === 'low')
    return <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-900" title="The parser and Nemotron read this differently; the parser's value is shown">⚠ check</span>;
  if (obs.extractor === 'reconciled')
    return <span className="ml-1.5 text-[10px] font-semibold text-emerald-700" title={EXTRACTOR_LABEL.reconciled}>✓✓</span>;
  if (obs.extractor === 'nemotron')
    return <span className="ml-1.5 rounded bg-[#E8F3DC] px-1 py-0.5 text-[10px] font-semibold text-[#3E6B12]" title={EXTRACTOR_LABEL.nemotron}>AI</span>;
  return null;
}

function Provenance({ obs }: { obs: Observation }) {
  return (
    <div className="mt-2 rounded-lg bg-[#0E1A21] p-3">
      <pre className="overflow-x-auto font-mono text-[12px] leading-relaxed whitespace-pre text-[#BFE6D4]">{obs.rawSpan}</pre>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        {SOURCE_NAME[obs.sourceId] ?? obs.sourceId} · issued {formatEastern(obs.issuedAt)} ·
        characters {obs.charStart}–{obs.charEnd} · {describeExtraction(obs.extractor, obs.model)} · {obs.confidence} confidence
        {obs.numeric?.approximate && ' · number approximated from the wording'}
      </p>
      {obs.adjudicationReason && (
        <p className="mt-1 text-[11px] leading-relaxed text-amber-200">
          Conflict resolved by Nemotron: {obs.adjudicationReason}
        </p>
      )}
      <a href={obs.sourceUrl} target="_blank" rel="noreferrer"
         className="mt-1 inline-block text-[11px] font-semibold text-sky-300 underline underline-offset-2">
        Open source product ↗
      </a>
    </div>
  );
}
