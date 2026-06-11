// Diagnostic lecture seule : état des configs questions/seuils
import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const q = (sql, params) => pool.query(sql, params);

const projects = await q(`SELECT id, name FROM projects ORDER BY id`);
console.log('=== PROJETS ===');
console.table(projects.rows);

const pqc = await q(`SELECT project_id,
  qty_very_low_threshold, qty_low_threshold, qty_high_threshold, qty_very_high_threshold,
  price_very_low_threshold, price_low_threshold, price_high_threshold, price_very_high_threshold,
  amount_very_low_threshold, amount_low_threshold, amount_high_threshold, amount_very_high_threshold
  FROM project_question_config ORDER BY project_id`);
console.log('=== SEUILS PROJET (project_question_config) ===');
console.table(pqc.rows);

const pqcTexts = await q(`SELECT project_id,
  left(coalesce(question_qty_low,'<NULL>'),30) qty_low,
  left(coalesce(question_price_low,'<NULL>'),30) price_low,
  left(coalesce(offer_amount_mismatch_comment,'<NULL>'),40) mismatch_comment,
  left(coalesce(unanswered_comment,'<NULL>'),30) unanswered,
  left(coalesce(question_unit_mismatch,'<NULL>'),40) unit_mismatch
  FROM project_question_config ORDER BY project_id`);
console.log('=== TEXTES PROJET (extraits) ===');
console.table(pqcTexts.rows);

const ltc = await q(`SELECT ltc.lot_id, l.code, l.project_id,
  ltc.qty_very_low_threshold qvl, ltc.qty_low_threshold ql, ltc.qty_high_threshold qh, ltc.qty_very_high_threshold qvh,
  ltc.price_low_threshold pl, ltc.amount_low_threshold al,
  ltc.qty_very_low_threshold_override o_qvl, ltc.qty_low_threshold_override o_ql,
  ltc.qty_high_threshold_override o_qh, ltc.qty_very_high_threshold_override o_qvh,
  ltc.price_very_low_threshold_override o_pvl, ltc.price_low_threshold_override o_pl,
  ltc.price_high_threshold_override o_ph, ltc.price_very_high_threshold_override o_pvh,
  ltc.amount_very_low_threshold_override o_avl, ltc.amount_low_threshold_override o_al,
  ltc.amount_high_threshold_override o_ah, ltc.amount_very_high_threshold_override o_avh
  FROM lot_threshold_config ltc JOIN lots l ON l.id = ltc.lot_id
  ORDER BY l.project_id, ltc.lot_id`);
console.log('=== SEUILS LOT + OVERRIDES (lot_threshold_config) ===');
console.table(ltc.rows);

const lqc = await q(`SELECT lqc.lot_id, l.code, l.project_id,
  lqc.question_qty_low_override o_qty_low,
  lqc.question_price_low_override o_price_low,
  lqc.question_amount_low_override o_amount_low,
  lqc.unanswered_comment_override o_unansw,
  lqc.offer_amount_mismatch_comment_override o_mismatch,
  lqc.question_unit_mismatch_override o_unit,
  left(coalesce(lqc.question_qty_low,'<NULL>'),25) qty_low_txt,
  left(coalesce(lqc.offer_amount_mismatch_comment,'<NULL>'),30) mismatch_txt
  FROM lot_question_config lqc JOIN lots l ON l.id = lqc.lot_id
  ORDER BY l.project_id, lqc.lot_id`);
console.log('=== TEXTES LOT + OVERRIDES (lot_question_config) ===');
console.table(lqc.rows);

const gq = await q(`SELECT lot_id, round_id, question_type, count(*) n
  FROM generated_questions GROUP BY lot_id, round_id, question_type
  ORDER BY lot_id, round_id, question_type`);
console.log('=== QUESTIONS GENEREES PAR TYPE ===');
console.table(gq.rows);

await pool.end();
