-- Migration: Add options as mini-lots with items and offers
-- Options are optional item bundles that can be toggled on/off in comparison
-- Each option has its own items (like a small lot) with MOE and offers per company

CREATE TABLE IF NOT EXISTS public.options (
  id SERIAL PRIMARY KEY,
  lot_id INT NOT NULL REFERENCES public.lots(id) ON DELETE CASCADE,
  round_id INT NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  designation VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(lot_id, round_id, designation)
);

-- Items dans une option (similaires aux items reguliers)
CREATE TABLE IF NOT EXISTS public.option_items (
  id SERIAL PRIMARY KEY,
  option_id INT NOT NULL REFERENCES public.options(id) ON DELETE CASCADE,
  num VARCHAR(50),
  designation VARCHAR(255),
  unit VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- MOE pour les items d'option
CREATE TABLE IF NOT EXISTS public.option_item_moe (
  id SERIAL PRIMARY KEY,
  option_item_id INT NOT NULL REFERENCES public.option_items(id) ON DELETE CASCADE,
  qty DECIMAL(15, 4),
  unit_price DECIMAL(15, 4),
  UNIQUE(option_item_id)
);

-- Offres pour les items d'option
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

