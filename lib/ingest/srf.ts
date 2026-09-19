// Stores one SRF product: the verbatim document, per-zone segment facts, and every
// extracted value with its provenance. Already-stored products are skipped.

import { createHash } from 'node:crypto';
import { db, valuesClause } from '../db';
import { parseSrf } from '../adapters/srf';
import { numericFor } from '../normalize';
import type { NwsProduct } from '../nws';
import type { Period } from '../types';

export const SRF_SOURCE_ID = 'nws-srf';

export interface IngestResult { documentId: string; skipped: boolean; zones: number; observations: number }

export async function ingestSrf(prod: NwsProduct): Promise<IngestResult> {
  const sql = db();
  const existing = await sql.query('select 1 from documents where id = $1', [prod.id]);
  if (existing.length) return { documentId: prod.id, skipped: true, zones: 0, observations: 0 };

  const text = prod.productText;
  const retrievedAt = new Date().toISOString();
  const segments = parseSrf(text);

  const segRows: unknown[][] = [];
  const obsRows: unknown[][] = [];

  for (const seg of segments) {
    // Only structured periods here; prose outlook periods are for Nemotron.
    const periods = seg.periods.filter((p) => p.prose === null && p.fields.length > 0).slice(0, 2);

    for (const zoneId of seg.zones) {
      segRows.push([prod.id, zoneId, seg.zoneName, seg.beaches, seg.headlines]);

      periods.forEach((p, idx) => {
        const period: Period = idx === 0 ? 'today' : 'tomorrow';
        for (const f of p.fields) {
          if (!f.field) continue;
          const n = numericFor(f.field, f.value);
          obsRows.push([
            prod.id, zoneId, period, p.label, f.field, f.value || null,
            n?.min ?? null, n?.max ?? null, n?.unit ?? null, n?.approximate ?? null,
            f.subArea, SRF_SOURCE_ID, prod['@id'], f.rawSpan, f.charStart, f.charEnd,
            prod.issuanceTime, retrievedAt,
            'regex', 'medium',   // regex-only until reconciled with Nemotron
          ]);
        }
      });
    }
  }

  const queries = [
    sql.query(
      `insert into documents (id, source_id, url, text, content_hash, issued_at, retrieved_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [prod.id, SRF_SOURCE_ID, prod['@id'], text, createHash('sha256').update(text).digest('hex'), prod.issuanceTime, retrievedAt],
    ),
  ];
  if (segRows.length) {
    const v = valuesClause(segRows);
    queries.push(sql.query(
      `insert into zone_segments (document_id, zone_id, zone_name, beaches, headlines) values ${v.text}`, v.params));
  }
  if (obsRows.length) {
    const v = valuesClause(obsRows);
    queries.push(sql.query(
      `insert into observations (document_id, zone_id, period, period_label, field, value,
         numeric_min, numeric_max, numeric_unit, approximate, sub_area, source_id, source_url,
         raw_span, char_start, char_end, issued_at, retrieved_at, extractor, confidence)
       values ${v.text}`, v.params));
  }
  await sql.transaction(queries);

  return { documentId: prod.id, skipped: false, zones: segRows.length, observations: obsRows.length };
}
