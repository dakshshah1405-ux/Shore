// The alerts table is a snapshot of what's active now: replace it atomically each run,
// so an expired or cancelled alert can never linger on the map.

import { db, valuesClause } from '../db';
import { fetchActiveAlerts } from '../adapters/cap';

export async function ingestAlerts(): Promise<{ active: number }> {
  const sql = db();
  const alerts = await fetchActiveAlerts();
  const retrievedAt = new Date().toISOString();

  const queries = [sql.query('delete from alerts')];
  if (alerts.length) {
    const v = valuesClause(alerts.map((a) => [
      a.id, a.event, a.severity, a.headline, a.description, a.onset, a.expires, a.sourceUrl, a.zones, retrievedAt,
    ]));
    queries.push(sql.query(
      `insert into alerts (id, event, severity, headline, description, onset, expires, source_url, zones, retrieved_at)
       values ${v.text} on conflict (id) do nothing`, v.params));
  }
  await sql.transaction(queries);
  return { active: alerts.length };
}
