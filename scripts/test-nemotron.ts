// Smoke test: is the key present, does Nemotron answer, and does it return parseable JSON?
process.loadEnvFile?.('.env.local');

import { extractJSON, NEMOTRON_MODEL } from '../lib/nemotron';

async function main() {
  const key = process.env.NVIDIA_API_KEY ?? '';
  if (!key.startsWith('nvapi-') || key.includes('xxxx')) {
    console.log('NVIDIA_API_KEY missing or still the placeholder in .env.local');
    process.exit(1);
  }
  console.log(`key: ${key.slice(0, 9)}… (${key.length} chars) · model: ${NEMOTRON_MODEL}`);
  const t = Date.now();
  const out = await extractJSON<{ risk?: string; quote?: string }>(
    'Extract the rip current risk. Reply with JSON {"risk": string, "quote": string} where quote is copied exactly from the text.',
    'Rip Current Risk*...........Moderate.\nSurf Height.................2 to 3 feet.',
  );
  console.log(`${Date.now() - t} ms →`, out);
}

main().catch((e) => { console.error('FAILED:', e.status ?? '', e.message); process.exit(1); });
