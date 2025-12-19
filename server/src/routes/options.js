// server/src/routes/options.js
import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware.auth.js';

const router = express.Router();
router.use(requireAuth);

// Récupérer les options d'un lot avec leurs items et offres
router.get('/lot/:lotId', async (req, res) => {
  try {
    const { lotId } = req.params;
    const roundId = req.query.round_id;

    // Récupérer les options
    let optionsRes;
    if (roundId) {
      optionsRes = await query(
        'SELECT * FROM options WHERE lot_id = $1 AND round_id = $2 ORDER BY created_at ASC',
        [lotId, roundId]
      );
    } else {
      optionsRes = await query(
        'SELECT * FROM options WHERE lot_id = $1 ORDER BY created_at ASC',
        [lotId]
      );
    }

    const options = optionsRes.rows;
    
    // Pour chaque option, récupérer ses items et offres
    const enriched = [];
    for (const opt of options) {
      try {
        const itemsRes = await query(
          `SELECT oi.id, oi.num, oi.designation, oi.unit,
                  oim.qty as moe_qty, oim.unit_price as moe_unit_price
           FROM option_items oi
           LEFT JOIN option_item_moe oim ON oim.option_item_id = oi.id
           WHERE oi.option_id = $1
           ORDER BY oi.num ASC, oi.id ASC`,
          [opt.id]
        );

        // Pour chaque item, récupérer ses offres
        const itemsWithOffers = [];
        for (const item of itemsRes.rows) {
          const offersRes = await query(
            `SELECT oio.id, oio.option_item_id, oio.company_id, oio.qty, oio.unit_price
             FROM option_item_offers oio
             WHERE oio.option_item_id = $1`,
            [item.id]
          );
          itemsWithOffers.push({
            ...item,
            offers: offersRes.rows
          });
        }

        enriched.push({
          ...opt,
          items: itemsWithOffers
        });
      } catch (err) {
        console.error(`Erreur en chargeant l'option ${opt.id}:`, err.message);
        throw err;
      }
    }

    res.json(enriched);
  } catch (err) {
    console.error('Erreur récupération options:', err.message, err.stack);
    res.status(500).json({ error: 'Impossible de récupérer les options: ' + err.message });
  }
});

// Créer une option
router.post('/lot/:lotId', async (req, res) => {
  try {
    const { lotId } = req.params;
    const { round_id, designation } = req.body;

    if (!designation) {
      return res.status(400).json({ error: 'Désignation requise' });
    }

    const result = await query(
      `INSERT INTO options (lot_id, round_id, designation)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [lotId, round_id, designation]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur création option:', err);
    res.status(500).json({ error: 'Impossible de créer l\'option' });
  }
});

// Mettre à jour une option
router.put('/:optionId', async (req, res) => {
  try {
    const { optionId } = req.params;
    const { designation } = req.body;

    const result = await query(
      `UPDATE options
       SET designation = $1
       WHERE id = $2
       RETURNING *`,
      [designation, optionId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Option introuvable' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur mise à jour option:', err);
    res.status(500).json({ error: 'Impossible de mettre à jour l\'option' });
  }
});

// Supprimer une option
router.delete('/:optionId', async (req, res) => {
  try {
    const { optionId } = req.params;
    await query('DELETE FROM options WHERE id = $1', [optionId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur suppression option:', err);
    res.status(500).json({ error: 'Impossible de supprimer l\'option' });
  }
});

// ===== Items dans une option =====

// Créer un item dans une option
router.post('/:optionId/items', async (req, res) => {
  try {
    const { optionId } = req.params;
    const { num, designation, unit, moe_qty, moe_unit_price } = req.body;

    const itemRes = await query(
      `INSERT INTO option_items (option_id, num, designation, unit)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [optionId, num, designation, unit]
    );

    const itemId = itemRes.rows[0].id;

    // Ajouter la MOE si fournie
    if (moe_qty != null && moe_unit_price != null) {
      await query(
        `INSERT INTO option_item_moe (option_item_id, qty, unit_price)
         VALUES ($1, $2, $3)`,
        [itemId, moe_qty, moe_unit_price]
      );
    }

    res.json({ ...itemRes.rows[0], moe_qty, moe_unit_price, offers: [] });
  } catch (err) {
    console.error('Erreur création item option:', err);
    res.status(500).json({ error: 'Impossible de créer l\'item' });
  }
});

// Mettre à jour un item d'option
router.put('/items/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { num, designation, unit, moe_qty, moe_unit_price } = req.body;

    const itemRes = await query(
      `UPDATE option_items
       SET num = $1, designation = $2, unit = $3
       WHERE id = $4
       RETURNING *`,
      [num, designation, unit, itemId]
    );

    if (itemRes.rowCount === 0) {
      return res.status(404).json({ error: 'Item introuvable' });
    }

    // Mettre à jour ou créer la MOE
    if (moe_qty != null && moe_unit_price != null) {
      const moeRes = await query(
        'SELECT id FROM option_item_moe WHERE option_item_id = $1',
        [itemId]
      );
      if (moeRes.rowCount > 0) {
        await query(
          `UPDATE option_item_moe SET qty = $1, unit_price = $2 WHERE option_item_id = $3`,
          [moe_qty, moe_unit_price, itemId]
        );
      } else {
        await query(
          `INSERT INTO option_item_moe (option_item_id, qty, unit_price) VALUES ($1, $2, $3)`,
          [itemId, moe_qty, moe_unit_price]
        );
      }
    }

    res.json({ ...itemRes.rows[0], moe_qty, moe_unit_price });
  } catch (err) {
    console.error('Erreur mise à jour item option:', err);
    res.status(500).json({ error: 'Impossible de mettre à jour l\'item' });
  }
});

// Supprimer un item d'option
router.delete('/items/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    await query('DELETE FROM option_items WHERE id = $1', [itemId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur suppression item option:', err);
    res.status(500).json({ error: 'Impossible de supprimer l\'item' });
  }
});

// ===== Offres pour items d'option =====

// Créer/mettre à jour une offre pour un item d'option
router.post('/items/:itemId/offers', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { company_id, qty, unit_price, round_id } = req.body;

    if (!company_id || !round_id) {
      return res.status(400).json({ error: 'company_id et round_id requis' });
    }

    // Vérifier si l'offre existe
    const existingRes = await query(
      'SELECT id FROM option_item_offers WHERE option_item_id = $1 AND company_id = $2 AND round_id = $3',
      [itemId, company_id, round_id]
    );

    let result;
    if (existingRes.rowCount > 0) {
      result = await query(
        `UPDATE option_item_offers
         SET qty = $1, unit_price = $2
         WHERE option_item_id = $3 AND company_id = $4 AND round_id = $5
         RETURNING *`,
        [qty, unit_price, itemId, company_id, round_id]
      );
    } else {
      result = await query(
        `INSERT INTO option_item_offers (option_item_id, company_id, qty, unit_price, round_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [itemId, company_id, qty, unit_price, round_id]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur création/maj offre item option:', err);
    res.status(500).json({ error: 'Impossible de sauvegarder l\'offre' });
  }
});

// Supprimer une offre d'item option
router.delete('/items/:itemId/offers/:company_id', async (req, res) => {
  try {
    const { itemId, company_id } = req.params;
    await query(
      'DELETE FROM option_item_offers WHERE option_item_id = $1 AND company_id = $2',
      [itemId, company_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur suppression offre item option:', err);
    res.status(500).json({ error: 'Impossible de supprimer l\'offre' });
  }
});

export default router;

