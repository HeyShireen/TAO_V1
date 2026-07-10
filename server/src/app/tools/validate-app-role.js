import 'dotenv/config'
import pg from 'pg'

const expectedRole = process.env.APP_DATABASE_ROLE || 'aolink_runtime'
const sourceConnectionString = process.env.APP_DATABASE_URL
if (!sourceConnectionString) throw new Error('APP_DATABASE_URL est obligatoire')
const parsed = new URL(sourceConnectionString)
if (process.env.DERIVE_RUNTIME_ROLE_URL === 'true') parsed.username = expectedRole
const connectionString = parsed.toString()

const target = `${parsed.host}/${decodeURIComponent(parsed.pathname.replace(/^\//, ''))}`
if (process.env.APP_CONFIRM_TARGET !== target) {
  throw new Error(`APP_CONFIRM_TARGET doit valoir exactement: ${target}`)
}

const { Pool } = pg
const pool = new Pool({
  connectionString,
  ssl: /render\.com/.test(connectionString) ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 15_000,
})
const client = await pool.connect()
let transactionStarted = false
try {
  await client.query('BEGIN TRANSACTION READ ONLY')
  transactionStarted = true
  await client.query("SET LOCAL statement_timeout = '30s'")

  const roleResult = await client.query(`
    SELECT session_user AS login_role,
           current_user AS effective_role,
           r.rolname AS role,
           r.rolsuper AS superuser,
           r.rolbypassrls AS bypass_rls,
           r.rolcreaterole AS can_create_role,
           r.rolcreatedb AS can_create_database,
           r.rolconfig AS role_config,
           (SELECT array_agg(parent.rolname ORDER BY parent.rolname)
              FROM pg_auth_members m
              JOIN pg_roles parent ON parent.oid = m.roleid
             WHERE m.member = r.oid) AS member_of,
           (SELECT COUNT(*)::int
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relowner = r.oid AND n.nspname = 'public') AS owned_public_tables,
           EXISTS (
             SELECT 1
             FROM pg_auth_members m
             JOIN pg_class owned ON owned.relowner = m.roleid
             JOIN pg_namespace owned_ns ON owned_ns.oid = owned.relnamespace
             WHERE m.member = r.oid
               AND owned_ns.nspname = 'public'
               AND owned.relname = 'tenants'
           ) AS member_of_schema_owner
    FROM pg_roles r
    WHERE r.rolname = session_user
  `)
  const role = roleResult.rows[0]
  console.table([role])
  if (!role || role.login_role !== expectedRole) throw new Error(`Le credential ne se connecte pas avec le login ${expectedRole}`)
  if (role.effective_role !== expectedRole) throw new Error(`Le role effectif est ${role.effective_role} au lieu de ${expectedRole}`)
  if (role.superuser || role.bypass_rls || role.can_create_role || role.can_create_database
      || role.owned_public_tables > 0 || role.member_of_schema_owner) {
    throw new Error(`Le role ${expectedRole} possede des privileges structurels interdits`)
  }

  const missingPrivileges = await client.query(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND NOT (
        has_table_privilege(current_user, c.oid, 'SELECT')
        AND has_table_privilege(current_user, c.oid, 'INSERT')
        AND has_table_privilege(current_user, c.oid, 'UPDATE')
        AND has_table_privilege(current_user, c.oid, 'DELETE')
      )
    ORDER BY c.relname
  `)
  if (missingPrivileges.rowCount > 0) {
    console.table(missingPrivileges.rows)
    throw new Error(`${missingPrivileges.rowCount} table(s) RLS sans privileges applicatifs complets`)
  }

  const noContext = await client.query('SELECT COUNT(*)::int AS count FROM public.projects')
  if (noContext.rows[0].count !== 0) throw new Error('RLS laisse voir des projets sans contexte tenant')

  await client.query("SELECT set_config('app.migration_scope', 'true', true)")
  const attemptedBypass = await client.query('SELECT COUNT(*)::int AS count FROM public.projects')
  if (attemptedBypass.rows[0].count !== 0) throw new Error('aolink_app peut contourner RLS avec migration_scope')

  await client.query("SELECT set_config('app.migration_scope', 'false', true), set_config('app.auth_scope', 'true', true)")
  const dmx = await client.query("SELECT id FROM public.tenants WHERE slug = 'dmx'")
  if (dmx.rowCount !== 1) throw new Error('Tenant DMX inaccessible dans le scope authentification')

  await client.query(
    "SELECT set_config('app.auth_scope', 'false', true), set_config('app.tenant_id', $1, true)",
    [String(dmx.rows[0].id)]
  )
  const tenantProjects = await client.query('SELECT COUNT(*)::int AS count FROM public.projects')
  console.table([{ target, no_context: noContext.rows[0].count, migration_bypass: attemptedBypass.rows[0].count, dmx_projects: tenantProjects.rows[0].count }])
  if (tenantProjects.rows[0].count < 1) throw new Error('Le role applicatif ne voit aucun projet DMX avec un contexte valide')
} finally {
  if (transactionStarted) await client.query('ROLLBACK')
  client.release()
  await pool.end()
}
