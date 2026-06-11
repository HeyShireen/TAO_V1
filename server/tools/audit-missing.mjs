// Audit lecture seule : offres dont l'écart dépasse les seuils mais sans question générée
import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const q = (sql, params) => pool.query(sql, params);
const N = v => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : null; };

// Derniers rounds ayant des questions générées, par lot
const rounds = await q(`SELECT DISTINCT lot_id, round_id FROM generated_questions`);

const thr = await q(`
  SELECT l.id lot_id, l.project_id, pqc.*
  FROM lots l JOIN project_question_config pqc ON pqc.project_id = l.project_id`);
const thrByLot = new Map(thr.rows.map(r => [String(r.lot_id), r]));

const classify = (dev, vl, lo, hi, vh) => {
  if (dev < -Math.abs(vl)) return 'very_low';
  if (dev < -Math.abs(lo)) return 'low';
  if (dev > Math.abs(vh)) return 'very_high';
  if (dev > Math.abs(hi)) return 'high';
  return null;
};

let totalMissing = 0;
const samples = [];
for (const { lot_id, round_id } of rounds.rows) {
  const t = thrByLot.get(String(lot_id));
  if (!t) continue;
  const offers = await q(`
    SELECT o.item_id, o.company_id, o.qty, o.unit_price, o.amount, o.unit offer_unit,
           i.unit item_unit, m.qty moe_qty, m.unit_price moe_up, m.amount moe_amount
    FROM offers o
    JOIN items i ON i.id = o.item_id AND i.lot_id = $1
    JOIN moe_items m ON m.item_id = o.item_id
    WHERE o.round_id = $2`, [lot_id, round_id]);
  const existing = await q(`
    SELECT item_id, company_id, question_type FROM generated_questions
    WHERE lot_id = $1 AND round_id = $2 AND item_id IS NOT NULL`, [lot_id, round_id]);
  const have = new Set(existing.rows.map(r => `${r.item_id}_${r.company_id}_${r.question_type}`));
  const haveAny = new Set(existing.rows.map(r => `${r.item_id}_${r.company_id}`));

  for (const o of offers.rows) {
    const qty = N(o.qty), up = N(o.unit_price);
    if (!qty || !up) continue; // unanswered → géré ailleurs
    const expected = [];
    const mq = N(o.moe_qty), mup = N(o.moe_up), mamt = N(o.moe_amount);
    if (mq != null && mq !== 0) {
      const c = classify(((qty - mq) / mq) * 100, t.qty_very_low_threshold, t.qty_low_threshold, t.qty_high_threshold, t.qty_very_high_threshold);
      if (c) expected.push(`qty_${c}`);
    }
    if (mup != null && mup !== 0) {
      const c = classify(((up - mup) / mup) * 100, t.price_very_low_threshold, t.price_low_threshold, t.price_high_threshold, t.price_very_high_threshold);
      if (c) expected.push(`price_${c}`);
    }
    const oamt = N(o.amount) ?? qty * up;
    if (mamt != null && mamt !== 0 && oamt != null) {
      const c = classify(((oamt - mamt) / mamt) * 100, t.amount_very_low_threshold, t.amount_low_threshold, t.amount_high_threshold, t.amount_very_high_threshold);
      if (c) expected.push(`amount_${c}`);
    }
    for (const type of expected) {
      if (!have.has(`${o.item_id}_${o.company_id}_${type}`)) {
        totalMissing++;
        if (samples.length < 40) samples.push({
          lot: lot_id, round: round_id, item: o.item_id, cie: o.company_id, manquant: type,
          unite_item: o.item_unit, unite_offre: o.offer_unit,
          autre_question: [...have].some(k => k.startsWith(`${o.item_id}_${o.company_id}_`))
            ? existing.rows.filter(r => `${r.item_id}` === `${o.item_id}` && `${r.company_id}` === `${o.company_id}`).map(r => r.question_type).join(',')
            : '(aucune)'
        });
      }
    }
  }
}
console.log(`=== QUESTIONS MANQUANTES (écart > seuil mais pas de question) : ${totalMissing} ===`);
console.table(samples);
await pool.end();
