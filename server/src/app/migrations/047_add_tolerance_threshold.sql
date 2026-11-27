-- Migration 047 : taux de tolérance (seuil de matérialité).
--
-- Règle métier, héritée du fonctionnement Excel antérieur au logiciel :
-- on compare l'IMPORTANCE d'un article au montant total du lot. Si le poids de
-- l'article est inférieur au taux, aucune question automatique d'écart n'est
-- posée dessus. Exemple : un article à 1 € dans un lot à 100 000 € pèse
-- 0,001 % et ne mérite pas de question, quel que soit son écart en pourcentage.
--
-- Ce n'est PAS un treizième seuil d'écart : c'est un filtre EN AMONT, qui
-- décide si l'article mérite qu'on regarde ses écarts. Objectif : réduire le
-- bruit dans les fiches questions.
--
-- Valeur par défaut 0 = désactivé. Appliquer cette migration ne change donc
-- aucun comportement tant qu'un taux n'est pas configuré.
--
-- Cascade projet -> lot, sur le modèle des migrations 040 et 044.

-- Disponibilite : ADD COLUMN a defaut constant ne reecrit pas la table
-- (PostgreSQL >= 11), mais prend brievement un verrou ACCESS EXCLUSIVE. Si ce
-- verrou n est pas obtenu tout de suite, toutes les requetes suivantes sur la
-- table s empilent derriere lui. On prefere donc un echec propre a un
-- bouchon : au-dela de 3 s, la transaction est annulee et il suffit de
-- relancer la migration plus tard. SET LOCAL expire au COMMIT.
SET LOCAL lock_timeout = '3s';

ALTER TABLE project_question_config
  ADD COLUMN IF NOT EXISTS tolerance_pct NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE lot_question_config
  ADD COLUMN IF NOT EXISTS tolerance_pct NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tolerance_pct_override BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN project_question_config.tolerance_pct IS
  'Seuil de matérialité en %% du total MOE du lot. En dessous, aucune question d''écart (qty/price/amount) n''est générée pour l''article. 0 = désactivé.';
