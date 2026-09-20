// Role 3 eval: does the coherence audit catch inconsistencies, and does it stay quiet on clean data?
//
// Clean set: real zones straight from the database — every flag here is a false alarm.
// Injected set: the same zones with one known inconsistency introduced.
//
// Measured against two deterministic baselines, because part of this is decidable without a model.
//   npx tsx scripts/eval-audit.ts [--clean N]
process.loadEnvFile?.('.env.local');

import fs from 'node:fs';
import path from 'node:path';
import { getZoneConditions } from '../lib/conditions';
import { auditZone, headlineKeywordCheck, recomputeCheck, type AuditResult } from '../lib/audit/coherence';
import type { Observation, ZoneCondition } from '../lib/types';

type Flaw = 'risk_mismatch' | 'rule_cites_absent' | 'headline_conflict' | 'field_contradiction';

const clone = (c: ZoneCondition): ZoneCondition => JSON.parse(JSON.stringify(c));
const obs = (c: ZoneCondition, field: keyof ZoneCondition['observations']) => c.observations[field]?.[0];

// Each injection creates one known inconsistency, or returns null if this zone can't host it.
function inject(c: ZoneCondition, flaw: Flaw): ZoneCondition | null {
  const z = clone(c);
  if (flaw === 'risk_mismatch') {
    if (z.risk === 'lower') return null;
    z.risk = 'lower'; z.firedRule = 'Low rip current risk; no other hazard triggered';
    return z;
  }
  if (flaw === 'rule_cites_absent') {
    if (obs(z, 'thunderstormPotential')) delete z.observations.thunderstormPotential;
    z.firedRule = 'Moderate thunderstorm potential';
    return z;
  }
  if (flaw === 'headline_conflict') {
    const rip = obs(z, 'ripCurrentRisk');
    if (!rip?.value || /high/i.test(rip.value)) return null;
    z.headlines = ['HIGH RIP CURRENT RISK IN EFFECT THROUGH THIS EVENING'];
    return z;
  }
  const t = obs(z, 'thunderstormPotential');
  if (!t?.value || !/none/i.test(t.value)) return null;
  z.observations.weather = [{ ...(obs(z, 'weather') ?? t), field: 'weather',
    value: 'Numerous thunderstorms, some severe, through the afternoon' } as Observation];
  return z;
}

async function main() {
  const cleanArg = process.argv.indexOf('--clean');
  const cleanN = cleanArg > -1 ? Number(process.argv[cleanArg + 1]) : 10;
  const all = (await getZoneConditions()).filter((c) => c.period === 'today');
  const clean = all.slice(0, cleanN);

  // The last config is the production design: the deterministic check decides what it can, and the
  // model covers the semantic cases it can't express. Computed from the others, so it costs nothing.
  const configs = ['recompute baseline', 'headline keyword baseline', 'nemotron', 'deterministic + nemotron'] as const;
  const stats: Record<string, { caught: number; falseFlags: number }> = {};
  for (const c of configs) stats[c] = { caught: 0, falseFlags: 0 };
  const rows: Record<string, unknown>[] = [];

  const run = async (c: ZoneCondition): Promise<Record<string, AuditResult>> => {
    const recompute = recomputeCheck(c);
    const keyword = headlineKeywordCheck(c);
    const model = (await auditZone(c)).result;
    const combined: AuditResult = recompute.coherent && model.coherent
      ? { coherent: true, issue: null }
      : { coherent: false, issue: recompute.issue ?? model.issue };
    return { 'recompute baseline': recompute, 'headline keyword baseline': keyword, 'nemotron': model, 'deterministic + nemotron': combined };
  };

  console.log(`clean set: ${clean.length} real zones (any flag is a false alarm)\n`);
  for (const c of clean) {
    const got = await run(c);
    for (const cfg of configs) if (!got[cfg].coherent) { stats[cfg].falseFlags++; console.log(`  FALSE FLAG ${c.zoneId} [${cfg}]: ${got[cfg].issue}`); }
    rows.push({ zoneId: c.zoneId, set: 'clean', ...Object.fromEntries(configs.map((k) => [k, got[k]])) });
  }

  const flaws: Flaw[] = ['risk_mismatch', 'rule_cites_absent', 'headline_conflict', 'field_contradiction'];
  let injected = 0;
  console.log(`\ninjected set:\n`);
  for (const flaw of flaws) {
    let made = 0;
    for (const c of all) {
      if (made >= 3) break;
      const bad = inject(c, flaw);
      if (!bad) continue;
      made++; injected++;
      const got = await run(bad);
      for (const cfg of configs) if (!got[cfg].coherent) stats[cfg].caught++;
      console.log(`  ${flaw.padEnd(20)} ${bad.zoneId.padEnd(7)} ` +
        configs.map((cfg) => `${cfg.split(' ')[0]}=${got[cfg].coherent ? 'miss' : 'CAUGHT'}`).join('  ') +
        (got['nemotron'].issue ? `\n      nemotron: ${got['nemotron'].issue}` : ''));
      rows.push({ zoneId: bad.zoneId, set: flaw, ...Object.fromEntries(configs.map((k) => [k, got[k]])) });
    }
  }

  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
  console.log(`\n| Config | Inconsistencies caught | False flags on clean data |`);
  console.log(`|---|---|---|`);
  console.log(`| no audit (baseline) | 0 / ${injected} (0%) | 0 / ${clean.length} |`);
  for (const cfg of configs)
    console.log(`| ${cfg} | ${stats[cfg].caught} / ${injected} (${pct(stats[cfg].caught, injected)}) | ${stats[cfg].falseFlags} / ${clean.length} |`);

  fs.mkdirSync(path.join('eval', 'results'), { recursive: true });
  fs.writeFileSync(path.join('eval', 'results', 'audit.json'), JSON.stringify({ generatedAt: new Date().toISOString(), stats, rows }, null, 2));
  console.log(`\nwrote eval/results/audit.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
