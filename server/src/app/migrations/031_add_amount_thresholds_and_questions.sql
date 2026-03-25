-- Migration 031: Ajouter les seuils/questions de montant et étendre les types de fiches

ALTER TABLE project_question_config
ADD COLUMN IF NOT EXISTS question_amount_very_low TEXT DEFAULT 'Pourquoi le montant est-il bien inférieur à la MOE ?',
ADD COLUMN IF NOT EXISTS question_amount_low TEXT DEFAULT 'Pourquoi le montant est-il inférieur à la MOE ?',
ADD COLUMN IF NOT EXISTS question_amount_high TEXT DEFAULT 'Pourquoi le montant est-il supérieur à la MOE ?',
ADD COLUMN IF NOT EXISTS question_amount_very_high TEXT DEFAULT 'Pourquoi le montant est-il bien supérieur à la MOE ?';

ALTER TABLE lot_threshold_config
ADD COLUMN IF NOT EXISTS amount_very_low_threshold NUMERIC DEFAULT 25,
ADD COLUMN IF NOT EXISTS amount_low_threshold NUMERIC DEFAULT 10,
ADD COLUMN IF NOT EXISTS amount_high_threshold NUMERIC DEFAULT 10,
ADD COLUMN IF NOT EXISTS amount_very_high_threshold NUMERIC DEFAULT 25;

ALTER TABLE generated_questions
  DROP CONSTRAINT IF EXISTS check_question_type;

ALTER TABLE generated_questions
  ADD CONSTRAINT check_question_type
  CHECK (
    question_type IN (
      'qty_very_low',
      'qty_low',
      'qty_high',
      'qty_very_high',
      'price_very_low',
      'price_low',
      'price_high',
      'price_very_high',
      'amount_very_low',
      'amount_low',
      'amount_high',
      'amount_very_high',
      'manual'
    )
  ) NOT VALID;
