-- Ajouter le message de commentaire automatique pour incohérence de montant importé

ALTER TABLE project_question_config
ADD COLUMN IF NOT EXISTS offer_amount_mismatch_comment TEXT DEFAULT 'Montant incohérent dans la DPGF : le montant importé est conservé.';
