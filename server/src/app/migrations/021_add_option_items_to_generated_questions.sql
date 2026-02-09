-- Migration 021: Support option items in generated_questions

ALTER TABLE generated_questions
  ADD COLUMN IF NOT EXISTS option_item_id BIGINT REFERENCES option_items(id) ON DELETE CASCADE;

ALTER TABLE generated_questions
  ALTER COLUMN item_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'generated_questions_round_lot_item_company_type_key'
  ) THEN
    ALTER TABLE generated_questions
      DROP CONSTRAINT generated_questions_round_lot_item_company_type_key;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'generated_questions_lot_id_item_id_company_id_question_type_key'
  ) THEN
    ALTER TABLE generated_questions
      DROP CONSTRAINT generated_questions_lot_id_item_id_company_id_question_type_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_questions_item_unique
  ON generated_questions (round_id, lot_id, item_id, company_id, question_type)
  WHERE item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_questions_option_item_unique
  ON generated_questions (round_id, lot_id, option_item_id, company_id, question_type)
  WHERE option_item_id IS NOT NULL;

ALTER TABLE generated_questions
  ADD CONSTRAINT generated_questions_item_or_option_check
  CHECK (
    (item_id IS NOT NULL AND option_item_id IS NULL)
    OR (item_id IS NULL AND option_item_id IS NOT NULL)
  );
