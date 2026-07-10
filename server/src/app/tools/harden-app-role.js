import 'dotenv/config'
import pg from 'pg'

const connectionString = process.env.MIGRATION_DATABASE_URL
if (!connectionString) throw new Error('MIGRATION_DATABASE_URL est obligatoire')
const credentialUrl = process.env.APP_DATABASE_URL
if (!credentialUrl) throw new Error('APP_DATABASE_URL est obligatoire pour fournir le mot de passe sans l afficher')

const parsed = new URL(connectionString)
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
const target = `${parsed.host}/${databaseName}`
if (process.env.ROLE_CONFIRM_TARGET !== target) {
  throw new Error(`ROLE_CONFIRM_TARGET doit valoir exactement: ${target}`)
}
if (process.env.ALLOW_PRODUCTION_ROLE_CHANGE !== 'true') {
  throw new Error('ALLOW_PRODUCTION_ROLE_CHANGE=true est obligatoire')
}
if (!(process.env.MIGRATION_BACKUP_REFERENCE || '').trim()) {
  throw new Error('MIGRATION_BACKUP_REFERENCE est obligatoire')
}

const credential = new URL(credentialUrl)
const credentialTarget = `${credential.host}/${decodeURIComponent(credential.pathname.replace(/^\//, ''))}`
if (credentialTarget !== target) throw new Error('APP_DATABASE_URL et MIGRATION_DATABASE_URL ne ciblent pas la meme base')
const runtimePassword = decodeURIComponent(credential.password)
if (runtimePassword.length < 24) throw new Error('Le mot de passe du credential Render est trop court')

const appRole = 'aolink_runtime'
const applyChanges = process.env.APPLY_APP_ROLE_HARDENING === 'true'
const quoteIdentifier = value => `"${String(value).replaceAll('"', '""')}"`
const quoteLiteral = value => `'${String(value).replaceAll("'", "''")}'`
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

  const ownerResult = await client.query(`
    SELECT current_user AS owner_role,
           current_database() AS database_name,
           r.rolcreaterole,
           EXISTS (
             SELECT 1 FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = 'tenants'
               AND c.relowner = r.oid
           ) AS owns_tenants
    FROM pg_roles r WHERE r.rolname = current_user
  `)
  const owner = ownerResult.rows[0]
  if (!owner?.rolcreaterole || !owner.owns_tenants) {
    throw new Error('Le credential de migration doit pouvoir gerer les roles et posseder public.tenants')
  }

  const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appRole])
  if (existing.rowCount > 0) throw new Error(`Le role ${appRole} existe deja; provisionnement refuse pour ne pas modifier son mot de passe`)

  console.table([{ target, app_role: appRole, source_credential: credential.username, password_reused_without_display: true }])
  await client.query(`CREATE ROLE ${quoteIdentifier(appRole)} LOGIN PASSWORD ${quoteLiteral(runtimePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`)
  await client.query(`ALTER ROLE ${quoteIdentifier(appRole)} SET row_security = on`)
  await client.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(owner.database_name)} TO ${quoteIdentifier(appRole)}`)
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
  await client.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(appRole)}`)
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoteIdentifier(appRole)}`)
  await client.query(`REVOKE ALL PRIVILEGES ON TABLE public.migrations FROM ${quoteIdentifier(appRole)}`)
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdentifier(appRole)}`)
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdentifier(owner.owner_role)} IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quoteIdentifier(appRole)}`)
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdentifier(owner.owner_role)} IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO ${quoteIdentifier(appRole)}`)

  if (applyChanges) {
    await client.query('COMMIT')
    transactionStarted = false
    console.log(`Role ${appRole} durci sur ${target}`)
  } else {
    await client.query('ROLLBACK')
    transactionStarted = false
    console.log(`Simulation OK sur ${target}; aucun privilege modifie`)
  }
} catch (error) {
  if (transactionStarted) await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
