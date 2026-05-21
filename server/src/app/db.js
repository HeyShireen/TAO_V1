import pg from 'pg'

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { Pool } = pg

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

export const pool = new Pool({
  connectionString,
  ssl: sslConfig
})

export const query = (t, p) => pool.query(t, p)

async function runMigrations() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const migrationsDir = path.join(__dirname, 'migrations')
  
  // Créer la table de suivi des migrations si elle n'existe pas
  await pool.query(`
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
      const exists = await pool.query(
        'SELECT id FROM migrations WHERE name = $1',
        [file]
      )
      
      if (exists.rowCount === 0) {
        console.log(`Exécution de la migration: ${file}`)
        const migrationPath = path.join(migrationsDir, file)
        const migrationSQL = await fs.readFile(migrationPath, 'utf8')
        
        // Exécuter la migration dans une transaction
        await pool.query('BEGIN')
        try {
          await pool.query(migrationSQL)
          await pool.query(
            'INSERT INTO migrations (name) VALUES ($1)',
            [file]
          )
          await pool.query('COMMIT')
          console.log(`✅ Migration ${file} exécutée avec succès`)
        } catch (err) {
          await pool.query('ROLLBACK')
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

export async function ensureSchema() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const schemaPath = path.join(__dirname, 'schema.sql')
  let sql
  try {
    sql = await fs.readFile(schemaPath, 'utf8')
  } catch {
    console.warn('schema.sql introuvable, chargement du schéma embarqué')
    sql = defaultSchemaSQL()
  }
  await pool.query(sql)
  console.log('Schema OK')
  
  // Exécuter les migrations
  await runMigrations()
  
  // Vérifier si un utilisateur admin existe
  const usersCount = await query('SELECT COUNT(*) FROM users')
  if (Number(usersCount.rows[0].count) === 0) {
    console.log('\n⚠️  AUCUN UTILISATEUR - Utilisez l\'une de ces méthodes pour créer un admin:')
    console.log('   1. Via l\'interface: Cliquez sur "Créer admin" au premier lancement')
    console.log('   2. Via variables d\'environnement (.env):')
    console.log('      ADMIN_EMAIL=admin@example.com')
    console.log('      ADMIN_PASSWORD=VotreMotDePasseSécurisé123!\n')
    
    // Si les variables d'environnement sont définies, créer l'admin
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      console.log('Création de l\'utilisateur admin depuis .env (base vide)...')
      const bcrypt = await import('bcrypt')
      const password_hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10)
      await query(
        'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)',
        [process.env.ADMIN_EMAIL, password_hash, 'admin']
      )
      console.log('✅ Utilisateur admin créé:', process.env.ADMIN_EMAIL)
    }
  }

  // Garantir l'existence / rôle admin même si la base n'est pas vide
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const adminRes = await query('SELECT id, role FROM users WHERE lower(email)=lower($1)', [process.env.ADMIN_EMAIL])
    if (adminRes.rowCount === 0) {
      console.log('Création admin manquante (base non vide) - ajout...')
      const bcrypt = await import('bcrypt')
      const password_hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10)
      await query(
        'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)',
        [process.env.ADMIN_EMAIL, password_hash, 'admin']
      )
      console.log('✅ Admin ajouté:', process.env.ADMIN_EMAIL)
    } else if (adminRes.rows[0].role !== 'admin') {
      await query('UPDATE users SET role=$2 WHERE id=$1', [adminRes.rows[0].id, 'admin'])
      console.log('⚠️ Utilisateur existant promu admin:', process.env.ADMIN_EMAIL)
    } else {
      console.log('ℹ️ Admin déjà présent:', process.env.ADMIN_EMAIL)
    }
  } else {
    console.log('ℹ️ ADMIN_EMAIL / ADMIN_PASSWORD non définis - bypass impossible')
  }
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
