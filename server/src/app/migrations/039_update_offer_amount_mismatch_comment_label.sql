-- Remplacer l'ancien libellé ambigu pour les configurations projet existantes.

UPDATE project_question_config
SET offer_amount_mismatch_comment = 'Montant incohérent dans la DPGF : le montant importé est conservé.'
WHERE offer_amount_mismatch_comment = 'Montant total incohérent dans la DPGF : le montant importé est conservé.';
