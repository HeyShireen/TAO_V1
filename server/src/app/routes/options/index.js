// server/src/routes/options.js
import express from 'express';
import { query, pool } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole, isResponsableOrAdmin } from '../../middleware/roles.js';
import { canViewProject, canEditProject } from '../../utils/permissions.js';

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

function parseGridNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/[â‚¬$Â£Â¥â‚¹]/g, '').replace(/[\u00A0\u202F\u2009\s]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 || lastDot > -1) {
    const last = Math.max(lastComma, lastDot);
    const decSep = s[last];
    s = s.replace(/[.,]/g, (m, idx) => (idx === last ? m : '')).replace(decSep, '.');
  }
  s = s.replace(/[^0-9.\-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Récupérer les options d'un lot avec leurs items et offres
router.get('/lot/:lotId', async (req, res) => {
  try {
    const { lotId } = req.params;
    const roundId = req.query.round_id;

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
          const offersRes = roundId
            ? await query(
              `SELECT oio.id, oio.option_item_id, oio.company_id, oio.qty, oio.unit_price, oio.round_id
               FROM option_item_offers oio
               WHERE oio.option_item_id = $1 AND oio.round_id = $2`,
              [item.id, Number(roundId)]
            )
            : await query(
              `SELECT oio.id, oio.option_item_id, oio.company_id, oio.qty, oio.unit_price, oio.round_id
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
router.post('/lot/:lotId', isResponsableOrAdmin, async (req, res) => {
  try {
    const { lotId } = req.params;
    const { round_id, designation } = req.body;

    // SÉCURITÉ: Vérifier accès en écriture
    const projectId = await getProjectIdForLot(lotId);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });

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

// Mettre à jour une option
router.put('/:optionId', isResponsableOrAdmin, async (req, res) => {
  try {
    const { optionId } = req.params;
    const { designation } = req.body;

    // SÉCURITÉ: Vérifier accès en écriture
    const lotId = await getLotIdForOption(optionId);
    if (!lotId) return res.status(404).json({ error: 'Option introuvable' });
    const projectId = await getProjectIdForLot(lotId);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });

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
router.delete('/:optionId', isResponsableOrAdmin, async (req, res) => {
  try {
    const { optionId } = req.params;

    // SÉCURITÉ: Vérifier accès en écriture
    const lotId = await getLotIdForOption(optionId);
    if (!lotId) return res.status(404).json({ error: 'Option introuvable' });
    const projectId = await getProjectIdForLot(lotId);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });

    await query('DELETE FROM options WHERE id = $1', [optionId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur suppression option:', err);
    res.status(500).json({ error: 'Impossible de supprimer l\'option' });
  }
});

// ===== Items dans une option =====

// Créer un item dans une option
router.post('/:optionId/items', isResponsableOrAdmin, async (req, res) => {
  try {
    const { optionId } = req.params;
    const { num, designation, unit, moe_qty, moe_unit_price } = req.body;

    // SÉCURITÉ: Vérifier accès en écriture
    const lotId = await getLotIdForOption(optionId);
    if (!lotId) return res.status(404).json({ error: 'Option introuvable' });
    const projectId = await getProjectIdForLot(lotId);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });

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
router.put('/items/:itemId', isResponsableOrAdmin, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { num, designation, unit, moe_qty, moe_unit_price } = req.body;

    // SÉCURITÉ: Vérifier accès en écriture
    const lotId = await getLotIdForOptionItem(itemId);
    if (!lotId) return res.status(404).json({ error: 'Item introuvable' });
    const projectId = await getProjectIdForLot(lotId);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });

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
router.delete('/items/:itemId', isResponsableOrAdmin, async (req, res) => {
  try {
    const { itemId } = req.params;

    // SÉCURITÉ: Vérifier accès en écriture
    const lotId = await getLotIdForOptionItem(itemId);
    if (!lotId) return res.status(404).json({ error: 'Item introuvable' });
    const projectId = await getProjectIdForLot(lotId);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });

    await query('DELETE FROM option_items WHERE id = $1', [itemId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur suppression item option:', err);
    res.status(500).json({ error: 'Impossible de supprimer l\'item' });
  }
});

// ===== Offres pour items d'option =====

// Créer/mettre à jour une offre pour un item d'option
router.post('/items/:itemId/offers', isResponsableOrAdmin, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { company_id, qty, unit_price, round_id } = req.body;

    if (!company_id || !round_id) {
      return res.status(400).json({ error: 'company_id et round_id requis' });
    }

    // SÉCURITÉ: Vérifier accès en écriture
    const lotId = await getLotIdForOptionItem(itemId);
    if (!lotId) return res.status(404).json({ error: 'Item introuvable' });
    const projectId = await getProjectIdForLot(lotId);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });

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
router.delete('/items/:itemId/offers/:company_id', isResponsableOrAdmin, async (req, res) => {
  try {
    const { itemId, company_id } = req.params;

    // SÉCURITÉ: Vérifier accès en écriture
    const lotId = await getLotIdForOptionItem(itemId);
    if (!lotId) return res.status(404).json({ error: 'Item introuvable' });
    const projectId = await getProjectIdForLot(lotId);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });

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

// ===== Sauvegarde groupée (bulk) des options =====
router.post('/lot/:lotId/save-grid', isResponsableOrAdmin, async (req, res) => {
  const lotId = Number(req.params.lotId);
  const { rows, round_id } = req.body || {};
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows[] requis' });
  if (!round_id) return res.status(400).json({ error: 'round_id requis' });

  const projectId = await getProjectIdForLot(lotId);
  if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
  const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
  if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });

  const roundId = Number(round_id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const resultItems = [];

    for (const r of rows) {
      const optionId = r.option_id ? Number(r.option_id) : null;
      let itemId = r.item_id ? Number(r.item_id) : null;
      const num = r.num ?? '';
      const designation = (r.designation ?? '').trim();
      const unit = r.unit ?? '';

      // Update or insert item
      if (itemId) {
        await client.query(
          'UPDATE option_items SET num=$1, designation=$2, unit=$3 WHERE id=$4',
          [num, designation, unit, itemId]
        );
      } else if (optionId) {
        const ins = await client.query(
          'INSERT INTO option_items (option_id, num, designation, unit) VALUES ($1,$2,$3,$4) RETURNING id',
          [optionId, num, designation, unit]
        );
        itemId = ins.rows[0].id;
      } else {
        continue;
      }

      // MOE
      let moeQty = null, moePu = null;
      moeQty = parseGridNumber(r.moe?.qty);
      moePu = parseGridNumber(r.moe?.pu);

      const moeExists = await client.query('SELECT id FROM option_item_moe WHERE option_item_id = $1', [itemId]);
      if (moeExists.rowCount > 0) {
        await client.query(
          'UPDATE option_item_moe SET qty=$1, unit_price=$2 WHERE option_item_id=$3',
          [moeQty, moePu, itemId]
        );
      } else if (moeQty != null || moePu != null) {
        await client.query(
          'INSERT INTO option_item_moe (option_item_id, qty, unit_price) VALUES ($1,$2,$3)',
          [itemId, moeQty, moePu]
        );
      }

      // Offers
      if (r.offers && typeof r.offers === 'object') {
        for (const [cid, val] of Object.entries(r.offers)) {
          const companyId = Number(cid);
          let oq = null, op = null;
          oq = parseGridNumber(val?.qty);
          op = parseGridNumber(val?.pu);

          const exists = await client.query(
            'SELECT id FROM option_item_offers WHERE option_item_id=$1 AND company_id=$2 AND round_id=$3',
            [itemId, companyId, roundId]
          );
          if (exists.rowCount > 0) {
            await client.query(
              'UPDATE option_item_offers SET qty=$1, unit_price=$2 WHERE option_item_id=$3 AND company_id=$4 AND round_id=$5',
              [oq, op, itemId, companyId, roundId]
            );
          } else {
            await client.query(
              'INSERT INTO option_item_offers (option_item_id, company_id, qty, unit_price, round_id) VALUES ($1,$2,$3,$4,$5)',
              [itemId, companyId, oq, op, roundId]
            );
          }
        }
      }

      resultItems.push({ id: itemId, option_id: optionId });
    }

    const keptItemIds = resultItems.map((item) => item.id).filter(Boolean);
    await client.query(
      `DELETE FROM option_items oi
       USING options o
       WHERE o.id = oi.option_id
         AND o.lot_id = $1
         AND NOT (oi.id = ANY($2::bigint[]))`,
      [lotId, keptItemIds]
    );

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

