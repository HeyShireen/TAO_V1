// Audit lecture seule : questions générées qui violent les seuils configurés
import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const q = (sql, params) => pool.query(sql, params);

// Seuils effectifs par lot (override ? lot : projet)
const thr = await q(`
  SELECT l.id lot_id, l.project_id,
    CASE WHEN COALESCE(ltc.qty_very_low_threshold_override,false) THEN ltc.qty_very_low_threshold ELSE pqc.qty_very_low_threshold END qvl,
    CASE WHEN COALESCE(ltc.qty_low_threshold_override,false) THEN ltc.qty_low_threshold ELSE pqc.qty_low_threshold END ql,
    CASE WHEN COALESCE(ltc.qty_high_threshold_override,false) THEN ltc.qty_high_threshold ELSE pqc.qty_high_threshold END qh,
    CASE WHEN COALESCE(ltc.qty_very_high_threshold_override,false) THEN ltc.qty_very_high_threshold ELSE pqc.qty_very_high_threshold END qvh,
    CASE WHEN COALESCE(ltc.price_very_low_threshold_override,false) THEN ltc.price_very_low_threshold ELSE pqc.price_very_low_threshold END pvl,
    CASE WHEN COALESCE(ltc.price_low_threshold_override,false) THEN ltc.price_low_threshold ELSE pqc.price_low_threshold END pl,
    CASE WHEN COALESCE(ltc.price_high_threshold_override,false) THEN ltc.price_high_threshold ELSE pqc.price_high_threshold END ph,
    CASE WHEN COALESCE(ltc.price_very_high_threshold_override,false) THEN ltc.price_very_high_threshold ELSE pqc.price_very_high_threshold END pvh,
    CASE WHEN COALESCE(ltc.amount_very_low_threshold_override,false) THEN ltc.amount_very_low_threshold ELSE pqc.amount_very_low_threshold END avl,
    CASE WHEN COALESCE(ltc.amount_low_threshold_override,false) THEN ltc.amount_low_threshold ELSE pqc.amount_low_threshold END al,
    CASE WHEN COALESCE(ltc.amount_high_threshold_override,false) THEN ltc.amount_high_threshold ELSE pqc.amount_high_threshold END ah,
    CASE WHEN COALESCE(ltc.amount_very_high_threshold_override,false) THEN ltc.amount_very_high_threshold ELSE pqc.amount_very_high_threshold END avh
  FROM lots l
  LEFT JOIN lot_threshold_config ltc ON ltc.lot_id = l.id
  LEFT JOIN project_question_config pqc ON pqc.project_id = l.project_id
`);
const thrByLot = new Map(thr.rows.map(r => [String(r.lot_id), r]));
const N = v => Number(v ?? NaN);

// 1) Questions générées dont l'écart ne justifie pas/plus le type
const gq = await q(`
  SELECT gq.id, gq.lot_id, gq.round_id, gq.question_type, gq.deviation_pct,
         gq.manual_edited, gq.created_at, l.project_id
  FROM generated_questions gq JOIN lots l ON l.id = gq.lot_id
  WHERE gq.question_type ~ '^(qty|price|amount)_'
`);
const violations = [];
for (const row of gq.rows) {
  const t = thrByLot.get(String(row.lot_id));
  if (!t) continue;
  const dev = N(row.deviation_pct);
  if (!Number.isFinite(dev)) continue;
  const [metric, ...rest] = row.question_type.split('_');
  const level = rest.join('_'); // very_low | low | high | very_high
  const k = { qty: ['qvl','ql','qh','qvh'], price: ['pvl','pl','ph','pvh'], amount: ['avl','al','ah','avh'] }[metric];
  const [vl, lo, hi, vh] = k.map(key => Math.abs(N(t[key])));
  let expected = null;
  if (dev < -vl) expected = 'very_low';
  else if (dev < -lo) expected = 'low';
  else if (dev > vh) expected = 'very_high';
  else if (dev > hi) expected = 'high';
  if (expected !== level) {
    violations.push({
      id: row.id, lot: row.lot_id, round: row.round_id, project: row.project_id,
      type: row.question_type, dev: dev.toFixed(1),
      attendu: expected ? `${metric}_${expected}` : 'AUCUNE QUESTION',
      manuel: row.manual_edited, cree: String(row.created_at).slice(0, 10)
    });
  }
}
console.log(`=== QUESTIONS EN BASE NE CORRESPONDANT PAS AUX SEUILS ACTUELS : ${violations.length} / ${gq.rows.length} ===`);
console.table(violations.slice(0, 60));
const byKind = {};
for (const v of violations) byKind[`${v.type} -> ${v.attendu}`] = (byKind[`${v.type} -> ${v.attendu}`] || 0) + 1;
console.log('Répartition:'); console.table(byKind);

// 2) Doublons : même item/entreprise/round avec plusieurs types de la même métrique
const dup = await q(`
  SELECT lot_id, round_id, item_id, option_item_id, company_id,
         split_part(question_type, '_', 1) metric,
         array_agg(question_type ORDER BY question_type) types, count(*) n
  FROM generated_questions
  WHERE question_type ~ '^(qty|price|amount)_'
  GROUP BY lot_id, round_id, item_id, option_item_id, company_id, split_part(question_type, '_', 1)
  HAVING count(*) > 1
  ORDER BY lot_id, item_id`);
console.log(`=== DOUBLONS (plusieurs niveaux pour la même métrique/article/entreprise) : ${dup.rowCount} ===`);
console.table(dup.rows.slice(0, 40));

await pool.end();
