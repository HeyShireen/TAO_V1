// Test sans risque de la logique generated_text : table TEMPORAIRE de session
// (aucune écriture dans les vraies tables de prod).
import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const client = await pool.connect();
const q = (sql, params) => client.query(sql, params);

// Index uniques réels (pour info)
const idx = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'generated_questions' AND indexdef LIKE '%UNIQUE%'`);
console.log('=== INDEX UNIQUES PROD ===');
idx.rows.forEach(r => console.log('-', r.indexdef));

// Table temporaire minimale reproduisant la clé d'upsert + la nouvelle colonne
await q(`CREATE TEMP TABLE tq (
  id BIGSERIAL PRIMARY KEY,
  lot_id BIGINT NOT NULL,
  round_id BIGINT,
  item_id BIGINT,
  option_item_id BIGINT,
  company_id BIGINT NOT NULL,
  question_type TEXT NOT NULL,
  question_text TEXT NOT NULL,
  generated_text TEXT,
  moe_value NUMERIC, offer_value NUMERIC, deviation_pct NUMERIC,
  comment TEXT,
  manual_edited BOOLEAN NOT NULL DEFAULT false,
  status TEXT DEFAULT 'pending'
)`);
await q(`CREATE UNIQUE INDEX tq_item_key ON tq (round_id, lot_id, item_id, company_id, question_type) WHERE item_id IS NOT NULL`);

// Cas 1 : question éditée AVEC baseline — la phrase doit se substituer en gardant l'ajout
await q(`INSERT INTO tq (lot_id, round_id, item_id, company_id, question_type, question_text, generated_text, manual_edited)
         VALUES (1, 1, 100, 10, 'price_low', E'Ancienne phrase prix.\nRemarque ajoutée par l''utilisateur.', 'Ancienne phrase prix.', true)`);
// Cas 2 : question non éditée — texte remplacé entièrement
await q(`INSERT INTO tq (lot_id, round_id, item_id, company_id, question_type, question_text, generated_text, manual_edited)
         VALUES (1, 1, 101, 10, 'price_low', 'Ancienne phrase prix.', 'Ancienne phrase prix.', false)`);
// Cas 3 : question éditée SANS baseline (état post-migration) — texte figé, baseline posée
await q(`INSERT INTO tq (lot_id, round_id, item_id, company_id, question_type, question_text, generated_text, manual_edited)
         VALUES (1, 1, 102, 10, 'price_low', 'Texte entièrement réécrit par l''utilisateur.', NULL, true)`);
// Cas 4 : question éditée dont le texte ne contient plus la baseline — texte figé
await q(`INSERT INTO tq (lot_id, round_id, item_id, company_id, question_type, question_text, generated_text, manual_edited)
         VALUES (1, 1, 103, 10, 'price_low', 'Texte entièrement réécrit.', 'Ancienne phrase prix.', true)`);

// Même SQL que l'upsert de config.js (table renommée tq)
const editedTextSql = `CASE
   WHEN tq.generated_text IS NOT NULL
    AND tq.generated_text <> ''
    AND tq.generated_text <> EXCLUDED.generated_text
    AND position(tq.generated_text IN tq.question_text) > 0
   THEN replace(tq.question_text, tq.generated_text, EXCLUDED.generated_text)
   ELSE tq.question_text
 END`;
const upsert = (itemId) => q(
  `INSERT INTO tq
    (lot_id, item_id, company_id, question_type, question_text, generated_text, moe_value, offer_value, deviation_pct, comment, round_id)
   VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (round_id, lot_id, item_id, company_id, question_type)
     WHERE item_id IS NOT NULL
   DO UPDATE SET
     question_text = CASE
       WHEN COALESCE(tq.manual_edited, false) THEN ${editedTextSql}
       ELSE EXCLUDED.question_text
     END,
     generated_text = EXCLUDED.generated_text,
     moe_value = EXCLUDED.moe_value,
     offer_value = EXCLUDED.offer_value,
     deviation_pct = EXCLUDED.deviation_pct,
     comment = CASE
       WHEN COALESCE(tq.manual_edited, false) THEN tq.comment
       ELSE EXCLUDED.comment
     END`,
  [1, itemId, 10, 'price_low', 'Nouvelle phrase prix.', 5, 4, -20, null, 1]
);
for (const itemId of [100, 101, 102, 103]) await upsert(itemId);

const res = await q(`SELECT item_id, manual_edited, question_text, generated_text FROM tq ORDER BY item_id`);
console.log('=== RÉSULTAT APRÈS RÉGÉNÉRATION SIMULÉE (nouvelle phrase : "Nouvelle phrase prix.") ===');
for (const r of res.rows) {
  console.log(`item ${r.item_id} (édité=${r.manual_edited}) -> texte: ${JSON.stringify(r.question_text)} | baseline: ${JSON.stringify(r.generated_text)}`);
}

client.release();
await pool.end();
