-- Migration: Supprimer la contrainte de clé étrangère sur projects.created_by
-- Raison: En mode développement sans authentification, req.user.id n'existe pas

-- Supprimer la contrainte de clé étrangère si elle existe
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_created_by_fkey;

-- Permettre NULL sur created_by (déjà le cas normalement mais on s'assure)
ALTER TABLE public.projects ALTER COLUMN created_by DROP NOT NULL;
