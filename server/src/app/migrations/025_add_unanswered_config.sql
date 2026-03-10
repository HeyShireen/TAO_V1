-- Ajouter les colonnes de configuration des articles sans réponse à project_question_config

ALTER TABLE project_question_config
ADD COLUMN IF NOT EXISTS unanswered_comment TEXT DEFAULT 'Article sans réponse',
ADD COLUMN IF NOT EXISTS unanswered_color TEXT DEFAULT '#fff3cd';
