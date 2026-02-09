-- 010_add_user_company.sql
-- Ajoute la colonne company_id sur users pour lier un utilisateur 'entreprise' à sa société
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
-- Index optionnel pour recherches
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
