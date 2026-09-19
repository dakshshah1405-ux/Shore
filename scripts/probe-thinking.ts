// Does Nemotron 3 accept chat_template_kwargs.enable_thinking=false, and what does it cost/buy?
process.loadEnvFile?.('.env.local');

import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.NVIDIA_API_KEY, baseURL: 'https://integrate.api.nvidia.com/v1' });
const SYSTEM = 'Extract the rip current risk and surf height. Reply with JSON only: {"risk": string, "surf": string, "quote": string}. quote must be copied exactly from the text. Use an empty string for anything the text does not state.';
const USER = '.MONDAY...Surf height around 2 feet. Mostly sunny. Highs in the lower\n60s. Northeast winds around 10 mph.';

async function main() {
  for (const model of ['nvidia/nemotron-3-super-120b-a12b', 'nvidia/nemotron-3.5-lightning-30b-a3b']) {
    const t = Date.now();
    try {
      const body = {
        model, temperature: 0, top_p: 1, max_tokens: 1024, stream: false as const,
        response_format: { type: 'json_object' as const },
        messages: [{ role: 'system' as const, content: SYSTEM }, { role: 'user' as const, content: USER }],
        chat_template_kwargs: { enable_thinking: false },   // NIM passes this through to the chat template
      };
      const res = await client.chat.completions.create(body as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
      const msg = res.choices[0]?.message as unknown as Record<string, unknown>;
      console.log(`\n${model} [enable_thinking:false] ${Date.now() - t} ms, finish=${res.choices[0]?.finish_reason}, tokens=${res.usage?.completion_tokens}`);
      console.log('  content:', JSON.stringify(msg?.content)?.slice(0, 300));
      console.log('  reasoning present:', Boolean(msg?.reasoning_content));
    } catch (e) {
      console.log(`\n${model}: FAILED ${(e as { status?: number }).status ?? ''} ${(e as Error).message.slice(0, 200)}`);
    }
  }
}

main();
