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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS study_phase TEXT;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.lots (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  code TEXT,
  macro_lot TEXT,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.companies (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
  designation TEXT NOT NULL,
  unit TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- MOE (Main d'oeuvre estimée) stockée par item dans une table nommée "moe_items"
CREATE TABLE IF NOT EXISTS public.moe_items (
  item_id BIGINT NOT NULL PRIMARY KEY REFERENCES public.items(id) ON DELETE CASCADE,
  qty NUMERIC,
  unit_price NUMERIC,
  amount NUMERIC,
  comment TEXT
);

CREATE TABLE IF NOT EXISTS public.offers (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  company_id BIGINT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit TEXT,
  qty NUMERIC,
  unit_price NUMERIC,
  amount NUMERIC,
  comment TEXT,
  UNIQUE (item_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_lots_project_id ON public.lots(project_id);
CREATE INDEX IF NOT EXISTS idx_items_lot_id     ON public.items(lot_id);
CREATE INDEX IF NOT EXISTS idx_offers_item      ON public.offers(item_id);
CREATE INDEX IF NOT EXISTS idx_offers_company   ON public.offers(company_id);

-- Colonnes supplémentaires attendues par le code
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS study_phase TEXT;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS study_date DATE;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS created_by BIGINT;

-- Position dans items (ordre dans le tableur)
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS position INTEGER;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS source_company_id BIGINT REFERENCES public.companies(id) ON DELETE SET NULL;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS parent_item_id BIGINT REFERENCES public.items(id) ON DELETE SET NULL;
ALTER TABLE public.lots ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_lots_sort_order ON public.lots(project_id, sort_order);

-- Amount calculé sur offers (compatibilité)
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS amount NUMERIC;

-- Si une table 'moe' existait auparavant, on la laisse pour compatibilité mais on privilégie 'moe_items'
CREATE TABLE IF NOT EXISTS public.moe (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL UNIQUE REFERENCES public.items(id) ON DELETE CASCADE,
  qty NUMERIC,
  unit_price NUMERIC
);
