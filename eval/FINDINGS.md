# Findings — what we learned putting Nemotron in the pipeline

Recorded as we found them, Saturday Sep 19 2026. Probe scripts: `scripts/probe-models.ts`, `scripts/probe-thinking.ts`.

## 1. The model in NVIDIA's hackathon slides is retired

`nvidia/nvidia-nemotron-nano-9b-v2` — the model in the official "Getting Started" slide — returns
**HTTP 410 Gone**: *"reached its end of life on 2026-08-26."* We queried `/v1/models` and chose from
what is actually served.

## 2. The `/no_think` token from NVIDIA's sample breaks Nemotron 3

Same prompt, a prose forecast line (`.MONDAY...Surf height around 2 feet. Mostly sunny...`):

| Model | Mode | Latency | Finish | Output |
|---|---|---|---|---|
| nemotron-3-super-120b-a12b | `/no_think` in system prompt | 17.1 s | `length` | **`{}`** — reasoning consumed the whole budget |
| nemotron-3-super-120b-a12b | thinking (default) | 8.7 s | `stop` | correct JSON |
| **nemotron-3-super-120b-a12b** | **`enable_thinking: false`** | **1.3 s** | `stop` | **correct JSON, 26 tokens** |
| nemotron-3.5-lightning-30b-a3b | `/no_think` | 23.8 s | `length` | reasoning leaked into `content` |
| nemotron-3.5-lightning-30b-a3b | thinking, temperature 0 | 103 s | `length` | **degenerate repetition** (`ellsellsells…`) |
| nemotron-3.5-lightning-30b-a3b | `enable_thinking: false` | 108.6 s | `stop` | correct JSON — latency unusable |

**Decision:** `nemotron-3-super-120b-a12b` with `chat_template_kwargs.enable_thinking = false`, temperature 0.

## 4. Nemotron caught a bug in our deterministic parser

Running both extractors on every forecast surfaced 4 disagreements, all in one zone (ILM `NCZ110`,
Coastal Brunswick). Every one was the **parser** being wrong:

```
Rip Current Risk*...
   East of Ocean Isle Beach.Low.        ← one dot: the name is long enough to eat the leader
   Ocean Isle Beach West....Low.
```

The parser required a run of two or more dots, so it silently skipped the East values — rip risk
and surf, both days. Nemotron read them, and the judge verified each quote against the source.
Reconciliation refused to store Nemotron's answer (the parser wins ties) and flagged the conflict
instead of guessing, which is how we found it.

Fix: SRF is fixed-width, so sub-area values are now read from column 28 rather than by counting
dots. Result: Wilmington 116 → 120 values, disagreements 4 → 0, provenance span errors still 0.
A scan of all 12 offices found no other single-dot lines.

**This is the role we want for Nemotron: not replacing the deterministic parser, but auditing it.**

## 5. Nemotron 3.5 Lightning ignored the requested output shape

As the automatic backup (it answered one Miami-Dade call when Super didn't), 3.5 Lightning returned
correct values in the wrong envelope — an object keyed by day name instead of the requested list:

```
{"REST OF TODAY": {"label": "REST OF TODAY", "fields": [...]}, "SUNDAY": {...}}
```

The judge rejected the whole response, so the zone fell back to parser-only values: a safe failure,
with no bad data admitted, but the backup's correct answer was wasted (after 47 s). The judge now
accepts either envelope while keeping every per-value check unchanged; the same cached response
yields 7 accepted and 1 rejected value.

## 6. Adjudication eval — and why "regex wins ties" wasn't enough

Nemotron's fourth role: when the parser and the model disagree about a field, Nemotron is shown the
source text and decides **which reading matches the document**. It never assesses danger — the rule
ladder in `lib/risk.ts` remains the sole authority on risk, and `applyAdjudications` refuses any
change that would lower a hazard (9 tests in `lib/extract/adjudicate.test.ts`).

**Harness:** real forecasts, broken one line at a time in ways that defeat the parser's structural
assumptions, with the correct answer read from the untouched document. **These are injected flaws,
not field data** — after fixing the bug in §4, real disagreements across all 12 offices are zero.
24 cases, 4 per flaw type, 6 offices. Run: `npx tsx scripts/eval-adjudicator.ts --per-flaw 4`.

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
| every config, including Nemotron | 0 / 4 | 100% |

Overall accuracy: regex 33% · naive reconcile 83% · adjudicated 100% · nemotron-only 100%.

**Read it honestly.** 16 of the 20 value cases are deliberately corrupted; on real data the parser
is right essentially always (0 disagreements in 1,262 live values). The table measures behaviour on
damaged input. Nemotron-only also scores 100% here — every case is one the parser fails, so any
deference to the parser costs points. That is exactly why both distributions matter: a config that
always trusted the model would ship the model's errors across the 1,262 real values.

**Most of the gain is deterministic, not model-driven.** A parser value that isn't a valid category
for its field, or whose source span crosses a line break (these fields are always stated on one
line), is provably wrong from the format alone. `preCheck` resolves those without calling Nemotron.

## 7. A reasoning model whose conclusion contradicted its own reasoning

Before the pre-check existed, adjudication was wrong in 3 of 8 corruption cases — and the reasons
are the interesting part. Verbatim, with `choice: "parser"`:

> *"Source text shows 'Rip Current Risk*...........Low.' and 'Expect hazardous conditions near
> inlets.' on separate lines; parser captured both, model only 'Low'."*

It correctly diagnosed that the parser had swallowed text from another line, then sided with the
parser anyway. Not a hallucination — a conclusion that doesn't follow from its own stated reasoning.
Found by measuring against a baseline rather than trusting the output, and mitigated by deciding
those cases deterministically instead of asking.

## 8. A measurement artifact worth knowing about

One corrupted surf case still stores the text `"Around 2 feet Expect hazardous conditions near
inlets"` yet scores correct: agreement is tested on parsed numbers, and both strings parse to 2 ft,
so it never became a disagreement. **Text corruption that preserves the number is invisible to a
numeric agreement test.** Disclosed rather than tuned away.

## 3. It declines to invent absent fields — when asked the right way

The prose line states surf but no rip current risk. With "use an empty string for anything the text
does not state," Super returned `"risk": ""` rather than inventing a category. This is the behavior
the `ABSENT` rows of the gold set test at scale.
