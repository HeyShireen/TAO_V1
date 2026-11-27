// Routes options : mini-lots cochables (options, option_items, option_item_moe, option_item_offers)
import express from 'express';
import { query, pool } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { isResponsableOrAdmin } from '../../middleware/roles.js';
import { canViewProject, canEditProject } from '../../utils/permissions.js';
import { parseNumber } from '../../importers/import-utils.js';
import { companyScope } from '../../utils/company-scope.js';

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
    const scope = companyScope(req);
    const isEntreprise = scope.isEntreprise;
    if (scope.orphan) {
      return res.status(403).json({ error: 'Aucune entreprise associée à votre compte' });
    }

    // SÉCURITÉ: Vérifier accès au projet
    const projectId = await getProjectIdForLot(lotId);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canView = await canViewProject(req.user.id, projectId, req.user.role, scope.companyId);
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
    const optionIds = options.map(o => Number(o.id)).filter(Number.isFinite);

    // Lignes d'options et offres récupérées en 2 requêtes, quel que soit le
    // nombre d'options.
    //
    // La version précédente imbriquait trois niveaux de boucles : 1 requête par
    // option, puis 1 par ligne d'option. Sur un lot à 6 options et 95 lignes,
    // cela faisait une centaine d'allers-retours séquentiels.
    const itemsByOption = new Map();
    const offersByItem = new Map();

    if (optionIds.length > 0) {
      const itemsRes = await query(
        `SELECT oi.option_id, oi.id, oi.num, oi.designation, oi.unit,
                oim.qty AS moe_qty, oim.unit_price AS moe_unit_price
           FROM option_items oi
           LEFT JOIN option_item_moe oim ON oim.option_item_id = oi.id
          WHERE oi.option_id = ANY($1::int[])
          ORDER BY oi.option_id, oi.num ASC, oi.id ASC`,
        [optionIds]
      );

      const itemIds = itemsRes.rows.map(r => Number(r.id));
      if (itemIds.length > 0) {
        const params = [itemIds];
        let roundFilter = '';
        if (roundId) {
          params.push(Number(roundId));
          roundFilter = ` AND oio.round_id = $${params.length}`;
        }
        const offersRes = await query(
          `SELECT oio.id, oio.option_item_id, oio.company_id, oio.qty,
                  oio.unit_price, oio.unit, oio.round_id
             FROM option_item_offers oio
            WHERE oio.option_item_id = ANY($1::int[])${roundFilter}${scope.sqlAnd('oio.company_id')}`,
          params
        );
        for (const row of offersRes.rows) {
          const key = Number(row.option_item_id);
          if (!offersByItem.has(key)) offersByItem.set(key, []);
          offersByItem.get(key).push(row);
        }
      }

      for (const row of itemsRes.rows) {
        const key = Number(row.option_id);
        if (!itemsByOption.has(key)) itemsByOption.set(key, []);
        itemsByOption.get(key).push({
          id: row.id,
          num: row.num,
          designation: row.designation,
          unit: row.unit,
          // Les données MOE restent masquées pour le rôle entreprise.
          moe_qty: isEntreprise ? null : row.moe_qty,
          moe_unit_price: isEntreprise ? null : row.moe_unit_price,
          offers: offersByItem.get(Number(row.id)) || [],
        });
      }
    }

    const enriched = options.map(opt => ({
      ...opt,
      items: itemsByOption.get(Number(opt.id)) || [],
    }));

    res.json(enriched);
  } catch (err) {
    // Le message d'exception n'est pas renvoyé au client : il exposait la
    // structure interne (noms de tables, contraintes) à l'appelant.
    console.error('Erreur récupération options:', err.message, err.stack);
    res.status(500).json({ error: 'Impossible de récupérer les options' });
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

    // Options et articles autorisés pour ce lot/tour, récupérés UNE fois.
    //
    // Chaque ligne déclenchait auparavant sa propre requête de validation, plus
    // un upsert MOE et un upsert par entreprise. Les contrôles d'appartenance
    // sont désormais faits en mémoire sur ces deux ensembles, et les upserts
    // regroupés après la boucle. Les INSERT de nouvelles lignes restent
    // unitaires : il faut l'identifiant attribué par la base pour le renvoyer au
    // client, et `option_items` n'a pas de colonne d'ordre qui permettrait de
    // recorréler un insert groupé de façon fiable.
    const optionsValidesRes = await client.query(
      'SELECT id FROM options WHERE lot_id = $1 AND round_id = $2',
      [lotId, roundId]
    );
    const optionIdsValides = new Set(optionsValidesRes.rows.map(o => Number(o.id)));

    const optionIdByItemId = new Map();
    if (optionIdsValides.size > 0) {
      const itemsValidesRes = await client.query(
        'SELECT id, option_id FROM option_items WHERE option_id = ANY($1::int[])',
        [[...optionIdsValides]]
      );
      for (const row of itemsValidesRes.rows) {
        optionIdByItemId.set(Number(row.id), Number(row.option_id));
      }
    }

    const aMettreAJour = [];
    const moeAUpserter = [];
    const offresAUpserter = [];

    for (const r of rows) {
      const clientIndex = Number.isFinite(Number(r.index)) ? Number(r.index) : null;
      const optionId = r.option_id ? Number(r.option_id) : null;
      let itemId = r.item_id ? Number(r.item_id) : null;
      if (!optionId) continue;
      // L'option doit appartenir au lot et au tour visés.
      if (!optionIdsValides.has(optionId)) continue;

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
        // L'article doit appartenir exactement à l'option déclarée par le
        // client, et cette option au lot/tour : même contrôle qu'avant, fait
        // en mémoire au lieu d'un aller-retour par ligne.
        if (optionIdByItemId.get(itemId) !== optionId) continue;
        aMettreAJour.push({ id: itemId, num, designation, unit });
      } else {
        const ins = await client.query(
          'INSERT INTO option_items (option_id, num, designation, unit) VALUES ($1, $2, $3, $4) RETURNING id',
          [optionId, num, designation, unit]
        );
        itemId = ins.rows[0].id;
      }

      moeAUpserter.push({ itemId, qty: moeQty, pu: moePu });

      for (const [cid, val] of offerEntries) {
        const companyId = Number(cid);
        if (!Number.isFinite(companyId)) continue;
        offresAUpserter.push({
          itemId,
          companyId,
          qty: parseNumber(val?.qty),
          pu: parseNumber(val?.pu),
          unit: String(val?.u ?? '').trim() || null,
        });
      }

      resultItems.push({ index: clientIndex, id: itemId, option_id: optionId });
    }

    // UPDATE groupé des articles existants
    if (aMettreAJour.length > 0) {
      await client.query(
        `UPDATE option_items AS oi
            SET num = d.num, designation = d.designation, unit = d.unit
           FROM unnest($1::int[], $2::text[], $3::text[], $4::text[])
                AS d(id, num, designation, unit)
          WHERE oi.id = d.id`,
        [
          aMettreAJour.map(i => i.id),
          aMettreAJour.map(i => i.num),
          aMettreAJour.map(i => i.designation),
          aMettreAJour.map(i => i.unit),
        ]
      );
    }

    // Upsert MOE groupé. Déduplication par article : `ON CONFLICT DO UPDATE`
    // refuse de toucher deux fois la même ligne dans une seule instruction.
    if (moeAUpserter.length > 0) {
      const parItem = new Map(moeAUpserter.map(m => [Number(m.itemId), m]));
      const lignes = [...parItem.values()];
      await client.query(
        `INSERT INTO option_item_moe (option_item_id, qty, unit_price)
         SELECT d.item_id, d.qty, d.unit_price
           FROM unnest($1::int[], $2::numeric[], $3::numeric[])
                AS d(item_id, qty, unit_price)
         ON CONFLICT (option_item_id) DO UPDATE
           SET qty = EXCLUDED.qty, unit_price = EXCLUDED.unit_price`,
        [lignes.map(m => m.itemId), lignes.map(m => m.qty), lignes.map(m => m.pu)]
      );
    }

    // Upsert groupé des offres, dédupliqué sur la clé d'unicité.
    if (offresAUpserter.length > 0) {
      const parCle = new Map(
        offresAUpserter.map(o => [`${Number(o.itemId)}:${Number(o.companyId)}`, o])
      );
      const lignes = [...parCle.values()];
      await client.query(
        `INSERT INTO option_item_offers (option_item_id, company_id, round_id, qty, unit_price, unit)
         SELECT d.item_id, d.company_id, $1, d.qty, d.unit_price, d.unit
           FROM unnest($2::int[], $3::int[], $4::numeric[], $5::numeric[], $6::text[])
                AS d(item_id, company_id, qty, unit_price, unit)
         ON CONFLICT (option_item_id, company_id, round_id) DO UPDATE
           SET qty = EXCLUDED.qty, unit_price = EXCLUDED.unit_price, unit = EXCLUDED.unit`,
        [
          roundId,
          lignes.map(o => o.itemId),
          lignes.map(o => o.companyId),
          lignes.map(o => o.qty),
          lignes.map(o => o.pu),
          lignes.map(o => o.unit),
        ]
      );
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
