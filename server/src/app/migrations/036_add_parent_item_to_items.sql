-- Rattache les postes ajoutes par une entreprise a une ligne DPGF parente.
ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS parent_item_id BIGINT REFERENCES public.items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_items_parent_item
ON public.items(parent_item_id)
WHERE parent_item_id IS NOT NULL;
