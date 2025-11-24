-- Migration 009: Corriger la contrainte UNIQUE de offers pour inclure round_id
-- Les offres sont spécifiques à chaque tour, donc la contrainte doit inclure round_id

DO $$ 
BEGIN
  -- 1. Supprimer l'ancienne contrainte UNIQUE (item_id, company_id)
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'offers_item_id_company_id_key'
  ) THEN
    RAISE NOTICE 'Suppression de l''ancienne contrainte UNIQUE (item_id, company_id)';
    ALTER TABLE offers DROP CONSTRAINT offers_item_id_company_id_key;
  END IF;

  -- 2. Ajouter la nouvelle contrainte UNIQUE (item_id, company_id, round_id)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'offers_item_company_round_unique'
  ) THEN
    RAISE NOTICE 'Ajout de la nouvelle contrainte UNIQUE (item_id, company_id, round_id)';
    ALTER TABLE offers 
      ADD CONSTRAINT offers_item_company_round_unique 
      UNIQUE (item_id, company_id, round_id);
  END IF;

  RAISE NOTICE 'Migration 009 terminée: contrainte UNIQUE avec round_id sur offers';
END $$;
