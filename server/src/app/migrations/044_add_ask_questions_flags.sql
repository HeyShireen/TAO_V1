-- Migration 044: cases à cocher "poser ces questions" par catégorie
-- (quantité / prix / montant / sans réponse / unité / montant incohérent).
-- Valeur projet dans project_question_config, surcharge par lot dans lot_question_config.

ALTER TABLE project_question_config
  ADD COLUMN IF NOT EXISTS ask_questions_qty BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ask_questions_price BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ask_questions_amount BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ask_questions_unanswered BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ask_questions_unit_mismatch BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ask_questions_offer_amount_mismatch BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE lot_question_config
  ADD COLUMN IF NOT EXISTS ask_questions_qty BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ask_questions_qty_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ask_questions_price BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ask_questions_price_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ask_questions_amount BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ask_questions_amount_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ask_questions_unanswered BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ask_questions_unanswered_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ask_questions_unit_mismatch BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ask_questions_unit_mismatch_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ask_questions_offer_amount_mismatch BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ask_questions_offer_amount_mismatch_override BOOLEAN NOT NULL DEFAULT false;
