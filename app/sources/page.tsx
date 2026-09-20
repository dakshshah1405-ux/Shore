import Link from 'next/link';
import type { Metadata } from 'next';

// Static on purpose: this page documents how the pipeline works, not what it currently says.
// Nothing here reads the database, so it renders identically whether or not ingestion has run.

export const metadata: Metadata = {
  title: 'Sources & Methodology — Shore',
  description:
    'Every source Shore reads, how a value gets from forecast text to the map, how risk is decided, and the limits we will not paper over.',
};

const SOURCES = [
  {
    name: 'Surf Zone Forecast (SRF)',
    shape: 'Fixed-width ASCII, dot-leader key/value',
    what: 'Rip current risk, surf height, thunderstorm potential, water temperature, wind, UV, tides, remarks',
    url: 'https://api.weather.gov/products/types/SRF',
    note: 'Issued about twice a day by each forecast office. The field set and label wording drift between offices.',
  },
  {
    name: 'Active alerts (CAP)',
    shape: 'Structured JSON',
    what: 'Official watches, warnings, advisories and statements affecting each zone',
    url: 'https://api.weather.gov/alerts/active',
    note: 'Headlines are shown verbatim. An official product always outranks anything Shore computes.',
  },
  {
    name: 'Forecast zone geometry',
    shape: 'GeoJSON',
    what: 'The polygon drawn for each of the 73 surf zones',
    url: 'https://api.weather.gov/zones/forecast',
    note: 'Fetched once, simplified, and committed as a static file. The map has no runtime dependency on this API.',
  },
];

const LADDER = [
  { level: 'Warning', color: '#6B2FA3', rule: 'An official NWS warning is in effect for the zone.' },
  { level: 'High', color: '#C62828', rule: 'Rip current risk is High, or thunderstorm potential is High.' },
  {
    level: 'Elevated',
    color: '#E07B00',
    rule: 'An NWS watch, advisory or statement is in effect; or rip risk is Moderate; or thunderstorm potential is Moderate; or surf reaches 5 ft; or the forecast notes a longshore current.',
  },
  { level: 'Lower', color: '#2E7D4F', rule: 'Rip current risk is stated and low, and no rung above fired.' },
  { level: 'No data', color: '#8B969C', rule: 'Rip current risk is not available for this zone. This never renders green.' },
];

export default function SourcesPage() {
  return (
    <main className="min-h-dvh bg-[#EEF3F5] px-5 py-10 text-slate-800">
      <div className="mx-auto w-full max-w-3xl">
        <nav className="mb-8 flex items-center justify-between gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-128.png" alt="Shore" width={40} height={40} className="h-10 w-10" />
          <Link
            href="/"
            className="rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-[var(--brand-blue-ink)] shadow-sm"
          >
            Back to the map
          </Link>
        </nav>

        <h1 className="text-3xl font-bold tracking-tight text-[var(--brand-blue-ink)]">Sources &amp; Methodology</h1>
        <p className="mt-3 text-[15px] leading-relaxed">
          The National Weather Service publishes a Surf Zone Forecast for every coastal zone on the East Coast. It is
          official, life-safety data, shipped as fixed-width ASCII from teletype-era infrastructure, and almost nobody
          reads it. Shore extracts that text into structured values, keeps the exact source span behind every one, and
          draws the result on a map. This page documents where each number comes from and what Shore will not claim.
        </p>

        <Section title="Where every number comes from">
          <p className={P}>
            All three sources are U.S. federal data from <Ext href="https://api.weather.gov">api.weather.gov</Ext>.
            Coverage is the 12 East Coast forecast offices — GYX, CAR, BOX, OKX, PHI, AKQ, MHX, ILM, CHS, JAX, MLB and
            MFL — across 73 surf zones.
          </p>
          <div className="mt-4 space-y-3">
            {SOURCES.map((s) => (
              <div key={s.name} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="font-semibold text-slate-900">{s.name}</h3>
                  <span className="rounded bg-[var(--brand-sand-soft)] px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {s.shape}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">{s.what}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{s.note}</p>
                <Ext href={s.url} className="mt-2 inline-block font-mono text-xs">
                  {s.url}
                </Ext>
              </div>
            ))}
          </div>
          <p className={`${P} mt-4`}>
            The base map is <Ext href="https://carto.com/basemaps/">CARTO Positron</Ext> over OpenStreetMap data. The
            satellite layer is <Ext href="https://basemap.nationalmap.gov/">USGS/USDA orthoimagery</Ext> — periodic
            aerial survey, not a live image, and it can be a season or more old.
          </p>
        </Section>

        <Section title="How a value gets from text to the map">
          <ol className="mt-1 space-y-3">
            {[
              ['Fetch', 'Each office’s latest product is retrieved and stored byte-for-byte. Documents already stored are skipped, so re-running costs nothing.'],
              ['Route', 'Every document is classified before extraction. A deterministic header check decides when it can; Nemotron is consulted only when it cannot. A document is dropped only when both agree it is not extractable, so the model can never discard data on its own.'],
              ['Extract twice', 'A deterministic parser reads the fixed-width fields by column. Nemotron reads the same text independently and must return a verbatim quote for every value it claims.'],
              ['Verify the quote', 'Each Nemotron value is checked against the stored document. A value whose quote is not found in the source is rejected outright, before anything else looks at it.'],
              ['Reconcile', 'Agreement stores the value at high confidence. Only one extractor finding it stores it at medium. Disagreement is not averaged or guessed — the parser wins by default, and the conflict is recorded.'],
              ['Adjudicate', 'For a genuine disagreement, a deterministic pre-check resolves what the format alone can prove. Anything left is shown to Nemotron with the source text, and it decides which reading matches the document — never which is more dangerous.'],
              ['Assess', 'The rule ladder below runs over the stored values. No model participates in this step.'],
              ['Serve', 'The website reads only the database. It never calls Nemotron on a page load.'],
            ].map(([step, body], i) => (
              <li key={step} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-blue-deep)] text-xs font-bold text-white">
                  {i + 1}
                </span>
                <p className="text-[15px] leading-relaxed">
                  <strong className="font-semibold text-slate-900">{step}.</strong> {body}
                </p>
              </li>
            ))}
          </ol>
          <p className={`${P} mt-4`}>
            Every stored value carries the URL of the product it came from, the exact text span that produced it, the
            character offsets of that span, when the forecast was issued, which extractor read it, and a confidence
            level. In the detail panel, clicking any value reveals that span and links to the source document. A value
            that cannot be read is stored as nothing at all and displayed as <em>Data unavailable</em>.
          </p>
        </Section>

        <Section title="How risk is decided">
          <p className={P}>
            Risk comes from a worst-of rule ladder, first match wins. It is deliberately not a weighted score: averaging
            hazards together can numerically downplay a severe one, and a number like 0.78 cannot be audited against the
            official forecast. Where a zone is split into sub-areas, the worst value in the zone is the one that counts.
            Every assessment records which rung fired, and that sentence is what the panel shows.
          </p>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {LADDER.map((r, i) => (
              <div key={r.level} className={`flex gap-3 p-3.5 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded-sm" style={{ background: r.color }} aria-hidden />
                <p className="text-sm leading-relaxed">
                  <strong className="font-semibold text-slate-900">{r.level}</strong> — {r.rule}
                </p>
              </div>
            ))}
          </div>
          <p className={`${P} mt-4`}>
            The vocabulary mirrors the NWS Low / Moderate / High scale so Shore never appears to disagree with the
            official source. Shore never describes a beach as safe.
          </p>
        </Section>

        <Section title="What Nemotron does — and what it is never allowed to do">
          <p className={P}>
            Shore uses NVIDIA Nemotron 3 Super in four places, none of them conversational. There is no chat interface
            anywhere in this product.
          </p>
          <ul className="mt-3 space-y-2.5">
            {[
              ['Router', 'classifies an arbitrary document by its structure and decides which extractor, if any, should see it.'],
              ['Extractor', 'reads forecast text independently of the parser, including prose remarks that no regular expression can reach.'],
              ['Adjudicator', 'when parser and model disagree, decides which reading matches the source document.'],
              ['Coherence auditor', 'runs offline and flags zones where the assessment, the fired rule, the official headline and the extracted fields contradict each other.'],
            ].map(([role, body]) => (
              <li key={role} className="text-[15px] leading-relaxed">
                <strong className="font-semibold text-slate-900">{role}</strong> — {body}
              </li>
            ))}
          </ul>
          <p className={`${P} mt-4`}>
            The constraints matter more than the roles. Nemotron never computes risk. Its values are rejected unless the
            quote it supplies is found verbatim in the stored document. Where it disagrees with the deterministic
            parser, the parser wins by default. An adjudication that would lower a hazard is refused. The coherence
            audit only raises a flag; it cannot change a value. And the audit runs offline, so serving a page never
            calls a model.
          </p>
        </Section>

        <Section title="What we measured">
          <p className={P}>
            Four evaluations are committed with the code, each against a deterministic baseline rather than against
            nothing. Nemotron beat both baselines outright at routing documents, 20 of 20. It caught a semantic
            contradiction in the coherence audit that no rule we could write would express, while missing two cases a
            recomputation catches exactly — which is why Shore ships the union of both. On adjudication, most of the
            gain turned out to be deterministic rather than model-driven.
          </p>
          <p className={`${P} mt-3`}>
            The most useful result was a failure. Running both extractors over every forecast surfaced four
            disagreements, and in all four the <em>parser</em> was wrong: a sub-area name long enough to eat its own
            dot leader left the values unreadable to a dot-counting regular expression. Nemotron read them correctly,
            reconciliation refused to store the model&rsquo;s answer because the parser wins ties, and flagged the
            conflict instead of guessing. That flag is how we found the bug. The parser now reads sub-area values by
            column; Wilmington went from 116 to 120 values and disagreements went to zero.
          </p>
          <p className={`${P} mt-3`}>
            Full numbers, baselines and caveats are in <code className={CODE}>eval/FINDINGS.md</code>, including a
            measurement artifact we disclosed rather than tuned away.
          </p>
        </Section>

        <Section title="Limits we will not paper over">
          <ul className="mt-1 space-y-2.5">
            {[
              ['Resolution is the forecast zone, not the beach.', 'An NWS surf zone spans tens of kilometres. Shore colours the zone because that is the resolution the data actually has. Drawing anything finer would be invented precision.'],
              ['Rip current risk is a forecast, not an observation.', 'It is issued roughly twice a day. It does not track what the water is doing right now.'],
              ['A forecast can be stale.', 'Offices issue on their own schedule, and Shore shows the issue time on every zone and warns when a product is old. An old product is still the current official one.'],
              ['No lifeguard data.', 'No authoritative national dataset of lifeguard coverage exists. Showing unverified lifeguard status on a drowning-risk map is the most dangerous thing this product could do, so it is not here.'],
              ['Missing data stays missing.', 'When a field is absent, Shore shows Data unavailable and the zone renders grey. It is never filled in by inference, and it never renders green.'],
            ].map(([head, body]) => (
              <li key={head} className="text-[15px] leading-relaxed">
                <strong className="font-semibold text-slate-900">{head}</strong> {body}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Data use">
          <p className={P}>
            Every source Shore reads is public U.S. federal data, in the public domain under 17 U.S.C. §105. No
            credentials or licences are required to read any of it. Shore uses public federal sources only and contains
            no LANXESS data of any kind.
          </p>
          <p className={`${P} mt-3`}>
            Shore was built at SteelHacks XIII, 19–20 September 2026. Source:{' '}
            <Ext href="https://github.com/dakshshah1405-ux/Shore">github.com/dakshshah1405-ux/Shore</Ext>.
          </p>
        </Section>

        <footer className="mt-10 rounded-xl border border-slate-300 bg-white/70 p-4 text-sm leading-relaxed text-slate-600">
          Beach and ocean conditions change rapidly. Shore is an informational prototype and does not replace
          instructions from lifeguards, beach authorities, or emergency officials. Always follow posted signs and local
          authorities.
        </footer>
      </div>
    </main>
  );
}

const P = 'text-[15px] leading-relaxed';
const CODE = 'rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[13px]';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold tracking-tight text-[var(--brand-blue-ink)]">{title}</h2>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function Ext({ href, children, className = '' }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`text-[var(--brand-blue-deep)] underline underline-offset-2 ${className}`}
    >
      {children}
    </a>
  );
}
