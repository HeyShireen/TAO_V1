-- Migration 016: Ajouter un ordre d'affichage aux lots

ALTER TABLE lots ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Initialiser sort_order selon l'ordre actuel (par id)
UPDATE lots SET sort_order = id WHERE sort_order = 0;

-- Index pour les tris rapides
CREATE INDEX IF NOT EXISTS idx_lots_sort_order ON lots(project_id, sort_order);
