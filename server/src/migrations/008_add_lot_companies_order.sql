-- Migration 008: Ajouter une colonne pour maintenir l'ordre d'insertion des entreprises dans les lots

DO $$ 
DECLARE
  rec RECORD;
  counter INTEGER;
BEGIN
  -- Ajouter une colonne created_at si elle n'existe pas
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'lot_companies' AND column_name = 'created_at'
  ) THEN
    RAISE NOTICE 'Ajout de created_at à lot_companies pour maintenir l''ordre d''insertion';
    ALTER TABLE lot_companies ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
    
    -- Mettre à jour les enregistrements existants avec un timestamp séquentiel
    -- On parcourt chaque lot et assigne des timestamps incrémentaux
    FOR rec IN (SELECT DISTINCT lot_id FROM lot_companies ORDER BY lot_id) LOOP
      counter := 0;
      FOR rec IN (SELECT lot_id, company_id FROM lot_companies WHERE lot_id = rec.lot_id ORDER BY company_id) LOOP
        UPDATE lot_companies 
        SET created_at = now() + (counter * INTERVAL '1 millisecond')
        WHERE lot_id = rec.lot_id AND company_id = rec.company_id;
        counter := counter + 1;
      END LOOP;
    END LOOP;
  END IF;

  RAISE NOTICE 'Migration 008 terminée: ordre d''insertion des entreprises maintenu';
END $$;
