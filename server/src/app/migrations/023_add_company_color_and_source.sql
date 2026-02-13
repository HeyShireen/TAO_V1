-- Migration 023: Ajouter couleur aux entreprises + source_company_id aux items
-- La couleur permet d'identifier visuellement chaque entreprise dans le tableau
-- source_company_id marque les articles ajoutés par une entreprise (pas dans la DPGF MOE)

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS color TEXT;

-- Items ajoutés par une entreprise (postes supplémentaires hors DPGF)
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS source_company_id BIGINT REFERENCES public.companies(id) ON DELETE SET NULL;

-- Index pour retrouver rapidement les items ajoutés par une entreprise
CREATE INDEX IF NOT EXISTS idx_items_source_company ON public.items(source_company_id) WHERE source_company_id IS NOT NULL;
