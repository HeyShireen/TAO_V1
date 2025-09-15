import express from 'express';
import multer from 'multer';
import { query } from '../db.js';
import { requireAuth } from '../middleware.auth.js';
import { importLotFromExcel } from '../importers/excel.js';
import { importLotFromClipboard } from '../importers/clipboard.js';

const upload = multer();
const router = express.Router();
router.use(requireAuth);

// === ENTREPRISES D'UN LOT ===

// Liste des entreprises du lot
router.get('/:id/companies', async (req, res) => {
  const id = req.params.id;
  const r = await query(
    'SELECT c.* FROM lot_companies lc JOIN companies c ON c.id = lc.company_id WHERE lc.lot_id = $1 ORDER BY c.name',
    [id]
  );
  res.json(r.rows);
});

// Ajouter une entreprise au lot (créée si elle n'existe pas)
router.post('/:id/companies', async (req, res) => {
  const id = req.params.id;
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nom requis' });

  const clean = name.trim();
  const upsert = await query(
    'INSERT INTO companies (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id, name',
    [clean]
  );
  const company = upsert.rows[0];

  await query(
    'INSERT INTO lot_companies (lot_id, company_id) VALUES ($1, $2) ON CONFLICT (lot_id, company_id) DO NOTHING',
    [id, company.id]
  );

  res.json(company);
});

// Retirer une entreprise du lot (ne supprime pas la société globale)
router.delete('/:id/companies/:companyId', async (req, res) => {
  const { id, companyId } = req.params;
  await query('DELETE FROM lot_companies WHERE lot_id=$1 AND company_id=$2', [id, companyId]);
  res.json({ ok: true });
});

// Get raw lot data
router.get('/:id', async (req, res) => {
  const id = req.params.id;
  const lot = await query('SELECT * FROM lots WHERE id=$1', [id]);
  if (lot.rowCount === 0) return res.status(404).json({ error: 'Not found' });

  const items = await query('SELECT * FROM items WHERE lot_id=$1 ORDER BY position NULLS LAST, id', [id]);
  const moe = await query('SELECT * FROM moe_items WHERE item_id = ANY($1::int[])', [items.rows.map(r => r.id)]);
  const lotCompanies = await query('SELECT c.* FROM lot_companies lc JOIN companies c ON c.id=lc.company_id WHERE lc.lot_id=$1', [id]);
  const offers = await query('SELECT * FROM offers WHERE item_id = ANY($1::int[])', [items.rows.map(r => r.id)]);

  res.json({ lot: lot.rows[0], items: items.rows, moe: moe.rows, companies: lotCompanies.rows, offers: offers.rows });
});

// Comparative table with computed deltas
router.get('/:id/table', async (req, res) => {
  const id = req.params.id;
  const itemsRes = await query('SELECT * FROM items WHERE lot_id=$1 ORDER BY position NULLS LAST, id', [id]);
  const itemIds = itemsRes.rows.map(r => r.id);
  if (itemIds.length === 0) return res.json({ companies: [], rows: [] });

  const moeRes = await query('SELECT * FROM moe_items WHERE item_id = ANY($1::int[])', [itemIds]);
  const moeByItem = new Map(moeRes.rows.map(r => [r.item_id, r]));

  const compsRes = await query('SELECT c.* FROM lot_companies lc JOIN companies c ON c.id=lc.company_id WHERE lc.lot_id=$1 ORDER BY c.name', [id]);
  const companies = compsRes.rows;

  const offersRes = await query('SELECT * FROM offers WHERE item_id = ANY($1::int[])', [itemIds]);
  const offersByItem = new Map();
  for (const o of offersRes.rows) {
    if (!offersByItem.has(o.item_id)) offersByItem.set(o.item_id, new Map());
    offersByItem.get(o.item_id).set(o.company_id, o);
  }

  const rows = itemsRes.rows.map(item => {
    const moe = moeByItem.get(item.id) || {};
    const result = {
      item_id: item.id,
      num: item.num,
      designation: item.designation,
      unit: item.unit,
      moe: { qty: moe.qty, pu: moe.unit_price, mt: moe.amount },
      companies: []
    };
    for (const c of companies) {
      const off = offersByItem.get(item.id)?.get(c.id) || {};
      const deltaQty = (moe.qty != null && off.qty != null && moe.qty != 0) ? (off.qty - moe.qty) / moe.qty * 100 : null;
      const deltaPu  = (moe.unit_price != null && off.unit_price != null && moe.unit_price != 0) ? (off.unit_price - moe.unit_price) / moe.unit_price * 100 : null;
      result.companies.push({
        company_id: c.id,
        name: c.name,
        u: off.unit ?? null,
        qty: off.qty ?? null,
        pu: off.unit_price ?? null,
        mt: off.amount ?? (off.qty != null && off.unit_price != null ? off.qty * off.unit_price : null),
        delta_qty_pct: deltaQty,
        delta_pu_pct: deltaPu
      });
    }
    return result;
  });

  res.json({ companies, rows });
});

// Import Excel (fichier .xlsx)
router.post('/:id/import-excel', upload.single('file'), async (req, res) => {
  const id = req.params.id;
  if (!req.file) return res.status(400).json({ error: 'Missing file' });
  try {
    const result = await importLotFromExcel({ lotId: id, buffer: req.file.buffer });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// Import "copier/coller" depuis tableur (TSV/CSV parsé côté front)
router.post('/:id/import-clipboard', async (req, res) => {
  const id = req.params.id;
  const { headers, rows } = req.body || {};
  if (!Array.isArray(headers) || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'headers[] et rows[][] requis' });
  }
  try {
    const result = await importLotFromClipboard({ lotId: id, headers, rows });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

export default router;
