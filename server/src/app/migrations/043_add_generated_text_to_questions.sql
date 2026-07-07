-- Migration 043: mémoriser la phrase auto-générée de chaque fiche question
-- pour pouvoir la substituer dans les textes édités manuellement lors des régénérations
-- (le texte édité garde les ajouts de l'utilisateur, seule la partie générée est mise à jour).

ALTER TABLE generated_questions
  ADD COLUMN IF NOT EXISTS generated_text TEXT;

-- Baseline pour les questions non éditées : leur texte actuel est la phrase générée.
-- Pour les questions éditées, la baseline sera posée à la prochaine régénération.
UPDATE generated_questions
SET generated_text = question_text
WHERE generated_text IS NULL
  AND COALESCE(manual_edited, false) = false;
