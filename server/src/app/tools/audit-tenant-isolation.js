import 'dotenv/config'
import pg from 'pg'

const connectionString = process.env.AUDIT_DATABASE_URL || process.env.TEST_DATABASE_URL
if (!connectionString) throw new Error('AUDIT_DATABASE_URL ou TEST_DATABASE_URL requis')
if (connectionString === process.env.DATABASE_URL && process.env.ALLOW_PRODUCTION_AUDIT !== 'true') {
  throw new Error('Audit de DATABASE_URL refuse sans ALLOW_PRODUCTION_AUDIT=true')
}

const platformAdminEmail = (process.env.PLATFORM_ADMIN_EMAIL || 'alban.michaud65@gmail.com').trim().toLowerCase()
const demoEmail = (process.env.DEMO_USER_EMAIL || 'demo@ao-link.fr').trim().toLowerCase()
const expectedTables = [
  'users', 'projects', 'companies', 'lots', 'rounds', 'round_lots', 'items',
  'moe_items', 'moe', 'offers', 'lot_companies', 'project_shares',
  'generated_questions', 'question_sheets', 'round_offers', 'options',
  'option_items', 'option_item_moe', 'option_item_offers', 'question_sheet_sends'
]

function printChecks(checks) {
  console.table(checks.map(({ check, value, blocking }) => ({
    controle: check,
    valeur: value,
    bloquant: blocking ? 'OUI' : 'non'
  })))
}

const { Pool } = pg
const pool = new Pool({
  connectionString,
  ssl: /render\.com/.test(connectionString) ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 15_000
})

const client = await pool.connect()
let transactionStarted = false
try {
  // La transaction READ ONLY est un garde-fou PostgreSQL : ce script ne peut
  // modifier ni le schema ni les donnees, meme si le compte est proprietaire.
  await client.query('BEGIN TRANSACTION READ ONLY')
  transactionStarted = true
  await client.query("SELECT set_config('app.migration_scope', 'true', true)")
  await client.query("SET LOCAL statement_timeout = '30s'")

  const identity = await client.query(`
    SELECT current_database() AS database,
           current_user AS role,
           r.rolsuper AS superuser,
           r.rolbypassrls AS bypass_rls,
           r.rolcreaterole AS can_create_role,
           (SELECT COUNT(*)::int
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relkind IN ('r', 'p')
               AND c.relowner = r.oid) AS owned_public_tables,
           current_setting('server_version') AS postgres_version
    FROM pg_roles r
    WHERE r.rolname = current_user
  `)
  console.table(identity.rows)

  const existingTables = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])
     ORDER BY table_name`,
    [expectedTables]
  )
  const tableNames = existingTables.rows.map(row => row.table_name)
  const tableCounts = []
  for (const tableName of tableNames) {
    // tableName vient exclusivement de la liste constante ci-dessus.
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM public.${tableName}`)
    tableCounts.push({ table: tableName, rows: result.rows[0].count })
  }
  console.table(tableCounts)

  const hasTenants = await client.query("SELECT to_regclass('public.tenants') IS NOT NULL AS present")
  if (!hasTenants.rows[0].present) {
    const readiness = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM users) AS users,
         (SELECT COUNT(*)::int FROM users WHERE lower(email) = $1) AS platform_admin_accounts,
         (SELECT COUNT(*)::int FROM users WHERE lower(email) = $2) AS demo_accounts,
         (SELECT COUNT(*)::int FROM projects) AS projects,
         (SELECT COUNT(*)::int FROM projects WHERE COALESCE(is_demo, false)) AS demo_projects,
         (SELECT COUNT(*)::int FROM projects WHERE NOT COALESCE(is_demo, false)) AS dmx_projects,
         (SELECT COUNT(*)::int FROM projects WHERE owner_id IS NULL) AS projects_without_owner,
         (SELECT COUNT(*)::int
            FROM projects p
            JOIN users u ON u.id = p.owner_id
           WHERE NOT COALESCE(p.is_demo, false) AND lower(u.email) = $2) AS dmx_projects_owned_by_demo,
         (SELECT COUNT(*)::int
            FROM project_shares s
            JOIN projects p ON p.id = s.project_id
            JOIN users u ON u.id = s.shared_with_user_id
           WHERE COALESCE(p.is_demo, false) <> (lower(u.email) = $2)) AS cross_tenant_shares,
         (SELECT COUNT(*)::int
            FROM companies c
           WHERE EXISTS (
             SELECT 1 FROM lot_companies lc
             JOIN lots l ON l.id = lc.lot_id
             JOIN projects p ON p.id = l.project_id
             WHERE lc.company_id = c.id AND COALESCE(p.is_demo, false)
           )
           AND EXISTS (
             SELECT 1 FROM lot_companies lc
             JOIN lots l ON l.id = lc.lot_id
             JOIN projects p ON p.id = l.project_id
             WHERE lc.company_id = c.id AND NOT COALESCE(p.is_demo, false)
           )) AS companies_to_duplicate`,
      [platformAdminEmail, demoEmail]
    )
    const row = readiness.rows[0]
    const checks = [
      { check: 'Compte platform admin present (exactement 1)', value: row.platform_admin_accounts, blocking: row.users > 0 && row.platform_admin_accounts !== 1 },
      { check: 'Compte DEMO present si projets DEMO', value: row.demo_accounts, blocking: row.demo_projects > 0 && row.demo_accounts !== 1 },
      { check: 'Projets DMX possedes par le compte DEMO', value: row.dmx_projects_owned_by_demo, blocking: row.dmx_projects_owned_by_demo > 0 },
      { check: 'Partages utilisateur/projet inter-tenant', value: row.cross_tenant_shares, blocking: row.cross_tenant_shares > 0 },
      { check: 'Projets sans proprietaire (autorises)', value: row.projects_without_owner, blocking: false },
      { check: 'Entreprises a dupliquer pour DEMO', value: row.companies_to_duplicate, blocking: false },
      { check: 'Projets DMX', value: row.dmx_projects, blocking: false },
      { check: 'Projets DEMO', value: row.demo_projects, blocking: false }
    ]
    printChecks(checks)
    if (row.cross_tenant_shares > 0) {
      const shareDetails = await client.query(
        `SELECT s.id AS share_id,
                p.id AS project_id,
                p.name AS project_name,
                COALESCE(p.is_demo, false) AS project_is_demo,
                u.id AS shared_user_id,
                u.email AS shared_user_email,
                u.role AS shared_user_role
           FROM project_shares s
           JOIN projects p ON p.id = s.project_id
           JOIN users u ON u.id = s.shared_with_user_id
          WHERE COALESCE(p.is_demo, false) <> (lower(u.email) = $1)
          ORDER BY s.id`,
        [demoEmail]
      )
      console.log('Partages inter-tenant a corriger avant migration :')
      console.table(shareDetails.rows)
    }
    if (checks.some(check => check.blocking)) process.exitCode = 1
  } else {
    const counts = await client.query(
      `SELECT t.slug, t.type, t.status,
              COUNT(DISTINCT u.id)::int AS users,
              COUNT(DISTINCT p.id)::int AS projects,
              COUNT(DISTINCT c.id)::int AS companies
       FROM tenants t
       LEFT JOIN users u ON u.tenant_id = t.id
       LEFT JOIN projects p ON p.tenant_id = t.id
       LEFT JOIN companies c ON c.tenant_id = t.id
       GROUP BY t.id ORDER BY t.slug`
    )
    console.table(counts.rows)
    const integrity = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM projects WHERE tenant_id IS NULL)::int AS projects_without_tenant,
         (SELECT COUNT(*) FROM users WHERE tenant_id IS NULL)::int AS users_without_tenant,
         (SELECT COUNT(*) FROM lots l JOIN projects p ON p.id = l.project_id WHERE l.tenant_id <> p.tenant_id)::int AS bad_lots,
         (SELECT COUNT(*) FROM items i JOIN lots l ON l.id = i.lot_id WHERE i.tenant_id <> l.tenant_id)::int AS bad_items,
         (SELECT COUNT(*) FROM offers o JOIN items i ON i.id = o.item_id WHERE o.tenant_id <> i.tenant_id)::int AS bad_offers,
         (SELECT COUNT(*) FROM project_shares s JOIN users u ON u.id = s.shared_with_user_id WHERE s.tenant_id <> u.tenant_id)::int AS bad_shares`
    )
    console.table(integrity.rows)
    if (Object.values(integrity.rows[0]).some(Number)) process.exitCode = 1
  }
} finally {
  if (transactionStarted) await client.query('ROLLBACK')
  client.release()
  await pool.end()
}
