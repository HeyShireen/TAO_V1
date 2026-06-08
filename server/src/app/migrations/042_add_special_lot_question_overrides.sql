-- Add per-lot overrides for the special question configuration fields.

ALTER TABLE lot_question_config
ADD COLUMN IF NOT EXISTS unanswered_comment TEXT,
ADD COLUMN IF NOT EXISTS unanswered_comment_override BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS unanswered_color TEXT,
ADD COLUMN IF NOT EXISTS unanswered_color_override BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS offer_amount_mismatch_comment TEXT,
ADD COLUMN IF NOT EXISTS offer_amount_mismatch_comment_override BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS question_unit_mismatch TEXT,
ADD COLUMN IF NOT EXISTS question_unit_mismatch_override BOOLEAN DEFAULT false;
