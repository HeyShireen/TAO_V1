import 'dotenv/config'
import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'

const testUrl = process.env.TEST_DATABASE_URL

function databaseTarget(url) {
  const parsed = new URL(url)
  return `${parsed.host}/${decodeURIComponent(parsed.pathname.replace(/^\//, ''))}`
}

function assertSafeTestDatabase(url) {
  const parsed = new URL(url)
  const target = databaseTarget(url)
  const productionUrl = process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_URL
  if (process.env.ALLOW_TEST_DATABASE !== 'true') {
    throw new Error('ALLOW_TEST_DATABASE=true est requis pour les tests PostgreSQL destructifs')
  }
  if (process.env.TEST_DATABASE_CONFIRM_TARGET !== target) {
    throw new Error(`TEST_DATABASE_CONFIRM_TARGET doit valoir exactement: ${target}`)
  }
  if (productionUrl && databaseTarget(productionUrl) === target) {
    throw new Error('TEST_DATABASE_URL ne peut pas cibler la base de production')
  }
  if (!productionUrl && !/test/i.test(parsed.pathname)) {
    throw new Error('Sans PRODUCTION_DATABASE_URL, le nom de la base de test doit contenir "test"')
  }
}

test('RLS isole deux tenants et les FK refusent une reference croisee', { skip: !testUrl }, async () => {
  assertSafeTestDatabase(testUrl)
  process.env.DATABASE_URL = testUrl
  process.env.MIGRATION_DATABASE_URL = testUrl
  const parsedTestUrl = new URL(testUrl)
  process.env.ALLOW_REMOTE_MIGRATION = 'true'
  process.env.MIGRATION_CONFIRM_TARGET = `${parsedTestUrl.host}/${decodeURIComponent(parsedTestUrl.pathname.replace(/^\//, ''))}`
  process.env.MIGRATION_BACKUP_REFERENCE = 'integration-test-disposable-database'
  process.env.ALLOW_SHARED_MIGRATION_CREDENTIALS = 'true'
  process.env.PLATFORM_ADMIN_EMAIL = 'platform@test.local'
  process.env.DEMO_USER_EMAIL = 'demo@test.local'

  const db = await import(`../src/app/db.js?integration=${Date.now()}`)
  await db.migrateSchema()

  const suffix = Date.now().toString(36)
  const third = await db.platformQuery(
    `INSERT INTO tenants (slug, name, type) VALUES ($1, $2, 'customer') RETURNING id`,
    [`test-${suffix}`, `Test ${suffix}`]
  )
  const tenantA = Number(third.rows[0].id)
  const tenantBResult = await db.platformQuery("SELECT id FROM tenants WHERE slug = 'demo'")
  const tenantB = Number(tenantBResult.rows[0].id)

  const users = await db.authQuery(
    `INSERT INTO users (email, password_hash, role, email_verified, tenant_id)
     VALUES ($1, 'not-used', 'tenant_admin', true, $2),
            ($3, 'not-used', 'responsable', true, $4)
     RETURNING id, tenant_id`,
    [`a-${suffix}@test.local`, tenantA, `b-${suffix}@test.local`, tenantB]
  )
  const userA = Number(users.rows[0].id)
  const userB = Number(users.rows[1].id)

  let projectA
  await db.runWithTenantContext({ tenantId: tenantA, userId: userA }, async () => {
    projectA = (await db.query(
      `INSERT INTO projects (name, reference, owner_id) VALUES ('A', $1, $2) RETURNING id`,
      [`A-${suffix}`, userA]
    )).rows[0]
    await db.query('INSERT INTO companies (name) VALUES ($1)', [`Entreprise ${suffix}`])
    const visible = await db.query('SELECT id FROM projects WHERE reference = $1', [`A-${suffix}`])
    assert.equal(visible.rowCount, 1)
  })

  await db.runWithTenantContext({ tenantId: tenantB, userId: userB }, async () => {
    await db.query('INSERT INTO companies (name) VALUES ($1)', [`Entreprise ${suffix}`])
    const invisible = await db.query('SELECT id FROM projects WHERE reference = $1', [`A-${suffix}`])
    assert.equal(invisible.rowCount, 0)
    await assert.rejects(
      db.query('INSERT INTO lots (project_id, name) VALUES ($1, $2)', [projectA.id, 'Interdit']),
      error => error.code === '23503'
    )
  })

  const withoutContext = await db.query('SELECT id FROM projects WHERE reference = $1', [`A-${suffix}`])
  assert.equal(withoutContext.rowCount, 0)

  // Meme si un role applicatif tente de positionner app.migration_scope, il
  // ne doit voir aucune ligne : ce scope est reserve au proprietaire du schema.
  const roleName = `aolink_rls_test_${suffix.replace(/[^a-z0-9_]/gi, '')}`
  const quotedRole = `"${roleName.replaceAll('"', '""')}"`
  const adminPool = new pg.Pool({
    connectionString: testUrl,
    ssl: /render\.com/.test(testUrl) ? { rejectUnauthorized: false } : false,
  })
  const adminClient = await adminPool.connect()
  let roleCreated = false
  let roleGranted = false
  try {
    await adminClient.query(`CREATE ROLE ${quotedRole} NOLOGIN NOSUPERUSER NOBYPASSRLS`)
    roleCreated = true
    await adminClient.query(`GRANT USAGE ON SCHEMA public TO ${quotedRole}`)
    await adminClient.query(`GRANT SELECT ON public.projects TO ${quotedRole}`)
    await adminClient.query(`GRANT ${quotedRole} TO CURRENT_USER`)
    roleGranted = true
    await adminClient.query(`SET ROLE ${quotedRole}`)
    await adminClient.query("SELECT set_config('app.migration_scope', 'true', false)")
    const attemptedBypass = await adminClient.query('SELECT COUNT(*)::int AS count FROM public.projects')
    assert.equal(attemptedBypass.rows[0].count, 0)
    await adminClient.query('RESET ROLE')
  } finally {
    await adminClient.query('RESET ROLE').catch(() => {})
    if (roleGranted) await adminClient.query(`REVOKE ${quotedRole} FROM CURRENT_USER`).catch(() => {})
    if (roleCreated) await adminClient.query(`DROP ROLE ${quotedRole}`).catch(() => {})
    adminClient.release()
    await adminPool.end()
  }
  await db.pool.end()
})
