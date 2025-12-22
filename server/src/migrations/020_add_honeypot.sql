-- Migration 020: Honeypot anti-bots
-- Logging des tentatives de remplissage de champs honeypot

CREATE TABLE IF NOT EXISTS public.honeypot_attempts (
  id SERIAL PRIMARY KEY,
  ip_address VARCHAR(45),
  user_agent TEXT,
  endpoint VARCHAR(100),
  filled_fields JSONB,
  detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_honeypot_attempts_ip ON public.honeypot_attempts(ip_address);
CREATE INDEX idx_honeypot_attempts_detected_at ON public.honeypot_attempts(detected_at);
