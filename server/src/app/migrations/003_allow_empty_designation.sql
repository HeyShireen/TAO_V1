-- Migration: Permettre les désignations vides pour préserver l'espacement DPGF
-- Raison: Les DPGF ont souvent des lignes vides pour l'espacement visuel

-- Permettre NULL sur designation
ALTER TABLE public.items ALTER COLUMN designation DROP NOT NULL;
