-- Migration 038: Preserve generated questions whose text was edited manually

ALTER TABLE generated_questions
  ADD COLUMN IF NOT EXISTS manual_edited BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_generated_questions_manual_edited
  ON generated_questions(manual_edited);
