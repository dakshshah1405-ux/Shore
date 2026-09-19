// Smoke test: is the key present, does Nemotron answer, and does it return parseable JSON?
//   npx tsx scripts/test-nemotron.ts [model]   — omit model to test the primary → backup chain
process.loadEnvFile?.('.env.local');

import { extractJSON, PRIMARY_MODEL, FALLBACK_MODEL } from '../lib/nemotron';

async function main() {
  const key = process.env.NVIDIA_API_KEY ?? '';
  if (!key.startsWith('nvapi-') || key.includes('xxxx')) {
    console.log('NVIDIA_API_KEY missing or still the placeholder in .env.local');
    process.exit(1);
  }
  const model = process.argv[2];
  console.log(`key: ${key.slice(0, 9)}… (${key.length} chars) · ${model ?? `${PRIMARY_MODEL} → backup ${FALLBACK_MODEL}`}`);
  const t = Date.now();
  const out = await extractJSON<{ risk?: string; quote?: string }>(
    'Extract the rip current risk. Reply with JSON {"risk": string, "quote": string} where quote is copied exactly from the text.',
    'Rip Current Risk*...........Moderate.\nSurf Height.................2 to 3 feet.',
    { model },
  );
  console.log(`${Date.now() - t} ms · answered by ${out.model ?? 'nobody'} →`, out.data);
  for (const a of out.attempts) console.log(`  ${a.ok ? 'ok  ' : 'FAIL'} ${a.model}${a.error ? ` — ${a.error}` : ''}`);
  process.exit(out.data ? 0 : 1);
}

main();
