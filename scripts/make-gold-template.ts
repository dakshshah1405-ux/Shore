// Builds eval/gold-template.csv: WHICH items to hand-label, never the answers.
// The gold values must come from people reading data/samples, or the eval is circular.
//
// Stratified on purpose: structured fields, sub-area splits, and prose outlook periods
// (where regex cannot reach and fields are often absent — the hallucination traps).

import fs from 'node:fs';
import path from 'node:path';
import { parseSrf } from '../lib/adapters/srf';

const FIELDS = ['ripCurrentRisk', 'surfHeight', 'thunderstormPotential'] as const;
interface Item { file: string; zoneId: string; zoneName: string; period: string; subArea: string; field: string; kind: string }

// Deterministic shuffle so the template is reproducible.
function seeded(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function shuffle<T>(a: T[], rnd: () => number) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const dir = path.join('data', 'samples');
const pools: Record<string, Item[]> = { structured: [], subarea: [], prose: [] };

for (const file of fs.readdirSync(dir).filter((f) => f.startsWith('srf-')).sort()) {
  for (const seg of parseSrf(fs.readFileSync(path.join(dir, file), 'utf8'))) {
    const base = { file, zoneId: seg.zones[0], zoneName: seg.zoneName ?? '' };
    for (const p of seg.periods) {
      if (p.prose) {
        for (const field of FIELDS) pools.prose.push({ ...base, period: p.label, subArea: '', field, kind: 'prose' });
        continue;
      }
      if (!p.fields.length) continue;
      for (const field of FIELDS) {
        const subs = p.fields.filter((f) => f.field === field && f.subArea);
        if (subs.length) for (const s of subs) pools.subarea.push({ ...base, period: p.label, subArea: s.subArea!, field, kind: 'sub-area' });
        else pools.structured.push({ ...base, period: p.label, subArea: '', field, kind: 'structured' });
      }
    }
  }
}

const rnd = seeded(20260919);
const pick = (pool: Item[], n: number) => {
  // Spread across offices: round-robin by file after shuffling.
  const byFile = new Map<string, Item[]>();
  for (const it of shuffle([...pool], rnd)) (byFile.get(it.file) ?? byFile.set(it.file, []).get(it.file)!).push(it);
  const out: Item[] = [];
  while (out.length < n && [...byFile.values()].some((l) => l.length))
    for (const l of byFile.values()) if (l.length && out.length < n) out.push(l.shift()!);
  return out;
};
const items = [...pick(pools.structured, 22), ...pick(pools.subarea, 8), ...pick(pools.prose, 20)];

const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const header = ['item_id', 'kind', 'file', 'zone_id', 'zone_name', 'period', 'sub_area', 'field', 'gold_value', 'labeler', 'notes'];
const rows = items.map((it, i) => [`G${String(i + 1).padStart(2, '0')}`, it.kind, it.file, it.zoneId, it.zoneName, it.period, it.subArea, it.field, '', '', '']);
fs.mkdirSync('eval', { recursive: true });
fs.writeFileSync(path.join('eval', 'gold-template.csv'), [header, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n');
console.log(`pools: structured=${pools.structured.length} sub-area=${pools.subarea.length} prose=${pools.prose.length}`);
console.log(`wrote eval/gold-template.csv with ${items.length} items:`,
  Object.fromEntries(['structured', 'sub-area', 'prose'].map((k) => [k, items.filter((i) => i.kind === k).length])),
  'across', new Set(items.map((i) => i.file)).size, 'offices');
