-- Migration 006: Partager items et moe_items entre tous les tours
-- Les items et MOE sont désormais partagés au niveau du lot
-- Seules les offres restent spécifiques à chaque tour

-- 1. Supprimer round_id des items (garder les items du round 0 comme référence)
-- On garde uniquement les items du premier tour (round_number = 0) pour chaque lot
DO $$ 
BEGIN
  -- Supprimer les items dupliqués des tours > 0
  DELETE FROM items 
  WHERE round_id IN (
    SELECT r.id FROM rounds r WHERE r.round_number > 0
  );
  
  -- Supprimer la colonne round_id de items
  ALTER TABLE items DROP COLUMN IF EXISTS round_id;
  
  RAISE NOTICE 'Items sont maintenant partagés entre tous les tours';
END $$;

-- 2. Supprimer round_id des moe_items (garder les MOE du round 0)
DO $$ 
BEGIN
  -- Supprimer les moe_items dupliqués des tours > 0
  DELETE FROM moe_items 
  WHERE round_id IN (
    SELECT r.id FROM rounds r WHERE r.round_number > 0
  );
  
  -- Supprimer la colonne round_id de moe_items
  ALTER TABLE moe_items DROP COLUMN IF EXISTS round_id;
  
  RAISE NOTICE 'MOE items sont maintenant partagés entre tous les tours';
END $$;

-- 3. Vérifier que offers et generated_questions gardent leur round_id
-- (Ces tables restent spécifiques à chaque tour)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'offers' AND column_name = 'round_id'
  ) THEN
    RAISE EXCEPTION 'ERREUR: offers doit avoir un round_id';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'generated_questions' AND column_name = 'round_id'
  ) THEN
    RAISE NOTICE 'Ajout de round_id à generated_questions';
    ALTER TABLE generated_questions ADD COLUMN round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_questions_round ON generated_questions(round_id);
  END IF;
  
  RAISE NOTICE 'Offers et questions restent spécifiques à chaque tour';
END $$;

-- 4. Supprimer les anciens index devenus inutiles
DROP INDEX IF EXISTS idx_items_round;
DROP INDEX IF EXISTS idx_moe_items_round;

-- 5. Commentaires pour documentation
COMMENT ON TABLE items IS 'Articles d''un lot - PARTAGÉS entre tous les tours du projet';
COMMENT ON TABLE moe_items IS 'Estimation MOE - PARTAGÉE entre tous les tours du projet';
COMMENT ON TABLE offers IS 'Offres des entreprises - SPÉCIFIQUES à chaque tour';
COMMENT ON TABLE generated_questions IS 'Questions générées - SPÉCIFIQUES à chaque tour';
