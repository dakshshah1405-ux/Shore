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

## 3. It declines to invent absent fields — when asked the right way

The prose line states surf but no rip current risk. With "use an empty string for anything the text
does not state," Super returned `"risk": ""` rather than inventing a category. This is the behavior
the `ABSENT` rows of the gold set test at scale.
