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

## 3. It declines to invent absent fields — when asked the right way

The prose line states surf but no rip current risk. With "use an empty string for anything the text
does not state," Super returned `"risk": ""` rather than inventing a category. This is the behavior
the `ABSENT` rows of the gold set test at scale.
