-- Script pour réinitialiser les migrations options
-- À exécuter si la migration 017 a déjà été appliquée mais avec des erreurs

-- 1. Supprimer les tables options si elles existent
DROP TABLE IF EXISTS public.option_item_offers CASCADE;
DROP TABLE IF EXISTS public.option_item_moe CASCADE;
DROP TABLE IF EXISTS public.option_items CASCADE;
DROP TABLE IF EXISTS public.options CASCADE;

-- 2. Supprimer la trace de migration
DELETE FROM public.migrations WHERE name = '017_add_options.sql';
