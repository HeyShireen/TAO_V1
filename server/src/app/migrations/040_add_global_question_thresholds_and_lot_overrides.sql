-- Global thresholds live on the project config; lots only store overrides.

ALTER TABLE project_question_config
ADD COLUMN IF NOT EXISTS qty_very_low_threshold NUMERIC DEFAULT 25,
ADD COLUMN IF NOT EXISTS qty_low_threshold NUMERIC DEFAULT 10,
ADD COLUMN IF NOT EXISTS qty_high_threshold NUMERIC DEFAULT 10,
ADD COLUMN IF NOT EXISTS qty_very_high_threshold NUMERIC DEFAULT 25,
ADD COLUMN IF NOT EXISTS price_very_low_threshold NUMERIC DEFAULT 25,
ADD COLUMN IF NOT EXISTS price_low_threshold NUMERIC DEFAULT 10,
ADD COLUMN IF NOT EXISTS price_high_threshold NUMERIC DEFAULT 10,
ADD COLUMN IF NOT EXISTS price_very_high_threshold NUMERIC DEFAULT 25,
ADD COLUMN IF NOT EXISTS amount_very_low_threshold NUMERIC DEFAULT 25,
ADD COLUMN IF NOT EXISTS amount_low_threshold NUMERIC DEFAULT 10,
ADD COLUMN IF NOT EXISTS amount_high_threshold NUMERIC DEFAULT 10,
ADD COLUMN IF NOT EXISTS amount_very_high_threshold NUMERIC DEFAULT 25;

ALTER TABLE lot_threshold_config
ADD COLUMN IF NOT EXISTS qty_very_low_threshold_override BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS qty_low_threshold_override BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS qty_high_threshold_override BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS qty_very_high_threshold_override BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS price_very_low_threshold_override BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS price_low_threshold_override BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS price_high_threshold_override BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS price_very_high_threshold_override BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS amount_very_low_threshold_override BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS amount_low_threshold_override BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS amount_high_threshold_override BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS amount_very_high_threshold_override BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS lot_question_config (
  lot_id BIGINT PRIMARY KEY REFERENCES lots(id) ON DELETE CASCADE,
  question_qty_very_low TEXT,
  question_qty_very_low_override BOOLEAN DEFAULT false,
  question_qty_low TEXT,
  question_qty_low_override BOOLEAN DEFAULT false,
  question_qty_high TEXT,
  question_qty_high_override BOOLEAN DEFAULT false,
  question_qty_very_high TEXT,
  question_qty_very_high_override BOOLEAN DEFAULT false,
  question_price_very_low TEXT,
  question_price_very_low_override BOOLEAN DEFAULT false,
  question_price_low TEXT,
  question_price_low_override BOOLEAN DEFAULT false,
  question_price_high TEXT,
  question_price_high_override BOOLEAN DEFAULT false,
  question_price_very_high TEXT,
  question_price_very_high_override BOOLEAN DEFAULT false,
  question_amount_very_low TEXT,
  question_amount_very_low_override BOOLEAN DEFAULT false,
  question_amount_low TEXT,
  question_amount_low_override BOOLEAN DEFAULT false,
  question_amount_high TEXT,
  question_amount_high_override BOOLEAN DEFAULT false,
  question_amount_very_high TEXT,
  question_amount_very_high_override BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);

