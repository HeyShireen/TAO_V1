-- Migration pour système RAO (Relevé d'Appel d'Offres)

-- Table des tours (ouverture, 1er tour, 2ème tour, etc.)
CREATE TABLE IF NOT EXISTS public.rounds (
  id BIGSERIAL PRIMARY KEY,
  lot_id BIGINT NOT NULL REFERENCES public.lots(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL, -- 0 = ouverture, 1 = 1er tour, 2 = 2ème tour, etc.
  name TEXT NOT NULL, -- "Ouverture des offres", "1er tour", "2ème tour"
  date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lot_id, round_number)
);

-- Table des fiches questions (générées automatiquement ou manuelles)
CREATE TABLE IF NOT EXISTS public.question_sheets (
  id BIGSERIAL PRIMARY KEY,
  round_id BIGINT NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  company_id BIGINT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  question_type TEXT NOT NULL, -- 'qty_difference', 'price_anomaly', 'manual'
  question TEXT NOT NULL,
  moe_qty NUMERIC, -- Quantité MOE au moment de la génération
  company_qty NUMERIC, -- Quantité entreprise au moment de la génération
  difference_percent NUMERIC, -- % d'écart
  response TEXT, -- Réponse de l'entreprise
  response_date DATE,
  status TEXT DEFAULT 'pending', -- 'pending', 'answered', 'resolved'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table historique des offres par tour (snapshot des offres à chaque tour)
CREATE TABLE IF NOT EXISTS public.round_offers (
  id BIGSERIAL PRIMARY KEY,
  round_id BIGINT NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  company_id BIGINT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit TEXT,
  qty NUMERIC,
  unit_price NUMERIC,
  amount NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, item_id, company_id)
);

-- Index pour optimiser les requêtes
CREATE INDEX IF NOT EXISTS idx_rounds_lot_id ON public.rounds(lot_id);
CREATE INDEX IF NOT EXISTS idx_question_sheets_round_id ON public.question_sheets(round_id);
CREATE INDEX IF NOT EXISTS idx_question_sheets_item_id ON public.question_sheets(item_id);
CREATE INDEX IF NOT EXISTS idx_question_sheets_company_id ON public.question_sheets(company_id);
CREATE INDEX IF NOT EXISTS idx_question_sheets_status ON public.question_sheets(status);
CREATE INDEX IF NOT EXISTS idx_round_offers_round_id ON public.round_offers(round_id);
CREATE INDEX IF NOT EXISTS idx_round_offers_item_company ON public.round_offers(round_id, item_id, company_id);

-- Fonction pour calculer le pourcentage de différence
CREATE OR REPLACE FUNCTION calculate_difference_percent(moe_value NUMERIC, company_value NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
  IF moe_value IS NULL OR moe_value = 0 THEN
    RETURN NULL;
  END IF;
  RETURN ROUND(((company_value - moe_value) / moe_value) * 100, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
