-- Migration 019: Ajout support refresh tokens avec rotation
-- Permet la révocation de tokens et refresh automatique sans re-login

CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  family VARCHAR(255), -- Groupe de tokens (détecte les rotations suspectes)
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  rotation_count INT DEFAULT 0
);

CREATE INDEX idx_refresh_tokens_user_id ON public.refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON public.refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_expires_at ON public.refresh_tokens(expires_at);

-- Table pour tracker les tentatives suspectes (réutilisation de refresh token)
CREATE TABLE IF NOT EXISTS public.suspicious_token_attempts (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_family VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent TEXT,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_suspicious_attempts_user_id ON public.suspicious_token_attempts(user_id);
CREATE INDEX idx_suspicious_attempts_attempted_at ON public.suspicious_token_attempts(attempted_at);
