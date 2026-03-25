-- Ajouter le regroupement de lots par macrolot
ALTER TABLE lots
ADD COLUMN IF NOT EXISTS macro_lot TEXT;

CREATE INDEX IF NOT EXISTS idx_lots_project_macro_lot
ON lots(project_id, macro_lot);
