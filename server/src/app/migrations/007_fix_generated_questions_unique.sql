-- Migration 007: Corriger la contrainte UNIQUE de generated_questions pour inclure round_id
-- Les questions générées sont spécifiques à chaque tour, donc la contrainte doit inclure round_id

DO $$ 
BEGIN
  -- 1. Vérifier que round_id existe (devrait être ajouté par migration 005/006)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'generated_questions' AND column_name = 'round_id'
  ) THEN
    RAISE NOTICE 'Ajout de round_id à generated_questions';
    ALTER TABLE generated_questions ADD COLUMN round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_questions_round ON generated_questions(round_id);
  END IF;

  -- 2. Supprimer l'ancienne contrainte UNIQUE sans round_id
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'generated_questions_lot_id_item_id_company_id_question_type_key'
  ) THEN
    RAISE NOTICE 'Suppression de l''ancienne contrainte UNIQUE sans round_id';
    ALTER TABLE generated_questions 
      DROP CONSTRAINT generated_questions_lot_id_item_id_company_id_question_type_key;
  END IF;

  -- 3. Ajouter la nouvelle contrainte UNIQUE avec round_id
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'generated_questions_round_lot_item_company_type_key'
  ) THEN
    RAISE NOTICE 'Ajout de la nouvelle contrainte UNIQUE avec round_id';
    ALTER TABLE generated_questions 
      ADD CONSTRAINT generated_questions_round_lot_item_company_type_key 
      UNIQUE (round_id, lot_id, item_id, company_id, question_type);
  END IF;

  RAISE NOTICE 'Migration 007 terminée: contrainte UNIQUE avec round_id';
END $$;
