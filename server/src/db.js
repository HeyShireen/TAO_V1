import pg from 'pg'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

export const query = (t, p) => pool.query(t, p)

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
  
  // Créer un utilisateur admin par défaut si aucun utilisateur n'existe
  const usersCount = await query('SELECT COUNT(*) FROM users')
  if (Number(usersCount.rows[0].count) === 0) {
    console.log('Création utilisateur admin par défaut...')
    const defaultAdmin = {
      email: process.env.ADMIN_EMAIL || 'admin@example.com',
      // Le hash correspond au mot de passe 'admin123' - À CHANGER en production !
      password_hash: '$2b$10$s6pQh34La0P/YhQBQrbvtObSWqIGqN4Q4RHXcQh.2oL1jB8YbE.K6',
      role: 'admin'
    }
    await query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)',
      [defaultAdmin.email, defaultAdmin.password_hash, defaultAdmin.role]
    )
    console.log('Utilisateur admin créé :', defaultAdmin.email)
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
    created_by BIGINT REFERENCES public.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS study_phase TEXT;
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS study_date DATE;

  CREATE TABLE IF NOT EXISTS public.lots (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    code TEXT,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS public.companies (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS public.lot_companies (
    lot_id BIGINT NOT NULL REFERENCES public.lots(id) ON DELETE CASCADE,
    company_id BIGINT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    PRIMARY KEY (lot_id, company_id)
  );

  CREATE TABLE IF NOT EXISTS public.items (
    id BIGSERIAL PRIMARY KEY,
    lot_id BIGINT NOT NULL REFERENCES public.lots(id) ON DELETE CASCADE,
    num TEXT,
    designation TEXT NOT NULL,
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
  CREATE INDEX IF NOT EXISTS idx_offers_item      ON public.offers(item_id);
  CREATE INDEX IF NOT EXISTS idx_offers_company   ON public.offers(company_id);
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS study_date DATE;
  `
}
