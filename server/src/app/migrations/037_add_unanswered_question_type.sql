-- Migration 037: Autoriser le type de question "reponse oubliee"

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
      'unit_mismatch',
      'unanswered',
      'manual'
    )
  ) NOT VALID;
