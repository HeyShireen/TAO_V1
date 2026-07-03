// Routes options : mini-lots cochables (options, option_items, option_item_moe, option_item_offers)
import express from 'express';
import { query, pool } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { isResponsableOrAdmin } from '../../middleware/roles.js';
import { canViewProject, canEditProject } from '../../utils/permissions.js';
import { parseNumber } from '../../importers/import-utils.js';

const router = express.Router();
router.use(requireAuth);

// Helper: Résoudre le project_id d'un lot
async function getProjectIdForLot(lotId) {
  const result = await query('SELECT project_id FROM lots WHERE id = $1', [lotId]);
  return result.rows[0]?.project_id || null;
}

// Helper: Résoudre le lot_id d'une option
async function getLotIdForOption(optionId) {
  const result = await query('SELECT lot_id FROM options WHERE id = $1', [optionId]);
  return result.rows[0]?.lot_id || null;
}

// Helper: Résoudre le lot_id d'un option_item
async function getLotIdForOptionItem(itemId) {
  const result = await query(
    'SELECT o.lot_id FROM option_items oi JOIN options o ON o.id = oi.option_id WHERE oi.id = $1',
    [itemId]
  );
  return result.rows[0]?.lot_id || null;
}

// Helper: Vérifier l'accès en écriture au lot ; renvoie le project_id ou null
async function assertCanEditLot(req, res, lotId) {
  const projectId = await getProjectIdForLot(lotId);
  if (!projectId) {
    res.status(404).json({ error: 'Lot introuvable' });
    return null;
  }
  const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
  if (!canEdit) {
    res.status(403).json({ error: 'Accès refusé' });
    return null;
  }
  return projectId;
}

// Récupérer les options d'un lot avec leurs items et offres
router.get('/lot/:lotId', async (req, res) => {
  try {
    const { lotId } = req.params;
    const roundId = req.query.round_id;
    const isEntreprise = req.user?.role === 'entreprise';
    const userCompanyId = req.user?.company_id || null;

    // SÉCURITÉ: Vérifier accès au projet
    const projectId = await getProjectIdForLot(lotId);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canView = await canViewProject(req.user.id, projectId, req.user.role, req.user.company_id || null);
    if (!canView) return res.status(403).json({ error: 'Accès refusé' });

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
        const offersRes = roundId
          ? await query(
            `SELECT oio.id, oio.option_item_id, oio.company_id, oio.qty, oio.unit_price, oio.unit, oio.round_id
             FROM option_item_offers oio
             WHERE oio.option_item_id = $1 AND oio.round_id = $2
               ${isEntreprise && userCompanyId ? 'AND oio.company_id = $3' : ''}`,
            isEntreprise && userCompanyId ? [item.id, Number(roundId), userCompanyId] : [item.id, Number(roundId)]
          )
          : await query(
            `SELECT oio.id, oio.option_item_id, oio.company_id, oio.qty, oio.unit_price, oio.unit, oio.round_id
             FROM option_item_offers oio
             WHERE oio.option_item_id = $1
               ${isEntreprise && userCompanyId ? 'AND oio.company_id = $2' : ''}`,
            isEntreprise && userCompanyId ? [item.id, userCompanyId] : [item.id]
          );
        itemsWithOffers.push({
          ...item,
          moe_qty: isEntreprise ? null : item.moe_qty,
          moe_unit_price: isEntreprise ? null : item.moe_unit_price,
          offers: offersRes.rows
        });
      }

      enriched.push({
        ...opt,
        items: itemsWithOffers
      });
    }

    res.json(enriched);
  } catch (err) {
    console.error('Erreur récupération options:', err.message, err.stack);
    res.status(500).json({ error: 'Impossible de récupérer les options: ' + err.message });
  }
});

// Créer une option
router.post('/lot/:lotId', isResponsableOrAdmin, async (req, res) => {
  try {
    const { lotId } = req.params;
    const { round_id, designation } = req.body;

    if (!(await assertCanEditLot(req, res, lotId))) return;

    const cleanDesignation = designation ? String(designation).trim() : '';

    if (!cleanDesignation) {
      return res.status(400).json({ error: 'Désignation requise' });
    }

    if (!round_id) {
      return res.status(400).json({ error: 'round_id requis' });
    }

    const exists = await query(
      `SELECT id FROM options
       WHERE lot_id = $1 AND round_id = $2 AND LOWER(designation) = LOWER($3)
       LIMIT 1`,
      [lotId, round_id, cleanDesignation]
    );
    if (exists.rowCount > 0) {
      return res.status(409).json({ error: 'Une option avec cette désignation existe déjà pour ce tour.' });
    }

    const result = await query(
      `INSERT INTO options (lot_id, round_id, designation)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [lotId, round_id, cleanDesignation]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur création option:', err);
    res.status(500).json({ error: 'Impossible de créer l\'option' });
  }
});

// Renommer une option
router.put('/:optionId', isResponsableOrAdmin, async (req, res) => {
  try {
    const { optionId } = req.params;
    const { designation } = req.body;

    const lotId = await getLotIdForOption(optionId);
    if (!lotId) return res.status(404).json({ error: 'Option introuvable' });
    if (!(await assertCanEditLot(req, res, lotId))) return;

    const cleanDesignation = designation ? String(designation).trim() : '';
    if (!cleanDesignation) {
      return res.status(400).json({ error: 'Désignation requise' });
    }

    const result = await query(
      `UPDATE options
       SET designation = $1
       WHERE id = $2
       RETURNING *`,
      [cleanDesignation, optionId]
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

// Supprimer une option (et ses items/MOE/offres en cascade)
router.delete('/:optionId', isResponsableOrAdmin, async (req, res) => {
  try {
    const { optionId } = req.params;

    const lotId = await getLotIdForOption(optionId);
    if (!lotId) return res.status(404).json({ error: 'Option introuvable' });
    if (!(await assertCanEditLot(req, res, lotId))) return;

    await query('DELETE FROM options WHERE id = $1', [optionId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur suppression option:', err);
    res.status(500).json({ error: 'Impossible de supprimer l\'option' });
  }
});

// Supprimer un item d'option (seule voie de suppression d'une ligne du tableur)
router.delete('/items/:itemId', isResponsableOrAdmin, async (req, res) => {
  try {
    const { itemId } = req.params;

    const lotId = await getLotIdForOptionItem(itemId);
    if (!lotId) return res.status(404).json({ error: 'Item introuvable' });
    if (!(await assertCanEditLot(req, res, lotId))) return;

    await query('DELETE FROM option_items WHERE id = $1', [itemId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur suppression item option:', err);
    res.status(500).json({ error: 'Impossible de supprimer l\'item' });
  }
});

// ===== Sauvegarde groupée (bulk) du tableur options =====
// Upsert uniquement : la suppression de lignes passe exclusivement par
// DELETE /options/items/:id. (L'ancienne purge des items absents du payload
// supprimait des articles au moindre désalignement client/serveur.)
// Chaque ligne porte un `index` client, renvoyé tel quel pour synchroniser
// les ids des lignes nouvellement créées sans risque de décalage.
router.post('/lot/:lotId/save-grid', isResponsableOrAdmin, async (req, res) => {
  const lotId = Number(req.params.lotId);
  const { rows, round_id } = req.body || {};
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows[] requis' });
  if (!round_id) return res.status(400).json({ error: 'round_id requis' });

  if (!(await assertCanEditLot(req, res, lotId))) return;

  const roundId = Number(round_id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const resultItems = [];

    for (const r of rows) {
      const clientIndex = Number.isFinite(Number(r.index)) ? Number(r.index) : null;
      const optionId = r.option_id ? Number(r.option_id) : null;
      let itemId = r.item_id ? Number(r.item_id) : null;
      if (!optionId) continue;

      const num = String(r.num ?? '').trim();
      const designation = String(r.designation ?? '').trim();
      const unit = String(r.unit ?? '').trim();
      const moeQty = parseNumber(r.moe?.qty);
      const moePu = parseNumber(r.moe?.pu);
      const offerEntries = Object.entries(r.offers && typeof r.offers === 'object' ? r.offers : {});
      const hasOfferData = offerEntries.some(([, v]) =>
        parseNumber(v?.qty) != null || parseNumber(v?.pu) != null || String(v?.u ?? '').trim() !== ''
      );

      // Ne jamais créer d'article pour une ligne neuve entièrement vide
      const isEmpty = !num && !designation && !unit && moeQty == null && moePu == null && !hasOfferData;
      if (!itemId && isEmpty) continue;

      if (itemId) {
        const upd = await client.query(
          `UPDATE option_items oi
           SET num = $1, designation = $2, unit = $3
           FROM options o
           WHERE oi.id = $4
             AND o.id = oi.option_id
             AND oi.option_id = $5
             AND o.lot_id = $6
             AND o.round_id = $7
           RETURNING oi.id`,
          [num, designation, unit, itemId, optionId, lotId, roundId]
        );
        if (upd.rowCount === 0) continue; // item n'appartenant pas à ce lot/tour → ignoré
      } else {
        const optCheck = await client.query(
          'SELECT id FROM options WHERE id = $1 AND lot_id = $2 AND round_id = $3',
          [optionId, lotId, roundId]
        );
        if (optCheck.rowCount === 0) continue;
        const ins = await client.query(
          'INSERT INTO option_items (option_id, num, designation, unit) VALUES ($1, $2, $3, $4) RETURNING id',
          [optionId, num, designation, unit]
        );
        itemId = ins.rows[0].id;
      }

      // MOE (une ligne par item : UNIQUE(option_item_id))
      await client.query(
        `INSERT INTO option_item_moe (option_item_id, qty, unit_price)
         VALUES ($1, $2, $3)
         ON CONFLICT (option_item_id) DO UPDATE SET qty = EXCLUDED.qty, unit_price = EXCLUDED.unit_price`,
        [itemId, moeQty, moePu]
      );

      // Offres entreprises
      for (const [cid, val] of offerEntries) {
        const companyId = Number(cid);
        if (!Number.isFinite(companyId)) continue;
        const offerQty = parseNumber(val?.qty);
        const offerPu = parseNumber(val?.pu);
        const offerUnit = String(val?.u ?? '').trim() || null;
        await client.query(
          `INSERT INTO option_item_offers (option_item_id, company_id, round_id, qty, unit_price, unit)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (option_item_id, company_id, round_id) DO UPDATE
           SET qty = EXCLUDED.qty, unit_price = EXCLUDED.unit_price, unit = EXCLUDED.unit`,
          [itemId, companyId, roundId, offerQty, offerPu, offerUnit]
        );
      }

      resultItems.push({ index: clientIndex, id: itemId, option_id: optionId });
    }

    await client.query('COMMIT');
    res.json({ ok: true, items: resultItems });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Erreur options save-grid:', e);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde des options' });
  } finally {
    client.release();
  }
});

export default router;
