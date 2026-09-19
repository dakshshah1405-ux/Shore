// Probes candidate Nemotron models: latency, raw output shape, and whether reasoning leaks into content.
process.loadEnvFile?.('.env.local');

import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.NVIDIA_API_KEY, baseURL: 'https://integrate.api.nvidia.com/v1' });
const MODELS = process.argv.slice(2).length ? process.argv.slice(2) : [
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3-super-120b-a12b',
];
const SYSTEM = 'Extract the rip current risk and surf height. Reply with JSON only: {"risk": string, "surf": string, "quote": string}. quote must be copied exactly from the text.';
const USER = '.MONDAY...Surf height around 2 feet. Mostly sunny. Highs in the lower\n60s. Northeast winds around 10 mph.';

async function main() {
  for (const model of MODELS) {
    for (const sys of [`/no_think\n${SYSTEM}`, SYSTEM]) {
      const t = Date.now();
      try {
        const res = await client.chat.completions.create({
          model, temperature: 0, top_p: 1, max_tokens: 1024, stream: false,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: sys }, { role: 'user', content: USER }],
        });
        const msg = res.choices[0]?.message as unknown as Record<string, unknown>;
        console.log(`\n${model} ${sys.startsWith('/no_think') ? '[/no_think]' : '[plain]'} ${Date.now() - t} ms, finish=${res.choices[0]?.finish_reason}`);
        console.log('  content:', JSON.stringify(msg?.content)?.slice(0, 300));
        if (msg?.reasoning_content) console.log('  reasoning_content:', String(msg.reasoning_content).slice(0, 120), '…');
      } catch (e) {
        console.log(`\n${model}: FAILED ${(e as { status?: number }).status ?? ''} ${(e as Error).message.slice(0, 200)}`);
      }
    }
  }
}

main();
