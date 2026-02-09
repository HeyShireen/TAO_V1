-- Migration 010: Ajouter le système de rôles et de partage d'affaires

-- 1. Modifier la colonne role dans users pour avoir les 3 rôles
-- (admin, responsable, visionneur)
ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'visionneur';

-- Mettre à jour les utilisateurs existants: le premier utilisateur devient admin
DO $$
DECLARE
  first_user_id BIGINT;
BEGIN
  SELECT id INTO first_user_id FROM public.users ORDER BY id ASC LIMIT 1;
  IF first_user_id IS NOT NULL THEN
    UPDATE public.users SET role = 'admin' WHERE id = first_user_id;
  END IF;
END $$;

-- 2. Créer la table de partage de projets
CREATE TABLE IF NOT EXISTS public.project_shares (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  shared_with_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  can_view BOOLEAN NOT NULL DEFAULT true,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  shared_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, shared_with_user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_shares_project ON public.project_shares(project_id);
CREATE INDEX IF NOT EXISTS idx_project_shares_user ON public.project_shares(shared_with_user_id);

-- 3. Ajouter une colonne owner dans projects pour tracer le créateur
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS owner_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL;

-- Mettre à jour les projets existants: assigner au premier admin
DO $$
DECLARE
  admin_id BIGINT;
BEGIN
  SELECT id INTO admin_id FROM public.users WHERE role = 'admin' ORDER BY id ASC LIMIT 1;
  IF admin_id IS NOT NULL THEN
    UPDATE public.projects SET owner_id = admin_id WHERE owner_id IS NULL;
  END IF;
END $$;
