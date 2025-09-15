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

  const lot = await query('SELECT * FROM lots WHERE id=$1', [id]);
  if (lot.rowCount === 0) return res.status(404).json({ error: 'Lot introuvable' });

  const items = await query('SELECT * FROM items WHERE lot_id=$1 ORDER BY position NULLS LAST, id', [id]);
  const itemIds = items.rows.map(r => r.id);

  const moe = itemIds.length
    ? await query('SELECT * FROM moe_items WHERE item_id = ANY($1::int[])', [itemIds])
    : { rows: [] };

  const companies = await query(
    'SELECT c.* FROM lot_companies lc JOIN companies c ON c.id=lc.company_id WHERE lc.lot_id=$1 ORDER BY c.name',
    [id]
  );

  const offers = itemIds.length
    ? await query('SELECT * FROM offers WHERE item_id = ANY($1::int[])', [itemIds])
    : { rows: [] };

  res.json({
    lot: lot.rows[0],
    items: items.rows,
    moe: moe.rows,
    companies: companies.rows,
    offers: offers.rows
  });
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
    'SELECT c.* FROM lot_companies lc JOIN companies c ON c.id=lc.company_id WHERE lc.lot_id=$1 ORDER BY c.name',
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
  const id = Number(req.params.id);
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nom requis' });

  const clean = name.trim();
  const up = await query(
    'INSERT INTO companies (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id, name',
    [clean]
  );
  const company = up.rows[0];
  await query(
    'INSERT INTO lot_companies (lot_id, company_id) VALUES ($1,$2) ON CONFLICT (lot_id, company_id) DO NOTHING',
    [id, company.id]
  );
  res.json(company);
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
  const { rows } = req.body || {};
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows[] requis' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let pos = 0;
    for (const r of rows) {
      const designation = (r.designation ?? '').trim();
      if (!designation) continue; // ignore lignes vides
      pos += 1;

      const num = r.num ?? null;
      const unit = r.unit ?? null;

      // upsert item
      let itemId = r.item_id ? Number(r.item_id) : null;
      if (!itemId) {
        const ins = await client.query(
          'INSERT INTO items (lot_id, num, designation, unit, position) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [lotId, num, designation, unit, pos]
        );
        itemId = ins.rows[0].id;
      } else {
        await client.query(
          'UPDATE items SET num=$2, designation=$3, unit=$4, position=$5 WHERE id=$1',
          [itemId, num, designation, unit, pos]
        );
      }

      // upsert MOE
      const q  = r.moe?.qty != null && r.moe.qty !== '' ? Number(r.moe.qty) : null;
      const pu = r.moe?.pu  != null && r.moe.pu  !== '' ? Number(r.moe.pu)  : null;
      const mt = (q != null && pu != null) ? q * pu : null;
      await client.query(`
        INSERT INTO moe_items (item_id, qty, unit_price, amount)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (item_id) DO UPDATE
        SET qty=EXCLUDED.qty, unit_price=EXCLUDED.unit_price, amount=EXCLUDED.amount
      `, [itemId, q, pu, mt]);

      // upsert OFFERS
      if (r.offers && typeof r.offers === 'object') {
        for (const [cid, val] of Object.entries(r.offers)) {
          const companyId = Number(cid);
          const u  = val?.u ?? null;
          const oq = val?.qty != null && val.qty !== '' ? Number(val.qty) : null;
          const op = val?.pu  != null && val.pu  !== '' ? Number(val.pu)  : null;
          const om = (oq != null && op != null) ? oq * op : null;

          await client.query(`
            INSERT INTO offers (item_id, company_id, unit, qty, unit_price, amount)
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (item_id, company_id) DO UPDATE
            SET unit=EXCLUDED.unit, qty=EXCLUDED.qty, unit_price=EXCLUDED.unit_price, amount=EXCLUDED.amount
          `, [itemId, companyId, u, oq, op, om]);
        }
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, saved: rows.length });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(400).json({ error: e.message });
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
