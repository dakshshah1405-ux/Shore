// The one place Shore talks to Nemotron. Everything else imports extractJSON.
//
// Model and settings were chosen by probing, not copied from NVIDIA's sample (see eval/FINDINGS.md):
//   - nemotron-nano-9b-v2, used in NVIDIA's hackathon slides, is end-of-life (HTTP 410).
//   - The "/no_think" system token from that sample breaks Nemotron 3: Super returns "{}".
//   - Thinking is disabled with chat_template_kwargs.enable_thinking=false instead:
//     Super answers in ~1.3 s vs ~8.7 s with thinking, same result.
//   - temperature 0 so the same input gives the same output (the eval depends on it).

import OpenAI from 'openai';

export const NEMOTRON_MODEL = process.env.NEMOTRON_MODEL || 'nvidia/nemotron-3-super-120b-a12b';

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!process.env.NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is not set (add it to .env.local)');
  client ??= new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: 'https://integrate.api.nvidia.com/v1',
    timeout: 90_000,
    maxRetries: 2,
  });
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
  think?: boolean;   // reasoning on — used for the thinking vs. no-thinking eval comparison
}

// Returns null on any failure. Callers treat null as "Data unavailable" — never as a guess.
export async function extractJSON<T>(system: string, user: string, opts: ExtractOptions = {}): Promise<T | null> {
  const body = {
    model: NEMOTRON_MODEL,
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
  const res = await getClient().chat.completions.create(body as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const raw = res.choices[0]?.message?.content;
  return raw ? (parseLoose(raw) as T | null) : null;
}
