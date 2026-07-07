// Audit lecture seule ciblé : projet 15 (6FERRANDI) — doublons même métrique / cellules manual+auto
import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const q = (sql, params) => pool.query(sql, params);

const proj = await q(`SELECT id, name FROM projects WHERE id = 15`);
console.log('=== PROJET ===');
console.table(proj.rows);

const lots = await q(`
  SELECT l.id, l.name, count(gq.id) n_questions,
         count(gq.id) FILTER (WHERE gq.question_type='manual') n_manual,
         count(gq.id) FILTER (WHERE COALESCE(gq.manual_edited,false)) n_edited,
         max(gq.created_at)::date derniere_creation
  FROM lots l LEFT JOIN generated_questions gq ON gq.lot_id = l.id
  WHERE l.project_id = 15
  GROUP BY l.id, l.name ORDER BY l.id`);
console.log('=== LOTS DU PROJET 15 ===');
console.table(lots.rows);

// A) Même cellule + même métrique (qty/price/amount) présente à PLUSIEURS niveaux
const sameMetric = await q(`
  SELECT gq.lot_id, gq.round_id, gq.item_id, gq.option_item_id, gq.company_id, c.name company,
         split_part(gq.question_type,'_',1) metric,
         array_agg(gq.question_type || '/' || gq.status || (CASE WHEN COALESCE(gq.manual_edited,false) THEN '/EDITÉ' ELSE '' END)
                   ORDER BY gq.id) versions,
         count(*) n
  FROM generated_questions gq
  JOIN lots l ON l.id = gq.lot_id AND l.project_id = 15
  LEFT JOIN companies c ON c.id = gq.company_id
  WHERE gq.question_type ~ '^(qty|price|amount)_'
  GROUP BY gq.lot_id, gq.round_id, gq.item_id, gq.option_item_id, gq.company_id, c.name, split_part(gq.question_type,'_',1)
  HAVING count(*) > 1
  ORDER BY gq.lot_id, gq.item_id, gq.company_id`);
console.log(`=== A) MÊME MÉTRIQUE À PLUSIEURS NIVEAUX (projet 15) : ${sameMetric.rowCount} cellules ===`);
console.table(sameMetric.rows.slice(0, 60));

// B) Cellules avec une question 'manual' ou éditée ACTIVE (non dismissée)
//    + au moins une question auto pending dans la même cellule
const coexist = await q(`
  WITH cell AS (
    SELECT gq.lot_id, gq.round_id, gq.item_id, gq.option_item_id, gq.company_id,
      bool_or((gq.question_type='manual' OR COALESCE(gq.manual_edited,false)) AND gq.status <> 'dismissed') has_user_active,
      count(*) FILTER (WHERE gq.question_type <> 'manual' AND NOT COALESCE(gq.manual_edited,false) AND gq.status = 'pending') n_auto_pending,
      array_agg(gq.question_type || '/' || gq.status || (CASE WHEN COALESCE(gq.manual_edited,false) THEN '/EDITÉ' ELSE '' END) ORDER BY gq.id) all_rows
    FROM generated_questions gq
    JOIN lots l ON l.id = gq.lot_id AND l.project_id = 15
    GROUP BY gq.lot_id, gq.round_id, gq.item_id, gq.option_item_id, gq.company_id
  )
  SELECT cell.lot_id, cell.item_id, cell.option_item_id, cell.company_id, c.name company, cell.n_auto_pending, cell.all_rows
  FROM cell LEFT JOIN companies c ON c.id = cell.company_id
  WHERE has_user_active AND n_auto_pending > 0
  ORDER BY cell.lot_id, cell.item_id, cell.company_id`);
console.log(`=== B) QUESTION UTILISATEUR ACTIVE + AUTO 'pending' À CÔTÉ (projet 15) : ${coexist.rowCount} cellules ===`);
console.table(coexist.rows.slice(0, 60));

await pool.end();
