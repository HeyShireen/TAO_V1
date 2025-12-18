import pg from 'pg'
const { Pool } = pg

let connectionString = process.env.DATABASE_URL
const isRenderHost = /render\.com/.test(connectionString || '')
if (isRenderHost && connectionString && !/sslmode=/.test(connectionString)) {
  connectionString += (connectionString.includes('?') ? '&' : '?') + 'sslmode=require'
}
let sslConfig = (process.env.DB_SSL === 'true' || isRenderHost) ? { rejectUnauthorized: false } : false

const pool = new Pool({ connectionString, ssl: sslConfig })

async function main() {
  try {
    // Delete the migration record for 015
    const res = await pool.query(
      'DELETE FROM migrations WHERE name = $1',
      ['015_add_lot_id_to_generated_questions.sql']
    )
    console.log('Migration 015 record deleted:', res.rowCount, 'row(s)')
    
    // Check if lot_id column exists
    const colCheck = await pool.query(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='generated_questions' AND column_name='lot_id'
      )
    `)
    console.log('lot_id column exists:', colCheck.rows[0].exists)
    
    // If column exists, drop it to start fresh
    if (colCheck.rows[0].exists) {
      await pool.query('ALTER TABLE generated_questions DROP COLUMN lot_id CASCADE')
      console.log('Dropped existing lot_id column')
    }
  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await pool.end()
  }
}

main()
