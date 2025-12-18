-- Migration 015: Ajouter la colonne lot_id dans generated_questions si elle manque

-- Step 1: Vérifier si la colonne existe déjà
DO $$
BEGIN
  -- Ajouter la colonne lot_id si elle n'existe pas (nullable pour commencer)
  ALTER TABLE generated_questions 
  ADD COLUMN IF NOT EXISTS lot_id BIGINT;
EXCEPTION WHEN duplicate_column THEN
  -- La colonne existe déjà
  NULL;
END $$;

-- Step 2: Remplir la colonne lot_id pour les enregistrements sans valeur
-- Utiliser une jointure simple avec round_lots
UPDATE generated_questions 
SET lot_id = rl.lot_id
FROM round_lots rl
WHERE generated_questions.round_id = rl.round_id 
  AND generated_questions.lot_id IS NULL;

-- Step 3: Si des questions n'ont toujours pas de lot_id, c'est une erreur de données
-- Mais on ne peut pas les rendre NOT NULL sans les résoudre d'abord
-- Pour l'instant, on laisse la colonne nullable

