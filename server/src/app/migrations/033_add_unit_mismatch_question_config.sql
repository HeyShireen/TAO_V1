-- Migration 033: Ajouter la question configurable pour les incohérences d'unité

ALTER TABLE project_question_config
ADD COLUMN IF NOT EXISTS question_unit_mismatch TEXT DEFAULT 'Pourquoi l''unité de chiffrage est-elle différente de l''unité MOE ({unit}) ?';
