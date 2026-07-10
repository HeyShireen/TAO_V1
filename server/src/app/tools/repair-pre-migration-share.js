import 'dotenv/config'
import pg from 'pg'

const connectionString = process.env.REPAIR_DATABASE_URL
if (!connectionString) throw new Error('REPAIR_DATABASE_URL est obligatoire')

const parsed = new URL(connectionString)
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
const target = `${parsed.host}/${databaseName}`
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
if (!isLocal) {
  if (process.env.ALLOW_REMOTE_REPAIR !== 'true') {
    throw new Error('ALLOW_REMOTE_REPAIR=true est requis pour une cible distante')
  }
  if (process.env.REPAIR_CONFIRM_TARGET !== target) {
    throw new Error(`REPAIR_CONFIRM_TARGET doit valoir exactement: ${target}`)
  }
}

const productionUrl = process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_URL
if (productionUrl) {
  const production = new URL(productionUrl)
  const productionTarget = `${production.host}/${decodeURIComponent(production.pathname.replace(/^\//, ''))}`
  if (productionTarget === target && process.env.ALLOW_PRODUCTION_REPAIR !== 'true') {
    throw new Error('La reparation de production est refusee sans ALLOW_PRODUCTION_REPAIR=true')
  }
}

const shareId = Number(process.env.REPAIR_SHARE_ID)
if (!Number.isSafeInteger(shareId) || shareId <= 0) {
  throw new Error('REPAIR_SHARE_ID doit etre un entier positif')
}

const applyRepair = process.env.APPLY_PREMIGRATION_REPAIR === 'true'
const demoEmail = (process.env.DEMO_USER_EMAIL || 'demo@ao-link.fr').trim().toLowerCase()
const { Pool } = pg
const pool = new Pool({
  connectionString,
  ssl: /render\.com/.test(connectionString) ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 15_000,
})

const client = await pool.connect()
let transactionStarted = false
try {
  await client.query('BEGIN')
  transactionStarted = true
  await client.query("SET LOCAL statement_timeout = '30s'")
  await client.query("SET LOCAL lock_timeout = '5s'")

  const migrated = await client.query("SELECT to_regclass('public.tenants') IS NOT NULL AS present")
  if (migrated.rows[0].present) {
    throw new Error('Reparation refusee: la base est deja multi-tenant')
  }

  const candidate = await client.query(
    `SELECT s.id AS share_id,
            p.id AS project_id,
            p.name AS project_name,
            COALESCE(p.is_demo, false) AS project_is_demo,
            u.id AS shared_user_id,
            u.email AS shared_user_email
       FROM project_shares s
       JOIN projects p ON p.id = s.project_id
       JOIN users u ON u.id = s.shared_with_user_id
      WHERE s.id = $1
      FOR UPDATE OF s`,
    [shareId]
  )
  if (candidate.rowCount !== 1) throw new Error(`Partage ${shareId} introuvable ou non unique`)

  const row = candidate.rows[0]
  if (!row.project_is_demo) throw new Error(`Le partage ${shareId} ne concerne pas un projet DEMO`)
  if (row.shared_user_email.trim().toLowerCase() === demoEmail) {
    throw new Error(`Le partage ${shareId} appartient deja au compte DEMO`)
  }
  console.table([row])

  if (!applyRepair) {
    await client.query('ROLLBACK')
    transactionStarted = false
    console.log(`Simulation OK sur ${target}; aucune donnee modifiee`)
  } else {
    const deleted = await client.query(
      `DELETE FROM project_shares s
       USING projects p, users u
       WHERE s.id = $1
         AND p.id = s.project_id
         AND u.id = s.shared_with_user_id
         AND COALESCE(p.is_demo, false)
         AND lower(u.email) <> $2
       RETURNING s.id`,
      [shareId, demoEmail]
    )
    if (deleted.rowCount !== 1) throw new Error(`Suppression refusee: ${deleted.rowCount} ligne affectee`)
    await client.query('COMMIT')
    transactionStarted = false
    console.log(`Partage ${shareId} supprime sur ${target}; 1 ligne affectee`)
  }
} catch (error) {
  if (transactionStarted) await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
