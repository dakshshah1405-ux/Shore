// Typo-tolerant search over the names we already parsed from the forecasts: beaches, zone names,
// zone IDs and states. Pure and dependency-free so it can be unit tested and runs on every keystroke.
//
// Matching is layered, best first: exact, prefix, spaces-removed prefix, all query words matched in
// any order, substring, and finally bounded fuzzy matching for real typos. Fuzzy uses
// Damerau-Levenshtein so a transposition ("rehobtoh") costs 1, not 2.

export const STATES: Record<string, string> = {
  ME: 'Maine', NH: 'New Hampshire', MA: 'Massachusetts', RI: 'Rhode Island', CT: 'Connecticut',
  NY: 'New York', NJ: 'New Jersey', DE: 'Delaware', MD: 'Maryland', VA: 'Virginia',
  NC: 'North Carolina', SC: 'South Carolina', GA: 'Georgia', FL: 'Florida',
};

export interface SearchEntry {
  zoneId: string;
  label: string;
  sub: string;
  isBeach: boolean;
  norm: string;        // normalized label
  squashed: string;    // normalized label without spaces
  tokens: string[];    // normalized label words
  hay: string;         // label + state + zone id, normalized
  haySquashed: string;
}

// Lowercase, strip accents, turn punctuation into spaces, collapse runs. "St. Augustine" → "st augustine"
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Damerau-Levenshtein with an early exit once the best possible distance exceeds `max`.
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = [], prev: number[] = [], cur: number[] = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        cur[j] = Math.min(cur[j], prev2[j - 2] + 1);   // transposition
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;                     // no row can improve enough
    for (let j = 0; j <= b.length; j++) { prev2[j] = prev[j]; prev[j] = cur[j]; }
  }
  return prev[b.length];
}

// Short words tolerate fewer mistakes, or everything matches everything. Two edits are only
// allowed on long words: at 6 letters it would match "denver" to "pender".
const tolerance = (len: number) => (len <= 4 ? 0 : len <= 7 ? 1 : 2);

export function buildSearchIndex(geo: GeoJSON.FeatureCollection | null): SearchEntry[] {
  const out: SearchEntry[] = [];
  const add = (zoneId: string, label: string, sub: string, isBeach: boolean, extra: string) => {
    const norm = normalize(label);
    if (!norm) return;
    const hay = normalize(`${label} ${extra}`);
    out.push({ zoneId, label, sub, isBeach, norm, squashed: norm.replace(/ /g, ''),
               tokens: norm.split(' '), hay, haySquashed: hay.replace(/ /g, '') });
  };

  for (const f of geo?.features ?? []) {
    const p = (f.properties ?? {}) as { zoneId?: string; name?: string; beaches?: string[] };
    if (!p.zoneId) continue;
    const abbr = p.zoneId.slice(0, 2);
    const state = STATES[abbr] ?? abbr;
    const name = p.name ?? p.zoneId;
    add(p.zoneId, name, `${state} · ${p.zoneId}`, false, `${p.zoneId} ${state} ${abbr}`);
    for (const beach of p.beaches ?? []) add(p.zoneId, beach, `${name} · ${state}`, true, `${state} ${abbr} ${name}`);
  }
  return out;
}

// Lower is better; -1 means no match.
export function scoreEntry(e: SearchEntry, q: string, qTokens: string[], qSquashed: string): number {
  if (e.norm === q) return 0;
  if (e.norm.startsWith(q)) return 1;
  if (e.squashed.startsWith(qSquashed)) return 2;
  // Every query word matches the start of some word in the label, in any order ("beach rehoboth").
  if (qTokens.length > 1 && qTokens.every((t) => e.tokens.some((w) => w.startsWith(t)))) return 3;
  if (e.norm.includes(q) || e.haySquashed.includes(qSquashed)) return 4;
  if (e.hay.split(' ').some((w) => qTokens.every((t) => w.startsWith(t)))) return 5;

  // Fuzzy: each query word must be close to some word in the entry.
  let total = 0;
  for (const t of qTokens) {
    if (t.length < 4) return -1;                     // too short to guess a typo safely
    const max = tolerance(t.length);
    if (max === 0) return -1;
    let best = max + 1;
    for (const w of e.tokens) {
      best = Math.min(best, editDistance(t, w, max));
      if (w.length > t.length + max) best = Math.min(best, editDistance(t, w.slice(0, t.length + max), max));
    }
    // Also compare against the whole label without spaces, for "nagshead"-style run-ons.
    best = Math.min(best, editDistance(qSquashed, e.squashed, max));
    if (best > max) return -1;
    total += best;
  }
  return 6 + total;
}

export function searchIndex(index: SearchEntry[], query: string, limit = 8, perZone = 3): SearchEntry[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const qTokens = q.split(' ');
  const qSquashed = q.replace(/ /g, '');

  const scored: [number, SearchEntry][] = [];
  for (const e of index) {
    const s = scoreEntry(e, q, qTokens, qSquashed);
    if (s >= 0) scored.push([s, e]);
  }
  scored.sort((a, b) =>
    a[0] - b[0] || a[1].label.length - b[1].label.length || a[1].label.localeCompare(b[1].label));

  // Keep results varied: one zone's beach list shouldn't fill the dropdown.
  const perZoneCount = new Map<string, number>();
  const out: SearchEntry[] = [];
  const seen = new Set<string>();
  for (const [, e] of scored) {
    const key = `${e.zoneId}|${e.label}`;
    if (seen.has(key)) continue;
    const n = perZoneCount.get(e.zoneId) ?? 0;
    if (n >= perZone) continue;
    perZoneCount.set(e.zoneId, n + 1);
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}
