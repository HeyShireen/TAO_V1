import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { query, pool } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole, isResponsableOrAdmin } from '../../middleware/roles.js';
import { canViewProject, canEditProject } from '../../utils/permissions.js';
import { previewExcel, applyImport, convertPdfToExcelBuffer } from '../../importers/smart-import.js';

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10 Mo max
const router = express.Router();
router.use(requireAuth);

// Cache temporaire des fichiers import (preview → apply sans re-upload)
const tempFileCache = new Map();
const TEMP_FILE_TTL = 10 * 60 * 1000; // 10 minutes
function cacheTempFile(buffer, meta) {
  const id = crypto.randomUUID();
  tempFileCache.set(id, { buffer, ts: Date.now(), ...meta });
  // Nettoyage des vieux fichiers
  for (const [k, v] of tempFileCache) {
    if (Date.now() - v.ts > TEMP_FILE_TTL) tempFileCache.delete(k);
  }
  return id;
}
function getTempFile(id) {
  const entry = tempFileCache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.ts > TEMP_FILE_TTL) { tempFileCache.delete(id); return null; }
  return entry;
}

// Helper: Résoudre le project_id d'un lot
async function getProjectIdForLot(lotId) {
  const result = await query('SELECT project_id FROM lots WHERE id = $1', [lotId]);
  return result.rows[0]?.project_id || null;
}

function isPdfFile({ mime, name }) {
  if (mime && mime.toLowerCase() === 'application/pdf') return true;
  if (name && name.toLowerCase().endsWith('.pdf')) return true;
  return false;
}

/* ---------- RAW LOT (pour construire le tableur) ---------- */
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const roundId = req.query.round_id ? Number(req.query.round_id) : null;
  const isEntreprise = req.user?.role === 'entreprise';
  const userCompanyId = req.user?.company_id || null;

  try {
    // SÉCURITÉ: Vérifier que l'utilisateur peut voir le projet de ce lot
    const projectId = await getProjectIdForLot(id);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canView = await canViewProject(req.user.id, projectId, req.user.role, userCompanyId);
    if (!canView) return res.status(403).json({ error: 'Accès refusé à ce lot' });

    // Construire la condition pour filtrer les offres par round_id
    const offerCondition = roundId ? 'AND o.round_id = $2' : '';
    const queryParams = roundId ? [id, roundId] : [id];
    
    // Une seule requête optimisée avec JOINs
    const result = await query(`
      SELECT 
        l.id as lot_id, l.code, l.name as lot_name, l.project_id,
        i.id as item_id, i.num, i.designation, i.unit, i.position, i.source_company_id,
        ${isEntreprise ? 'NULL AS moe_qty, NULL AS moe_unit_price, NULL AS moe_amount,' : 'm.qty as moe_qty, m.unit_price as moe_unit_price, m.amount as moe_amount,'}
        (SELECT json_agg(jsonb_build_object('id', c2.id, 'name', c2.name, 'color', c2.color, 'email', c2.email) ORDER BY lc2.created_at, c2.id)
         FROM lot_companies lc2
         JOIN companies c2 ON c2.id = lc2.company_id
         WHERE lc2.lot_id = l.id
         ${isEntreprise && userCompanyId ? 'AND c2.id = ' + userCompanyId : ''}) as companies,
        json_agg(jsonb_build_object(
          'id', o.id,
          'item_id', o.item_id,
          'company_id', o.company_id,
          'round_id', o.round_id,
          'unit', o.unit,
          'qty', o.qty,
          'unit_price', o.unit_price,
          'amount', o.amount,
          'comment', o.comment
        )) FILTER (WHERE o.id IS NOT NULL ${isEntreprise && userCompanyId ? 'AND o.company_id = ' + userCompanyId : ''}) as offers
      FROM lots l
      LEFT JOIN items i ON i.lot_id = l.id
      ${isEntreprise ? '' : 'LEFT JOIN moe_items m ON m.item_id = i.id'}
      LEFT JOIN offers o ON o.item_id = i.id ${offerCondition}
      WHERE l.id = $1
      GROUP BY l.id, i.id${isEntreprise ? '' : ', m.item_id'}
      ORDER BY i.position NULLS LAST, i.id
    `, queryParams);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Lot introuvable' });
    }

    // Restructurer les données
    const firstRow = result.rows[0];
    const lot = {
      id: firstRow.lot_id,
      code: firstRow.code,
      name: firstRow.lot_name,
      project_id: firstRow.project_id
    };

    // Extraire les entreprises (déjà triées par created_at dans la sous-requête)
    const companies = firstRow.companies || [];

    // Extraire items avec leurs données MOE
    const itemsMap = new Map();
    const moeList = isEntreprise ? [] : [];
    const offersByKey = new Map();
    let duplicatedOffersCount = 0;
    const duplicatedOfferSamples = [];

    result.rows.forEach(row => {
      if (row.item_id && !itemsMap.has(row.item_id)) {
        itemsMap.set(row.item_id, {
          id: row.item_id,
          lot_id: row.lot_id,
          num: row.num,
          designation: row.designation,
          unit: row.unit,
          position: row.position,
          source_company_id: row.source_company_id || null
        });

        if (!isEntreprise && (row.moe_qty !== null || row.moe_unit_price !== null)) {
          moeList.push({
            item_id: row.item_id,
            qty: row.moe_qty,
            unit_price: row.moe_unit_price,
            amount: row.moe_amount
          });
        }
      }

      if (row.offers) {
        row.offers.forEach(offer => {
          const itemId = Number(offer.item_id);
          const companyId = Number(offer.company_id);
          if (!Number.isFinite(itemId) || !Number.isFinite(companyId)) return;

          const offerRoundId = Number(offer.round_id);
          const key = `${itemId}_${companyId}_${Number.isFinite(offerRoundId) ? offerRoundId : 'none'}`;
          const offerId = Number(offer.id) || 0;
          const previous = offersByKey.get(key);

          if (previous) {
            duplicatedOffersCount += 1;
            if (duplicatedOfferSamples.length < 15) {
              duplicatedOfferSamples.push({
                lotId: id,
                roundId: Number.isFinite(offerRoundId) ? offerRoundId : null,
                itemId,
                companyId,
                keptOfferId: Math.max(offerId, previous._offerId || 0),
                droppedOfferId: Math.min(offerId || 0, previous._offerId || 0)
              });
            }
          }

          if (!previous || offerId >= previous._offerId) {
            offersByKey.set(key, {
              ...offer,
              _offerId: offerId
            });
          }
        });
      }
    });

    const offersList = Array.from(offersByKey.values()).map(({ _offerId, ...offer }) => offer);

    if (duplicatedOffersCount > 0) {
      console.warn('[AMOUNT-DIAG][lots.get] Offres dupliquées détectées pour item+entreprise+tour', {
        lotId: id,
        requestedRoundId: roundId,
        duplicatedOffersCount,
        samples: duplicatedOfferSamples
      });
    }

    // Filtrer les offres par company pour entreprise (déjà fait en SQL) mais garde sécurité côté code
    const filteredOffers = isEntreprise && userCompanyId
      ? offersList.filter(o => o.company_id === userCompanyId)
      : offersList;

    res.json({
      lot,
      items: Array.from(itemsMap.values()),
      moe: moeList,
      companies: companies || [],
      offers: filteredOffers
    });

  } catch (err) {
    console.error('Erreur GET lot:', err);
    res.status(500).json({ error: 'Erreur lors du chargement du lot' });
  }
});

/* ---------- TABLE COMPARATIVE (lecture) ---------- */
router.get('/:id/table', async (req, res) => {
  const id = Number(req.params.id);
  const roundId = req.query.round_id ? Number(req.query.round_id) : null;
  const isEntreprise = req.user?.role === 'entreprise';
  const userCompanyId = req.user?.company_id || null;

  try {
  // SÉCURITÉ: Vérifier que l'utilisateur peut voir le projet de ce lot
  const projectId = await getProjectIdForLot(id);
  if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
  const canView = await canViewProject(req.user.id, projectId, req.user.role, userCompanyId);
  if (!canView) return res.status(403).json({ error: 'Accès refusé à ce lot' });

  const itemsRes = await query('SELECT * FROM items WHERE lot_id=$1 ORDER BY position NULLS LAST, id', [id]);
  const itemIds = itemsRes.rows.map(r => r.id);

  const moeRes = (!isEntreprise && itemIds.length)
    ? await query('SELECT * FROM moe_items WHERE item_id = ANY($1::int[])', [itemIds])
    : { rows: [] };

  const moeByItem = new Map(moeRes.rows.map(r => [r.item_id, r]));

  const compsRes = await query(
    'SELECT c.id, c.name, c.color FROM lot_companies lc JOIN companies c ON c.id=lc.company_id WHERE lc.lot_id=$1 ORDER BY lc.created_at, c.id',
    [id]
  );
  let companies = compsRes.rows;
  
  if (isEntreprise && userCompanyId) {
    companies = companies.filter(c => Number(c.id) === Number(userCompanyId));
  }

  // Filtrer les offres par round_id si fourni
  const offersRes = itemIds.length && roundId
    ? await query('SELECT * FROM offers WHERE item_id = ANY($1::int[]) AND round_id = $2', [itemIds, roundId])
    : itemIds.length
    ? await query('SELECT * FROM offers WHERE item_id = ANY($1::int[])', [itemIds])
    : { rows: [] };

  const offersByItem = new Map();
  for (const o of offersRes.rows) {
    if (!offersByItem.has(o.item_id)) offersByItem.set(o.item_id, new Map());
    offersByItem.get(o.item_id).set(o.company_id, o);
  }

  const rows = itemsRes.rows.map(item => {
    const m = moeByItem.get(item.id) || {};
    const line = {
      item_id: item.id,
      num: item.num,
      designation: item.designation,
      unit: item.unit,
      source_company_id: item.source_company_id || null,
      moe: { qty: m.qty, pu: m.unit_price, mt: m.amount },
      companies: []
    };
    for (const c of companies) {
      const off = offersByItem.get(item.id)?.get(c.id) || {};
      const dQty = (!isEntreprise && m.qty != null && off.qty != null && m.qty !== 0) ? ((off.qty - m.qty) / m.qty * 100) : null;
      const dPu  = (!isEntreprise && m.unit_price != null && off.unit_price != null && m.unit_price !== 0) ? ((off.unit_price - m.unit_price) / m.unit_price * 100) : null;
      line.companies.push({
        company_id: c.id,
        name: c.name,
        color: c.color || null,
        u: off.unit ?? null,
        qty: off.qty ?? null,
        pu: off.unit_price ?? null,
        mt: off.amount ?? (off.qty != null && off.unit_price != null ? off.qty * off.unit_price : null),
        delta_qty_pct: dQty,
        delta_pu_pct: dPu,
        comment: off.comment ?? null
      });
    }
    return line;
  });

  // Si entreprise: filtrer lignes pour ne retourner que leurs offres dans companies déjà réduit
  if (isEntreprise && userCompanyId) {
    // Remove moe amounts
    rows.forEach(r => { r.moe = { qty: null, pu: null, mt: null }; });
  }
  res.json({ companies, rows });
  } catch (err) {
    console.error('Erreur GET lot table:', err);
    res.status(500).json({ error: 'Erreur lors du chargement du tableau' });
  }
});

/* ---------- ENTREPRISES DU LOT ---------- */
router.get('/:id/companies', async (req, res) => {
  const id = Number(req.params.id);
  try {
    // SÉCURITÉ: Vérifier accès au projet
    const projectId = await getProjectIdForLot(id);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canView = await canViewProject(req.user.id, projectId, req.user.role, req.user.company_id || null);
    if (!canView) return res.status(403).json({ error: 'Accès refusé' });

    const r = await query(
      'SELECT c.* FROM lot_companies lc JOIN companies c ON c.id=lc.company_id WHERE lc.lot_id=$1 ORDER BY lc.created_at, c.id',
      [id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('Erreur GET lot companies:', err);
    res.status(500).json({ error: 'Erreur lors du chargement des entreprises' });
  }
});

router.post('/:id/companies', isResponsableOrAdmin, async (req, res) => {
  const lotId = Number(req.params.id);
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Nom requis' });

  const client = await pool.connect();
  try {
    // SÉCURITÉ: Vérifier que l'utilisateur peut éditer le projet de ce lot
    const projectId = await getProjectIdForLot(lotId);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé - Vous ne pouvez pas modifier ce lot' });

    await client.query('BEGIN');
    
    // 1. Vérifier si le lot existe
    const lotCheck = await client.query('SELECT id FROM lots WHERE id = $1', [lotId]);
    if (lotCheck.rowCount === 0) {
      throw new Error('Lot introuvable');
    }

    // 2. Chercher ou créer l'entreprise
    const cleanName = name.trim();
    let company;
    
    // D'abord chercher si elle existe
    const existing = await client.query(
      'SELECT id, name FROM companies WHERE lower(name) = lower($1)',
      [cleanName]
    );
    
    if (existing.rowCount > 0) {
      company = existing.rows[0];
    } else {
      // Si elle n'existe pas, la créer
      const inserted = await client.query(
        'INSERT INTO companies (name) VALUES ($1) RETURNING id, name',
        [cleanName]
      );
      company = inserted.rows[0];
    }

    // 3. Ajouter l'association lot-entreprise si elle n'existe pas déjà
    await client.query(
      'INSERT INTO lot_companies (lot_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [lotId, company.id]
    );

    await client.query('COMMIT');
    res.json(company);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur ajout entreprise:', err);
    
    if (err.message === 'Lot introuvable') {
      res.status(404).json({ error: err.message });
    } else if (err.code === '23505') { // violation de contrainte unique
      res.status(409).json({ error: 'Cette entreprise existe déjà' });
    } else {
      res.status(500).json({ error: 'Erreur lors de l\'ajout de l\'entreprise' });
    }
  } finally {
    client.release();
  }
});

router.delete('/:id/companies/:companyId', isResponsableOrAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const companyId = Number(req.params.companyId);
  try {
    // SÉCURITÉ: Vérifier que l'utilisateur peut éditer le projet de ce lot
    const projectId = await getProjectIdForLot(id);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé - Vous ne pouvez pas modifier ce lot' });

    // Supprimer les offres de cette entreprise sur les items de ce lot
    await query(
      'DELETE FROM offers WHERE company_id=$1 AND item_id IN (SELECT id FROM items WHERE lot_id=$2)',
      [companyId, id]
    );
    // Supprimer les offres d'options de cette entreprise sur ce lot
    await query(
      `DELETE FROM option_item_offers WHERE company_id=$1 AND option_item_id IN (
         SELECT oi.id FROM option_items oi
         JOIN options o ON o.id = oi.option_id
         WHERE o.lot_id=$2
       )`,
      [companyId, id]
    );
    // Supprimer les questions générées pour cette entreprise sur ce lot
    await query('DELETE FROM generated_questions WHERE company_id=$1 AND lot_id=$2', [companyId, id]);
    // Supprimer les items ajoutés par cette entreprise
    await query('DELETE FROM items WHERE lot_id=$1 AND source_company_id=$2', [id, companyId]);
    await query('DELETE FROM lot_companies WHERE lot_id=$1 AND company_id=$2', [id, companyId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur suppression entreprise du lot:', err);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

/* ---------- COULEUR ENTREPRISE ---------- */
router.patch('/companies/:companyId/color', isResponsableOrAdmin, async (req, res) => {
  const companyId = Number(req.params.companyId);
  const { color } = req.body || {};
  if (!color) return res.status(400).json({ error: 'Couleur requise' });
  try {
    await query('UPDATE companies SET color = $1 WHERE id = $2', [color, companyId]);
    res.json({ ok: true, color });
  } catch (err) {
    console.error('Erreur mise à jour couleur:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

/* ---------- EMAIL ENTREPRISE ---------- */
router.patch('/companies/:companyId/email', isResponsableOrAdmin, async (req, res) => {
  const companyId = Number(req.params.companyId);
  const { email } = req.body || {};
  // Validation format email basique (ou vide pour effacer)
  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Adresse email invalide' });
    }
  }
  try {
    await query('UPDATE companies SET email = $1 WHERE id = $2', [email || null, companyId]);
    res.json({ ok: true, email: email || null });
  } catch (err) {
    console.error('Erreur mise à jour email:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

/* ---------- SAUVEGARDE DU TABLEUR (édition) ---------- */
// Body: { rows: [ { item_id?, num, designation, unit, moe:{qty,pu}, offers:{ [companyId]:{u,qty,pu} } } ] }
router.post('/:id/save-grid', requireRole(['admin', 'responsable', 'entreprise']), async (req, res) => {
  const lotId = Number(req.params.id);
  const { rows, round_id } = req.body || {};
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows[] requis' });
  if (!round_id) return res.status(400).json({ error: 'round_id requis' });
  
  // SÉCURITÉ: Vérifier l'accès au projet
  const projectId = await getProjectIdForLot(lotId);
  if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
  
  const isEntreprise = req.user?.role === 'entreprise';
  const userCompanyId = req.user?.company_id || null;
  
  // Entreprise: vérifier que leur company est liée au lot
  if (isEntreprise) {
    if (!userCompanyId) return res.status(403).json({ error: 'Aucune entreprise associée à votre compte' });
    const companyLink = await query(
      'SELECT 1 FROM lot_companies WHERE lot_id = $1 AND company_id = $2',
      [lotId, userCompanyId]
    );
    if (companyLink.rowCount === 0) return res.status(403).json({ error: 'Votre entreprise n\'est pas associée à ce lot' });
  } else {
    // Admin/Responsable: vérifier canEditProject
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé - Vous ne pouvez pas modifier ce lot' });
  }
  
  const roundId = Number(round_id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemsToUpdate = [];
    const itemsToInsert = [];
    const moeData = [];
    const offersData = [];
    
    let pos = 0;
    
    // 1. Séparer items existants vs nouveaux
    for (const r of rows) {
      pos += 1;
      
      const designation = (r.designation ?? '').trim();
      const num = r.num ?? null;
      const unit = r.unit ?? null;
      const itemId = r.item_id ? Number(r.item_id) : null;
      
      // Sauvegarder toutes les lignes pour préserver l'ordre DPGF (même les vides)
      // Utiliser un espace comme désignation minimale pour les lignes vides
      const finalDesignation = designation || '';

      if (itemId) {
        itemsToUpdate.push({ id: itemId, num, designation: finalDesignation, unit, pos });
      } else {
        itemsToInsert.push({ num, designation: finalDesignation, unit, pos, rowIndex: rows.indexOf(r) });
      }

      // Préparer MOE
      let q = null, pu = null, mt = null;
      if (r.moe?.qty != null && r.moe.qty !== '' && !isNaN(Number(r.moe.qty))) {
        q = Number(r.moe.qty);
      }
      if (r.moe?.pu != null && r.moe.pu !== '' && !isNaN(Number(r.moe.pu))) {
        pu = Number(r.moe.pu);
      }
      if (q != null && pu != null) {
        mt = q * pu;
      }
      moeData.push({ itemId, q, pu, mt, rowIndex: rows.indexOf(r) });

      // Préparer OFFERS
      if (r.offers && typeof r.offers === 'object') {
        for (const [cid, val] of Object.entries(r.offers)) {
          const companyId = Number(cid);
          const u  = val?.u ?? null;
          let oq = null, op = null, om = null;
          if (val?.qty != null && val.qty !== '' && !isNaN(Number(val.qty))) {
            oq = Number(val.qty);
          }
          if (val?.pu != null && val.pu !== '' && !isNaN(Number(val.pu))) {
            op = Number(val.pu);
          }
          if (oq != null && op != null) {
            om = oq * op;
          }
          offersData.push({ itemId, companyId, u, oq, op, om, rowIndex: rows.indexOf(r) });
        }
      }
    }

    // 2. Batch UPDATE items existants (interdit pour entreprise)
    if (itemsToUpdate.length > 0 && !isEntreprise) {
      for (const item of itemsToUpdate) {
        await client.query(
          'UPDATE items SET num=$2, designation=$3, unit=$4, position=$5 WHERE id=$1',
          [item.id, item.num, item.designation, item.unit, item.pos]
        );
      }
    }

    // 3. Batch INSERT nouveaux items (interdit pour entreprise)
    const newItemIds = [];
    if (itemsToInsert.length > 0 && !isEntreprise) {
      for (const item of itemsToInsert) {
        const ins = await client.query(
          'INSERT INTO items (lot_id, num, designation, unit, position) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [lotId, item.num, item.designation, item.unit, item.pos]
        );
        newItemIds.push({ rowIndex: item.rowIndex, id: ins.rows[0].id });
      }
    }

    // 4. Mettre à jour les itemIds dans moeData et offersData
    for (const newItem of newItemIds) {
      for (const moe of moeData) {
        if (moe.rowIndex === newItem.rowIndex && !moe.itemId) {
          moe.itemId = newItem.id;
        }
      }
      for (const offer of offersData) {
        if (offer.rowIndex === newItem.rowIndex && !offer.itemId) {
          offer.itemId = newItem.id;
        }
      }
    }

    // 5. Batch upsert MOE (interdit pour entreprise)
    if (moeData.length > 0 && !isEntreprise) {
      for (const moe of moeData) {
        if (!moe.itemId) continue;
        await client.query(`
          INSERT INTO moe_items (item_id, qty, unit_price, amount)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (item_id) DO UPDATE
          SET qty=EXCLUDED.qty, unit_price=EXCLUDED.unit_price, amount=EXCLUDED.amount
        `, [moe.itemId, moe.q, moe.pu, moe.mt]);
      }
    }

    // 6. Batch upsert OFFERS
    // SÉCURITÉ: Entreprise ne peut sauvegarder que les offres de sa propre company
    if (offersData.length > 0) {
      for (const offer of offersData) {
        if (!offer.itemId) continue;
        // Entreprise: filtrer uniquement ses propres offres
        if (isEntreprise && Number(offer.companyId) !== Number(userCompanyId)) continue;
        await client.query(`
          INSERT INTO offers (item_id, company_id, round_id, unit, qty, unit_price, amount)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (item_id, company_id, round_id) DO UPDATE
          SET unit=EXCLUDED.unit, qty=EXCLUDED.qty, unit_price=EXCLUDED.unit_price, amount=EXCLUDED.amount,
              comment=COALESCE(offers.comment, EXCLUDED.comment)
        `, [offer.itemId, offer.companyId, roundId, offer.u, offer.oq, offer.op, offer.om]);
      }
    }

    await client.query('COMMIT');
    
    // Retourner les items avec leurs IDs (anciens + nouveaux)
    const allItems = [];
    
    // Ajouter les items mis à jour
    for (const item of itemsToUpdate) {
      allItems.push({ id: item.id, designation: item.designation });
    }
    
    // Ajouter les nouveaux items créés
    for (const newItem of newItemIds) {
      const originalRow = rows[newItem.rowIndex];
      allItems.push({ id: newItem.id, designation: originalRow.designation });
    }
    
    res.json({ ok: true, saved: pos, items: allItems });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Erreur save-grid:', e);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  } finally {
    client.release();
  }
});

/* ---------- Smart Import : Preview ---------- */
router.post('/:id/import-preview', requireRole(['admin', 'responsable']), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });
  try {
    const sheetName = req.body?.sheetName || null;
    const headerRow = req.body?.headerRow ? Number(req.body.headerRow) : null;
    const isPdf = isPdfFile({ mime: req.file.mimetype, name: req.file.originalname });
    const buffer = isPdf
      ? await convertPdfToExcelBuffer({ buffer: req.file.buffer, headerRow })
      : req.file.buffer;
    const result = await previewExcel({ buffer, sheetName: isPdf ? 'PDF' : sheetName, headerRow: isPdf ? 1 : headerRow });
    // Cacher le fichier pour éviter un re-upload à l'étape apply
    const fileId = cacheTempFile(req.file.buffer, { mime: req.file.mimetype, name: req.file.originalname });
    res.json({ ...result, fileId });
  } catch (e) {
    console.error('Preview error:', e);
    res.status(400).json({ error: e.message });
  }
});

/* ---------- Smart Import : Apply ---------- */
router.post('/:id/import-apply', requireRole(['admin', 'responsable']), upload.single('file'), async (req, res) => {
  const lotId = Number(req.params.id);

  try {
    const { mode, sheetName, headerRow, mapping, excludedRows, roundId, companyId, companyName, fileId } = JSON.parse(req.body.params || '{}');
    if (!mode) return res.status(400).json({ error: 'Mode requis (dpgf ou offer)' });
    if (!mapping) return res.status(400).json({ error: 'Mapping requis' });

    if (String(mode) === 'offer' && !roundId) {
      console.warn('[AMOUNT-DIAG][import.apply] Import offre sans roundId', {
        lotId,
        companyId: companyId ? Number(companyId) : null,
        companyName: companyName || null,
        userId: req.user?.id || null
      });
    }

    // Utiliser le fichier caché si disponible, sinon le fichier uploadé
    let buffer = req.file?.buffer;
    let mime = req.file?.mimetype;
    let name = req.file?.originalname;
    if (!buffer && fileId) {
      const entry = getTempFile(fileId);
      buffer = entry?.buffer;
      mime = entry?.mime;
      name = entry?.name;
    }
    if (!buffer) return res.status(400).json({ error: 'Fichier manquant. Veuillez relancer l\'import.' });

    const isPdf = isPdfFile({ mime, name });
    if (isPdf) {
      buffer = await convertPdfToExcelBuffer({ buffer, headerRow: Number(headerRow) || null });
    }
    const result = await applyImport({
      buffer,
      mode,
      lotId,
      roundId: roundId ? Number(roundId) : null,
      companyId: companyId ? Number(companyId) : null,
      companyName: companyName || null,
      sheetName: isPdf ? 'PDF' : (sheetName || null),
      headerRow: isPdf ? 1 : (Number(headerRow) || 1),
      mapping,
      excludedRows: excludedRows || [],
    });

    if (String(mode) === 'offer') {
      const amountMismatchCount = Number(result?.amountMismatchCount || 0);
      const unmatchedDpgfCount = Number(result?.unmatchedDpgfCount || 0);
      const addedPostsCount = Number(result?.addedPostsCount || 0);
      if (amountMismatchCount > 0 || unmatchedDpgfCount > 0 || addedPostsCount > 0) {
        console.warn('[AMOUNT-DIAG][import.apply] Import offre avec anomalies fonctionnelles', {
          lotId,
          roundId: roundId ? Number(roundId) : null,
          companyId: Number(result?.companyId || companyId || 0) || null,
          matched: Number(result?.matched || 0),
          skipped: Number(result?.skipped || 0),
          amountMismatchCount,
          unmatchedDpgfCount,
          addedPostsCount,
          warnings: result?.warnings || []
        });
      }
    }

    // Nettoyer le fichier caché après usage
    if (fileId) tempFileCache.delete(fileId);

    res.json(result);
  } catch (e) {
    console.error('Import apply error:', e);
    res.status(400).json({ error: e.message });
  }
});

export default router;
