-- Ajouter les seuils très bas et très haut aux tables de configuration des questions

-- Ajouter les colonnes de questions "très bas" et "très haut" à project_question_config
ALTER TABLE project_question_config
ADD COLUMN IF NOT EXISTS question_qty_very_low TEXT DEFAULT 'Pourquoi la quantité est-elle bien inférieure à la MOE ?',
ADD COLUMN IF NOT EXISTS question_qty_very_high TEXT DEFAULT 'Pourquoi la quantité est-elle bien supérieure à la MOE ?',
ADD COLUMN IF NOT EXISTS question_price_very_low TEXT DEFAULT 'Pourquoi le prix unitaire est-il bien inférieur à la MOE ?',
ADD COLUMN IF NOT EXISTS question_price_very_high TEXT DEFAULT 'Pourquoi le prix unitaire est-il bien supérieur à la MOE ?';

-- Ajouter les seuils très bas et très haut à lot_threshold_config
ALTER TABLE lot_threshold_config
ADD COLUMN IF NOT EXISTS qty_very_low_threshold NUMERIC DEFAULT 25,
ADD COLUMN IF NOT EXISTS qty_very_high_threshold NUMERIC DEFAULT 25,
ADD COLUMN IF NOT EXISTS price_very_low_threshold NUMERIC DEFAULT 25,
ADD COLUMN IF NOT EXISTS price_very_high_threshold NUMERIC DEFAULT 25;

-- Mettre à jour la colonne question_type pour supporter les nouveaux types
ALTER TABLE generated_questions
ADD CONSTRAINT check_question_type CHECK (question_type IN ('qty_very_low', 'qty_low', 'qty_high', 'qty_very_high', 'price_very_low', 'price_low', 'price_high', 'price_very_high')) NOT VALID;
