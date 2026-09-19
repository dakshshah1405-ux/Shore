// Stores one SRF product: the verbatim document, per-zone segment facts, and every
// extracted value with its provenance. Both extractors run; lib/extract/reconcile.ts merges them.
// Nemotron failing never blocks ingestion — the parser's values are stored regardless.

import { createHash } from 'node:crypto';
import { db, valuesClause } from '../db';
import { parseSrf } from '../adapters/srf';
import { numericFor } from '../normalize';
import { extractSegment, type SegmentExtraction } from '../extract/srf-llm';
import { reconcile } from '../extract/reconcile';
import { adjudicate, applyAdjudications, buildCases, preCheck, type AppliedAdjudication } from '../extract/adjudicate';
import { FALLBACK_MODEL } from '../nemotron';
import type { NwsProduct } from '../nws';

export const SRF_SOURCE_ID = 'nws-srf';

export interface IngestResult {
  documentId: string; skipped: boolean; zones: number; observations: number;
  llm: { calls: number; failed: number; fallback: number; accepted: number; rejected: number; disagreements: number };
  adjudications: AppliedAdjudication[];
}

export interface IngestOptions {
  force?: boolean;       // re-extract a document that's already stored (replaces its observations)
  llm?: boolean;         // run Nemotron (default true)
  adjudicate?: boolean;  // let Nemotron resolve parser/model disagreements (default true)
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export async function ingestSrf(prod: NwsProduct, opts: IngestOptions = {}): Promise<IngestResult> {
  const sql = db();
  const exists = (await sql.query('select 1 from documents where id = $1', [prod.id])).length > 0;
  const llmStats = { calls: 0, failed: 0, fallback: 0, accepted: 0, rejected: 0, disagreements: 0 };
  const adjudications: AppliedAdjudication[] = [];
  if (exists && !opts.force) return { documentId: prod.id, skipped: true, zones: 0, observations: 0, llm: llmStats, adjudications };

  const text = prod.productText;
  const retrievedAt = new Date().toISOString();
  const segments = parseSrf(text);

  // Nemotron, one call per zone section, ~4 at a time to respect the per-key rate limit.
  const llm: (SegmentExtraction | null)[] = opts.llm === false ? segments.map(() => null)
    : await mapLimit(segments, 4, async (seg) => {
        llmStats.calls++;
        try {
          const ex = await extractSegment(text, seg);
          if (ex.model === null) { llmStats.failed++; console.warn(`  nemotron: both models failed for ${seg.zones[0]}; parser values only`); }
          else if (ex.model === FALLBACK_MODEL) llmStats.fallback++;
          return ex;
        } catch (e) {
          llmStats.failed++;
          console.warn(`  nemotron error for ${seg.zones[0]}: ${(e as Error).message}`);
          return null;
        }
      });

  const segRows: unknown[][] = [];
  const obsRows: unknown[][] = [];

  for (const [si, seg] of segments.entries()) {
    const ex = llm[si];
    for (const f of ex?.fields ?? []) f.status === 'accepted' ? llmStats.accepted++ : llmStats.rejected++;
    const reconciled = reconcile(seg, ex?.fields ?? null, ex?.model ?? null);
    let values = reconciled.values;
    const { disagreements } = reconciled;
    llmStats.disagreements += disagreements.length;

    // Nemotron adjudicates disagreements over what the text says. It can add a missed value or
    // confirm the parser, but applyAdjudications refuses any change that lowers a hazard.
    if (opts.adjudicate !== false && disagreements.length) {
      try {
        const cases = buildCases(text, seg, disagreements);
        // Some parser values are provably wrong from the format alone; those never reach the model.
        const pre = preCheck(cases);
        const { decisions, model } = await adjudicate(pre.remaining);
        const applied = applyAdjudications(values, cases, [...pre.decisions, ...decisions], model ?? ex?.model ?? null);
        values = applied.values;
        adjudications.push(...applied.applied);
      } catch (e) {
        console.warn(`  adjudication failed for ${seg.zones[0]}: ${(e as Error).message}`);
      }
    }

    for (const zoneId of seg.zones) {
      segRows.push([prod.id, zoneId, seg.zoneName, seg.beaches, seg.headlines]);
      for (const v of values) {
        const n = numericFor(v.field, v.value);
        const period = v.periodIndex === 0 ? 'today' : v.periodIndex === 1 ? 'tomorrow' : 'outlook';
        obsRows.push([
          prod.id, zoneId, period, v.periodLabel, v.field, v.value || null,
          n?.min ?? null, n?.max ?? null, n?.unit ?? null, n?.approximate ?? null,
          v.subArea, SRF_SOURCE_ID, prod['@id'], v.rawSpan, v.charStart, v.charEnd,
          prod.issuanceTime, retrievedAt, v.extractor, v.confidence, v.model, v.adjudicationReason,
        ]);
      }
    }
  }

  const queries = exists
    ? [sql.query('delete from observations where document_id = $1', [prod.id]),
       sql.query('delete from zone_segments where document_id = $1', [prod.id])]
    : [sql.query(
        `insert into documents (id, source_id, url, text, content_hash, issued_at, retrieved_at)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [prod.id, SRF_SOURCE_ID, prod['@id'], text, createHash('sha256').update(text).digest('hex'), prod.issuanceTime, retrievedAt])];
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
         raw_span, char_start, char_end, issued_at, retrieved_at, extractor, confidence, model, adjudication_reason)
       values ${v.text}`, v.params));
  }
  await sql.transaction(queries);

  return { documentId: prod.id, skipped: false, zones: segRows.length, observations: obsRows.length, llm: llmStats, adjudications };
}
