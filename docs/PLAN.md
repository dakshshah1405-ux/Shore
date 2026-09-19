<title>Shore — SteelHacks XIII Plan</title>

# Shore — Signal Extraction from Public Safety Documents

> ## Status — Saturday afternoon
>
> **Built and working (vertical slice done):** live SRF ingestion from all 12 East Coast offices → deterministic parser with byte-exact provenance (0 span errors) → Neon → risk ladder → `/api/conditions` → MapLibre map of 73 zones with risk colors, text labels, today/tomorrow, filters, and a provenance panel.
>
> **Where this plan differs from what was built — the code wins:**
> - **Next.js 16.3** (not 15). **Neon** (not Tiger Cloud). **MapLibre 6** (ESM-only, named imports).
> - Schema lives in `db/schema.sql` — adds `zone_segments` and numeric columns vs. the runbook's SQL.
> - `Observation` gained `numeric` and `subArea`; `ZoneCondition.observations` maps each field to an **array** (sub-areas). See `lib/types.ts`.
> - Zone geometry is committed at `public/zones.geojson`; runbook sections B–F are already done.
> - Model default is `nvidia/nvidia-nemotron-nano-9b-v2` (in `lib/nemotron.ts`).
>
> **Remaining, by owner:**
> - **A — pipeline:** CAP alerts adapter (`lib/adapters/cap.ts` → `alerts` table) so the official-warning override fires; SPS prose adapter; scheduled ingestion.
> - **B — Nemotron + eval:** extract fields from SRF prose outlook periods and ILM `Remarks` (longshore currents); reconciliation (regex wins ties, confidence upgrades on agreement); router; gold set + metrics table + a documented failure.
> - **C — map:** polish, mobile bottom sheet, zone search, legend placement.
> - **D — ship:** Vercel deploy from GitHub, Sources & Methodology page, README (eval table + "public sources only, no LANXESS data"), demo video, Devpost.

**SteelHacks XIII · Posvar Hall · 4 people**
**⚠️ 24 HOURS — hacking starts Sat 11:00 AM, Devpost due Sun 11:00 AM. Live judging 11:00–12:45.**
**Tracks: Xtract (Signal-to-Insight Engine) + Beyond the Chatbot (stacks with everything). Check Cold Start eligibility.**

### Credits to claim at 9:00 AM Eastern — Hacker Portal → Credits

| Credit | Amount | Scope |
|---|---|---|
| **Anthropic** | $25 Claude API | **per hacker** — $100 across the team |
| **NVIDIA Brev** | $60 GPU compute | per team (expires Sep 22) |
| **Vercel v0** | $30 | everyone; also coupon `V0-STEELHACKS30` |
| **ElevenLabs** | 3mo Creator | via `discord.gg/VnBvbbcdEC` |

### Rules that bind us
- **No working on previous projects** — repo created fresh Saturday.
- Devpost submission by **11:00 AM Sunday** or you are not judged.
- **Must be present at judging.** Teams max 4.

### Track wording, verbatim
> **Xtract — Signal-to-Insight Engine:** "There's too much information to read all of it. Build something that does it for you — take in news, reports, and press releases and pull out what actually matters, with every insight traceable back to its source. (Public or synthetic data only - no LANXESS data.)"

> **Beyond the Chatbot:** "We have enough chatbots. Use Nemotron for something else - routing requests, classifying, judging another model's output, making decisions inside a bigger pipeline. Show us where it fits and why you needed it. Stacks with every other track."

Both describe this architecture directly. No reframing needed.

---

## Context

The original brief was a full beach-safety platform for the U.S. East Coast. The real constraint is a 48-hour hackathon, so this is rescoped to a prototype that is genuinely useful, demoable, and honest — and deliberately shaped to hit two specific track rubrics.

### The insight the project hangs on

The National Weather Service publishes a **Surf Zone Forecast (`SRF`)** for every coastal zone on the East Coast. Verified live from Morehead City, NC (`api.weather.gov/products/types/SRF/locations/MHX`):

```
NCZ203-190000-
Northern Outer Banks-
Including the beaches of Duck, Southern Shores, Kitty Hawk,
Kill Devil Hills, and Nags Head
.REST OF TODAY...
Rip Current Risk*...........Low.
Surf Height.................Around 2 feet.
Thunderstorm Potential**....None.
UV Index**..................Very High.
Water Temperature...........In the upper 70s.
Weather.....................Sunny.
```

Official, life-safety data — shipped as fixed-width ASCII from teletype-era infrastructure, in a format that drifts between the ~14 East Coast forecast offices. Essentially nobody consumes it programmatically. **The signal that matters is sitting in plain text that nobody reads.**

**Re-verified live 2026-09-19, 15:11Z** — and the values moved. The same zone that read `Rip Current Risk*...........Low.` / `Around 2 feet` yesterday now reads **`Moderate`** / `2 to 3 feet`. The feed is live and genuinely varies day to day, so the demo shows real movement rather than a frozen snapshot.

| Endpoint | Status |
|---|---|
| `/products/types/SRF/locations/MHX` | ✅ 200 — 20 products, latest `2026-09-19T15:11Z` |
| `/products/types/SRF/locations` | ✅ 200 — 40 offices |
| `/products/{uuid}` (full text) | ✅ 200 — all five target fields present |

**All 12 planned East Coast offices confirmed present** in the SRF locations list: `GYX CAR BOX OKX PHI AKQ MHX ILM CHS JAX MLB MFL`. No coverage gaps.

That is Xtract's premise almost word for word: *take in reports and notes, pull out what actually matters, make sure we can trace it back to the source.*

**Product name: Shore.**

### How to pitch it

Lead with the mechanism, not the beach. The deliverable is **a source-pluggable extraction pipeline that turns unstructured public documents into traceable, structured safety signals.** Beach safety is the application that proves it works — and it's a domain where fabricating a value has real consequences, which is *why* the provenance and validation machinery exists rather than being bolted on.

Most Xtract submissions will be competitor-intel dashboards over GDELT and RSS. A public-safety domain with a hard no-fabrication constraint is differentiated and makes the traceability requirement feel necessary instead of decorative.

---

## Track compliance

**Xtract rules:** *"Public sources like GDELT, RSS feeds, and press releases. Synthetic notes or documents you create yourselves. No LANXESS data. Everything must come from public or synthetic sources."*

✅ Every source is public U.S. federal data (public domain, 17 U.S.C. §105). Zero LANXESS data touches the project. State this explicitly in the README — it's a rule we satisfy by construction.

**Mapping to the four Xtract criteria — build to these directly:**

| Their criterion | Our answer |
|---|---|
| "Support for different sources without rebuilding everything" | Adapter interface + Nemotron router. Adding a source = one file. **4 deliberately heterogeneous formats shipped.** |
| "A model that can find useful signals in incoming documents" | Nemotron extraction across all formats, incl. free prose with no field structure |
| "Insights that link back to where they came from" | Every stored value carries source URL, **raw text span**, char offsets, issue time, extractor, confidence. Click any number in the UI → see the exact source line. |
| "A clean way to actually see and use the output" | The map. Filters. Detail panel. |

**Beyond the Chatbot criteria:**

| Their criterion | Our answer |
|---|---|
| "Nemotron doing something beyond conversation" | Router + extractor + explainer in a pipeline. **No chat interface exists anywhere in the product.** |
| "A clear explanation of what it does in your system" | Architecture slide + Sources page section |
| "An eval, comparison, benchmark, or even a failure you found" | **Dedicated deliverable — see Eval section. Owned by one person with a time block.** |

**No Wrapper: do not pursue.** "No language models in the finished project" is mutually exclusive with shipping Nemotron. Beyond the Chatbot stacks with everything else; No Wrapper is the single track it cannot stack with. Chasing both means two projects or a crippled one.

---

## Architecture

```
  ┌─ SRF text (fixed-width, dot-leader fields)
  ├─ CAP alerts (structured JSON)          ──►  Nemotron ROUTER
  ├─ SPS / Beach Hazards (free prose)           classify → schema
  ├─ NDBC buoy (positional numeric table)              │
  └─ (stretch) state closure RSS / press release       ▼
                                          ┌────────────┴────────────┐
                                    Deterministic          Nemotron
                                      adapter              extraction
                                          └────────────┬────────────┘
                                                  RECONCILE
                                            (regex wins ties)
                                                       │
                                        Observation[] + provenance
                                                       │
                                            Risk rule ladder
                                                       │
                                         Map · Filters · Panel
```

### The four source adapters (the Xtract deliverable)

Chosen to be *maximally different in shape* — that's the whole point of the demo.

| # | Source | Format | Why it stresses the pipeline |
|---|---|---|---|
| 1 | NWS **SRF** | Fixed-width ASCII, dot-leader key/value | Labeled but format drifts across 14 offices |
| 2 | NWS **CAP alerts** (`/alerts/active`) | Structured JSON | Already structured — proves the pipeline doesn't special-case |
| 3 | NWS **SPS / Beach Hazards Statement** | Free prose paragraphs | **No field structure at all.** Regex cannot touch this. This is where Nemotron is unarguably required. |
| 4 | **NDBC buoy** (`realtime2/{id}.txt`) | Positional numeric table + units row | Numeric, no labels, `MM` sentinel for missing |

Adapter contract — adding a source is one file implementing:

```ts
interface SourceAdapter {
  id: string;
  fetch(): Promise<RawDocument[]>;       // { text, url, retrievedAt }
  deterministicExtract?(doc): Partial<Extraction>;  // optional
  schema: JSONSchema;                     // what Nemotron targets
}
```

Everything downstream — routing, LLM extraction, reconciliation, provenance, storage — is shared. **Demo this live: add adapter #5 on stage in under a minute.**

### Provenance model (non-negotiable — it's a whole Xtract criterion)

Every stored value is an `Observation`:

```ts
{ field: 'ripCurrentRisk', value: 'High', unit: null,
  sourceId: 'nws-srf', sourceUrl: 'https://api.weather.gov/products/<uuid>',
  rawSpan: 'Rip Current Risk*...........High.',   // exact text
  charStart: 1204, charEnd: 1239,
  issuedAt: '2026-09-19T15:09:00Z', retrievedAt: '...',
  extractor: 'regex' | 'nemotron' | 'reconciled',
  confidence: 'high' | 'medium' | 'low' }
```

**In the UI, every number is clickable and reveals its `rawSpan` plus a link to the source document.** This is the single most important demo moment for Xtract — it turns an abstract criterion into something judges can poke at.

### The frozen contract — commit this file first, hour 0

Everyone works against these types. Once committed, A/B/C/D build in parallel against mocks with no blocking.

```ts
// types.ts — the whole team's interface. Change only by agreement.

type RiskLevel  = 'official' | 'high' | 'elevated' | 'lower' | 'unknown';
type Confidence = 'high' | 'medium' | 'low';
type Extractor  = 'regex' | 'nemotron' | 'reconciled';

interface Observation<T = string | number> {
  field: string;                 // 'ripCurrentRisk'
  value: T | null;               // null is a legitimate answer — never fabricate
  unit: string | null;
  sourceId: string;              // 'nws-srf'
  sourceUrl: string;
  rawSpan: string | null;        // exact source text
  charStart: number | null;
  charEnd: number | null;
  issuedAt: string;              // ISO
  retrievedAt: string;           // ISO
  extractor: Extractor;
  confidence: Confidence;
}

interface Alert {
  id: string;
  event: string;                 // 'Rip Current Statement'
  severity: string;              // CAP severity, verbatim
  headline: string;              // official wording — never paraphrased or summarized
  description: string;
  onset: string | null;
  expires: string | null;
  sourceUrl: string;
  zones: string[];               // UGC codes
}

interface ZoneCondition {
  zoneId: string;                // 'NCZ203'
  zoneName: string;              // 'Northern Outer Banks'
  beaches: string[];             // parsed from 'Including the beaches of ...'
  period: 'today' | 'tomorrow';
  risk: RiskLevel;               // defaults to 'unknown' — NEVER to 'lower'
  firedRule: string;             // which ladder rung matched, for the explainer
  explanation: string | null;    // guardrailed; null if the validator rejected it
  observations: Record<string, Observation>;
  alerts: Alert[];
  staleAfter: string;            // ISO; UI shows a staleness warning past this
}

interface BeachDetail {
  name: string;
  zoneId: string;
  lat: number;
  lon: number;
  condition: ZoneCondition;
  nearestBuoy: {
    id: string;
    distanceKm: number;          // always displayed — never imply it's at the beach
    observations: Record<string, Observation>;
  } | null;
}
```

Two invariants worth stating in a comment at the top of the file, because they're the safety story in type form: **`value: null` is a valid answer**, and **`risk` initializes to `'unknown'`, never `'lower'`.**

---

## Where Nemotron earns its place (three jobs)

1. **Router / classifier.** Arbitrary document in → which source type, which extraction schema, is it even relevant. This is what makes the pipeline pluggable. *(Their words: "routes requests, classifies something.")*
2. **Extractor.** Structured JSON from all four formats. Mandatory for source #3 (free prose) — no deterministic parser is possible there, which is the cleanest possible answer to "why did you need it."
3. **Explainer.** Grounded natural-language "why is this elevated?" from extracted fields only.

A **deterministic validator judges Nemotron's output** — regex wins ties, and the explanation validator rejects hallucinated numbers. *(Their words: "judges another model's output" — inverted, and worth calling out as a deliberate choice.)*

### Reconciliation

| Case | Confidence | Stored |
|---|---|---|
| Both agree | `high` | value |
| Regex only | `medium` | regex value |
| Nemotron only (prose, or format drift) | `medium` | Nemotron value, flagged |
| **Disagree** | `low` | **regex wins**, disagreement logged and surfaced |
| Neither | — | `null` → UI shows **"Data unavailable"** |

Deterministic wins ties. On a life-safety number a regex over a fixed-width field is more trustworthy than a language model, and saying so to NVIDIA judges is a *strength* — it shows you know where an LLM belongs and where it doesn't.

### Explanation guardrail

Nemotron writes the "why" from a JSON object of extracted fields only. Then a validator:

- Every number in the output must appear in the input JSON → else regenerate once, then fall back to a template.
- Reject outputs containing `lifeguard`, `safe to swim`, `no danger` (hardcoded banned list).
- If an official NWS alert is active, the explanation may not render above the alert banner.

~30 lines. Directly produces eval material (see below).

---

## The eval (Beyond the Chatbot deliverable — B owns it)

**Gold set:** 50 hand-labeled field extractions spanning all 4 source types and ≥5 WFOs (MHX, AKQ, PHI, MFL, GYX). Two people label 25 each in ~45 min.

**Metrics table — ship this in the README and on a slide:**

| Config | Coverage | Precision | Recall |
|---|---|---|---|
| Regex only | | | |
| Nemotron only | | | |
| Reconciled | | | |

**Expected story** (verify, don't assume): regex is near-perfect precision on the standard SRF template but falls off a cliff on format drift and scores ~0 on free prose; Nemotron generalizes across all four formats at slightly lower precision; reconciliation captures both. That is a *comparison* and a *benchmark* in one table.

**Router eval:** classification accuracy on held-out documents, including one deliberately out-of-distribution doc.

**Document a failure — they explicitly invited this.** The likeliest and most useful one: Nemotron emitting a plausible surf height when the field is *absent* from the product. Capture it, show the validator catching it, and use it as the justification for the deterministic layer. A found failure with a shipped mitigation is worth more than a clean chart.

---

## Risk model — deterministic, not a weighted score

**Do not build a weighted composite that outputs `0.783`.** Unexplainable, unvalidatable in 48h, and it can mathematically *downplay* a severe hazard by averaging it against benign ones.

**Worst-of rule ladder**, first match wins:

1. Active NWS warning affecting zone → **Official Warning** (purple, own visual treatment, overrides all)
2. Rip Current Risk High, **or** Thunderstorm High → **High** (red)
3. Rip Current Risk Moderate, **or** surf ≥ 5 ft, **or** Thunderstorm Moderate → **Elevated** (orange)
4. Rip Current Low, nothing else triggered → **Lower modeled risk** (green)
5. Insufficient data → **Unknown** (gray, hatched) — *never* green

Every level records which rule fired; the explainer reads the fired rule. Auditable, unit-testable, cannot contradict NWS. Vocabulary mirrors NWS `Low/Moderate/High` so we never appear to disagree with the official source. **Missing data must never render as green.**

---

## Stack

One language, one deploy, no Docker, no CORS. Integration friction kills hackathon teams, not algorithms.

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js 15 (App Router) + TypeScript** | Single repo, API routes = backend |
| Map | **MapLibre GL JS** + free CARTO/OSM raster tiles | No Mapbox token, no billing |
| DB | **Postgres — Tiger Cloud** (Neon fallback) | Tiger Data is an MLH prize track; it's Postgres either way = free extra prize shot |
| LLM | **Nemotron 3 via NVIDIA NIM** (`build.nvidia.com`, OpenAI-compatible HTTP) | Required for the track |
| Ingest | Node script on **GitHub Actions cron** (30 min) | Avoids Vercel free-tier cron limits |
| Deploy | **Vercel** | Fastest path |

**Skip PostGIS.** Store zone polygons as GeoJSON in `jsonb`, simplify with `turf.simplify` at build time, ship one static file. A few hundred polygons. No tile server, no spatial index. Biggest single time saver in the plan.

---

## Cost, hardware, and setup

### Cost: $0. Budget $20 as insurance.

| Item | Tier | Cost |
|---|---|---|
| All data sources | Public federal data | **$0** |
| Nemotron (NVIDIA NIM) | Free developer credits at `build.nvidia.com` | **$0** |
| Postgres (Tiger Cloud / Neon) | Free tier (~0.5 GB) | **$0** |
| Vercel | Hobby | **$0** |
| Map tiles (CARTO basemaps) | Free tier | **$0** |
| Domain | MLH `.Tech` prize gives one free | **$0** |

**Token math** — the thing that could cost money, and doesn't:

An SRF product is ~8 KB ≈ 2.5k tokens. Twelve WFOs × 4 source types ≈ 50 documents per cycle. Naively re-extracting every 30 minutes = ~3.5M tokens across the weekend.

**But SRF only updates ~2×/day.** So: **hash each document's text and skip extraction when the hash is unchanged.** That drops real extraction to ~100 calls/day. Including heavy dev iteration and eval runs, realistic total is a few hundred thousand tokens — comfortably inside free credits. Even at commercial rates (~$0.10–0.60/M tokens) the entire weekend is under $5.

Worth building on hour one regardless of cost: it makes ingestion near-instant, keeps the eval reproducible, and is a good answer when a judge asks how you'd scale it.

### Storage

| Data | Size |
|---|---|
| Zone polygons, simplified (`turf.simplify`, tol ~0.001) | **2–5 MB** (~1 MB gzipped over the wire) |
| Zone polygons, raw full-precision | 20–50 MB — *simplify at build time, never ship raw* |
| Raw source documents (48h) | < 1 MB |
| `Observation` rows incl. `rawSpan` (~8k rows/cycle) | < 100 MB |

**Total DB well under 200 MB** — fits the free tier with large margin.

### Per-person machine requirements

**No GPU. No local model. Nothing heavy.** Nemotron is an HTTPS call to NVIDIA's cloud; no weights are ever downloaded.

| | Minimum | Comfortable |
|---|---|---|
| RAM | **8 GB** | 16 GB |
| Free disk | **5 GB** | 10 GB |
| GPU | none | none |

Working set is Next.js dev server (~0.5–1.5 GB) + browser with MapLibre and devtools (~1–2 GB) + editor (~1 GB) ≈ **4 GB**. Any laptop from the last six years is fine.

### Yes, all four of you need your own laptop — but for parallelism, not power

Do **not** try to share one machine; four people editing one repo on one keyboard is the bottleneck, not compute. Each person needs only **Node 20+, git, and a browser**.

**Zero local infrastructure** — this is deliberate and saves hours:

- **One shared cloud Postgres.** Everyone connects to the same dev database. No local Postgres installs, no Docker, no migrations drift.
- **Each person makes their own free NIM key** (2 minutes) rather than sharing one. This is not optional politeness: the free tier is **~40 req/min**, and one key split four ways during parallel dev will throttle — and rate-limit errors read like bugs, costing debugging time. Four keys, four independent budgets.
- **Cap ingestion concurrency at ~4** for the same reason. Combined with document hashing, a normal cycle only calls the model for documents that actually changed, so you'll rarely approach the limit.
- **Vercel preview deploys per branch**, so anyone can see anyone's work without cloning or running it.

### Note: the eval's gold set lives in the repo

Not an offline-mode feature — a reproducibility requirement. The 50 hand-labeled documents backing the eval must be committed as static files, because NWS reissues products continuously and a benchmark measured against a moving target isn't a benchmark. B saves the documents at labeling time, which costs nothing extra.

---

## Government permissions — the direct answer

**None required. Nothing to apply for.**

- Federal works are public domain (17 U.S.C. §105). No license, no key for NWS, CO-OPS, or NDBC.
- `api.weather.gov` requires a **`User-Agent` with contact info** (`Shore/0.1 (you@pitt.edu)`). Only gate; requests without it are rejected.
- CO-OPS asks for an `application=Shore` param. Courtesy.
- NDBC: plain text files; be polite about frequency.
- **Avoided legal trap:** OpenStreetMap is ODbL with share-alike obligations on derived databases. Cutting lifeguards avoids it entirely.

---

## Data sources (all verified 2026-09-18)

| Signal | Source | Endpoint | Type |
|---|---|---|---|
| Rip current, surf, thunderstorm, water temp, UV | NWS **SRF** | `api.weather.gov/products/types/SRF/locations/{WFO}` | Forecast |
| Official warnings/watches | NWS **Alerts** | `api.weather.gov/alerts/active?area={ST}` | Official |
| Prose hazard statements | NWS **SPS** | `api.weather.gov/products/types/SPS/locations/{WFO}` | Official |
| Zone geometry | NWS **Zones** | `api.weather.gov/zones/forecast/{id}` — **no query param** | Static |
| Waves, water temp (observed) | **NDBC** | `ndbc.noaa.gov/data/realtime2/{id}.txt` | Observed |
| Tides *(stretch)* | **CO-OPS** | `api.tidesandcurrents.noaa.gov/api/prod/datagetter` | Obs + predicted |

East Coast WFOs: `GYX CAR BOX OKX PHI AKQ MHX ILM CHS JAX MLB MFL`

### Zone geometry — verified 2026-09-19, build once and commit

Tested against the live API:

| Request | Result |
|---|---|
| `/zones/forecast/NCZ203` (bare) | ✅ **geometry populated** (MultiPolygon) |
| `/zones/forecast/NCZ203?include_geometry=true` | ❌ **400 Bad Request** — the param is invalid here |
| `/zones?type=forecast&area=NC` | 100 zones, `geometry: null` |
| `/zones?type=forecast&area=NC&include_geometry=true` | still `geometry: null` — param silently ignored |

**Two consequences:**

1. **Never send `include_geometry`.** The bare per-zone URL already returns geometry.
2. **The list endpoint never returns geometry under any parameter** — it's one request per zone.

**Which zones? Let the SRF products tell you.** Every SRF segment header carries its UGC code (`NCZ203-190000-`). So the build script is:

```
fetch SRF for all 12 WFOs
  → regex out distinct UGC zone codes        (~40–80 coastal zones, not ~500)
  → GET /zones/forecast/{code} for each      (sequential, ~1 req/s, polite)
  → turf.simplify(tolerance ~0.001)
  → write public/zones.geojson               (2–5 MB) and commit it
```

Runs once, in about a minute. The committed file means the map works from hour 3 onward with no runtime dependency on the zones API.

*Last-resort fallback only:* NWS bulk zone shapefiles from `weather.gov/gis`. **Not recommended** — US-wide download plus a `mapshaper`/`shpjs` conversion and filtering step, to reach the same place one API loop already gets you. Extra tooling is the last thing you want in hour 3.

**Limitations to state plainly in UI and demo:**
- SRF resolution is the **NWS coastal zone** (tens of km), *not* per-beach. We color zones because that's the real resolution. Finer would be fabricated precision.
- Rip current risk is a **forecast**, ~2×/day, not an observation.
- NDBC buoys are often 20–50 km offshore. Show distance; never imply the reading is at the beach.
- NOAA's better rip model (**RCMOS**, hourly probabilistic) exists but is **restricted** to NOAA staff and WFOs under MOU. We use public SRF only. Naming this in the demo shows you found the frontier.

---

## Map filters (recolor on the map)

MapLibre data-driven styling on one GeoJSON source — cheap, excellent on camera.

- Rip current risk (Moderate+)
- Surf height slider
- Thunderstorm potential
- Water temperature range
- Has active NWS alert

All client-side `setFilter` / `setPaintProperty` against loaded features. **No refetch** — instant, which is the point. Non-matching zones desaturate to gray 30% rather than vanishing, so the coastline stays legible.

**Accessibility:** every zone carries a text label and a distinct fill pattern in addition to color. Never color alone.

---

## Scope

**In:** the four adapters, router, extraction, reconciliation, provenance UI, risk ladder, map + filters + legend, detail panel, eval, Sources & Methodology page, search.

**Cut — say so in the demo, knowing why reads as judgment:** bathymetry/sandbars, HF-radar currents, lifeguards, water quality, notifications, accounts, history, time slider, offline mode, admin dashboard.

**Why lifeguards are cut:** no authoritative national dataset exists. USLA has no API and certifies agencies, not tower locations. OSM's `emergency=lifeguard` coverage is sparse and crowdsourced. Showing "Lifeguards: Active" from unverified data on a drowning-risk app is the most dangerous thing this product could do. Cutting it *is* the safety-conscious answer — say that.

---

## HOUR 0 RUNBOOK — exact steps

### A. Before 11:00 (do tonight / at 09:00)

**A1. Accounts.** Everyone creates, if they don't have one: GitHub, Vercel (sign in *with GitHub*), Neon (sign in *with GitHub*), NVIDIA developer.

**A2. Claim credits** — steelhacks.org → Hacker Portal → **Credits** (opens 09:00 ET): Anthropic $25 *per hacker*, NVIDIA Brev $60 per team, Vercel v0 $30, ElevenLabs via `discord.gg/VnBvbbcdEC`.

**A3. NVIDIA key, each person:**
1. `build.nvidia.com` → Log in
2. Search `nemotron` → open **`nvidia/nvidia-nemotron-nano-9b-v2`**
3. Click **View Code** → **Generate API Key**
4. The key **populates into the code sample** — copy it
5. Smoke-test (PowerShell — `curl` is aliased to `Invoke-WebRequest` in PS 5.1, don't use it):

```powershell
$env:NVIDIA_API_KEY = "nvapi-xxxx"
Invoke-RestMethod -Uri "https://integrate.api.nvidia.com/v1/models" `
  -Headers @{ Authorization = "Bearer $env:NVIDIA_API_KEY" } |
  Select-Object -ExpandProperty data | Select-Object -First 3 id
```
Model IDs listed = working. 401 = bad copy.

**A4. Verify toolchain:** `node --version` (need 20+), `git --version`, `gh --version`.

**A5. Check Cold Start eligibility** (all members 1st/2nd hackathon, no professional experience). Free extra track.

### B. 11:00–11:20 — repo and deploy skeleton

One person (A) runs this; everyone else waits and does A3 if not done.

```powershell
npx create-next-app@latest shore --typescript --app --tailwind --eslint --no-src-dir --import-alias "@/*"
cd shore
npm i maplibre-gl openai @turf/turf @neondatabase/serverless
npm i -D tsx
git init; git add -A; git commit -m "init"
gh repo create shore --public --source=. --push
npx vercel --yes
```

Then in Vercel dashboard → Settings → Environment Variables, add `NVIDIA_API_KEY` and `DATABASE_URL`. Invite the other three as collaborators on GitHub.

### C. 11:20–11:40 — database

1. `neon.tech` → **New Project** → name `shore` → **accept every default** (AWS, US East Ohio, latest Postgres, branch `main`). Region choice is a ~10–15 ms difference and does not matter here — don't spend a decision on it.
2. Copy the **pooled** connection string — the host contains `-pooler`. Pooled is required because each Next.js API route is a separate serverless function; the direct connection exhausts Postgres connection slots under that pattern.
3. Paste into `.env.local` as `DATABASE_URL=...` and share the identical string with all four teammates — one shared database.

*Expected behavior, not a bug:* free-tier Neon auto-suspends after ~5 min idle. The first query after a pause takes ~500 ms to wake, then it's fast. If someone reports "the database is slow," this is why.
4. In Neon's **SQL Editor**, run:

```sql
create table if not exists documents (
  id           text primary key,
  source_id    text not null,
  url          text not null,
  text         text not null,
  content_hash text not null,
  issued_at    timestamptz,
  retrieved_at timestamptz not null default now()
);
create index if not exists documents_hash_idx on documents(content_hash);

create table if not exists observations (
  id           bigserial primary key,
  zone_id      text not null,
  period       text not null,
  field        text not null,
  value        text,
  unit         text,
  source_id    text not null,
  source_url   text not null,
  raw_span     text,
  char_start   int,
  char_end     int,
  issued_at    timestamptz,
  retrieved_at timestamptz not null default now(),
  extractor    text not null,
  confidence   text not null
);
create index if not exists obs_zone_idx on observations(zone_id, period);

create table if not exists alerts (
  id           text primary key,
  event        text not null,
  severity     text,
  headline     text,
  description  text,
  onset        timestamptz,
  expires      timestamptz,
  source_url   text not null,
  zones        text[] not null,
  retrieved_at timestamptz not null default now()
);
create index if not exists alerts_zones_idx on alerts using gin(zones);
```

**One shared database for all four.** No local Postgres, no Docker.

### D. `.env.local` (and `.gitignore` must contain `.env*`)

```
NVIDIA_API_KEY=nvapi-xxxx
DATABASE_URL=postgresql://...
NWS_USER_AGENT=Shore/0.1 (shore.vercel.app, you@pitt.edu)
```

### E. 11:40–12:00 — commit `types.ts`, then everyone unblocks

Commit the frozen contract (see *The frozen contract* above) as `types.ts` and push. **Nobody starts feature work before this lands.**

### F. Zone geometry — `scripts/build-zones.mjs`, run once

```js
import fs from 'node:fs';
import { simplify } from '@turf/turf';

const UA = { 'User-Agent': process.env.NWS_USER_AGENT };
const WFOS = ['GYX','CAR','BOX','OKX','PHI','AKQ','MHX','ILM','CHS','JAX','MLB','MFL'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const zones = new Set();
for (const wfo of WFOS) {
  const list = await (await fetch(`https://api.weather.gov/products/types/SRF/locations/${wfo}`, { headers: UA })).json();
  const latest = list['@graph']?.[0];
  if (!latest) { console.warn(`no SRF for ${wfo}`); continue; }
  const prod = await (await fetch(latest['@id'], { headers: UA })).json();
  for (const m of prod.productText.matchAll(/^([A-Z]{2}Z\d{3})/gm)) zones.add(m[1]);
  await sleep(300);
}
console.log(`${zones.size} zones found`);

const features = [];
for (const z of zones) {
  const res = await fetch(`https://api.weather.gov/zones/forecast/${z}`, { headers: UA });
  if (!res.ok) { console.warn(`${z}: ${res.status}`); continue; }
  const f = await res.json();
  if (!f.geometry) continue;
  features.push(simplify(
    { type: 'Feature', properties: { zoneId: z, name: f.properties?.name }, geometry: f.geometry },
    { tolerance: 0.001, highQuality: false }
  ));
  await sleep(300);
}
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/zones.geojson', JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`wrote ${features.length} features`);
```

Run: `npx tsx scripts/build-zones.mjs` — takes about a minute. **Commit `public/zones.geojson`.**

*Known gap:* the UGC regex catches single codes (`NCZ203-`) but not ranges (`NCZ203>205-`). If a WFO uses ranges you'll silently miss zones — check the count looks sane (expect ~40–80) and expand the regex if it's low.

### F2. `lib/nemotron.ts` — where NVIDIA's code sample actually goes

Do **not** paste NVIDIA's sample into app code; it hardcodes the key and streams. Wrap it once:

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey:  process.env.NVIDIA_API_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
});

const MODEL = "nvidia/nvidia-nemotron-nano-9b-v2";

function parseLoose(raw: string): unknown | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  try { return JSON.parse((fenced ? fenced[1] : raw).trim()); }
  catch { return null; }
}

export async function extractJSON<T>(system: string, user: string): Promise<T | null> {
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: `/no_think\n${system}` },
      { role: "user",   content: user },
    ],
    temperature: 0,
    top_p: 1,
    max_tokens: 2048,
    response_format: { type: "json_object" },
    stream: false,
  });
  const raw = res.choices[0]?.message?.content;
  return raw ? (parseLoose(raw) as T | null) : null;   // null → "Data unavailable", never a guess
}
```

**Changes from NVIDIA's sample, and why:**

| Their sample | Ours | Why |
|---|---|---|
| `apiKey: "$API_KEY_..."` | `process.env.NVIDIA_API_KEY` | Hardcoding commits the key |
| `temperature: 0.6` | `0` | Determinism — otherwise eval numbers are noise |
| `top_p: 0.95` | `1` | Meaningless at temp 0 |
| `stream: true` | `false` | Parsing JSON, not rendering tokens |
| `"/think"` | `"/no_think"` | Reasoning mode is slower/verbose; wrong default for bulk extraction |
| *(absent)* | `response_format` | Forces valid JSON instead of prose |

**Free eval row:** `/think` vs `/no_think` on the gold set is one config flag and two table rows — exactly the "comparison or benchmark" Beyond the Chatbot asks for.

`parseLoose` is defensive: if NIM doesn't honor `response_format` for this model, the JSON may arrive inside markdown fences. Handles both.

**Prove it standalone before wiring anything** — `scripts/test-nemotron.ts` calling `extractJSON` on one real SRF product. Object returned = whole LLM path proven.

### G. Onboarding the other three

```powershell
git clone https://github.com/<you>/shore; cd shore
npm install
# create .env.local with the shared DATABASE_URL + their OWN NVIDIA_API_KEY
npm run dev
```

---

## Team split

| | Owner | Scope |
|---|---|---|
| **A** | Pipeline | Adapter interface, all 4 adapters, deterministic parsers, reconciliation, DB, GH Action |
| **B** | Nemotron | Router, extractor, explainer, guardrail, **and the full eval** |
| **C** | Map | MapLibre, zones, color scale, filters, legend, search |
| **D** | UI + pitch | Detail panel + **provenance viewer**, Sources page, design system, demo video, Devpost |

**Freeze the API contract in the first 3 hours.** Commit TypeScript types for `Observation`, `ZoneCondition`, `BeachDetail`, `Alert` first; then everyone works against mocks in parallel without blocking. Highest-leverage 45 minutes of the weekend.

---

## Hour-by-hour

**24 hours, wall-clock. Saturday 11:00 AM → Sunday 11:00 AM.**

| Clock | Milestone |
|---|---|
| **Sat 09:00** | *Before hacking:* claim all credits, 4 NVIDIA keys, smoke-test each one. Check Cold Start eligibility. |
| **11:00–12:00** | Repo (fresh), Next.js up, hello-world on Vercel, shared Postgres, **freeze `types.ts` and commit**. Run zone-geometry script → commit `zones.geojson`. |
| **12:00–13:00** | Lunch — A keeps going on the SRF regex parser. |
| **13:00–15:00** | A: SRF adapter. B: Nemotron extraction on SRF. C: map renders zones flat-colored. D: panel shell + tokens. *One person to the **NVIDIA AMA 14:00–14:45** — ask if router-as-classifier counts.* |
| **15:00–18:00** | **VERTICAL SLICE — the only hard deadline.** Real SRF → extract → reconcile → DB → API → colored zones → clickable panel with `rawSpan`. *Not working by 18:00? Cut adapter #3 and the eval's router section.* |
| **18:00–19:00** | Dinner. Do not skip; you have a long night. |
| **19:00–23:00** | Adapter #2 (CAP alerts) + #3 (SPS prose). Alert override banner. **Provenance viewer** — the money demo. B starts gold-set labeling. |
| **23:00–01:00** | Filters. Explanation + guardrail. Legend. Mobile pass. |
| **01:00–04:00** | **Sleep, staggered, 2 at a time.** Non-negotiable at 24h — the last 3 hours need clear heads more than the middle needs bodies. |
| **04:00–07:00** | **B finishes eval: metrics table + router accuracy + the documented failure.** Everyone else polishes and kills bugs. |
| **07:00–09:00** | Demo video, README (eval table + "public sources only, no LANXESS data"), Devpost draft. |
| **09:00–10:00** | **CODE FREEZE 09:00.** Submit to Devpost — do not wait for 11:00. |
| **10:00–11:00** | Rehearse the pitch out loud, twice. Brunch 09:30. Coffee truck 08:15 (wear your shirt). |

**24-hour scope cuts from the 48-hour version:** NDBC adapter #4 → stretch only. Tides → cut entirely. Search → cut. Three heterogeneous adapters (fixed-width, JSON, prose) already prove the Xtract claim; a fourth is polish you don't have time for.

---

## Validation

Five beaches, different characters — catches format drift fast:

| Beach | WFO | Tests |
|---|---|---|
| Nags Head, NC | MHX | Open-ocean barrier island, high rip frequency |
| Ocean City, NJ | PHI | Urban beach, different WFO format |
| Virginia Beach, VA | AKQ | Large metro, multiple zones |
| Miami Beach, FL | MFL | Different SRF template, year-round |
| Old Orchard Beach, ME | GYX | Cold water, sparse data → **must render "Data unavailable", not green** |

**Required unit tests — these are the safety story:**
- Active NWS warning → override banner renders regardless of computed risk
- Missing rip current field → `Unknown`/gray, never green
- SRF older than 12h → staleness warning renders
- Explanation containing a number absent from input JSON → rejected by validator
- Regex and Nemotron disagree → regex value persisted, `low` confidence recorded
- Every rendered value has a non-null `sourceUrl` and `rawSpan`

---

## Changes from the original brief

| Brief said | Changed to | Why |
|---|---|---|
| Color ocean 1 km offshore per beach | Color NWS coastal zones | No source has per-beach resolution; 1 km polygons would be invented precision |
| Weighted multi-factor risk score | Deterministic worst-of ladder | Weighted averages can numerically downplay a severe hazard |
| 5 levels incl. purple "extreme" | 4 + gray Unknown; purple only for official alerts | Mirrors NWS `Low/Moderate/High` so we never appear to contradict the source |
| Sandbars, bathymetry | Cut | CUDEM topobathy is ~3 m but often years old; nearshore bars migrate weekly |
| Lifeguards, coverage polygons | Cut | No authoritative source exists (see above) |
| Animated current flow fields | Cut | HF radar and NOAA OFS resolve *regional* flow, not surf-zone rips — wrong tool, plus a NetCDF/THREDDS time sink |
| EPA BEACON for live water quality | Cut | **BEACON is not real-time** — states needn't submit until the following calendar year. It's an archive. |
| Notifications, accounts, history, admin, model versioning | Cut | Post-hackathon. A missed lightning alert is worse than no alert feature. |
| Time slider | Cut — SRF's two periods shown as Today / Tomorrow | Already in the product, free |

---

## Demo script (2 min — rehearse)

1. **Show the raw SRF ASCII blob.** "This is official NWS rip-current data for every East Coast beach. It looks like this. Nobody reads it." *(The hook. Lead with it.)*
2. Map appears, zones colored. Click Nags Head → risk + why.
3. **Click the number.** Raw source line appears with a link to the NWS product. "Every value traces back."
4. **Filter** — "only High rip current risk." Coast recolors instantly.
5. Zone with an active NWS alert → override banner.
6. Zone with missing data → **gray, "Data unavailable."** "It never guesses."
7. **Add a fifth source adapter live**, in under a minute.
8. Architecture + **eval table**: router, regex vs Nemotron vs reconciled, and the failure we found. "No chatbot anywhere in this product."

---

## Open items for hour 0

- ~~Verify the zone geometry endpoint~~ — **done, 2026-09-19.** Works via the bare `/zones/forecast/{id}` URL; `?include_geometry=true` returns 400 and must not be sent. See *Zone geometry* above for the build script. No open assumption remains.
- **Each of the four gets their own NVIDIA NIM key at `build.nvidia.com`, before the clock starts.** Verified 2026-09-19: free, no credit card, key format `nvapi-`, valid 6 months, ~1,000 credits, **~40 requests/minute**. Base URL `https://integrate.api.nvidia.com/v1`, OpenAI SDK compatible. Smoke-test with `curl .../v1/models -H "Authorization: Bearer $KEY"` immediately — a 401 at hour 3 is an avoidable disaster.

  **Setup flow, per NVIDIA's own slide:** log in → open a model → **View Code** → **Generate API Key**, and *the key populates directly into the code sample*. Copy the whole sample.

  **Model: start on `nvidia/nvidia-nemotron-nano-9b-v2`** — the one NVIDIA demos and supports at this event, so their AMA staff can actually help you. Escalate a stage to a larger Nemotron only if the eval shows the 9B failing on it. *If it does fail on the SPS prose adapter, that comparison is itself a Beyond the Chatbot deliverable — "we benchmarked two model sizes and here's where the small one broke."*

  **Override NVIDIA's sample defaults.** They ship `temperature=0.6, top_p=0.95, stream=True` — tuned for chat. For extraction use **`temperature=0`** and **`response_format={"type":"json_object"}`**, and drop streaming. Non-zero temperature makes eval numbers drift between runs and the benchmark meaningless.

  **Brev is separate and optional:** `brev.nvidia.com`, redeem `steel-hacks-2026-XXXXXX` at checkout for $60 GPU credit. NIM is hosted, so you don't need it.

  **Always set `temperature: 0` and `response_format: {type:'json_object'}`** on extraction calls. Without temperature 0 the eval numbers drift between runs and the benchmark is meaningless.
- Confirm at opening ceremony whether Xtract expects a business/market framing. If judges push on domain fit, the answer is ready: the rules permit any public source, and public safety makes the traceability requirement *necessary* rather than decorative.

## Disclaimer (ships in UI — footer + first load)

> Beach and ocean conditions change rapidly. Shore is an informational prototype built at SteelHacks XIII. It does not replace instructions from lifeguards, beach authorities, or emergency officials. Always follow posted signs and local authorities.
