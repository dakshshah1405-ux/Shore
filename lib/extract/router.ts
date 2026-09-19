// Role: classify an incoming NWS text product before extracting from it, and reject what this
// pipeline cannot read. Three implementations so the model is measured against honest baselines:
//
//   headerRoute  — deterministic: the AWIPS id / product title in the first lines
//   keywordRoute — the naive content matcher ("it mentions rip currents, must be a surf forecast")
//   routeDocument — Nemotron, reasoning about structure rather than vocabulary
//
// The header is decisive when present, so it runs first. Nemotron matters when a document arrives
// without its header — pasted text, a third-party feed — which is the case this pipeline claims to
// support. The gate below never lets the model alone discard data.

import { extractJSON } from '../nemotron';

export type Schema = 'srf' | 'none';
export interface Route { schema: Schema; reason: string }

// Deterministic: NWS products carry an AWIPS id (SRFMHX) and a title line.
export function headerRoute(text: string): Route {
  const head = text.slice(0, 400);
  if (/^SRF[A-Z]{3}\s*$/m.test(head)) return { schema: 'srf', reason: 'AWIPS id starts with SRF' };
  if (/surf zone forecast/i.test(head)) return { schema: 'srf', reason: 'title says Surf Zone Forecast' };
  return { schema: 'none', reason: 'no SRF product id or title in the header' };
}

// The naive matcher: looks for beach vocabulary anywhere in the document.
export function keywordRoute(text: string): Route {
  if (/rip current|surf height/i.test(text)) return { schema: 'srf', reason: 'mentions rip currents or surf height' };
  return { schema: 'none', reason: 'no beach vocabulary found' };
}

const SYSTEM = `You classify National Weather Service text products for an extraction pipeline.

Answer "srf" ONLY if the document is a Surf Zone Forecast: it lists forecast periods (lines like
".TODAY..." or ".REST OF TODAY...") whose values appear as labelled fixed-width fields, for example
"Rip Current Risk*...........Moderate." or "Surf Height.................2 to 3 feet.".

Answer "none" for anything else — including documents that discuss rip currents, surf or beaches in
prose (hazardous weather outlooks, coastal hazard messages, marine or zone forecasts, forecast
discussions), and anything that is not an NWS product at all. Mentioning beach hazards is not
enough: the labelled per-period field structure must be present.

Judge the structure, not the vocabulary. Return JSON: {"schema": "srf"|"none", "reason": string}
with reason under 15 words.`;

export async function routeDocument(text: string): Promise<{ route: Route; model: string | null }> {
  // Enough to show structure without paying for the whole document.
  const res = await extractJSON<{ schema?: string; reason?: string }>(SYSTEM, text.slice(0, 2500));
  const schema: Schema = res.data?.schema === 'srf' ? 'srf' : 'none';
  return { route: { schema, reason: String(res.data?.reason ?? 'no answer').slice(0, 120) }, model: res.model };
}

// The gate used in the pipeline. A document is dropped only when BOTH the deterministic header
// check and Nemotron say it is not extractable, so the model can never discard data on its own.
export async function routeGate(text: string): Promise<{ accepted: boolean; header: Route; model: Route | null; modelName: string | null }> {
  const header = headerRoute(text);
  if (header.schema === 'srf') return { accepted: true, header, model: null, modelName: null };
  try {
    const { route, model } = await routeDocument(text);
    return { accepted: route.schema === 'srf', header, model: route, modelName: model };
  } catch {
    return { accepted: false, header, model: null, modelName: null };   // header already said no
  }
}
