@AGENTS.md

# Shore — project context

SteelHacks XIII, 24 hours. **Devpost due Sunday Sep 20, 11:00 AM ET — code freeze 9:00 AM.**
Tracks: Xtract (Signal-to-Insight Engine) + NVIDIA Beyond the Chatbot. Full plan: `docs/PLAN.md`.

Shore turns NWS Surf Zone Forecast text (fixed-width ASCII that drifts between offices) into
structured, traceable beach-safety signals and renders them on a map of 73 East Coast surf zones.

## Safety rules — non-negotiable, they are the product
- **Never fabricate a value.** Missing → `null` → UI shows "Data unavailable".
- **`risk` defaults to `'unknown'`, never `'lower'`.** Missing data must never render as green or safe.
- **Every stored value keeps provenance:** `sourceUrl`, `rawSpan` (the literal slice of the stored document), `charStart`/`charEnd`. `npx tsx scripts/parse-samples.ts` must report **0 span errors**.
- **Risk comes from the worst-of rule ladder** in `lib/risk.ts`, not a weighted score. Sub-areas take the worst value.
- **Official NWS wording is shown verbatim** — headlines and alert text are never paraphrased.
- **Never say "safe."** Use NWS vocabulary: Low / Moderate / High.
- **Nemotron output is validated before use; the deterministic parser wins ties.**
- **Filters:** a zone without the data never matches (a "calm surf" filter must not highlight unknown surf).

## Layout
| Path | What |
|---|---|
| `lib/types.ts` | Shared contract. **Change only by team agreement.** |
| `lib/adapters/srf.ts` | Deterministic SRF parser with byte-exact provenance |
| `lib/ingest/srf.ts` | Stores documents, zone segments, observations |
| `lib/risk.ts`, `lib/conditions.ts`, `app/api/conditions/route.ts` | Risk ladder → per-zone conditions API |
| `lib/nemotron.ts` | The only Nemotron client (`extractJSON`) |
| `lib/nws.ts`, `lib/ugc.ts`, `lib/normalize.ts` | NWS client, zone-code parser, label/number normalization |
| `components/` | `ShoreApp` (state, filters, legend), `ZoneMap`, `ZonePanel` (provenance) |
| `db/schema.sql`, `scripts/migrate.ts` | Shared Neon database — **additive schema changes only** |
| `data/samples/` | Real SRF text from all 12 offices; seed of the eval gold set |

## Commands
```
npm run dev                          # http://localhost:3000
npx tsx scripts/ingest.ts            # fetch + store latest SRFs (idempotent)
npx tsx scripts/parse-samples.ts     # parser + provenance check over data/samples
npx tsx scripts/check-conditions.ts  # print computed risk for every zone
npx tsx scripts/migrate.ts           # apply db/schema.sql (idempotent)
npx tsc --noEmit                     # typecheck
```
Env lives in `.env.local` (copy `.env.example`). Everyone shares `DATABASE_URL`; each person uses their **own** `NVIDIA_API_KEY` (~40 req/min per key).

## Verified gotchas — do not relearn these
- **Next.js 16.3**, not 15. Read `node_modules/next/dist/docs/` before writing Next code. Route `params` are Promises.
- **MapLibre 6 is ESM-only with no default export.** Use named imports, dynamically imported inside client components.
- **NWS API** requires a `User-Agent`. Geometry endpoints need `Accept: application/geo+json` — the JSON-LD form returns WKT strings. Never send `include_geometry` to `/zones/forecast/{id}` (400).
- **SRF drift already handled:** optional `*`/`**` on labels, field order, wrapped values, sub-area splits, wrapped headlines, prose outlook periods, and per-office labels (CAR `Surf`, OKX `Surf Temperature`, ILM free-text `Remarks` carrying longshore-current warnings).
- **`data/**` is byte-exact** (`.gitattributes: -text`). Provenance offsets index into these files — never reformat them.
- Scripts load `.env.local` with `process.loadEnvFile`; read env vars at call time, since imports are hoisted.
- **Windows PowerShell 5.1:** no `&&`; embedded double quotes break `git commit -m` — use `git commit -F <file>`. Don't rewrite source files with `Get-Content`/`Set-Content` (it corrupts UTF-8); use the editor tools.

## Team workflow
- Stay inside your own area's files (see Team split in `docs/PLAN.md`) so four people never edit the same file.
- Branch per feature, merge to `main` often. **`main` must always build** — Vercel deploys it as the demo URL.
- `git pull --rebase` before pushing. Never commit `.env.local`.
