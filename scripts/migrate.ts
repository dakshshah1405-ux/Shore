// Applies db/schema.sql to DATABASE_URL. Idempotent. Run: npx tsx scripts/migrate.ts

import fs from 'node:fs';
import path from 'node:path';
import { Pool } from '@neondatabase/serverless';

process.loadEnvFile?.('.env.local');

async function main() {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('ep-xxxx')) {
    throw new Error('DATABASE_URL is not set — paste the pooled Neon connection string into .env.local');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = fs.readFileSync(path.join('db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query(
    `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
  );
  console.log('tables:', rows.map((r) => r.table_name).join(', '));
  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
