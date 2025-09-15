import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
export const pool = new Pool({ connectionString });

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  // Simple log; in production prefer a proper logger
  // console.log('executed query', { text, duration, rows: res.rowCount });
  return res;
}
