// Neon over HTTP: stateless, so it's safe in serverless route handlers without pool management.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let sql: NeonQueryFunction<false, false> | null = null;

export function db(): NeonQueryFunction<false, false> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (add it to .env.local)');
  sql ??= neon(process.env.DATABASE_URL);
  return sql;
}

// Builds "($1,$2,...),($n,...)" for a multi-row INSERT, returning the SQL fragment and flat params.
export function valuesClause(rows: unknown[][]): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const tuples = rows.map((row) => {
    const ph = row.map((v) => { params.push(v); return `$${params.length}`; });
    return `(${ph.join(',')})`;
  });
  return { text: tuples.join(','), params };
}
