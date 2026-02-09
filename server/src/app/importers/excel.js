import ExcelJS from 'exceljs';
import { query } from '../db.js';

/**
 * Expected Excel structure (V1):
 * Header row with at least: Num, Désignation, U (optional), Quantité MOE, PU MOE, Montant MOE
 * Then groups of 3-4 columns per company, named, for example:
 *  - <Company Name> U   (optional)
 *  - <Company Name> Quantité
 *  - <Company Name> PU
 *  - <Company Name> Montant
 * Sheet can be the first sheet or a sheet named like the lot. The importer tries to map automatically.
 */
export async function importLotFromExcel({ lotId, buffer }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Empty workbook');

  // Build rows as array of objects using header row (row 1)
  const headerRow = ws.getRow(1);
  const headerNames = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const v = cell.value;
    const text = typeof v === 'object' && v !== null ? (v.text || v.result || '') : v;
    headerNames[colNumber - 1] = (text ?? '').toString();
  });
  if (headerNames.length === 0) throw new Error('Empty sheet');

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    // Skip completely empty rows
    if (!row || row.cellCount === 0) continue;
    const obj = {};
    headerNames.forEach((h, idx) => {
      const cell = row.getCell(idx + 1);
      let val = cell?.value;
      if (val && typeof val === 'object') {
        // ExcelJS cell value can be RichText, Formula, Hyperlink, etc.
        val = val.text ?? val.result ?? val.richText?.map(t => t.text).join('') ?? val.hyperlink ?? null;
      }
      obj[h] = val ?? null;
    });
    // Consider row empty if all values are null/empty
    const hasAny = Object.values(obj).some(v => v !== null && v !== '');
    if (hasAny) rows.push(obj);
  }
  if (rows.length === 0) throw new Error('Empty sheet');

  // Normalize headers to simplify mapping
  const normalize = (s) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

  const headers = Object.keys(rows[0]);
  const normHeaders = headers.map(h => normalize(h));

  const findHeader = (patterns) => {
    for (let i = 0; i < headers.length; i++) {
      const h = normHeaders[i];
      if (patterns.some(p => h.includes(p))) return headers[i];
    }
    return null;
  };

  const numCol = findHeader(['num']);
  const desigCol = findHeader(['désignation','designation','libellé','libelle']);
  const baseUnitCol = findHeader([' u','u ', 'unité','unite']); // try to avoid company U by using spaces

  // MOE columns
  const moeQtyCol = findHeader(['quantité moe','quantite moe','qté moe','qte moe','quantité moé','quantite moé','quantité','quantite']);
  const moePuCol  = findHeader(['pu moe','prix unitaire moe','p.u moe','p.u. moe','pu moé']);
  const moeMtCol  = findHeader(['montant moe','mt moe','montant moé']);

  if (!desigCol) throw new Error('Missing column Désignation');
  if (!moeQtyCol || !moePuCol) {
    // We can compute amount if qty*pu exists; still require qty and pu
    throw new Error('Missing MOE columns (Quantité MOE and PU MOE)');
  }

  // Detect company column groups by looking for headers that contain company names followed by 'quantité' or 'pu'
  // Strategy: split headers on patterns 'quantité','pu','montant' and group by the first token (company name)
  const companyGroups = {};
  headers.forEach((h, idx) => {
    const nh = normHeaders[idx];
    const mQty = nh.match(/(.+?)\s*(quantité|quantite|qté|qte)$/);
    const mPu  = nh.match(/(.+?)\s*(pu|prix unitaire|p\.u\.?|p u)$/);
    const mMt  = nh.match(/(.+?)\s*(montant|mt)$/);
    const mU   = nh.match(/(.+?)\s*(u|unité|unite)$/);
    let key = null, type = null;
    if (mQty) { key = mQty[1].trim(); type = 'qty'; }
    else if (mPu) { key = mPu[1].trim(); type = 'pu'; }
    else if (mMt) { key = mMt[1].trim(); type = 'mt'; }
    else if (mU)  { key = mU[1].trim(); type = 'u'; }
    if (key) {
      if (!companyGroups[key]) companyGroups[key] = {};
      companyGroups[key][type] = headers[idx];
    }
  });

  // Remove potential 'moe' group mistakenly detected
  delete companyGroups['moe'];

  // Insert or get companies, create lot_companies
  const companies = [];
  for (const key of Object.keys(companyGroups)) {
    // Clean key (capitalize words)
    const name = key.replace(/\b\w/g, (c) => c.toUpperCase());
    const r1 = await query('INSERT INTO companies (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id, name', [name]);
    const company = r1.rows[0];
    companies.push({ ...company, cols: companyGroups[key] });
    // link to lot
    await query('INSERT INTO lot_companies (lot_id, company_id) VALUES ($1,$2) ON CONFLICT (lot_id, company_id) DO NOTHING', [lotId, company.id]);
  }

  // Insert rows
  let position = 0;
  for (const r of rows) {
    position += 1;
    const num = r[numCol] ?? null;
    const designation = r[desigCol];
    if (!designation) continue; // skip blank rows

    const baseUnit = baseUnitCol ? r[baseUnitCol] : null;
    const qtyMoe = r[moeQtyCol] != null ? Number(r[moeQtyCol]) : null;
    const puMoe = r[moePuCol] != null ? Number(r[moePuCol]) : null;
    const mtMoe = (r[moeMtCol] != null ? Number(r[moeMtCol]) : (qtyMoe != null && puMoe != null ? qtyMoe * puMoe : null));

    const itemRes = await query(
      'INSERT INTO items (lot_id, num, designation, unit, position) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [lotId, num, designation, baseUnit, position]
    );
    const itemId = itemRes.rows[0].id;

    await query('INSERT INTO moe_items (item_id, qty, unit_price, amount) VALUES ($1,$2,$3,$4)',
      [itemId, qtyMoe, puMoe, mtMoe]
    );

    for (const company of companies) {
      const cols = company.cols;
      const uq = cols['qty'] ? Number(r[cols['qty']]) : null;
      const up = cols['pu'] ? Number(r[cols['pu']]) : null;
      const uu = cols['u'] ? r[cols['u']] : null;
      const um = cols['mt'] ? Number(r[cols['mt']]) : (uq != null && up != null ? uq * up : null);
      // Some rows may be empty for a company; skip if no price/unit provided
      if (uq != null || up != null || uu != null || um != null) {
        await query(
          'INSERT INTO offers (item_id, company_id, unit, qty, unit_price, amount) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (item_id, company_id) DO NOTHING',
          [itemId, company.id, uu, uq, up, um]
        );
      }
    }
  }

  return { companies: companies.map(c => ({ id: c.id, name: c.name })), itemsImported: position };
}
