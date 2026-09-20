// Role: Nemotron audits one zone's assembled result for internal contradictions before anyone
// relies on it. It checks COHERENCE — it never computes risk, and never changes a value. Its only
// output is a flag for review, so it cannot alter what a user sees.
//
// Two deterministic baselines are implemented alongside it, because some of this is decidable
// without a model and should be done that way.

import { extractJSON } from '../nemotron';
import { assessRisk } from '../risk';
import { hazardRank } from '../normalize';
import type { ZoneCondition } from '../types';

export interface AuditResult { coherent: boolean; issue: string | null }

// Baseline 1: recompute the assessment from the stored observations. Catches a risk label or rule
// that doesn't follow from the data — exactly, and for free.
export function recomputeCheck(c: ZoneCondition): AuditResult {
  const { risk, firedRule } = assessRisk(c.observations, c.alerts);
  if (risk !== c.risk) return { coherent: false, issue: `risk is "${c.risk}" but the data gives "${risk}"` };
  if (firedRule !== c.firedRule) return { coherent: false, issue: `rule is "${c.firedRule}" but the data gives "${firedRule}"` };
  return { coherent: true, issue: null };
}

// Baseline 2: the naive headline matcher — look for a category word in the official headline and
// compare it with the extracted rip current field.
export function headlineKeywordCheck(c: ZoneCondition): AuditResult {
  const field = (c.observations.ripCurrentRisk ?? []).map((o) => hazardRank(o.value)).filter((r): r is number => r !== null);
  const worst = field.length ? Math.max(...field) : null;
  for (const h of c.headlines) {
    const m = h.match(/\b(LOW|MODERATE|HIGH)\b/i);
    if (!m || worst === null) continue;
    const stated = hazardRank(m[1]);
    if (stated !== null && stated !== worst)
      return { coherent: false, issue: `headline says ${m[1].toLowerCase()} but the field says rank ${worst}` };
  }
  return { coherent: true, issue: null };
}

const SYSTEM = `You are checking one beach zone's extracted forecast data for internal contradictions.

You are NOT assessing danger and NOT deciding a risk level. Only report whether the pieces are
mutually consistent.

Flag a problem when, for example:
- the official headline states a hazard level that contradicts the extracted field value
- the stated rule cites a value that is not present in the observations
- two observations contradict each other (e.g. weather describes thunderstorms while thunderstorm
  potential is None)

Do NOT flag: a headline that qualifies a value by area or time (e.g. "north of Cape Hatteras",
"through this evening") while the field shows the worst case; missing fields; cautious wording.

Return JSON: {"coherent": true|false, "issue": string|null} with issue under 25 words.`;

export function auditPrompt(c: ZoneCondition): string {
  const obs = Object.entries(c.observations)
    .map(([field, list]) => `${field}: ${list!.map((o) => `${o.subArea ? `[${o.subArea}] ` : ''}${o.value}`).join(' / ')}`)
    .join('\n');
  return [
    `zone: ${c.zoneName} (${c.zoneId}), period: ${c.periodLabel}`,
    `assessment: ${c.risk}`,
    `rule that produced it: ${c.firedRule}`,
    `official headlines (verbatim): ${c.headlines.length ? c.headlines.join(' | ') : '(none)'}`,
    `extracted observations:\n${obs}`,
  ].join('\n');
}

export async function auditZone(c: ZoneCondition): Promise<{ result: AuditResult; model: string | null }> {
  const res = await extractJSON<{ coherent?: boolean; issue?: string | null }>(SYSTEM, auditPrompt(c));
  if (!res.data) return { result: { coherent: true, issue: null }, model: res.model };   // no answer: do not flag
  return {
    result: { coherent: res.data.coherent !== false, issue: res.data.issue ? String(res.data.issue).slice(0, 160) : null },
    model: res.model,
  };
}
