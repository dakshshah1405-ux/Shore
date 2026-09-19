// The one place Shore talks to Nemotron. Everything else imports extractJSON.
//
// Model and settings were chosen by probing, not copied from NVIDIA's sample (see eval/FINDINGS.md):
//   - nemotron-nano-9b-v2, used in NVIDIA's hackathon slides, is end-of-life (HTTP 410).
//   - The "/no_think" system token from that sample breaks Nemotron 3: Super returns "{}".
//   - Thinking is disabled with chat_template_kwargs.enable_thinking=false instead.
//   - temperature 0 so the same input gives the same output (the eval depends on it).
//
// Reliability: 3 Super answers in seconds; 3.5 Lightning is the automatic backup when Super
// fails or is overloaded. If both fail, callers get data: null and keep parser values only.

import OpenAI from 'openai';

export const PRIMARY_MODEL = process.env.NEMOTRON_MODEL || 'nvidia/nemotron-3-super-120b-a12b';
export const FALLBACK_MODEL = process.env.NEMOTRON_FALLBACK_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!process.env.NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is not set (add it to .env.local)');
  client ??= new OpenAI({ apiKey: process.env.NVIDIA_API_KEY, baseURL: 'https://integrate.api.nvidia.com/v1' });
  return client;
}

// Tolerates a model that wraps its JSON in markdown fences despite json_object mode.
function parseLoose(raw: string): unknown | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  try {
    return JSON.parse((fenced ? fenced[1] : raw).trim());
  } catch {
    return null;
  }
}

export interface ExtractOptions {
  think?: boolean;   // reasoning on — for the thinking vs. no-thinking eval comparison
  model?: string;    // pin one model with no fallback — for benchmarking a specific model
}

export interface ExtractResult<T> {
  data: T | null;                 // null when every attempt failed — callers keep parser values only
  model: string | null;           // which model produced `data`
  attempts: { model: string; ok: boolean; error?: string }[];
}

export async function extractJSON<T>(system: string, user: string, opts: ExtractOptions = {}): Promise<ExtractResult<T>> {
  const chain = opts.model
    ? [{ model: opts.model, timeout: 180_000, maxRetries: 1 }]
    : [{ model: PRIMARY_MODEL, timeout: 60_000, maxRetries: 1 },
       { model: FALLBACK_MODEL, timeout: 120_000, maxRetries: 0 }];
  const attempts: ExtractResult<T>['attempts'] = [];

  for (const step of chain) {
    const body = {
      model: step.model,
      messages: [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: user },
      ],
      temperature: 0,
      top_p: 1,
      max_tokens: opts.think ? 8192 : 2048,
      response_format: { type: 'json_object' as const },
      stream: false as const,
      chat_template_kwargs: { enable_thinking: !!opts.think },   // NIM forwards this to the chat template
    };
    try {
      const res = await getClient().chat.completions.create(
        body as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
        { timeout: step.timeout, maxRetries: step.maxRetries },
      );
      const raw = res.choices[0]?.message?.content;
      const data = raw ? (parseLoose(raw) as T | null) : null;
      if (data !== null) {
        attempts.push({ model: step.model, ok: true });
        return { data, model: step.model, attempts };
      }
      attempts.push({ model: step.model, ok: false, error: 'unparseable response' });
    } catch (e) {
      attempts.push({ model: step.model, ok: false, error: (e as Error).message.slice(0, 160) });
    }
  }
  return { data: null, model: null, attempts };
}
