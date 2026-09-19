// The one place Shore talks to Nemotron. Everything else imports extractJSON.
//
// Settings differ from NVIDIA's sample on purpose: their defaults are tuned for chat.
//   temperature 0     — same input, same output; otherwise eval numbers are noise
//   /no_think         — reasoning mode is slower and verbose; wrong default for bulk extraction
//   json_object       — valid JSON instead of prose
//   stream: false     — we parse a whole object, not render tokens

import OpenAI from 'openai';

export const NEMOTRON_MODEL = process.env.NEMOTRON_MODEL || 'nvidia/nvidia-nemotron-nano-9b-v2';

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!process.env.NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is not set (add it to .env.local)');
  client ??= new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: 'https://integrate.api.nvidia.com/v1',
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
  think?: boolean;   // flip on for the /think vs /no_think eval comparison
}

// Returns null on any failure. Callers treat null as "Data unavailable" — never as a guess.
export async function extractJSON<T>(system: string, user: string, opts: ExtractOptions = {}): Promise<T | null> {
  const res = await getClient().chat.completions.create({
    model: NEMOTRON_MODEL,
    messages: [
      { role: 'system', content: `${opts.think ? '/think' : '/no_think'}\n${system}` },
      { role: 'user', content: user },
    ],
    temperature: 0,
    top_p: 1,
    max_tokens: 2048,
    response_format: { type: 'json_object' },
    stream: false,
  });
  const raw = res.choices[0]?.message?.content;
  return raw ? (parseLoose(raw) as T | null) : null;
}
