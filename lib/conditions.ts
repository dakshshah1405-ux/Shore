// Assembles ZoneCondition records from the latest stored SRF per zone, plus active alerts.

import { db } from './db';
import { assessRisk } from './risk';
import type { Alert, FieldName, Observation, OutlookPeriod, Period, ZoneCondition } from './types';

const STALE_AFTER_MS = 12 * 60 * 60 * 1000;
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

interface Row {
  zone_id: string; zone_name: string | null; beaches: string[]; headlines: string[]; doc_issued: string;
  period: Period | 'outlook' | null; period_label: string | null; field: FieldName | null; value: string | null;
  numeric_min: number | null; numeric_max: number | null; numeric_unit: 'ft' | 'F' | 'mph' | null; approximate: boolean | null;
  sub_area: string | null; source_id: string; source_url: string; raw_span: string | null;
  char_start: number | null; char_end: number | null; issued_at: string; retrieved_at: string;
  extractor: Observation['extractor']; confidence: Observation['confidence']; model: string | null;
  adjudication_reason: string | null;
}

function toObservation(r: Row): Observation {
  return {
    field: r.field!, value: r.value,
    numeric: r.numeric_min == null || r.numeric_unit == null ? null
      : { min: r.numeric_min, max: r.numeric_max ?? r.numeric_min, unit: r.numeric_unit, approximate: !!r.approximate },
    subArea: r.sub_area, sourceId: r.source_id, sourceUrl: r.source_url, rawSpan: r.raw_span,
    charStart: r.char_start, charEnd: r.char_end, issuedAt: iso(r.issued_at)!, retrievedAt: iso(r.retrieved_at)!,
    extractor: r.extractor, confidence: r.confidence, model: r.model, adjudicationReason: r.adjudication_reason,
  };
}

export async function getZoneConditions(): Promise<ZoneCondition[]> {
  const sql = db();
  const rows = (await sql.query(`
    with latest as (
      select distinct on (zs.zone_id) zs.zone_id, zs.document_id, zs.zone_name, zs.beaches, zs.headlines,
             d.issued_at as doc_issued
      from zone_segments zs join documents d on d.id = zs.document_id
      where d.source_id = 'nws-srf'
      order by zs.zone_id, d.issued_at desc
    )
    select l.zone_id, l.zone_name, l.beaches, l.headlines, l.doc_issued,
           o.period, o.period_label, o.field, o.value, o.numeric_min, o.numeric_max, o.numeric_unit,
           o.approximate, o.sub_area, o.source_id, o.source_url, o.raw_span, o.char_start, o.char_end,
           o.issued_at, o.retrieved_at, o.extractor, o.confidence, o.model, o.adjudication_reason
    from latest l
    left join observations o on o.document_id = l.document_id and o.zone_id = l.zone_id
    order by l.zone_id, o.id`)) as Row[];

  const alertRows = (await sql.query(
    `select * from alerts where expires is null or expires > now()`)) as Record<string, unknown>[];
  const alerts: Alert[] = alertRows.map((a) => ({
    id: a.id as string, event: a.event as string, severity: (a.severity as string) ?? '',
    headline: (a.headline as string) ?? '', description: (a.description as string) ?? '',
    onset: iso(a.onset), expires: iso(a.expires), sourceUrl: a.source_url as string, zones: a.zones as string[],
  }));

  const byZone = new Map<string, Map<Period, ZoneCondition>>();
  const outlooks = new Map<string, OutlookPeriod[]>();

  for (const r of rows) {
    if (!byZone.has(r.zone_id)) { byZone.set(r.zone_id, new Map()); outlooks.set(r.zone_id, []); }
    if (!r.period || !r.field) continue;

    if (r.period === 'outlook') {
      const list = outlooks.get(r.zone_id)!;
      let p = list.find((o) => o.periodLabel === r.period_label);
      if (!p) { p = { periodLabel: r.period_label ?? '', observations: {} }; list.push(p); }
      (p.observations[r.field] ??= []).push(toObservation(r));
      continue;
    }

    const byPeriod = byZone.get(r.zone_id)!;
    if (!byPeriod.has(r.period)) {
      const issuedAt = iso(r.doc_issued)!;
      byPeriod.set(r.period, {
        zoneId: r.zone_id, zoneName: r.zone_name ?? r.zone_id, beaches: r.beaches ?? [],
        period: r.period, periodLabel: r.period_label ?? '', risk: 'unknown', firedRule: '',
        explanation: null, observations: {}, headlines: r.headlines ?? [],
        alerts: alerts.filter((a) => a.zones.includes(r.zone_id)), outlook: [],
        issuedAt, staleAfter: new Date(new Date(issuedAt).getTime() + STALE_AFTER_MS).toISOString(),
      });
    }
    (byPeriod.get(r.period)!.observations[r.field] ??= []).push(toObservation(r));
  }

  const result: ZoneCondition[] = [];
  for (const [zoneId, byPeriod] of byZone) {
    for (const c of byPeriod.values()) {
      c.outlook = outlooks.get(zoneId) ?? [];
      Object.assign(c, assessRisk(c.observations, c.alerts));
      result.push(c);
    }
  }
  return result;
}
