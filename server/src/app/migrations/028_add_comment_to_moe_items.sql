-- Migration 028: Add comment column to moe_items
-- Permet de conserver les commentaires saisis dans les cellules de quantité, PU ou montant lors de l'importation

ALTER TABLE moe_items ADD COLUMN IF NOT EXISTS comment TEXT;
