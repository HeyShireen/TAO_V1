// Audit lecture seule : cohabitation questions manuelles/éditées et questions auto-générées
import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const q = (sql, params) => pool.query(sql, params);

// 0) Répartition des types de questions
const types = await q(`
  SELECT question_type, count(*) n,
         count(*) FILTER (WHERE COALESCE(manual_edited,false)) n_manual_edited
  FROM generated_questions
  GROUP BY question_type ORDER BY n DESC`);
console.log('=== RÉPARTITION DES TYPES ===');
console.table(types.rows);

// 1) Cellules (item/option × entreprise × round) avec PLUSIEURS questions dont
//    au moins une manuelle (type 'manual') ou éditée (manual_edited=true)
const dup = await q(`
  WITH cells AS (
    SELECT lot_id, round_id, item_id, option_item_id, company_id,
           count(*) n,
           bool_or(question_type = 'manual') has_manual,
           bool_or(COALESCE(manual_edited,false)) has_edited
    FROM generated_questions
    GROUP BY lot_id, round_id, item_id, option_item_id, company_id
    HAVING count(*) > 1
  )
  SELECT gq.id, gq.lot_id, l.name lot_name, gq.round_id, gq.item_id, gq.option_item_id,
         gq.company_id, c.name company_name, gq.question_type, gq.status,
         COALESCE(gq.manual_edited,false) edited, gq.deviation_pct,
         left(gq.question_text, 60) texte, gq.created_at::date cree
  FROM generated_questions gq
  JOIN cells ON cells.lot_id = gq.lot_id AND cells.round_id = gq.round_id
    AND cells.company_id = gq.company_id
    AND cells.item_id IS NOT DISTINCT FROM gq.item_id
    AND cells.option_item_id IS NOT DISTINCT FROM gq.option_item_id
  JOIN lots l ON l.id = gq.lot_id
  LEFT JOIN companies c ON c.id = gq.company_id
  WHERE cells.has_manual OR cells.has_edited
  ORDER BY gq.created_at DESC, gq.lot_id, gq.item_id, gq.option_item_id, gq.company_id, gq.id
  LIMIT 120`);
console.log(`=== CELLULES MULTI-QUESTIONS AVEC MANUELLE/ÉDITÉE : ${dup.rowCount} lignes ===`);
console.table(dup.rows);

// 2) Activité récente (créations des 3 derniers jours)
const recent = await q(`
  SELECT gq.created_at::date jour, gq.lot_id, l.name lot_name, count(*) n,
         count(*) FILTER (WHERE gq.question_type = 'manual') n_manual,
         count(*) FILTER (WHERE COALESCE(gq.manual_edited,false)) n_edited
  FROM generated_questions gq JOIN lots l ON l.id = gq.lot_id
  WHERE gq.created_at >= now() - interval '3 days'
  GROUP BY 1, 2, 3 ORDER BY 1 DESC, n DESC`);
console.log('=== CRÉATIONS RÉCENTES (3 jours) ===');
console.table(recent.rows);

await pool.end();
