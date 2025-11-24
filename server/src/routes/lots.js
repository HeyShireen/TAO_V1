import express from 'express';
import multer from 'multer';
import { query, pool } from '../db.js';
import { requireAuth } from '../middleware.auth.js';

// (si tu gardes l’import Excel, sinon tu peux enlever multer et la route)
import { importLotFromExcel } from '../importers/excel.js';

const upload = multer();
const router = express.Router();
router.use(requireAuth);

/* ---------- RAW LOT (pour construire le tableur) ---------- */
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);

  try {
    // Une seule requête optimisée avec JOINs
    const result = await query(`
      SELECT 
        l.id as lot_id, l.code, l.name as lot_name, l.project_id,
        i.id as item_id, i.num, i.designation, i.unit, i.position,
        m.qty as moe_qty, m.unit_price as moe_unit_price, m.amount as moe_amount,
        json_agg(DISTINCT jsonb_build_object(
          'id', c.id, 
          'name', c.name
        )) FILTER (WHERE c.id IS NOT NULL) as companies,
        json_agg(DISTINCT jsonb_build_object(
          'item_id', o.item_id,
          'company_id', o.company_id,
          'unit', o.unit,
          'qty', o.qty,
          'unit_price', o.unit_price,
          'amount', o.amount
        )) FILTER (WHERE o.id IS NOT NULL) as offers
      FROM lots l
      LEFT JOIN items i ON i.lot_id = l.id
      LEFT JOIN moe_items m ON m.item_id = i.id
      LEFT JOIN lot_companies lc ON lc.lot_id = l.id
      LEFT JOIN companies c ON c.id = lc.company_id
      LEFT JOIN offers o ON o.item_id = i.id
      WHERE l.id = $1
      GROUP BY l.id, i.id, m.item_id
      ORDER BY i.position NULLS LAST, i.id
    `, [id]);

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

    // Extraire les entreprises uniques
    const companiesSet = new Map();
    result.rows.forEach(row => {
      if (row.companies) {
        row.companies.forEach(c => companiesSet.set(c.id, c));
      }
    });
    const companies = Array.from(companiesSet.values()).sort((a, b) => a.name.localeCompare(b.name));

    // Extraire items avec leurs données MOE
    const itemsMap = new Map();
    const moeList = [];
    const offersList = [];

    result.rows.forEach(row => {
      if (row.item_id && !itemsMap.has(row.item_id)) {
        itemsMap.set(row.item_id, {
          id: row.item_id,
          lot_id: row.lot_id,
          num: row.num,
          designation: row.designation,
          unit: row.unit,
          position: row.position
        });

        if (row.moe_qty !== null || row.moe_unit_price !== null) {
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
          if (offer.item_id && !offersList.find(o => o.item_id === offer.item_id && o.company_id === offer.company_id)) {
            offersList.push(offer);
          }
        });
      }
    });

    res.json({
      lot,
      items: Array.from(itemsMap.values()),
      moe: moeList,
      companies,
      offers: offersList
    });

  } catch (err) {
    console.error('Erreur GET lot:', err);
    res.status(500).json({ error: 'Erreur lors du chargement du lot' });
  }
});

/* ---------- TABLE COMPARATIVE (lecture) ---------- */
router.get('/:id/table', async (req, res) => {
  const id = Number(req.params.id);

  const itemsRes = await query('SELECT * FROM items WHERE lot_id=$1 ORDER BY position NULLS LAST, id', [id]);
  const itemIds = itemsRes.rows.map(r => r.id);

  const moeRes = itemIds.length
    ? await query('SELECT * FROM moe_items WHERE item_id = ANY($1::int[])', [itemIds])
    : { rows: [] };

  const moeByItem = new Map(moeRes.rows.map(r => [r.item_id, r]));

  const compsRes = await query(
    'SELECT c.* FROM lot_companies lc JOIN companies c ON c.id=lc.company_id WHERE lc.lot_id=$1 ORDER BY lc.created_at, c.id',
    [id]
  );
  const companies = compsRes.rows;

  const offersRes = itemIds.length
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
      moe: { qty: m.qty, pu: m.unit_price, mt: m.amount },
      companies: []
    };
    for (const c of companies) {
      const off = offersByItem.get(item.id)?.get(c.id) || {};
      const dQty = (m.qty != null && off.qty != null && m.qty !== 0) ? ((off.qty - m.qty) / m.qty * 100) : null;
      const dPu  = (m.unit_price != null && off.unit_price != null && m.unit_price !== 0) ? ((off.unit_price - m.unit_price) / m.unit_price * 100) : null;
      line.companies.push({
        company_id: c.id,
        name: c.name,
        u: off.unit ?? null,
        qty: off.qty ?? null,
        pu: off.unit_price ?? null,
        mt: off.amount ?? (off.qty != null && off.unit_price != null ? off.qty * off.unit_price : null),
        delta_qty_pct: dQty,
        delta_pu_pct: dPu
      });
    }
    return line;
  });

  res.json({ companies, rows });
});

/* ---------- ENTREPRISES DU LOT ---------- */
router.get('/:id/companies', async (req, res) => {
  const id = Number(req.params.id);
  const r = await query(
    'SELECT c.* FROM lot_companies lc JOIN companies c ON c.id=lc.company_id WHERE lc.lot_id=$1 ORDER BY c.name',
    [id]
  );
  res.json(r.rows);
});

router.post('/:id/companies', async (req, res) => {
  const lotId = Number(req.params.id);
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Nom requis' });

  const client = await pool.connect();
  try {
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

router.delete('/:id/companies/:companyId', async (req, res) => {
  const id = Number(req.params.id);
  const companyId = Number(req.params.companyId);
  await query('DELETE FROM lot_companies WHERE lot_id=$1 AND company_id=$2', [id, companyId]);
  res.json({ ok: true });
});

/* ---------- SAUVEGARDE DU TABLEUR (édition) ---------- */
// Body: { rows: [ { item_id?, num, designation, unit, moe:{qty,pu}, offers:{ [companyId]:{u,qty,pu} } } ] }
router.post('/:id/save-grid', async (req, res) => {
  const lotId = Number(req.params.id);
  const { rows, round_id } = req.body || {};
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows[] requis' });
  if (!round_id) return res.status(400).json({ error: 'round_id requis' });
  
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

    // 2. Batch UPDATE items existants
    if (itemsToUpdate.length > 0) {
      for (const item of itemsToUpdate) {
        await client.query(
          'UPDATE items SET num=$2, designation=$3, unit=$4, position=$5 WHERE id=$1',
          [item.id, item.num, item.designation, item.unit, item.pos]
        );
      }
    }

    // 3. Batch INSERT nouveaux items (on doit le faire en séquentiel pour récupérer les IDs)
    const newItemIds = [];
    if (itemsToInsert.length > 0) {
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

    // 5. Batch upsert MOE
    if (moeData.length > 0) {
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
    if (offersData.length > 0) {
      for (const offer of offersData) {
        if (!offer.itemId) continue;
        await client.query(`
          INSERT INTO offers (item_id, company_id, round_id, unit, qty, unit_price, amount)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (item_id, company_id, round_id) DO UPDATE
          SET unit=EXCLUDED.unit, qty=EXCLUDED.qty, unit_price=EXCLUDED.unit_price, amount=EXCLUDED.amount
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

/* ---------- (optionnel) Import Excel ---------- */
router.post('/:id/import-excel', upload.single('file'), async (req, res) => {
  const id = Number(req.params.id);
  if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });
  try {
    const r = await importLotFromExcel({ lotId: id, buffer: req.file.buffer });
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

export default router;
