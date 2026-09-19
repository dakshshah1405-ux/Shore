// Deterministic worst-of risk ladder. First matching rung wins; every result records why.
//
// Deliberately NOT a weighted score: averaging can numerically downplay a severe hazard.
// Missing data resolves to 'unknown', never 'lower'.

import { hazardRank } from './normalize';
import type { Alert, FieldName, Observation, RiskLevel } from './types';

type Obs = Partial<Record<FieldName, Observation[]>>;

const NAMES = ['none', 'low', 'moderate', 'high'];

// Worst categorical value across sub-areas (e.g. Hatteras north Moderate / south Low → Moderate).
export function worstRank(list?: Observation[]): number | null {
  const ranks = (list ?? []).map((o) => hazardRank(o.value)).filter((r): r is number => r !== null);
  return ranks.length ? Math.max(...ranks) : null;
}

export function maxNumeric(list?: Observation[]): number | null {
  const vals = (list ?? []).map((o) => o.numeric?.max).filter((v): v is number => typeof v === 'number');
  return vals.length ? Math.max(...vals) : null;
}

export function assessRisk(obs: Obs, alerts: Alert[]): { risk: RiskLevel; firedRule: string } {
  const warning = alerts.find((a) => /warning/i.test(a.event));
  if (warning) return { risk: 'official', firedRule: `Official NWS ${warning.event} in effect` };

  const rip = worstRank(obs.ripCurrentRisk);
  const thunder = worstRank(obs.thunderstormPotential);
  const surf = maxNumeric(obs.surfHeight);

  const high: string[] = [];
  if (rip === 3) high.push('High rip current risk');
  if (thunder === 3) high.push('High thunderstorm potential');
  if (high.length) return { risk: 'high', firedRule: high.join('; ') };

  const elevated: string[] = [];
  // An active official watch, advisory, or statement floors the zone at Elevated, so the
  // derived assessment can never show green while NWS has a hazard product in effect.
  for (const event of new Set(alerts.map((a) => a.event)))
    if (/watch|advisory|statement/i.test(event)) elevated.push(`NWS ${event} in effect`);
  if (rip === 2) elevated.push('Moderate rip current risk');
  if (thunder === 2) elevated.push('Moderate thunderstorm potential');
  if (surf !== null && surf >= 5) elevated.push(`Surf up to ${surf} ft`);
  // AI-extracted values may raise the assessment, never lower it. A longshore current comes
  // only from Nemotron reading free-text remarks, with its quote verified against the source.
  if ((obs.longshoreCurrent ?? []).some((o) => /moderate|strong/i.test(o.value ?? '')))
    elevated.push('NWS notes a longshore current');
  if (elevated.length) return { risk: 'elevated', firedRule: elevated.join('; ') };

  if (rip !== null && rip >= 1)
    return { risk: 'lower', firedRule: `${cap(NAMES[rip])} rip current risk; no other hazard triggered` };

  return { risk: 'unknown', firedRule: 'Rip current risk not available for this zone' };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
