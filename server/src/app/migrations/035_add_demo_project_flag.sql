-- Marque les projets visibles sur l'instance de demonstration commerciale.
ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_projects_is_demo
ON public.projects(is_demo);
