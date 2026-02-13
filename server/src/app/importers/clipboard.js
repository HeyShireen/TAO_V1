import { query } from '../db.js';

const normalize = (s) => (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

/** Convertit une valeur en nombre, retourne null si vide/invalide/zéro */
function safeNum(val) {
  if (val == null || val === '') return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

// rows: array of arrays; headers: array of strings
export async function importLotFromClipboard({ lotId, headers, rows, roundId }) {
  if (!headers.length || !rows.length) throw new Error('Tableau vide');

  const normHeaders = headers.map(normalize);
  const findHeader = (patterns) => {
    const idx = normHeaders.findIndex(h => patterns.some(p => h.includes(p)));
    return idx >= 0 ? idx : -1;
  };

  const numIdx   = findHeader(['num']);
  const desIdx   = findHeader(['désignation','designation','libellé','libelle']);
  const uIdx     = findHeader(['unité','unite']);
  const moeQIdx  = findHeader(['quantité moe','quantite moe','qté moe','qte moe','quantité','quantite']);
  const moePUIdx = findHeader(['pu moe','prix unitaire moe','p.u moe','p.u. moe','pu moé']);
  const moeMTIdx = findHeader(['montant moe','mt moe','montant moé']);

  if (desIdx < 0) throw new Error('Colonne "Désignation" absente');
  if (moeQIdx < 0 || moePUIdx < 0) throw new Error('Colonnes MOE Quantité/PU manquantes');

  // détecter les groupes d'entreprises
  const groups = {};
  headers.forEach((h, i) => {
    const nh = normHeaders[i];
    const mQty = nh.match(/(.+?)\s*(quantité|quantite|qté|qte)$/);
    const mPu  = nh.match(/(.+?)\s*(pu|prix unitaire|p\.u\.?|p u)$/);
    const mMt  = nh.match(/(.+?)\s*(montant|mt)$/);
    const mU   = nh.match(/(.+?)\s*(u|unité|unite)$/);
    let key = null, type = null;
    if (mQty) { key = mQty[1].trim(); type = 'qty'; }
    else if (mPu) { key = mPu[1].trim(); type = 'pu'; }
    else if (mMt) { key = mMt[1].trim(); type = 'mt'; }
    else if (mU)  { key = mU[1].trim();  type = 'u'; }
    if (key) {
      if (key === 'moe') return; // ignorer MOE
      groups[key] = groups[key] || {};
      groups[key][type] = i;
    }
  });

  // créer/associer entreprises
  const companies = [];
  for (const key of Object.keys(groups)) {
    const name = key.replace(/\b\w/g, c => c.toUpperCase());
    const r1 = await query(
      'INSERT INTO companies (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id, name',
      [name]
    );
    const company = r1.rows[0];
    companies.push({ ...company, cols: groups[key] });
    await query('INSERT INTO lot_companies (lot_id, company_id) VALUES ($1,$2) ON CONFLICT (lot_id, company_id) DO NOTHING',
      [lotId, company.id]);
  }

  let position = 0;
  for (const row of rows) {
    const designation = row[desIdx];
    if (!designation || String(designation).trim() === '') continue;
    position += 1;
    const num = numIdx >= 0 ? row[numIdx] : null;
    const u   = uIdx   >= 0 ? row[uIdx]   : null;
    const qty = moeQIdx >= 0 ? safeNum(row[moeQIdx]) : null;
    const pu  = moePUIdx >= 0 ? safeNum(row[moePUIdx]) : null;
    const mt  = moeMTIdx >= 0 && row[moeMTIdx] !== '' ? safeNum(row[moeMTIdx]) : (qty!=null && pu!=null ? qty*pu : null);

    const itemRes = await query(
      'INSERT INTO items (lot_id, num, designation, unit, position) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [lotId, num, designation, u, position]
    );
    const itemId = itemRes.rows[0].id;

    await query('INSERT INTO moe_items (item_id, qty, unit_price, amount) VALUES ($1,$2,$3,$4)',
      [itemId, qty, pu, mt]);

    for (const comp of companies) {
      const ci = comp.cols;
      const uq = ci.qty != null ? safeNum(row[ci.qty]) : null;
      const up = ci.pu  != null ? safeNum(row[ci.pu])  : null;
      const uu = ci.u   != null ? row[ci.u]           : null;
      const um = ci.mt  != null && row[ci.mt] !== '' ? safeNum(row[ci.mt]) : (uq!=null && up!=null ? uq*up : null);
      if (uq!=null || up!=null || uu!=null || um!=null) {
        await query(
          'INSERT INTO offers (item_id, company_id, round_id, unit, qty, unit_price, amount) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (item_id, company_id, round_id) DO UPDATE SET unit = EXCLUDED.unit, qty = EXCLUDED.qty, unit_price = EXCLUDED.unit_price, amount = EXCLUDED.amount',
          [itemId, comp.id, roundId || null, uu, uq, up, um]
        );
      }
    }
  }

  return { companies: companies.map(c => ({ id: c.id, name: c.name })), itemsImported: position };
}
