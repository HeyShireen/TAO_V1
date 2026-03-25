-- Ajoute la colonne offer_designation à la table offers.
-- Stocke la désignation fournie par l'entreprise quand elle diffère de la désignation DPGF,
-- afin de l'afficher comme puce cliquable dans le tableau comparatif.
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS offer_designation TEXT;
