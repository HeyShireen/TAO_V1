-- Migration 030: Suivi des envois de fiches questions par email

-- Ajout du champ email sur les entreprises
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS email TEXT;

-- Table de suivi des envois de fiches questions
CREATE TABLE IF NOT EXISTS public.question_sheet_sends (
  id            BIGSERIAL PRIMARY KEY,
  lot_id        BIGINT NOT NULL REFERENCES public.lots(id) ON DELETE CASCADE,
  round_id      BIGINT NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  company_id    BIGINT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_by       BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  sent_to_email TEXT NOT NULL,
  email_subject TEXT,
  UNIQUE (lot_id, round_id, company_id, sent_at)
);

CREATE INDEX IF NOT EXISTS idx_qs_sends_lot_round ON public.question_sheet_sends(lot_id, round_id);
CREATE INDEX IF NOT EXISTS idx_qs_sends_company   ON public.question_sheet_sends(company_id);
