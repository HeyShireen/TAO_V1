-- Configuration des questions au niveau projet
CREATE TABLE IF NOT EXISTS project_question_config (
  project_id BIGINT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  question_qty_low TEXT DEFAULT 'Pourquoi la quantité est-elle inférieure à la MOE ?',
  question_qty_high TEXT DEFAULT 'Pourquoi la quantité est-elle supérieure à la MOE ?',
  question_price_low TEXT DEFAULT 'Pourquoi le prix unitaire est-il inférieur à la MOE ?',
  question_price_high TEXT DEFAULT 'Pourquoi le prix unitaire est-il supérieur à la MOE ?',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Configuration des seuils au niveau lot
CREATE TABLE IF NOT EXISTS lot_threshold_config (
  lot_id BIGINT PRIMARY KEY REFERENCES lots(id) ON DELETE CASCADE,
  qty_low_threshold NUMERIC DEFAULT 10,  -- % écart en dessous duquel c'est "faible"
  qty_high_threshold NUMERIC DEFAULT 10, -- % écart au dessus duquel c'est "haut"
  price_low_threshold NUMERIC DEFAULT 10,
  price_high_threshold NUMERIC DEFAULT 10,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Fiches questions générées (liées au système RAO existant ou standalone)
CREATE TABLE IF NOT EXISTS generated_questions (
  id BIGSERIAL PRIMARY KEY,
  lot_id BIGINT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  question_type TEXT NOT NULL, -- 'qty_low', 'qty_high', 'price_low', 'price_high'
  question_text TEXT NOT NULL,
  moe_value NUMERIC,
  offer_value NUMERIC,
  deviation_pct NUMERIC,
  status TEXT DEFAULT 'pending', -- 'pending', 'answered', 'dismissed'
  answer TEXT,
  answered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (lot_id, item_id, company_id, question_type)
);

CREATE INDEX IF NOT EXISTS idx_generated_questions_lot ON generated_questions(lot_id);
CREATE INDEX IF NOT EXISTS idx_generated_questions_status ON generated_questions(status);
