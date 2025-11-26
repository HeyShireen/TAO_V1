-- Migration 013: Modifier access_requests pour nom de projet en texte libre

-- Supprimer l'ancienne contrainte unique
ALTER TABLE access_requests DROP CONSTRAINT IF EXISTS access_requests_user_id_project_id_status_key;

-- Ajouter colonne pour nom de projet en texte libre
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS project_name TEXT;

-- Rendre project_id nullable (pour les nouvelles demandes avec nom uniquement)
ALTER TABLE access_requests ALTER COLUMN project_id DROP NOT NULL;

-- Nouvelle contrainte : un user ne peut avoir qu'une seule demande pending pour un même nom de projet
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_user_project_name_pending 
  ON access_requests(user_id, LOWER(project_name), status) 
  WHERE status = 'pending' AND project_name IS NOT NULL;

-- Contrainte pour les anciennes demandes avec project_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_user_project_id_pending 
  ON access_requests(user_id, project_id, status) 
  WHERE status = 'pending' AND project_id IS NOT NULL;
