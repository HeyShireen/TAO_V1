import pg from 'pg'
import { AsyncLocalStorage } from 'node:async_hooks'

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { Pool } = pg
const dbContext = new AsyncLocalStorage()
const appliedClientContexts = new WeakMap()

// Configuration SSL
// Problème rencontré: "SSL/TLS required" sur Render lorsque NODE_ENV=development et DB_SSL non défini.
// Solution: activer SSL si l'URL pointe vers un hôte Render ou si DB_SSL=true.
let connectionString = process.env.DATABASE_URL
const isRenderHost = /render\.com/.test(connectionString || '')
// Ajouter sslmode=require si hébergeur Render et absent
if (isRenderHost && connectionString && !/sslmode=/.test(connectionString)) {
  connectionString += (connectionString.includes('?') ? '&' : '?') + 'sslmode=require'
}
let sslConfig
if (process.env.DB_SSL === 'true' || isRenderHost) {
  // Render impose SSL; on assouplit la vérification du certificat (managed cert)
  sslConfig = { rejectUnauthorized: false }
} else if (process.env.NODE_ENV === 'production') {
  // Autres environnements production: vérification stricte
  sslConfig = { rejectUnauthorized: true }
} else {
  // Développement local sans SSL
  sslConfig = false
}

const runtimePool = new Pool({
  connectionString,
  ssl: sslConfig
})

function normalizedContext(extra = {}) {
  return { ...(dbContext.getStore() || {}), ...extra }
}

export function runWithDbContext(context, callback) {
  return dbContext.run(normalizedContext(context), callback)
}

export function runWithTenantContext(context, callback) {
  return runWithDbContext({
    tenantId: Number(context.tenantId),
    userId: Number(context.userId),
    authScope: false,
    platformScope: false,
  }, callback)
}

function contextSettings(context = dbContext.getStore()) {
  const tenantId = Number.isFinite(Number(context?.tenantId)) ? String(context.tenantId) : ''
  const userId = Number.isFinite(Number(context?.userId)) ? String(context.userId) : ''
  return {
    tenantId,
    userId,
    authScope: context?.authScope === true ? 'true' : 'false',
    platformScope: context?.platformScope === true ? 'true' : 'false',
  }
}

function contextSignature(settings) {
  return [settings.tenantId, settings.userId, settings.authScope, settings.platformScope].join('|')
}

async function applyContextIfChanged(client, context = dbContext.getStore()) {
  const settings = contextSettings(context)
  const signature = contextSignature(settings)
  if (appliedClientContexts.get(client) === signature) return

  await client.query(
    `SELECT
       set_config('app.tenant_id', $1, false),
       set_config('app.user_id', $2, false),
       set_config('app.auth_scope', $3, false),
       set_config('app.platform_scope', $4, false)`,
    [
      settings.tenantId,
      settings.userId,
      settings.authScope,
      settings.platformScope,
    ]
  )
  appliedClientContexts.set(client, signature)
}

async function connectWithContext() {
  const client = await runtimePool.connect()
  try {
    await applyContextIfChanged(client)
  } catch (error) {
    appliedClientContexts.delete(client)
    client.release(true)
    throw error
  }

  const release = client.release.bind(client)
  let released = false
  client.release = async (destroy = false) => {
    if (released) return
    released = true
    if (destroy) {
      appliedClientContexts.delete(client)
      return release(true)
    }
    // Le contexte reste sur la connexion inactive, inaccessible hors de cette
    // façade. Au prochain checkout il est comparé au contexte demandé et
    // remplacé avant toute requête si nécessaire.
    release()
  }
  return client
}

// Façade compatible avec les transactions existantes. Chaque connexion reçoit
// le contexte AsyncLocalStorage courant avant sa première requête.
export const pool = {
  connect: connectWithContext,
  query: async (text, params) => {
    const client = await connectWithContext()
    try {
      return await client.query(text, params)
    } finally {
      await client.release()
    }
  },
  end: () => runtimePool.end(),
}

export const query = (text, params) => pool.query(text, params)

export function authQuery(text, params) {
  return runWithDbContext({ authScope: true }, () => query(text, params))
}

export function platformQuery(text, params) {
  return runWithDbContext({ platformScope: true }, () => query(text, params))
}

async function runMigrations(client) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const migrationsDir = path.join(__dirname, 'migrations')
  
  // Créer la table de suivi des migrations si elle n'existe pas
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  
  try {
    // Lire tous les fichiers de migration
    const files = await fs.readdir(migrationsDir)
    const sqlFiles = files.filter(f => f.endsWith('.sql')).sort()
    
    for (const file of sqlFiles) {
      // Vérifier si la migration a déjà été exécutée
      const exists = await client.query(
        'SELECT id FROM migrations WHERE name = $1',
        [file]
      )
      
      if (exists.rowCount === 0) {
        console.log(`Exécution de la migration: ${file}`)
        const migrationPath = path.join(migrationsDir, file)
        const migrationSQL = await fs.readFile(migrationPath, 'utf8')
        
        // Exécuter la migration dans une transaction
        await client.query('BEGIN')
        try {
          await client.query(migrationSQL)
          await client.query(
            'INSERT INTO migrations (name) VALUES ($1)',
            [file]
          )
          await client.query('COMMIT')
          console.log(`✅ Migration ${file} exécutée avec succès`)
        } catch (err) {
          await client.query('ROLLBACK')
          console.error(`❌ Erreur lors de la migration ${file}:`, err.message)
          throw err
        }
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('Aucun dossier migrations trouvé, création...')
      await fs.mkdir(migrationsDir, { recursive: true })
    } else {
      throw err
    }
  }
}

const REQUIRED_COLUMNS = [
  ['generated_questions', 'generated_text'],   // migration 043
  ['project_question_config', 'ask_questions_qty'], // migration 044
  ['lot_question_config', 'ask_questions_qty_override'], // migration 044
  ['users', 'tenant_id'], // migration 045
  ['projects', 'tenant_id'] // migration 045
]

async function assertSchemaSanity() {
  const missing = []
  for (const [table, column] of REQUIRED_COLUMNS) {
    const res = await runtimePool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      [table, column]
    )
    if (res.rowCount === 0) missing.push(`${table}.${column}`)
  }
  if (missing.length > 0) {
    console.error('❌ ERREUR CRITIQUE: schéma incomplet, colonnes manquantes:', missing.join(', '))
    console.error('   Le déploiement n\'inclut probablement pas les fichiers de migration correspondants.')
    console.error('   Démarrage refusé pour éviter toute corruption de données.')
    process.exit(1)
  }
}

async function assertRuntimeRoleSafety() {
  const result = await runtimePool.query(
    `SELECT r.rolsuper, r.rolbypassrls,
            EXISTS (
              SELECT 1 FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND c.relrowsecurity
                AND c.relowner = r.oid
            ) AS owns_business_tables
     FROM pg_roles r WHERE r.rolname = current_user`
  )
  const role = result.rows[0]
  if (!role || role.rolsuper || role.rolbypassrls || role.owns_business_tables) {
    throw new Error('DATABASE_URL doit utiliser un role applicatif non proprietaire, NOSUPERUSER et NOBYPASSRLS')
  }
}

export async function migrateSchema() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const schemaPath = path.join(__dirname, 'schema.sql')
  const sql = await fs.readFile(schemaPath, 'utf8')
  const migrationConnectionString = process.env.MIGRATION_DATABASE_URL
  if (!migrationConnectionString) {
    throw new Error('MIGRATION_DATABASE_URL est obligatoire; DATABASE_URL ne sert jamais de repli pour une migration')
  }

  const parsedMigrationUrl = new URL(migrationConnectionString)
  if (!['postgres:', 'postgresql:'].includes(parsedMigrationUrl.protocol)) {
    throw new Error('MIGRATION_DATABASE_URL doit etre une URL PostgreSQL')
  }
  const databaseName = decodeURIComponent(parsedMigrationUrl.pathname.replace(/^\//, ''))
  const target = `${parsedMigrationUrl.host}/${databaseName}`
  const isLocalTarget = ['localhost', '127.0.0.1', '::1'].includes(parsedMigrationUrl.hostname)

  if (!isLocalTarget) {
    if (process.env.ALLOW_REMOTE_MIGRATION !== 'true') {
      throw new Error(`Migration distante refusee. Pour cette cible, definir ALLOW_REMOTE_MIGRATION=true et MIGRATION_CONFIRM_TARGET=${target}`)
    }
    if (process.env.MIGRATION_CONFIRM_TARGET !== target) {
      throw new Error(`Cible non confirmee. MIGRATION_CONFIRM_TARGET doit valoir exactement: ${target}`)
    }
    if (!(process.env.MIGRATION_BACKUP_REFERENCE || '').trim()) {
      throw new Error('MIGRATION_BACKUP_REFERENCE est obligatoire pour une migration distante')
    }
  }

  if (process.env.DATABASE_URL) {
    const runtimeUrl = new URL(process.env.DATABASE_URL)
    const sameCredentialsAndTarget = runtimeUrl.username === parsedMigrationUrl.username
      && runtimeUrl.hostname === parsedMigrationUrl.hostname
      && runtimeUrl.port === parsedMigrationUrl.port
      && runtimeUrl.pathname === parsedMigrationUrl.pathname
    if (sameCredentialsAndTarget && process.env.ALLOW_SHARED_MIGRATION_CREDENTIALS !== 'true') {
      throw new Error('Le role de migration est aussi le role DATABASE_URL. Definir ALLOW_SHARED_MIGRATION_CREDENTIALS=true uniquement pour la migration de transition, puis separer les roles')
    }
  }

  const migrationIsRender = /render\.com/.test(migrationConnectionString)
  const migrationPool = new Pool({
    connectionString: migrationConnectionString,
    ssl: process.env.DB_SSL === 'true' || migrationIsRender ? { rejectUnauthorized: false } : sslConfig,
  })
  const client = await migrationPool.connect()
  try {
    await client.query(
      `SELECT set_config('app.demo_email', $1, false),
              set_config('app.platform_admin_email', $2, false),
              set_config('app.migration_scope', 'true', false)`,
      [
        (process.env.DEMO_USER_EMAIL || 'demo@ao-link.fr').trim().toLowerCase(),
        (process.env.PLATFORM_ADMIN_EMAIL || 'alban.michaud65@gmail.com').trim().toLowerCase(),
      ]
    )
    await client.query(sql)
    await runMigrations(client)
    console.log('Schéma et migrations OK')
  } finally {
    client.release()
    await migrationPool.end()
  }
}

export async function ensureSchema() {
  // Le processus applicatif n'exécute jamais de DDL. Cela permet d'utiliser un
  // rôle PostgreSQL non propriétaire soumis à FORCE ROW LEVEL SECURITY.
  await assertSchemaSanity()
  await assertRuntimeRoleSafety()
  console.log('Schéma applicatif OK')
}

function defaultSchemaSQL() {
  return `
  CREATE TABLE IF NOT EXISTS public.users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON public.users (lower(email));

  CREATE TABLE IF NOT EXISTS public.projects (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    reference TEXT,
    client TEXT,
    location TEXT,
    is_demo BOOLEAN NOT NULL DEFAULT false,
    created_by BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS study_phase TEXT;
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS study_date DATE;
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

  CREATE TABLE IF NOT EXISTS public.lots (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    code TEXT,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Table des entreprises avec contrainte d'unicité sur le nom (insensible à la casse)
  CREATE TABLE IF NOT EXISTS public.companies (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS companies_name_lower_idx ON public.companies (lower(name));
  

  CREATE TABLE IF NOT EXISTS public.lot_companies (
    lot_id BIGINT NOT NULL REFERENCES public.lots(id) ON DELETE CASCADE,
    company_id BIGINT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    display_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (lot_id, company_id)
  );

  CREATE TABLE IF NOT EXISTS public.items (
    id BIGSERIAL PRIMARY KEY,
    lot_id BIGINT NOT NULL REFERENCES public.lots(id) ON DELETE CASCADE,
    num TEXT,
    designation TEXT,
    unit TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS public.moe_items (
    item_id BIGINT NOT NULL PRIMARY KEY REFERENCES public.items(id) ON DELETE CASCADE,
    qty NUMERIC,
    unit_price NUMERIC,
    amount NUMERIC
  );

  -- Table legacy conservée pour compatibilité
  CREATE TABLE IF NOT EXISTS public.moe (
    id BIGSERIAL PRIMARY KEY,
    item_id BIGINT NOT NULL UNIQUE REFERENCES public.items(id) ON DELETE CASCADE,
    qty NUMERIC,
    unit_price NUMERIC
  );

  CREATE TABLE IF NOT EXISTS public.offers (
    id BIGSERIAL PRIMARY KEY,
    item_id BIGINT NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    company_id BIGINT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    unit TEXT,
    qty NUMERIC,
    unit_price NUMERIC,
    amount NUMERIC,
    UNIQUE (item_id, company_id)
  );

  -- Ajout position pour l'ordre des items
  ALTER TABLE public.items ADD COLUMN IF NOT EXISTS position INTEGER;

  -- Indexes pour les performances
  CREATE INDEX IF NOT EXISTS idx_lots_project_id ON public.lots(project_id);
  CREATE INDEX IF NOT EXISTS idx_items_lot_id     ON public.items(lot_id);
  CREATE INDEX IF NOT EXISTS idx_items_lot_position ON public.items(lot_id, position);
  CREATE INDEX IF NOT EXISTS idx_offers_item      ON public.offers(item_id);
  CREATE INDEX IF NOT EXISTS idx_offers_company   ON public.offers(company_id);
  CREATE INDEX IF NOT EXISTS idx_offers_item_company ON public.offers(item_id, company_id);
  CREATE INDEX IF NOT EXISTS idx_moe_items_item   ON public.moe_items(item_id);
  CREATE INDEX IF NOT EXISTS idx_lot_companies_lot ON public.lot_companies(lot_id);
  CREATE INDEX IF NOT EXISTS idx_lot_companies_company ON public.lot_companies(company_id);
  `
}
