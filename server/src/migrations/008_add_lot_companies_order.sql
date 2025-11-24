-- Migration 008: Ajouter une colonne pour maintenir l'ordre d'insertion des entreprises dans les lots

DO $$ 
BEGIN
  -- Ajouter une colonne created_at si elle n'existe pas
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'lot_companies' AND column_name = 'created_at'
  ) THEN
    RAISE NOTICE 'Ajout de created_at à lot_companies pour maintenir l''ordre d''insertion';
    ALTER TABLE lot_companies ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
    
    -- Mettre à jour les enregistrements existants avec un timestamp séquentiel
    UPDATE lot_companies SET created_at = now() + (row_number() OVER (PARTITION BY lot_id ORDER BY company_id)) * INTERVAL '1 millisecond';
  END IF;

  RAISE NOTICE 'Migration 008 terminée: ordre d''insertion des entreprises maintenu';
END $$;
