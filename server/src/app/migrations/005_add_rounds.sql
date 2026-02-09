-- Migration 005: Ajout du système de phases/tours

-- Vérifier et renommer l'ancienne table rounds si elle existe avec une structure différente
DO $$ 
BEGIN
  -- Si une table rounds existe déjà avec lot_id, on la renomme
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'rounds'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rounds' AND column_name = 'lot_id'
  ) THEN
    -- Sauvegarder les anciennes données
    DROP TABLE IF EXISTS rounds_old CASCADE;
    ALTER TABLE rounds RENAME TO rounds_old;
    
    -- Supprimer les tables dépendantes de l'ancien système
    DROP TABLE IF EXISTS question_sheets CASCADE;
    DROP TABLE IF EXISTS round_offers CASCADE;
  END IF;
END $$;

-- Table des tours/phases d'un projet
CREATE TABLE IF NOT EXISTS rounds (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL, -- 0=Ouverture, 1=1er tour, 2=2ème tour, etc.
  name VARCHAR(255) NOT NULL, -- ex: "Ouverture des offres", "1er tour", "2ème tour"
  description TEXT,
  status VARCHAR(50) DEFAULT 'active', -- active, closed, archived
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, round_number)
);

-- Associer les lots à un tour (un lot peut exister dans plusieurs tours)
CREATE TABLE IF NOT EXISTS round_lots (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  lot_id INTEGER NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(round_id, lot_id)
);

-- Modifier la table items pour supporter les tours
-- On garde les items comme "templates" et on créera des copies par tour
ALTER TABLE items ADD COLUMN IF NOT EXISTS round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE;

-- Modifier moe_items pour supporter les tours
ALTER TABLE moe_items ADD COLUMN IF NOT EXISTS round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE;

-- Modifier offers pour supporter les tours
ALTER TABLE offers ADD COLUMN IF NOT EXISTS round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE;

-- Modifier generated_questions pour supporter les tours
ALTER TABLE generated_questions ADD COLUMN IF NOT EXISTS round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE;

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_rounds_project ON rounds(project_id);
CREATE INDEX IF NOT EXISTS idx_round_lots_round ON round_lots(round_id);
CREATE INDEX IF NOT EXISTS idx_round_lots_lot ON round_lots(lot_id);
CREATE INDEX IF NOT EXISTS idx_items_round ON items(round_id);
CREATE INDEX IF NOT EXISTS idx_moe_items_round ON moe_items(round_id);
CREATE INDEX IF NOT EXISTS idx_offers_round ON offers(round_id);
CREATE INDEX IF NOT EXISTS idx_questions_round ON generated_questions(round_id);

-- Créer automatiquement un tour "Ouverture des offres" pour les projets existants
INSERT INTO rounds (project_id, round_number, name, status)
SELECT id, 0, 'Ouverture des offres', 'active'
FROM projects
WHERE NOT EXISTS (
  SELECT 1 FROM rounds WHERE rounds.project_id = projects.id
);

-- Associer tous les items/moe/offers existants au tour 0 (migration des données existantes)
UPDATE items SET round_id = (
  SELECT r.id FROM rounds r 
  JOIN lots l ON l.project_id = r.project_id 
  WHERE l.id = items.lot_id AND r.round_number = 0
  LIMIT 1
) WHERE round_id IS NULL;

UPDATE moe_items SET round_id = (
  SELECT r.id FROM rounds r 
  JOIN lots l ON l.project_id = r.project_id 
  JOIN items i ON i.id = moe_items.item_id
  WHERE l.id = i.lot_id AND r.round_number = 0
  LIMIT 1
) WHERE round_id IS NULL;

UPDATE offers SET round_id = (
  SELECT r.id FROM rounds r 
  JOIN lots l ON l.project_id = r.project_id 
  JOIN items i ON i.id = offers.item_id
  WHERE l.id = i.lot_id AND r.round_number = 0
  LIMIT 1
) WHERE round_id IS NULL;

UPDATE generated_questions SET round_id = (
  SELECT r.id FROM rounds r 
  JOIN lots l ON l.project_id = r.project_id 
  WHERE l.id = generated_questions.lot_id AND r.round_number = 0
  LIMIT 1
) WHERE round_id IS NULL;
