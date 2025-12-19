-- Migration 018: Correction des tables options (recreation)
-- Suppress tables mal formées de la migration 017 et les recréer

DROP TABLE IF EXISTS public.option_item_offers CASCADE;
DROP TABLE IF EXISTS public.option_item_moe CASCADE;
DROP TABLE IF EXISTS public.option_items CASCADE;
DROP TABLE IF EXISTS public.options CASCADE;

-- Recréer correctement les tables options
CREATE TABLE IF NOT EXISTS public.options (
  id SERIAL PRIMARY KEY,
  lot_id INT NOT NULL REFERENCES public.lots(id) ON DELETE CASCADE,
  round_id INT NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  designation VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(lot_id, round_id, designation)
);

CREATE TABLE IF NOT EXISTS public.option_items (
  id SERIAL PRIMARY KEY,
  option_id INT NOT NULL REFERENCES public.options(id) ON DELETE CASCADE,
  num VARCHAR(50),
  designation VARCHAR(255),
  unit VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.option_item_moe (
  id SERIAL PRIMARY KEY,
  option_item_id INT NOT NULL REFERENCES public.option_items(id) ON DELETE CASCADE,
  qty DECIMAL(15, 4),
  unit_price DECIMAL(15, 4),
  UNIQUE(option_item_id)
);

CREATE TABLE IF NOT EXISTS public.option_item_offers (
  id SERIAL PRIMARY KEY,
  option_item_id INT NOT NULL REFERENCES public.option_items(id) ON DELETE CASCADE,
  company_id INT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  round_id INT NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  qty DECIMAL(15, 4),
  unit_price DECIMAL(15, 4),
  UNIQUE(option_item_id, company_id, round_id)
);

CREATE INDEX idx_options_lot_round ON public.options(lot_id, round_id);
CREATE INDEX idx_option_items_option ON public.option_items(option_id);
CREATE INDEX idx_option_item_offers_option_item ON public.option_item_offers(option_item_id);
