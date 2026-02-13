-- Migration 022: Ajouter un commentaire sur les offres

ALTER TABLE offers ADD COLUMN IF NOT EXISTS comment TEXT;
