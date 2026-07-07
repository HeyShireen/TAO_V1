// Test sans risque (tables TEMPORAIRES de session) du SQL dynamique des flags
// "poser ces questions" : migration 044 + upserts projet et lot.
import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const client = await pool.connect();
const q = (sql, params) => client.query(sql, params);

// Mêmes listes que dans config.js
const LOT_THRESHOLD_FIELDS = [
  'qty_very_low_threshold', 'qty_low_threshold', 'qty_high_threshold', 'qty_very_high_threshold',
  'price_very_low_threshold', 'price_low_threshold', 'price_high_threshold', 'price_very_high_threshold',
  'amount_very_low_threshold', 'amount_low_threshold', 'amount_high_threshold', 'amount_very_high_threshold'
];
const QUESTION_CONFIG_FIELDS = [
  'question_qty_very_low', 'question_qty_low', 'question_qty_high', 'question_qty_very_high',
  'question_price_very_low', 'question_price_low', 'question_price_high', 'question_price_very_high',
  'question_amount_very_low', 'question_amount_low', 'question_amount_high', 'question_amount_very_high',
  'unanswered_comment', 'unanswered_color', 'offer_amount_mismatch_comment', 'question_unit_mismatch'
];
const ASK_QUESTION_FIELDS = [
  'ask_questions_qty', 'ask_questions_price', 'ask_questions_amount',
  'ask_questions_unanswered', 'ask_questions_unit_mismatch', 'ask_questions_offer_amount_mismatch'
];

// Clones temporaires des tables réelles (contraintes uniques incluses)
await q(`CREATE TEMP TABLE tpc (LIKE project_question_config INCLUDING ALL)`);
await q(`CREATE TEMP TABLE tlqc (LIKE lot_question_config INCLUDING ALL)`);

// Migration 044 rejouée sur les clones
const alterCols = (table, withOverride) => ASK_QUESTION_FIELDS.map(f => {
  const cols = [`ADD COLUMN IF NOT EXISTS ${f} BOOLEAN NOT NULL DEFAULT true`];
  if (withOverride) cols.push(`ADD COLUMN IF NOT EXISTS ${f}_override BOOLEAN NOT NULL DEFAULT false`);
  return cols.join(', ');
}).join(', ');
await q(`ALTER TABLE tpc ${alterCols('tpc', false)}`);
await q(`ALTER TABLE tlqc ${alterCols('tlqc', true)}`);
console.log('Migration 044 (clones) : OK');

// 1) Upsert global (PUT /project/:id/lot-thresholds)
const thresholdValues = LOT_THRESHOLD_FIELDS.map(() => 15);
const questionValues = QUESTION_CONFIG_FIELDS.map(f => `texte ${f}`);
const askValues = ASK_QUESTION_FIELDS.map(f => f !== 'ask_questions_qty'); // qty décoché
const allConfigFields = [...LOT_THRESHOLD_FIELDS, ...QUESTION_CONFIG_FIELDS, ...ASK_QUESTION_FIELDS];
await q(
  `INSERT INTO tpc
    (project_id, ${allConfigFields.join(', ')}, updated_at)
   VALUES ($1, ${allConfigFields.map((_, idx) => `$${idx + 2}`).join(', ')}, now())
   ON CONFLICT (project_id)
   DO UPDATE SET
     ${allConfigFields.map(field => `${field} = EXCLUDED.${field}`).join(',\n     ')},
     updated_at = now()`,
  [999999, ...thresholdValues, ...questionValues, ...askValues]
);
// Rejouer pour vérifier le chemin ON CONFLICT
await q(
  `INSERT INTO tpc
    (project_id, ${allConfigFields.join(', ')}, updated_at)
   VALUES ($1, ${allConfigFields.map((_, idx) => `$${idx + 2}`).join(', ')}, now())
   ON CONFLICT (project_id)
   DO UPDATE SET
     ${allConfigFields.map(field => `${field} = EXCLUDED.${field}`).join(',\n     ')},
     updated_at = now()`,
  [999999, ...thresholdValues, ...questionValues, ...askValues]
);
const pRow = (await q(`SELECT ${ASK_QUESTION_FIELDS.join(', ')} FROM tpc WHERE project_id = 999999`)).rows[0];
console.log('Upsert projet : OK ->', pRow);

// 2) Upsert lot (PUT /lot/:id/question-config)
const lotConfigFields = [...QUESTION_CONFIG_FIELDS, ...ASK_QUESTION_FIELDS];
const lotConfigValues = [...questionValues, ...askValues];
const lotOverrideValues = lotConfigFields.map((_, i) => i % 2 === 0);
await q(
  `INSERT INTO tlqc
    (lot_id, ${lotConfigFields.join(', ')}, ${lotConfigFields.map(field => `${field}_override`).join(', ')}, updated_at)
   VALUES ($1, ${lotConfigFields.map((_, idx) => `$${idx + 2}`).join(', ')}, ${lotConfigFields.map((_, idx) => `$${idx + 2 + lotConfigFields.length}`).join(', ')}, now())
   ON CONFLICT (lot_id)
   DO UPDATE SET
     ${[...lotConfigFields, ...lotConfigFields.map(field => `${field}_override`)].map(field => `${field} = EXCLUDED.${field}`).join(',\n     ')},
     updated_at = now()
   RETURNING ask_questions_qty, ask_questions_qty_override, ask_questions_price, ask_questions_price_override`,
  [888888, ...lotConfigValues, ...lotOverrideValues]
);
const lRow = (await q(`SELECT ask_questions_qty, ask_questions_qty_override, ask_questions_unanswered FROM tlqc WHERE lot_id = 888888`)).rows[0];
console.log('Upsert lot : OK ->', lRow);

// 3) PUT /project/:id (route "config projet" du sous-onglet lot)
await q(
  `INSERT INTO tpc
    (project_id, question_qty_very_low, question_qty_low, question_qty_high, question_qty_very_high, question_price_very_low, question_price_low, question_price_high, question_price_very_high, question_amount_very_low, question_amount_low, question_amount_high, question_amount_very_high, unanswered_comment, unanswered_color, offer_amount_mismatch_comment, question_unit_mismatch, ${ASK_QUESTION_FIELDS.join(', ')}, updated_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, ${ASK_QUESTION_FIELDS.map((_, idx) => `$${idx + 18}`).join(', ')}, now())
   ON CONFLICT (project_id)
   DO UPDATE SET
     ${ASK_QUESTION_FIELDS.map(field => `${field} = EXCLUDED.${field}`).join(',\n     ')},
     updated_at = now()`,
  [999999, 'a','b','c','d','e','f','g','h','i','j','k','l','m','#fff3cd','n','o', ...askValues]
);
console.log('Upsert PUT /project : OK');

client.release();
await pool.end();
console.log('TOUS LES TESTS SQL PASSENT');
