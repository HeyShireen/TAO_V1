// src/db.js
import pg from 'pg'
const { Pool } = pg

try {
  console.log('PG host ->', new URL(process.env.DATABASE_URL).host)
} catch {}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

pool.on('error', err => {
  console.error('PG pool error:', err)
})

export async function query(text, params) {
  return pool.query(text, params)
}
