-- Migration 042: Ajout colonne unit dans option_item_offers
ALTER TABLE public.option_item_offers ADD COLUMN IF NOT EXISTS unit VARCHAR(50);
