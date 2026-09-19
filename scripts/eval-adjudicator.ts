// Role 1 eval: does Nemotron adjudication recover values that naive reconciliation loses?
//
// Four configurations on the same injected cases, each measured against the known-correct value:
//   regex only          — the deterministic parser alone
//   nemotron only       — the model's extraction alone (judged as usual)
//   naive reconcile     — both, parser wins every tie   ← the baseline that matters
//   adjudicated         — both, Nemotron resolves disagreements against the source text
//
// The number that matters is whether "adjudicated" beats "naive reconcile": that is the evidence
// that the reasoning step, not merely "an LLM", was necessary.
//
//   npx tsx scripts/eval-adjudicator.ts [--limit N]
process.loadEnvFile?.('.env.local');

import fs from 'node:fs';
import path from 'node:path';
import { parseSrf } from '../lib/adapters/srf';
import { extractSegment } from '../lib/extract/srf-llm';
import { reconcile } from '../lib/extract/reconcile';
import { adjudicate, applyAdjudications, buildCases, preCheck } from '../lib/extract/adjudicate';
import { valuesAgree } from '../lib/extract/reconcile';
import { ALL_FLAWS, injectFlaws, type InjectedCase } from '../lib/eval/inject';
import type { ReconciledValue } from '../lib/extract/reconcile';

const CONFIGS = ['regex only', 'nemotron only', 'naive reconcile', 'adjudicated'] as const;
type Config = (typeof CONFIGS)[number];

interface Outcome { produced: boolean; correct: boolean; expectAbsent: boolean }
const tally: Record<Config, Outcome[]> = { 'regex only': [], 'nemotron only': [], 'naive reconcile': [], adjudicated: [] };
const rows: Record<string, unknown>[] = [];

const pick = (values: ReconciledValue[], c: InjectedCase) =>
  values.find((v) => v.field === c.field && (v.subArea ?? '') === (c.subArea ?? '') &&
    v.periodLabel.replace(/[.\s]+/g, ' ').trim().toUpperCase() === c.periodLabel.replace(/[.\s]+/g, ' ').trim().toUpperCase());

// For a deleted field the correct behaviour is to produce nothing; inventing a value is a miss.
const score = (config: Config, value: string | undefined, c: InjectedCase) => {
  const expectAbsent = c.correctValue === null;
  const produced = value !== undefined;
  const correct = expectAbsent ? !produced : produced && valuesAgree(c.field, value!, c.correctValue!);
  tally[config].push({ produced, correct, expectAbsent });
  return { value: value ?? null, correct };
};

async function main() {
  const perFlawArg = process.argv.indexOf('--per-flaw');
  const perFlaw = perFlawArg > -1 ? Number(process.argv[perFlawArg + 1]) : 4;
  const dir = path.join('data', 'samples');
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('srf-')).sort();

  // Equal cases per flaw type, spread across offices.
  const cases: InjectedCase[] = [];
  for (const flaw of ALL_FLAWS) {
    const forFlaw: InjectedCase[] = [];
    for (const file of files) {
      forFlaw.push(...injectFlaws(file, fs.readFileSync(path.join(dir, file), 'utf8'), { flaw, maxPerFile: 1 }));
      if (forFlaw.length >= perFlaw) break;
    }
    cases.push(...forFlaw.slice(0, perFlaw));
  }
  console.log(`${cases.length} injected cases · ${perFlaw} per flaw type · ${new Set(cases.map((c) => c.file)).size} offices\n`);

  for (const c of cases) {
    const seg = parseSrf(c.text).find((s) => s.zones.includes(c.zoneId));
    if (!seg) { console.warn(`${c.id}: zone vanished after injection`); continue; }

    const ex = await extractSegment(c.text, seg);
    const { values, disagreements } = reconcile(seg, ex.fields, ex.model);

    // regex only: reconcile with no model input at all
    const regexOnly = reconcile(seg, null, null).values;
    // nemotron only: the model's accepted fields for this case
    const llmField = ex.fields.find((f) => f.status === 'accepted' && f.field === c.field &&
      (f.subArea ?? '') === (c.subArea ?? '') &&
      f.periodLabel.replace(/[.\s]+/g, ' ').trim().toUpperCase() === c.periodLabel.replace(/[.\s]+/g, ' ').trim().toUpperCase());

    let adjudicated = values;
    let note = '';
    if (disagreements.length) {
      const built = buildCases(c.text, seg, disagreements);
      const pre = preCheck(built);
      const { decisions, model } = await adjudicate(pre.remaining);
      const all = [...pre.decisions, ...decisions];
      adjudicated = applyAdjudications(values, built, all, model ?? ex.model).values;
      note = [...pre.decisions.map((d) => `pre-check → ${d.choice}: ${d.reason}`),
              ...decisions.map((d) => `nemotron → ${d.choice}: ${d.reason}`)].join(' | ');
    }

    const r = {
      id: c.id, flaw: c.flaw, expected: c.correctValue,
      regex: score('regex only', pick(regexOnly, c)?.value, c),
      nemotron: score('nemotron only', llmField?.value, c),
      naive: score('naive reconcile', pick(values, c)?.value, c),
      adjudicated: score('adjudicated', pick(adjudicated, c)?.value, c),
      disagreements: disagreements.length, note,
    };
    rows.push(r);
    console.log(`${c.flaw.padEnd(20)} ${c.field.padEnd(15)} want ${(c.correctValue === null ? '(no value)' : JSON.stringify(c.correctValue)).padEnd(18)} ` +
      `regex=${String(r.regex.value).padEnd(16)} nemo=${String(r.nemotron.value).padEnd(16)} ` +
      `naive=${String(r.naive.value).padEnd(16)} adj=${String(r.adjudicated.value)}`);
    if (note) console.log(`    ${note}`);
  }

  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
  const nValue = tally['regex only'].filter((x) => !x.expectAbsent).length;
  const nAbsent = tally['regex only'].filter((x) => x.expectAbsent).length;

  console.log(`\nA. Cases where the forecast states a value (${nValue} cases)\n`);
  console.log(`| Config | Coverage | Precision | Recall |`);
  console.log(`|---|---|---|---|`);
  for (const config of CONFIGS) {
    const t = tally[config].filter((x) => !x.expectAbsent);
    const produced = t.filter((x) => x.produced).length;
    const correct = t.filter((x) => x.correct).length;
    console.log(`| ${config} | ${pct(produced, t.length)} | ${pct(correct, produced)} | ${pct(correct, t.length)} |`);
  }

  console.log(`\nB. Control: the field was deleted, so the correct answer is NO value (${nAbsent} cases)\n`);
  console.log(`| Config | Values invented | Correctly silent |`);
  console.log(`|---|---|---|`);
  for (const config of CONFIGS) {
    const t = tally[config].filter((x) => x.expectAbsent);
    const invented = t.filter((x) => x.produced).length;
    console.log(`| ${config} | ${invented} / ${t.length} | ${pct(t.length - invented, t.length)} |`);
  }

  console.log(`\nOverall accuracy across all ${tally['regex only'].length} cases\n`);
  console.log(`| Config | Accuracy |`);
  console.log(`|---|---|`);
  for (const config of CONFIGS)
    console.log(`| ${config} | ${pct(tally[config].filter((x) => x.correct).length, tally[config].length)} |`);

  fs.mkdirSync(path.join('eval', 'results'), { recursive: true });
  const out = path.join('eval', 'results', 'adjudicator.json');
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), note: 'INJECTED flaws, not field data', rows, tally }, null, 2));
  console.log(`\nwrote ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
