// Shore — the team's shared contract. Change only by agreement.
//
// Two invariants, because they are the safety story in type form:
//   1. `value: null` is a legitimate answer. Never fabricate a value to fill a gap.
//   2. `risk` initializes to 'unknown', never 'lower'. Missing data must never render as safe.

export type RiskLevel = 'official' | 'high' | 'elevated' | 'lower' | 'unknown';
export type Confidence = 'high' | 'medium' | 'low';
export type Extractor = 'regex' | 'nemotron' | 'reconciled';
export type Period = 'today' | 'tomorrow';

export type FieldName =
  | 'ripCurrentRisk'
  | 'surfHeight'
  | 'thunderstormPotential'
  | 'uvIndex'
  | 'waterTemperature'
  | 'weather'
  | 'highTemperature'
  | 'winds'
  | 'waterspoutRisk'
  | 'maxHeatIndex'
  | 'remarks'          // free text; ILM uses it for longshore-current warnings
  | 'sunrise'
  | 'sunset';

// A parsed numeric range, e.g. "2 to 3 feet" → {min: 2, max: 3, unit: 'ft'}.
// `approximate` is true when the source is qualitative ("In the upper 70s").
export interface NumericRange {
  min: number;
  max: number;
  unit: 'ft' | 'F';
  approximate: boolean;
}

export interface Observation {
  field: FieldName;
  value: string | null;           // source wording, lightly cleaned ("2 to 3 feet")
  numeric: NumericRange | null;   // for filters; null when the source has no number
  subArea: string | null;         // "North of Cape Hatteras" when a zone is split
  sourceId: string;               // 'nws-srf'
  sourceUrl: string;
  rawSpan: string | null;         // exact source text the value came from
  charStart: number | null;       // offsets into the stored document text
  charEnd: number | null;
  issuedAt: string;               // ISO
  retrievedAt: string;            // ISO
  extractor: Extractor;
  confidence: Confidence;
}

export interface Alert {
  id: string;
  event: string;                  // 'Rip Current Statement'
  severity: string;               // CAP severity, verbatim
  headline: string;               // official wording — never paraphrased or summarized
  description: string;
  onset: string | null;
  expires: string | null;
  sourceUrl: string;
  zones: string[];                // UGC codes
}

export interface ZoneCondition {
  zoneId: string;                 // 'NCZ203'
  zoneName: string;               // 'Northern Outer Banks'
  beaches: string[];              // parsed from 'Including the beaches of ...'
  period: Period;
  periodLabel: string;            // source wording: 'REST OF TODAY', 'SUNDAY'
  risk: RiskLevel;                // defaults to 'unknown' — NEVER to 'lower'
  firedRule: string;              // which ladder rung matched, for the explainer
  explanation: string | null;     // guardrailed; null if the validator rejected it
  // A field can have several observations when the zone is split into sub-areas.
  observations: Partial<Record<FieldName, Observation[]>>;
  headlines: string[];            // official "...RIP CURRENT RISK IN EFFECT..." lines, verbatim
  alerts: Alert[];
  issuedAt: string;
  staleAfter: string;             // ISO; UI shows a staleness warning past this
}

export interface BeachDetail {
  name: string;
  zoneId: string;
  lat: number;
  lon: number;
  condition: ZoneCondition;
  nearestBuoy: {
    id: string;
    distanceKm: number;           // always displayed — never imply it's at the beach
    observations: Partial<Record<FieldName, Observation[]>>;
  } | null;
}
