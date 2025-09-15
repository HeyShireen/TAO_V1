-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', -- 'admin' or 'user'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  reference TEXT,
  client TEXT,
  location TEXT,
  study_phase TEXT,
  study_date DATE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lots
CREATE TABLE IF NOT EXISTS lots (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Companies
CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  siret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Relation: companies participating in a lot
CREATE TABLE IF NOT EXISTS lot_companies (
  id SERIAL PRIMARY KEY,
  lot_id INTEGER NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  UNIQUE(lot_id, company_id)
);

-- Items (line items within a lot)
CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  lot_id INTEGER NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  num TEXT, -- 'Num' from your sheet
  designation TEXT NOT NULL,
  unit TEXT,
  position INTEGER, -- ordering
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- MOE estimate per item
CREATE TABLE IF NOT EXISTS moe_items (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  qty NUMERIC,
  unit_price NUMERIC,
  amount NUMERIC
);

-- Offers per company per item
CREATE TABLE IF NOT EXISTS offers (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  unit TEXT,
  qty NUMERIC,
  unit_price NUMERIC,
  amount NUMERIC,
  comment TEXT,
  UNIQUE(item_id, company_id)
);
