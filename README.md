# Shore

**Official beach-safety data for the entire U.S. East Coast is published as fixed-width ASCII from
teletype-era infrastructure. Almost nobody reads it. Shore does.**

Built at SteelHacks XIII, 19–20 September 2026. Sources & Methodology ships inside the app, at `/sources`.

**Live demo:** <https://shore-dakshshah1405-7053s-projects.vercel.app>

---

## The document nobody reads

This is the National Weather Service Surf Zone Forecast for the Northern Outer Banks, live, right now:

```
NCZ203-190000-
Northern Outer Banks-
Including the beaches of Duck, Southern Shores, Kitty Hawk,
Kill Devil Hills, and Nags Head
.REST OF TODAY...
Rip Current Risk*...........Moderate.
Surf Height.................2 to 3 feet.
Thunderstorm Potential**....None.
UV Index**..................Very High.
Water Temperature...........In the upper 70s.
Weather.....................Sunny.
```

One of these is issued about twice a day by each of the 12 East Coast forecast offices. It is
life-safety data, delivered in a format whose column positions carry meaning and whose field set and
label wording drift from office to office.

Shore turns that text into structured, traceable values across **73 surf zones**, and draws them on
a map where every single number can be clicked to reveal the exact source line it came from.

## What it does

- **Extracts** rip current risk, surf height, thunderstorm potential, water temperature, wind, UV,
  tides and free-text remarks from every East Coast Surf Zone Forecast.
- **Keeps provenance on every value** — source URL, the literal text span, character offsets, issue
  time, which extractor read it, and a confidence level.
- **Assesses** each zone with a deterministic worst-of rule ladder, and records which rung fired.
- **Never guesses.** A value that cannot be read is stored as nothing and shown as *Data unavailable*.
  A zone missing rip current data renders grey, never green.
- **Ingests unattended** on a 15-minute GitHub Actions schedule, so an overnight alert appears
  without anyone touching it.

## Tracks

### Xtract — Signal-to-Insight Engine

| Their criterion | How Shore answers it |
|---|---|
| Support for different sources without rebuilding everything | Two adapters of deliberately opposite shape — fixed-width ASCII (SRF) and structured JSON (CAP alerts) — behind one shared router, reconciler, provenance model and store. |
| A model that can find useful signals in incoming documents | Nemotron extracts from the same text independently of the parser, including prose remarks no regular expression can reach. |
| Insights that link back to where they came from | Every stored value carries `sourceUrl`, `rawSpan`, `charStart`/`charEnd`. Clicking any value in the UI reveals the exact source line and links to the NWS product. `scripts/parse-samples.ts` asserts **0 provenance span errors**. |
| A clean way to actually see and use the output | A map of all 73 zones, instant client-side filters, a detail panel, and an in-app Sources & Methodology page at `/sources`. |

**Public data only.** Every source is U.S. federal data in the public domain under 17 U.S.C. §105.
Shore contains **no LANXESS data** of any kind.

### Beyond the Chatbot

**There is no chat interface anywhere in this product.** Nemotron 3 Super holds four jobs inside the
pipeline, and is fenced in on all four:

| Role | What it does | What it is not allowed to do |
|---|---|---|
| **Router** | Classifies an arbitrary document by structure and picks the extractor | Cannot discard a document alone — a document is dropped only when the deterministic check agrees |
| **Extractor** | Reads forecast text independently of the parser | Every value is rejected unless its quote is found verbatim in the stored source |
| **Adjudicator** | When parser and model disagree, decides which reading matches the document | Never assesses danger; an adjudication that would lower a hazard is refused |
| **Coherence auditor** | Flags zones where assessment, fired rule, headline and fields contradict each other | Only raises a flag — cannot compute risk or change a value. Runs offline, never in the request path |

The deterministic layer judges the model, not the other way round. **The serving path never calls
Nemotron.**

---

## Evals

Four evaluations, each measured against a deterministic baseline rather than against nothing.
Full write-up, caveats and disclosed artifacts: **[`eval/FINDINGS.md`](eval/FINDINGS.md)**.

### 1. Router — classifying documents by structure, not vocabulary

20 cases: 6 real SRF products and 6 real non-SRF NWS products, each also with its WMO/AWIPS header
stripped as if pasted from a web page, plus 3 synthetic junk inputs.
Run: `npx tsx scripts/eval-router.ts`

| Config | Overall | SRF recognised | Non-SRF rejected | Header-stripped |
|---|---|---|---|---|
| header baseline (deterministic) | 77% | 50% | **100%** | 45% |
| keyword baseline (naive matcher) | 85% | **100%** | 71% | 82% |
| **nemotron** | **100%** | **100%** | **100%** | **100%** |

Both baselines fail in their own way, and both failures are real rather than constructed. The header
check never mislabels anything but goes blind once the header is gone — it missed all six stripped
forecasts, which is exactly the "arbitrary document" case this pipeline claims to support. The
keyword matcher routes a Hazardous Weather Outlook into the surf extractor because the prose
contains the phrase "rip current risk": confident nonsense, and the failure a matcher cannot fix
because it has no notion of *I don't recognise this*. This is the one eval where the model beats
both deterministic baselines on their own ground. Sample size is 20 — a clean signal, not a precise
number.

### 2. Coherence audit — catching contradictions no rule can express

10 real zones (any flag is a false alarm) plus 12 injected inconsistencies of four kinds.
Run: `npx tsx scripts/eval-audit.ts --clean 10`

| Config | Inconsistencies caught | False flags on clean data |
|---|---|---|
| no audit | 0 / 12 (0%) | 0 / 10 |
| recompute baseline (deterministic) | 6 / 12 (50%) | 0 / 10 |
| headline keyword baseline | 3 / 12 (25%) | 0 / 10 |
| nemotron | 10 / 12 (83%) | 0 / 10 |
| **deterministic + nemotron** (what we ship) | **12 / 12 (100%)** | **0 / 10** |

The classes separate cleanly, which is the useful part. Recomputing the risk catches a label that
doesn't follow from the data exactly and for free, but cannot see a headline contradicting a field.
Only Nemotron caught the semantic contradiction — weather reading *"Numerous thunderstorms, some
severe"* while `thunderstormPotential` is `None` — which no rule we could write expresses. And
Nemotron missed 2 of 3 "rule cites an absent value" cases that recomputation catches exactly. Hence
the union. **Zero false flags on real data matters more than the catch rate: an auditor that cries
wolf gets switched off.**

### 3. Adjudication — and why "the parser wins ties" wasn't enough

24 cases across 6 offices: real forecasts broken one line at a time in ways that defeat the parser's
structural assumptions, with the correct answer read from the untouched document.
Run: `npx tsx scripts/eval-adjudicator.ts --per-flaw 4`

**A. Cases where the forecast states a value (20)**

| Config | Coverage | Precision | Recall |
|---|---|---|---|
| regex only | 40% | 50% | 20% |
| nemotron only | 100% | 100% | 100% |
| naive reconcile (parser wins ties) | 100% | 80% | 80% |
| **adjudicated (pre-check + Nemotron)** | **100%** | **100%** | **100%** |

**B. Control — the field was deleted, so the correct answer is no value (4)**

| Config | Values invented | Correctly silent |
|---|---|---|
| every config, including Nemotron | **0 / 4** | **100%** |

Overall accuracy: regex 33% · naive reconcile 83% · adjudicated 100% · nemotron-only 100%.

**Read this one honestly.** 16 of the 20 value cases are deliberately corrupted; on real data the
parser is right essentially always — **0 disagreements across 1,262 live values**. The table measures
behaviour on damaged input. Nemotron-only also scores 100% here, because every case is one the
parser fails, so any deference to the parser costs points — which is precisely why both
distributions matter. A config that always trusted the model would ship the model's errors across
the 1,262 real values. And most of the gain is deterministic rather than model-driven: a parser
value that isn't a valid category for its field, or whose span crosses a line break, is provably
wrong from the format alone, and the pre-check resolves those without calling Nemotron at all.

### 4. Thinking mode and model choice

The model in NVIDIA's own hackathon slide, `nvidia/nvidia-nemotron-nano-9b-v2`, returns **HTTP 410
Gone** — end of life 2026-08-26. We queried `/v1/models` and chose from what is actually served. The
`/no_think` token from NVIDIA's sample then turned out to *break* Nemotron 3. Same prompt, one prose
forecast line:

| Model | Mode | Latency | Finish | Output |
|---|---|---|---|---|
| nemotron-3-super-120b-a12b | `/no_think` in system prompt | 17.1 s | `length` | **`{}`** — reasoning ate the whole budget |
| nemotron-3-super-120b-a12b | thinking (default) | 8.7 s | `stop` | correct JSON |
| **nemotron-3-super-120b-a12b** | **`enable_thinking: false`** | **1.3 s** | `stop` | **correct JSON, 26 tokens** |
| nemotron-3.5-lightning-30b-a3b | `/no_think` | 23.8 s | `length` | reasoning leaked into `content` |
| nemotron-3.5-lightning-30b-a3b | thinking, temperature 0 | 103 s | `length` | **degenerate repetition** (`ellsellsells…`) |
| nemotron-3.5-lightning-30b-a3b | `enable_thinking: false` | 108.6 s | `stop` | correct JSON — latency unusable |

Shipped: `nemotron-3-super-120b-a12b`, `chat_template_kwargs.enable_thinking = false`, temperature 0.

---

## The failure we found

We ran both extractors over every forecast, which produced four disagreements — all in one zone,
Coastal Brunswick (`NCZ110`). In all four, the **parser** was the one that was wrong:

```
Rip Current Risk*...
   East of Ocean Isle Beach.Low.        ← one dot: the name is long enough to eat the leader
   Ocean Isle Beach West....Low.
```

The parser required a run of two or more dots, so it silently dropped the East values — rip risk and
surf, both days. Nemotron read them correctly. Reconciliation then **refused to store Nemotron's
answer**, because the parser wins ties, and flagged the conflict instead of guessing. That flag is
how we found the bug.

SRF is fixed-width, so sub-area values are now read from column 28 rather than by counting dots.
Wilmington went from 116 to 120 values, disagreements 4 → 0, provenance span errors still 0. A scan
of all 12 offices found no other single-dot lines.

**This is the role we want for Nemotron: not replacing the deterministic parser, but auditing it.**

Two more, written up in [`eval/FINDINGS.md`](eval/FINDINGS.md): a reasoning model whose conclusion
contradicted its own stated reasoning, and a measurement artifact in our own harness that we
disclosed rather than tuned away.

---

## Safety rules

These are the product, not a checklist bolted on afterwards:

- **Never fabricate a value.** Missing → `null` → *Data unavailable*.
- **`risk` defaults to `unknown`, never `lower`.** Missing data never renders green or safe.
- **Risk comes from a worst-of rule ladder**, never a weighted score — averaging can numerically
  downplay a severe hazard, and `0.78` cannot be audited against the official forecast.
- **Sub-areas take the worst value** in the zone.
- **Official NWS wording is shown verbatim.** Headlines are never paraphrased.
- **Never say "safe."** The vocabulary mirrors NWS Low / Moderate / High so Shore cannot appear to
  contradict the official source.
- **An official NWS product always outranks anything Shore computes.**
- **A filter never highlights a zone lacking that data** — "surf under 2 ft" must not select a zone
  whose surf is unknown.

### Limits, stated plainly

Resolution is the NWS forecast zone — tens of kilometres — not an individual beach; anything finer
would be invented precision. Rip current risk is a forecast issued about twice a day, not an
observation. Lifeguard data is deliberately absent, because no authoritative national dataset exists
and showing unverified lifeguard status on a drowning-risk map is the most dangerous thing this
product could do.

---

## Architecture

```
NWS SRF (fixed-width ASCII) ─┐
NWS CAP alerts (JSON) ───────┴─► ROUTER ─► deterministic parser ─┐
                                 (header check                    ├─► RECONCILE ─► ADJUDICATE
                                  + Nemotron)  Nemotron extractor ┘   (parser wins)  (pre-check
                                                                                      + Nemotron)
                                                                             │
                                          Observation[] + full provenance ◄──┘
                                                       │
                                            risk ladder (deterministic)
                                                       │
                                        Postgres ─► /api/conditions ─► map
                                                       │
                                        coherence audit (offline, flags only)
```

| Path | What |
|---|---|
| `lib/types.ts` | The shared contract |
| `lib/adapters/srf.ts` | Deterministic SRF parser with byte-exact provenance |
| `lib/extract/router.ts` | Header check + Nemotron classification |
| `lib/extract/srf-llm.ts` | Nemotron extraction with quote verification |
| `lib/extract/reconcile.ts` | Agreement, confidence, disagreement logging |
| `lib/extract/adjudicate.ts` | Deterministic pre-check, then Nemotron against the source |
| `lib/risk.ts` | The worst-of rule ladder |
| `lib/audit/coherence.ts` | Offline contradiction audit |
| `lib/nemotron.ts` | The only Nemotron client |
| `components/` | `ShoreApp`, `ZoneMap`, `ZonePanel` (the provenance viewer) |
| `app/sources/page.tsx` | In-app Sources & Methodology |
| `eval/FINDINGS.md` | Every eval, with caveats |

**Stack:** Next.js 16 · TypeScript · Tailwind v4 · MapLibre GL · Neon Postgres · NVIDIA NIM
(Nemotron 3 Super) · Vercel · GitHub Actions.

---

## Running it

```bash
npm install
cp .env.example .env.local     # add your own NVIDIA key + a Neon connection string
npx tsx scripts/migrate.ts     # create the schema (idempotent)
npx tsx scripts/ingest.ts      # fetch and store the latest forecasts (idempotent)
npm run dev                    # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npx tsx scripts/parse-samples.ts` | Parser + provenance check over the committed samples — must report **0 span errors** |
| `npx tsx scripts/check-conditions.ts` | Print the computed risk for every zone |
| `npx tsx scripts/eval-router.ts` | Router eval (table 1) |
| `npx tsx scripts/eval-audit.ts --clean 10` | Coherence audit eval (table 2) |
| `npx tsx scripts/eval-adjudicator.ts --per-flaw 4` | Adjudication eval (table 3) |
| `npx tsx --test lib/normalize.test.ts lib/search.test.ts lib/extract/router.test.ts lib/extract/adjudicate.test.ts` | 34 unit tests — router, adjudicator guards, normalisation, search |
| `npx tsc --noEmit` | Typecheck |

Ingestion runs unattended every 15 minutes via `.github/workflows/ingest.yml`. Documents already
stored are skipped, so a typical run does almost no work and makes few model calls.

---

## Data sources and licensing

All data comes from [api.weather.gov](https://api.weather.gov): Surf Zone Forecast products, active
CAP alerts, and forecast zone geometry. U.S. federal works, public domain under 17 U.S.C. §105. No
credentials or licences are required; NWS asks only for a `User-Agent` carrying contact information.

Base map: [CARTO Positron](https://carto.com/basemaps/) over OpenStreetMap. Satellite layer:
[USGS/USDA orthoimagery](https://basemap.nationalmap.gov/) — periodic aerial survey, not live.

**Public federal sources only. No LANXESS data.**

---

> Beach and ocean conditions change rapidly. Shore is an informational prototype built at
> SteelHacks XIII. It does not replace instructions from lifeguards, beach authorities, or emergency
> officials. Always follow posted signs and local authorities.
