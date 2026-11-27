import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { query, pool } from '../../db.js';
import { requireAuth, preserveDbContext } from '../../middleware/auth.js';
import { requireRole, isResponsableOrAdmin } from '../../middleware/roles.js';
import { canViewProject, canEditProject } from '../../utils/permissions.js';
import { previewExcel, applyImport, convertPdfToExcelBuffer } from '../../importers/smart-import.js';
import { redisSet, redisGet } from '../../utils/redis.js';
import { companyScope } from '../../utils/company-scope.js';

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10 Mo max
const router = express.Router();
router.use(requireAuth);

// Cache temporaire des fichiers import (preview → apply sans re-upload)
const tempFileCache = new Map();
// 10 minutes ne couvraient pas la realite d'un import : entre l'apercu et la
// validation, l'utilisateur regle le mapping, exclut des lignes et verifie les
// colonnes, ce qui depasse largement ce delai sur une DPGF un peu fournie. Le
// fichier cache disparaissait alors, et l'apply repondait « Fichier manquant »
// sans qu'aucun nouveau clic ne puisse y remedier.
const TEMP_FILE_TTL = 45 * 60 * 1000; // 45 minutes
const TEMP_FILE_MAX_ENTRIES = 24;
const TEMP_FILE_MAX_BYTES = 80 * 1024 * 1024; // 80 Mo max en memoire

function getBufferSize(buffer) {
  if (!buffer) return 0;
  if (typeof buffer.byteLength === 'number') return buffer.byteLength;
  if (typeof buffer.length === 'number') return buffer.length;
  return 0;
}

function getTempCacheBytes() {
  let total = 0;
  for (const entry of tempFileCache.values()) {
    total += entry.size || getBufferSize(entry.buffer);
  }
  return total;
}

function cleanupTempFileCache(now = Date.now()) {
  for (const [k, v] of tempFileCache) {
    if (now - v.ts > TEMP_FILE_TTL) tempFileCache.delete(k);
  }

  while (
    tempFileCache.size > TEMP_FILE_MAX_ENTRIES
    || getTempCacheBytes() > TEMP_FILE_MAX_BYTES
  ) {
    const oldestKey = tempFileCache.keys().next().value;
    if (!oldestKey) break;
    tempFileCache.delete(oldestKey);
  }
}

// Le cache mémoire ci-dessus est propre au process. Avec PM2 en cluster (ou un
// redéploiement entre le preview et l'apply), l'étape apply peut être servie par
// une autre instance et ne retrouve alors pas le fichier : l'utilisateur doit
// tout recommencer. On double donc le stockage dans Redis, qui est partagé.
// Redis absent → `redisSet`/`redisGet` retombent sur leur propre cache mémoire,
// donc le comportement reste celui d'avant.
const TEMP_FILE_REDIS_PREFIX = 'import:tempfile:';

async function cacheTempFile(buffer, meta) {
  cleanupTempFileCache();

  // Chaque apercu rappelle cette fonction : changer d'onglet, corriger la ligne
  // d'en-tete ou revenir a l'etape 1 creait une entree de plus pour le MEME
  // fichier. Passe TEMP_FILE_MAX_ENTRIES, l'eviction supprimait l'entree dont
  // l'etape apply avait besoin — d'ou des « Fichier manquant » sur un import
  // pourtant tout juste previsualise. On reutilise donc l'entree existante
  // lorsque l'empreinte du contenu est identique.
  const empreinte = crypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex');
  let id = null;
  for (const [cle, entree] of tempFileCache) {
    if (entree.empreinte === empreinte) { id = cle; break; }
  }

  if (id) {
    const entree = tempFileCache.get(id);
    entree.ts = Date.now();
    // Reinserer en fin de Map : l'eviction retire les entrees les plus anciennes.
    tempFileCache.delete(id);
    tempFileCache.set(id, entree);
  } else {
    id = crypto.randomUUID();
    tempFileCache.set(id, { buffer, ts: Date.now(), size: getBufferSize(buffer), empreinte, ...meta });
  }
  cleanupTempFileCache();

  try {
    await redisSet(
      `${TEMP_FILE_REDIS_PREFIX}${id}`,
      JSON.stringify({ ...meta, data: Buffer.from(buffer).toString('base64') }),
      Math.floor(TEMP_FILE_TTL / 1000)
    );
  } catch (e) {
    // Le cache mémoire suffit au cas mono-instance : on n'échoue pas l'import.
    console.warn('[import] mise en cache Redis du fichier impossible:', e.message);
  }
  return id;
}

async function getTempFile(id) {
  cleanupTempFileCache();
  const entry = tempFileCache.get(id);
  if (entry && Date.now() - entry.ts <= TEMP_FILE_TTL) return entry;
  if (entry) tempFileCache.delete(id);

  // Pas (ou plus) en mémoire locale : tenter le cache partagé.
  try {
    const raw = await redisGet(`${TEMP_FILE_REDIS_PREFIX}${id}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data) return null;
    const buffer = Buffer.from(parsed.data, 'base64');
    const restored = {
      buffer,
      ts: Date.now(),
      size: getBufferSize(buffer),
      mime: parsed.mime,
      name: parsed.name,
    };
    // Remettre en mémoire locale pour les éventuels appels suivants.
    tempFileCache.set(id, restored);
    cleanupTempFileCache();
    return restored;
  } catch (e) {
    console.warn('[import] lecture du cache Redis impossible:', e.message);
    return null;
  }
}

/**
 * Compte ce que le mode « replace » peut détruire dans un lot, pour l'afficher
 * avant confirmation. On ne simule pas le matching (trop coûteux à ce stade) :
 * on expose l'état actuel, qui est la portée maximale de la suppression.
 */
async function getReplaceImpact(lotId) {
  const { rows } = await query(
    `SELECT
       (SELECT count(*) FROM items WHERE lot_id = $1) AS items,
       (SELECT count(*) FROM items
          WHERE lot_id = $1 AND source_company_id IS NOT NULL) AS added_items,
       (SELECT count(*) FROM moe_items m
          JOIN items i ON i.id = m.item_id WHERE i.lot_id = $1) AS moe_rows,
       (SELECT count(*) FROM offers o
          JOIN items i ON i.id = o.item_id WHERE i.lot_id = $1) AS offers`,
    [lotId]
  );
  const r = rows[0] || {};
  // count(*) revient en string via node-postgres : conversion explicite.
  return {
    items: Number(r.items || 0),
    addedItems: Number(r.added_items || 0),
    moeRows: Number(r.moe_rows || 0),
    offers: Number(r.offers || 0),
  };
}

// Helper: Résoudre le project_id d'un lot
function parseGridNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/[€$£¥₹]/g, '').replace(/[\u00A0\u202F\u2009\s]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 || lastDot > -1) {
    const last = Math.max(lastComma, lastDot);
    const decSep = s[last];
    s = s.replace(/[.,]/g, (m, idx) => (idx === last ? m : '')).replace(decSep, '.');
  }
  s = s.replace(/[^0-9.\-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function getProjectIdForLot(lotId) {
  const result = await query('SELECT project_id FROM lots WHERE id = $1', [lotId]);
  return result.rows[0]?.project_id || null;
}

function isPdfFile({ mime, name }) {
  if (mime && mime.toLowerCase() === 'application/pdf') return true;
  if (name && name.toLowerCase().endsWith('.pdf')) return true;
  return false;
}

async function mergeLotCompanyInto(client, { lotId, fromCompanyId, toCompanyId }) {
  if (Number(fromCompanyId) === Number(toCompanyId)) return { merged: false };
  const optionalTablesRes = await client.query(
    `SELECT
       to_regclass('public.round_offers') IS NOT NULL AS has_round_offers,
       to_regclass('public.question_sheets') IS NOT NULL AS has_question_sheets,
       to_regclass('public.question_sheet_sends') IS NOT NULL AS has_question_sheet_sends,
       to_regclass('public.option_item_offers') IS NOT NULL AS has_option_item_offers`
  );
  const optionalTables = optionalTablesRes.rows[0] || {};

  await client.query(
    `INSERT INTO lot_companies (lot_id, company_id, display_name, created_at)
     SELECT lot_id, $3, NULL, created_at
     FROM lot_companies
     WHERE lot_id = $1 AND company_id = $2
     ON CONFLICT (lot_id, company_id) DO UPDATE
     SET display_name = NULL`,
    [lotId, fromCompanyId, toCompanyId]
  );

  await client.query(
    `UPDATE offers target
     SET unit = COALESCE(target.unit, source.unit),
         qty = COALESCE(target.qty, source.qty),
         unit_price = COALESCE(target.unit_price, source.unit_price),
         amount = COALESCE(target.amount, source.amount),
         comment = COALESCE(target.comment, source.comment),
         offer_designation = COALESCE(target.offer_designation, source.offer_designation)
     FROM offers source
     JOIN items i ON i.id = source.item_id
     WHERE i.lot_id = $1
       AND source.company_id = $2
       AND target.company_id = $3
       AND target.item_id = source.item_id
       AND target.round_id IS NOT DISTINCT FROM source.round_id`,
    [lotId, fromCompanyId, toCompanyId]
  );
  await client.query(
    `DELETE FROM offers source
     USING offers target, items i
     WHERE i.id = source.item_id
       AND i.lot_id = $1
       AND source.company_id = $2
       AND target.company_id = $3
       AND target.item_id = source.item_id
       AND target.round_id IS NOT DISTINCT FROM source.round_id`,
    [lotId, fromCompanyId, toCompanyId]
  );
  await client.query(
    `UPDATE offers o
     SET company_id = $3
     FROM items i
     WHERE i.id = o.item_id
       AND i.lot_id = $1
       AND o.company_id = $2`,
    [lotId, fromCompanyId, toCompanyId]
  );

  if (optionalTables.has_option_item_offers) {
    await client.query(
      `UPDATE option_item_offers target
       SET qty = COALESCE(target.qty, source.qty),
           unit_price = COALESCE(target.unit_price, source.unit_price)
       FROM option_item_offers source
       JOIN option_items oi ON oi.id = source.option_item_id
       JOIN options opt ON opt.id = oi.option_id
       WHERE opt.lot_id = $1
         AND source.company_id = $2
         AND target.company_id = $3
         AND target.option_item_id = source.option_item_id
         AND target.round_id IS NOT DISTINCT FROM source.round_id`,
      [lotId, fromCompanyId, toCompanyId]
    );
    await client.query(
      `DELETE FROM option_item_offers source
       USING option_item_offers target, option_items oi, options opt
       WHERE oi.id = source.option_item_id
         AND opt.id = oi.option_id
         AND opt.lot_id = $1
         AND source.company_id = $2
         AND target.company_id = $3
         AND target.option_item_id = source.option_item_id
         AND target.round_id IS NOT DISTINCT FROM source.round_id`,
      [lotId, fromCompanyId, toCompanyId]
    );
    await client.query(
      `UPDATE option_item_offers oio
       SET company_id = $3
       FROM option_items oi
       JOIN options opt ON opt.id = oi.option_id
       WHERE oi.id = oio.option_item_id
         AND opt.lot_id = $1
         AND oio.company_id = $2`,
      [lotId, fromCompanyId, toCompanyId]
    );
  }

  await client.query(
    `UPDATE generated_questions target
     SET question_text = COALESCE(target.question_text, source.question_text),
         moe_value = COALESCE(target.moe_value, source.moe_value),
         offer_value = COALESCE(target.offer_value, source.offer_value),
         deviation_pct = COALESCE(target.deviation_pct, source.deviation_pct),
         comment = COALESCE(target.comment, source.comment),
         answered_at = COALESCE(target.answered_at, source.answered_at)
     FROM generated_questions source
     WHERE source.lot_id = $1
       AND source.company_id = $2
       AND target.lot_id = source.lot_id
       AND target.company_id = $3
       AND target.round_id IS NOT DISTINCT FROM source.round_id
       AND target.item_id IS NOT DISTINCT FROM source.item_id
       AND target.option_item_id IS NOT DISTINCT FROM source.option_item_id
       AND target.question_type = source.question_type`,
    [lotId, fromCompanyId, toCompanyId]
  );
  await client.query(
    `DELETE FROM generated_questions source
     USING generated_questions target
     WHERE source.lot_id = $1
       AND source.company_id = $2
       AND target.lot_id = source.lot_id
       AND target.company_id = $3
       AND target.round_id IS NOT DISTINCT FROM source.round_id
       AND target.item_id IS NOT DISTINCT FROM source.item_id
       AND target.option_item_id IS NOT DISTINCT FROM source.option_item_id
       AND target.question_type = source.question_type`,
    [lotId, fromCompanyId, toCompanyId]
  );
  await client.query(
    `UPDATE generated_questions
     SET company_id = $3
     WHERE lot_id = $1 AND company_id = $2`,
    [lotId, fromCompanyId, toCompanyId]
  );

  if (optionalTables.has_round_offers) {
    await client.query(
      `UPDATE round_offers target
       SET unit = COALESCE(target.unit, source.unit),
           qty = COALESCE(target.qty, source.qty),
           unit_price = COALESCE(target.unit_price, source.unit_price),
           amount = COALESCE(target.amount, source.amount)
       FROM round_offers source
       JOIN items i ON i.id = source.item_id
       WHERE i.lot_id = $1
         AND source.company_id = $2
         AND target.company_id = $3
         AND target.round_id IS NOT DISTINCT FROM source.round_id
         AND target.item_id = source.item_id`,
      [lotId, fromCompanyId, toCompanyId]
    );
    await client.query(
      `DELETE FROM round_offers source
       USING round_offers target, items i
       WHERE i.id = source.item_id
         AND i.lot_id = $1
         AND source.company_id = $2
         AND target.company_id = $3
         AND target.round_id IS NOT DISTINCT FROM source.round_id
         AND target.item_id = source.item_id`,
      [lotId, fromCompanyId, toCompanyId]
    );
    await client.query(
      `UPDATE round_offers ro
       SET company_id = $3
       FROM items i
       WHERE i.id = ro.item_id
         AND i.lot_id = $1
         AND ro.company_id = $2`,
      [lotId, fromCompanyId, toCompanyId]
    );
  }

  if (optionalTables.has_question_sheets) {
    await client.query(
      `UPDATE question_sheets qs
       SET company_id = $3
       FROM items i
       WHERE i.id = qs.item_id
         AND i.lot_id = $1
         AND qs.company_id = $2`,
      [lotId, fromCompanyId, toCompanyId]
    );
  }
  if (optionalTables.has_question_sheet_sends) {
    await client.query(
      `UPDATE question_sheet_sends
       SET company_id = $3
       WHERE lot_id = $1 AND company_id = $2`,
      [lotId, fromCompanyId, toCompanyId]
    );
  }
  await client.query(
    `UPDATE items
     SET source_company_id = $3
     WHERE lot_id = $1 AND source_company_id = $2`,
    [lotId, fromCompanyId, toCompanyId]
  );
  await client.query(
    'DELETE FROM lot_companies WHERE lot_id = $1 AND company_id = $2',
    [lotId, fromCompanyId]
  );

  return { merged: true };
}

/* ---------- RAW LOT (pour construire le tableur) ---------- */
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const roundId = req.query.round_id ? Number(req.query.round_id) : null;
  const scope = companyScope(req);
  const isEntreprise = scope.isEntreprise;
  const userCompanyId = scope.companyId;
  if (scope.orphan) {
    return res.status(403).json({ error: 'Aucune entreprise associée à votre compte' });
  }

  try {
    // SÉCURITÉ: Vérifier que l'utilisateur peut voir le projet de ce lot
    const projectId = await getProjectIdForLot(id);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canView = await canViewProject(req.user.id, projectId, req.user.role, userCompanyId);
    if (!canView) return res.status(403).json({ error: 'Accès refusé à ce lot' });

    // Construire la condition pour filtrer les offres par round_id
    const offerCondition = roundId ? 'AND o.round_id = $2' : '';
    const queryParams = roundId ? [id, roundId] : [id];
    
    // Une seule requête optimisée avec JOINs
    const result = await query(`
      SELECT 
        l.id as lot_id, l.code, l.name as lot_name, l.project_id,
        i.id as item_id, i.num, i.designation, i.unit, i.position, i.source_company_id, i.parent_item_id,
        parent_i.num as parent_num, parent_i.designation as parent_designation,
        ${isEntreprise ? 'NULL AS moe_qty, NULL AS moe_unit_price, NULL AS moe_amount,' : 'm.qty as moe_qty, m.unit_price as moe_unit_price, m.amount as moe_amount,'}
        (SELECT json_agg(jsonb_build_object(
           'id', c2.id,
           'name', COALESCE(NULLIF(lc2.display_name, ''), c2.name),
           'original_name', c2.name,
           'display_name', lc2.display_name,
           'color', c2.color,
           'email', c2.email
         ) ORDER BY lc2.created_at, c2.id)
         FROM lot_companies lc2
         JOIN companies c2 ON c2.id = lc2.company_id
         WHERE lc2.lot_id = l.id
         ${scope.sqlAnd('c2.id')}) as companies,
        json_agg(jsonb_build_object(
          'id', o.id,
          'item_id', o.item_id,
          'company_id', o.company_id,
          'round_id', o.round_id,
          'unit', o.unit,
          'qty', o.qty,
          'unit_price', o.unit_price,
          'amount', o.amount,
          'offer_designation', o.offer_designation,
          'comment', o.comment
        )) FILTER (WHERE o.id IS NOT NULL${scope.sqlAnd('o.company_id')}) as offers
      FROM lots l
      LEFT JOIN items i ON i.lot_id = l.id${scope.sqlAndOwnOrShared('i.source_company_id')}
      LEFT JOIN items parent_i ON parent_i.id = i.parent_item_id
      ${isEntreprise ? '' : 'LEFT JOIN moe_items m ON m.item_id = i.id'}
      LEFT JOIN offers o ON o.item_id = i.id ${offerCondition}
      WHERE l.id = $1
      GROUP BY l.id, i.id, parent_i.id${isEntreprise ? '' : ', m.item_id'}
      ORDER BY i.position NULLS LAST, i.id
    `, queryParams);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Lot introuvable' });
    }

    // Restructurer les données
    const firstRow = result.rows[0];
    const lot = {
      id: firstRow.lot_id,
      code: firstRow.code,
      name: firstRow.lot_name,
      project_id: firstRow.project_id
    };

    // Extraire les entreprises (déjà triées par created_at dans la sous-requête)
    const companies = firstRow.companies || [];

    // Extraire items avec leurs données MOE
    const itemsMap = new Map();
    const moeList = isEntreprise ? [] : [];
    const offersByKey = new Map();
    let duplicatedOffersCount = 0;
    const duplicatedOfferSamples = [];

    result.rows.forEach(row => {
      if (row.item_id && !itemsMap.has(row.item_id)) {
        itemsMap.set(row.item_id, {
          id: row.item_id,
          lot_id: row.lot_id,
          num: row.num,
          designation: row.designation,
          unit: row.unit,
          position: row.position,
          source_company_id: row.source_company_id || null,
          parent_item_id: row.parent_item_id || null,
          parent_num: row.parent_num || null,
          parent_designation: row.parent_designation || null
        });

        if (!isEntreprise && (row.moe_qty !== null || row.moe_unit_price !== null)) {
          moeList.push({
            item_id: row.item_id,
            qty: row.moe_qty,
            unit_price: row.moe_unit_price,
            amount: row.moe_amount
          });
        }
      }

      if (row.offers) {
        row.offers.forEach(offer => {
          const itemId = Number(offer.item_id);
          const companyId = Number(offer.company_id);
          if (!Number.isFinite(itemId) || !Number.isFinite(companyId)) return;

          const offerRoundId = Number(offer.round_id);
          const key = `${itemId}_${companyId}_${Number.isFinite(offerRoundId) ? offerRoundId : 'none'}`;
          const offerId = Number(offer.id) || 0;
          const previous = offersByKey.get(key);

          if (previous) {
            duplicatedOffersCount += 1;
            if (duplicatedOfferSamples.length < 15) {
              duplicatedOfferSamples.push({
                lotId: id,
                roundId: Number.isFinite(offerRoundId) ? offerRoundId : null,
                itemId,
                companyId,
                keptOfferId: Math.max(offerId, previous._offerId || 0),
                droppedOfferId: Math.min(offerId || 0, previous._offerId || 0)
              });
            }
          }

          if (!previous || offerId >= previous._offerId) {
            offersByKey.set(key, {
              ...offer,
              _offerId: offerId
            });
          }
        });
      }
    });

    const offersList = Array.from(offersByKey.values()).map(({ _offerId, ...offer }) => offer);

    if (duplicatedOffersCount > 0) {
      console.warn('[AMOUNT-DIAG][lots.get] Offres dupliquées détectées pour item+entreprise+tour', {
        lotId: id,
        requestedRoundId: roundId,
        duplicatedOffersCount,
        samples: duplicatedOfferSamples
      });
    }

    // Filtrer les offres par company pour entreprise (déjà fait en SQL) mais garde sécurité côté code
    const filteredOffers = isEntreprise && userCompanyId
      ? offersList.filter(o => o.company_id === userCompanyId)
      : offersList;

    res.json({
      lot,
      items: Array.from(itemsMap.values()),
      moe: moeList,
      companies: companies || [],
      offers: filteredOffers
    });

  } catch (err) {
    console.error('Erreur GET lot:', err);
    res.status(500).json({ error: 'Erreur lors du chargement du lot' });
  }
});

/* ---------- TABLE COMPARATIVE (lecture) ---------- */
router.get('/:id/table', async (req, res) => {
  const id = Number(req.params.id);
  const roundId = req.query.round_id ? Number(req.query.round_id) : null;
  const scope = companyScope(req);
  const isEntreprise = scope.isEntreprise;
  const userCompanyId = scope.companyId;
  if (scope.orphan) {
    return res.status(403).json({ error: 'Aucune entreprise associée à votre compte' });
  }

  try {
  // SÉCURITÉ: Vérifier que l'utilisateur peut voir le projet de ce lot
  const projectId = await getProjectIdForLot(id);
  if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
  const canView = await canViewProject(req.user.id, projectId, req.user.role, userCompanyId);
  if (!canView) return res.status(403).json({ error: 'Accès refusé à ce lot' });

  const itemsRes = await query(`
    SELECT i.*, p.num AS parent_num, p.designation AS parent_designation
    FROM items i
    LEFT JOIN items p ON p.id = i.parent_item_id
    WHERE i.lot_id=$1${scope.sqlAndOwnOrShared('i.source_company_id')}
    ORDER BY i.position NULLS LAST, i.id
  `, [id]);
  const itemIds = itemsRes.rows.map(r => r.id);

  const moeRes = (!isEntreprise && itemIds.length)
    ? await query('SELECT * FROM moe_items WHERE item_id = ANY($1::int[])', [itemIds])
    : { rows: [] };

  const moeByItem = new Map(moeRes.rows.map(r => [r.item_id, r]));

  const compsRes = await query(
    `SELECT c.id,
            COALESCE(NULLIF(lc.display_name, ''), c.name) AS name,
            c.name AS original_name,
            lc.display_name,
            c.color
     FROM lot_companies lc
     JOIN companies c ON c.id=lc.company_id
     WHERE lc.lot_id=$1
     ORDER BY lc.created_at, c.id`,
    [id]
  );
  let companies = compsRes.rows;
  
  if (isEntreprise && userCompanyId) {
    companies = companies.filter(c => Number(c.id) === Number(userCompanyId));
  }

  // Filtrer les offres par round_id si fourni
  const offersRes = itemIds.length && roundId
    ? await query('SELECT * FROM offers WHERE item_id = ANY($1::int[]) AND round_id = $2', [itemIds, roundId])
    : itemIds.length
    ? await query('SELECT * FROM offers WHERE item_id = ANY($1::int[])', [itemIds])
    : { rows: [] };

  const offersByItem = new Map();
  for (const o of offersRes.rows) {
    if (!offersByItem.has(o.item_id)) offersByItem.set(o.item_id, new Map());
    offersByItem.get(o.item_id).set(o.company_id, o);
  }

  const rows = itemsRes.rows.map(item => {
    const m = moeByItem.get(item.id) || {};
    const line = {
      item_id: item.id,
      num: item.num,
      designation: item.designation,
      unit: item.unit,
      source_company_id: item.source_company_id || null,
      parent_item_id: item.parent_item_id || null,
      parent_num: item.parent_num || null,
      parent_designation: item.parent_designation || null,
      moe: { qty: m.qty, pu: m.unit_price, mt: m.amount },
      companies: []
    };
    for (const c of companies) {
      const off = offersByItem.get(item.id)?.get(c.id) || {};
      const dQty = (!isEntreprise && m.qty != null && off.qty != null && m.qty !== 0) ? ((off.qty - m.qty) / m.qty * 100) : null;
      const dPu  = (!isEntreprise && m.unit_price != null && off.unit_price != null && m.unit_price !== 0) ? ((off.unit_price - m.unit_price) / m.unit_price * 100) : null;
      line.companies.push({
        company_id: c.id,
        name: c.name,
        original_name: c.original_name || c.name,
        display_name: c.display_name || null,
        color: c.color || null,
        u: off.unit ?? null,
        qty: off.qty ?? null,
        pu: off.unit_price ?? null,
        mt: off.amount ?? (off.qty != null && off.unit_price != null ? off.qty * off.unit_price : null),
        delta_qty_pct: dQty,
        delta_pu_pct: dPu,
        offer_designation: off.offer_designation ?? null,
        comment: off.comment ?? null
      });
    }
    return line;
  });

  // Si entreprise: filtrer lignes pour ne retourner que leurs offres dans companies déjà réduit
  if (isEntreprise && userCompanyId) {
    // Remove moe amounts
    rows.forEach(r => { r.moe = { qty: null, pu: null, mt: null }; });
  }
  res.json({ companies, rows });
  } catch (err) {
    console.error('Erreur GET lot table:', err);
    res.status(500).json({ error: 'Erreur lors du chargement du tableau' });
  }
});

/* ---------- ENTREPRISES DU LOT ---------- */
router.get('/:id/companies', async (req, res) => {
  const id = Number(req.params.id);
  try {
    // SÉCURITÉ: Vérifier accès au projet
    const projectId = await getProjectIdForLot(id);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canView = await canViewProject(req.user.id, projectId, req.user.role, req.user.company_id || null);
    if (!canView) return res.status(403).json({ error: 'Accès refusé' });

    const r = await query(
      `SELECT c.id,
              COALESCE(NULLIF(lc.display_name, ''), c.name) AS name,
              c.name AS original_name,
              lc.display_name,
              c.created_at,
              c.color,
              c.email
       FROM lot_companies lc
       JOIN companies c ON c.id=lc.company_id
       WHERE lc.lot_id=$1
       ORDER BY lc.created_at, c.id`,
      [id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('Erreur GET lot companies:', err);
    res.status(500).json({ error: 'Erreur lors du chargement des entreprises' });
  }
});

router.post('/:id/companies', isResponsableOrAdmin, async (req, res) => {
  const lotId = Number(req.params.id);
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Nom requis' });

  const client = await pool.connect();
  try {
    // SÉCURITÉ: Vérifier que l'utilisateur peut éditer le projet de ce lot
    const projectId = await getProjectIdForLot(lotId);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé - Vous ne pouvez pas modifier ce lot' });

    await client.query('BEGIN');
    
    // 1. Vérifier si le lot existe
    const lotCheck = await client.query('SELECT id FROM lots WHERE id = $1', [lotId]);
    if (lotCheck.rowCount === 0) {
      throw new Error('Lot introuvable');
    }

    // 2. Chercher ou créer l'entreprise
    const cleanName = name.trim();
    let company;
    
    // D'abord chercher si elle existe
    const existing = await client.query(
      'SELECT id, name FROM companies WHERE lower(name) = lower($1)',
      [cleanName]
    );
    
    if (existing.rowCount > 0) {
      company = existing.rows[0];
    } else {
      // Si elle n'existe pas, la créer
      const inserted = await client.query(
        'INSERT INTO companies (name) VALUES ($1) RETURNING id, name',
        [cleanName]
      );
      company = inserted.rows[0];
    }

    // 3. Ajouter l'association lot-entreprise si elle n'existe pas déjà
    await client.query(
      'INSERT INTO lot_companies (lot_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [lotId, company.id]
    );

    await client.query('COMMIT');
    res.json({
      ...company,
      original_name: company.name,
      display_name: null
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur ajout entreprise:', err);
    
    if (err.message === 'Lot introuvable') {
      res.status(404).json({ error: err.message });
    } else if (err.code === '23505') { // violation de contrainte unique
      res.status(409).json({ error: 'Cette entreprise existe déjà' });
    } else {
      res.status(500).json({ error: 'Erreur lors de l\'ajout de l\'entreprise' });
    }
  } finally {
    client.release();
  }
});

router.delete('/:id/companies/:companyId', isResponsableOrAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const companyId = Number(req.params.companyId);
  try {
    // SÉCURITÉ: Vérifier que l'utilisateur peut éditer le projet de ce lot
    const projectId = await getProjectIdForLot(id);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé - Vous ne pouvez pas modifier ce lot' });

    // Supprimer les offres de cette entreprise sur les items de ce lot
    await query(
      'DELETE FROM offers WHERE company_id=$1 AND item_id IN (SELECT id FROM items WHERE lot_id=$2)',
      [companyId, id]
    );
    // Supprimer les offres d'options de cette entreprise sur ce lot
    await query(
      `DELETE FROM option_item_offers WHERE company_id=$1 AND option_item_id IN (
         SELECT oi.id FROM option_items oi
         JOIN options o ON o.id = oi.option_id
         WHERE o.lot_id=$2
       )`,
      [companyId, id]
    );
    // Supprimer les questions générées pour cette entreprise sur ce lot
    await query('DELETE FROM generated_questions WHERE company_id=$1 AND lot_id=$2', [companyId, id]);
    // Supprimer les items ajoutés par cette entreprise
    await query('DELETE FROM items WHERE lot_id=$1 AND source_company_id=$2', [id, companyId]);
    await query('DELETE FROM lot_companies WHERE lot_id=$1 AND company_id=$2', [id, companyId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur suppression entreprise du lot:', err);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

/* ---------- COULEUR ENTREPRISE ---------- */
router.patch('/companies/:companyId/color', isResponsableOrAdmin, async (req, res) => {
  const companyId = Number(req.params.companyId);
  const { color } = req.body || {};
  if (!color) return res.status(400).json({ error: 'Couleur requise' });
  try {
    await query('UPDATE companies SET color = $1 WHERE id = $2', [color, companyId]);
    res.json({ ok: true, color });
  } catch (err) {
    console.error('Erreur mise à jour couleur:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

/* ---------- NOM AFFICHÉ ENTREPRISE PAR LOT ---------- */
router.patch('/:id/companies/:companyId/display-name', isResponsableOrAdmin, async (req, res) => {
  const lotId = Number(req.params.id);
  const companyId = Number(req.params.companyId);
  const { name } = req.body || {};
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!cleanName) return res.status(400).json({ error: 'Nom requis' });

  const client = await pool.connect();
  try {
    const projectId = await getProjectIdForLot(lotId);
    if (!projectId) {
      return res.status(404).json({ error: 'Lot introuvable' });
    }
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) {
      return res.status(403).json({ error: 'Accès refusé - Vous ne pouvez pas modifier ce lot' });
    }

    await client.query('BEGIN');

    const currentRes = await client.query(
      `SELECT lc.lot_id, c.id, c.name
       FROM lot_companies lc
       JOIN companies c ON c.id = lc.company_id
       WHERE lc.lot_id = $1 AND lc.company_id = $2`,
      [lotId, companyId]
    );
    if (currentRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Entreprise introuvable sur ce lot' });
    }

    const existingRes = await client.query(
      'SELECT id, name, color, email FROM companies WHERE lower(name) = lower($1) ORDER BY id LIMIT 1',
      [cleanName]
    );

    let targetCompany = existingRes.rows[0] || null;
    let merged = false;

    if (targetCompany && Number(targetCompany.id) !== Number(companyId)) {
      await mergeLotCompanyInto(client, {
        lotId,
        fromCompanyId: companyId,
        toCompanyId: targetCompany.id
      });
      merged = true;
    } else {
      const updateRes = await client.query(
        `UPDATE companies SET name = $2 WHERE id = $1 RETURNING id, name, color, email`,
        [companyId, cleanName]
      );
      targetCompany = updateRes.rows[0];
      await client.query(
        `UPDATE lot_companies
         SET display_name = NULL
         WHERE lot_id = $1 AND company_id = $2`,
        [lotId, targetCompany.id]
      );
    }

    await client.query('COMMIT');

    res.json({
      id: targetCompany.id,
      name: targetCompany.name,
      original_name: targetCompany.name,
      display_name: null,
      color: targetCompany.color || null,
      email: targetCompany.email || null,
      merged
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Erreur mise à jour nom affiché entreprise:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  } finally {
    client.release();
  }
});

/* ---------- EMAIL ENTREPRISE ---------- */
router.patch('/companies/:companyId/email', isResponsableOrAdmin, async (req, res) => {
  const companyId = Number(req.params.companyId);
  const { email } = req.body || {};
  // Validation format email basique (ou vide pour effacer)
  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Adresse email invalide' });
    }
  }
  try {
    await query('UPDATE companies SET email = $1 WHERE id = $2', [email || null, companyId]);
    res.json({ ok: true, email: email || null });
  } catch (err) {
    console.error('Erreur mise à jour email:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

/* ---------- SAUVEGARDE DU TABLEUR (édition) ---------- */
// Body: { rows: [ { item_id?, num, designation, unit, moe:{qty,pu}, offers:{ [companyId]:{u,qty,pu} } } ] }
router.post('/:id/save-grid', requireRole(['platform_admin', 'tenant_admin', 'responsable', 'entreprise']), async (req, res) => {
  const lotId = Number(req.params.id);
  const { rows, round_id } = req.body || {};
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows[] requis' });
  if (!round_id) return res.status(400).json({ error: 'round_id requis' });
  
  // SÉCURITÉ: Vérifier l'accès au projet
  const projectId = await getProjectIdForLot(lotId);
  if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
  
  const scope = companyScope(req);
  const isEntreprise = scope.isEntreprise;
  const userCompanyId = scope.companyId;

  // Entreprise: vérifier que leur company est liée au lot
  if (isEntreprise) {
    if (scope.orphan) return res.status(403).json({ error: 'Aucune entreprise associée à votre compte' });
    const companyLink = await query(
      'SELECT 1 FROM lot_companies WHERE lot_id = $1 AND company_id = $2',
      [lotId, userCompanyId]
    );
    if (companyLink.rowCount === 0) return res.status(403).json({ error: 'Votre entreprise n\'est pas associée à ce lot' });
  } else {
    // Admin/Responsable: vérifier canEditProject
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé - Vous ne pouvez pas modifier ce lot' });
  }
  
  const roundId = Number(round_id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemsToUpdate = [];
    const itemsToInsert = [];
    const moeData = [];
    const offersData = [];
    
    let pos = 0;
    
    // 1. Séparer items existants vs nouveaux
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const r = rows[rowIndex];
      pos += 1;

      const designation = (r.designation ?? '').trim();
      const num = r.num ?? null;
      const unit = r.unit ?? null;
      const itemId = r.item_id ? Number(r.item_id) : null;
      // `rowIndex` vient de la boucle : `rows.indexOf(r)` était en O(n²) sur la
      // grille entière, et renvoyait le mauvais index si deux lignes
      // partageaient la même référence d'objet.
      
      // Sauvegarder toutes les lignes pour préserver l'ordre DPGF (même les vides)
      // Utiliser un espace comme désignation minimale pour les lignes vides
      const finalDesignation = designation || '';

      if (itemId) {
        itemsToUpdate.push({ id: itemId, num, designation: finalDesignation, unit, pos, rowIndex });
      } else {
        itemsToInsert.push({ num, designation: finalDesignation, unit, pos, rowIndex });
      }

      // Préparer MOE
      //
      // Le montant est FIGÉ : on conserve celui transmis par la grille, y
      // compris lorsqu'il vaut 0 (la MOE peut renseigner une quantité et un PU
      // sans vouloir de total). On ne calcule qty × PU que si aucun montant
      // n'est fourni. Le recalcul à la saisie est assuré côté client par
      // recalcRowAmountsRow(), qui envoie alors la valeur recalculée.
      const q = parseGridNumber(r.moe?.qty);
      const pu = parseGridNumber(r.moe?.pu);
      let mt = parseGridNumber(r.moe?.mt);
      if (mt == null && q != null && pu != null) {
        mt = q * pu;
      }
      moeData.push({ itemId, q, pu, mt, rowIndex });

      // Préparer OFFERS — même règle de montant figé que pour la MOE.
      if (r.offers && typeof r.offers === 'object') {
        for (const [cid, val] of Object.entries(r.offers)) {
          const companyId = Number(cid);
          const u  = val?.u ?? null;
          const oq = parseGridNumber(val?.qty);
          const op = parseGridNumber(val?.pu);
          let om = parseGridNumber(val?.mt);
          if (om == null && oq != null && op != null) {
            om = oq * op;
          }
          offersData.push({ itemId, companyId, u, oq, op, om, rowIndex });
        }
      }
    }

    // Supprimer les articles retires de la grille (admin/responsable uniquement).
    // Les données liées (MOE, offres, questions, etc.) suivent via ON DELETE CASCADE.
    if (!isEntreprise) {
      const keptItemIds = itemsToUpdate.map((item) => item.id);
      await client.query(
        `DELETE FROM items
         WHERE lot_id = $1
           AND NOT (id = ANY($2::bigint[]))`,
        [lotId, keptItemIds]
      );
    }

    // 2. UPDATE de tous les items existants en UNE requête.
    //
    // Les quatre blocs qui suivent étaient des boucles de requêtes unitaires
    // malgré leur commentaire « Batch ». Sur une grille de 2 000 articles ×
    // 5 entreprises, cela faisait ~12 000 allers-retours dans une seule
    // transaction ; à ~17 ms de latence mesurée vers la base, la sauvegarde
    // prenait plusieurs minutes. `unnest()` déplie les tableaux côté serveur et
    // ramène chaque bloc à une seule requête.
    if (itemsToUpdate.length > 0 && !isEntreprise) {
      await client.query(
        `UPDATE items AS i
            SET num = d.num,
                designation = d.designation,
                unit = d.unit,
                position = d.pos
           FROM unnest($2::bigint[], $3::text[], $4::text[], $5::text[], $6::int[])
                AS d(id, num, designation, unit, pos)
          WHERE i.id = d.id
            AND i.lot_id = $1`,
        [
          lotId,
          itemsToUpdate.map(i => i.id),
          itemsToUpdate.map(i => i.num),
          itemsToUpdate.map(i => i.designation),
          itemsToUpdate.map(i => i.unit),
          itemsToUpdate.map(i => i.pos),
        ]
      );
      // `AND i.lot_id = $1` est un garde-fou ajouté au passage : un id d'item
      // appartenant à un autre lot ne peut plus être modifié par cette route.
    }

    // 3. INSERT des nouveaux items en UNE requête.
    //
    // `position` est un compteur strictement croissant sur l'ensemble des
    // lignes de la grille : il est donc unique parmi les insertions, ce qui en
    // fait une clé fiable pour rattacher l'identifiant attribué par la base à
    // la bonne ligne. On ne se repose pas sur l'ordre des lignes RETURNING.
    const newItemIds = [];
    if (itemsToInsert.length > 0 && !isEntreprise) {
      const rowIndexByPos = new Map(itemsToInsert.map(i => [Number(i.pos), i.rowIndex]));
      if (rowIndexByPos.size !== itemsToInsert.length) {
        throw new Error('Positions non uniques : impossible de rattacher les nouveaux articles');
      }

      const ins = await client.query(
        `INSERT INTO items (lot_id, num, designation, unit, position)
         SELECT $1, d.num, d.designation, d.unit, d.pos
           FROM unnest($2::text[], $3::text[], $4::text[], $5::int[])
                AS d(num, designation, unit, pos)
         RETURNING id, position`,
        [
          lotId,
          itemsToInsert.map(i => i.num),
          itemsToInsert.map(i => i.designation),
          itemsToInsert.map(i => i.unit),
          itemsToInsert.map(i => i.pos),
        ]
      );

      for (const row of ins.rows) {
        const rowIndex = rowIndexByPos.get(Number(row.position));
        if (rowIndex === undefined) {
          throw new Error('Article insere sans position correspondante dans la grille');
        }
        newItemIds.push({ rowIndex, id: row.id });
      }
      if (newItemIds.length !== itemsToInsert.length) {
        throw new Error('Nombre d\'articles inseres incoherent avec la grille');
      }
    }

    // 4. Rattacher les identifiants fraîchement créés aux données MOE et offres.
    //
    // C'était auparavant une double boucle : O(nouveaux articles × lignes), soit
    // des millions de comparaisons sur une grande grille. Une table de
    // correspondance ramène l'étape à un seul passage.
    if (newItemIds.length > 0) {
      const idByRowIndex = new Map(newItemIds.map(n => [n.rowIndex, n.id]));
      for (const moe of moeData) {
        if (!moe.itemId) {
          const id = idByRowIndex.get(moe.rowIndex);
          if (id !== undefined) moe.itemId = id;
        }
      }
      for (const offer of offersData) {
        if (!offer.itemId) {
          const id = idByRowIndex.get(offer.rowIndex);
          if (id !== undefined) offer.itemId = id;
        }
      }
    }

    // 5. Upsert MOE en UNE requête (interdit pour entreprise).
    //
    // Déduplication par item_id obligatoire : `ON CONFLICT DO UPDATE` refuse de
    // toucher deux fois la même ligne dans une seule instruction. On garde la
    // dernière occurrence, ce qui reproduit le comportement de la boucle
    // précédente (la dernière écriture gagnait).
    if (moeData.length > 0 && !isEntreprise) {
      const parItem = new Map();
      for (const moe of moeData) {
        if (!moe.itemId) continue;
        parItem.set(Number(moe.itemId), moe);
      }
      const lignes = [...parItem.values()];
      if (lignes.length > 0) {
        await client.query(
          `INSERT INTO moe_items (item_id, qty, unit_price, amount)
           SELECT d.item_id, d.qty, d.unit_price, d.amount
             FROM unnest($1::bigint[], $2::numeric[], $3::numeric[], $4::numeric[])
                  AS d(item_id, qty, unit_price, amount)
           ON CONFLICT (item_id) DO UPDATE
             SET qty = EXCLUDED.qty,
                 unit_price = EXCLUDED.unit_price,
                 amount = EXCLUDED.amount`,
          [
            lignes.map(m => m.itemId),
            lignes.map(m => m.q),
            lignes.map(m => m.pu),
            lignes.map(m => m.mt),
          ]
        );
      }
    }

    // 6. Upsert OFFERS en UNE requête.
    // SÉCURITÉ: une entreprise ne peut sauvegarder que ses propres offres.
    // Déduplication sur le triplet de la contrainte d'unicité.
    if (offersData.length > 0) {
      const parCle = new Map();
      for (const offer of offersData) {
        if (!offer.itemId) continue;
        if (isEntreprise && !scope.allows(offer.companyId)) continue;
        parCle.set(`${Number(offer.itemId)}:${Number(offer.companyId)}`, offer);
      }
      const lignes = [...parCle.values()];
      if (lignes.length > 0) {
        await client.query(
          `INSERT INTO offers (item_id, company_id, round_id, unit, qty, unit_price, amount)
           SELECT d.item_id, d.company_id, $1, d.unit, d.qty, d.unit_price, d.amount
             FROM unnest($2::bigint[], $3::bigint[], $4::text[], $5::numeric[], $6::numeric[], $7::numeric[])
                  AS d(item_id, company_id, unit, qty, unit_price, amount)
           ON CONFLICT (item_id, company_id, round_id) DO UPDATE
             SET unit = EXCLUDED.unit,
                 qty = EXCLUDED.qty,
                 unit_price = EXCLUDED.unit_price,
                 amount = EXCLUDED.amount,
                 comment = COALESCE(offers.comment, EXCLUDED.comment)`,
          [
            roundId,
            lignes.map(o => o.itemId),
            lignes.map(o => o.companyId),
            lignes.map(o => o.u),
            lignes.map(o => o.oq),
            lignes.map(o => o.op),
            lignes.map(o => o.om),
          ]
        );
      }
    }

    await client.query('COMMIT');
    
    // Retourner les items avec leurs IDs (anciens + nouveaux)
    const itemIdsByRowIndex = new Map();
    
    // Ajouter les items mis à jour
    for (const item of itemsToUpdate) {
      itemIdsByRowIndex.set(item.rowIndex, item.id);
    }
    
    // Ajouter les nouveaux items créés
    for (const newItem of newItemIds) {
      itemIdsByRowIndex.set(newItem.rowIndex, newItem.id);
    }
    const allItems = rows
      .map((row, index) => ({ rowIndex: index, id: itemIdsByRowIndex.get(index) || null, designation: row.designation || '' }))
      .filter((item) => item.id);
    
    res.json({ ok: true, saved: pos, items: allItems });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Erreur save-grid:', e);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  } finally {
    client.release();
  }
});

/* ---------- Smart Import : Preview ---------- */
router.post('/:id/import-preview', requireRole(['platform_admin', 'tenant_admin', 'responsable']), preserveDbContext(upload.single('file')), async (req, res) => {
  const lotId = Number(req.params.id);
  if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });
  try {
    const projectId = await getProjectIdForLot(lotId);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });

    const sheetName = req.body?.sheetName || null;
    const headerRow = req.body?.headerRow ? Number(req.body.headerRow) : null;
    const isPdf = isPdfFile({ mime: req.file.mimetype, name: req.file.originalname });
    const buffer = isPdf
      ? await convertPdfToExcelBuffer({ buffer: req.file.buffer, headerRow })
      : req.file.buffer;
    const result = await previewExcel({ buffer, sheetName: isPdf ? 'PDF' : sheetName, headerRow: isPdf ? 1 : headerRow });
    // Cacher le fichier pour éviter un re-upload à l'étape apply
    const fileId = await cacheTempFile(req.file.buffer, { mime: req.file.mimetype, name: req.file.originalname });
    // Portée maximale d'une suppression en mode « replace », à confirmer côté UI.
    const replaceImpact = await getReplaceImpact(lotId);
    res.json({ ...result, fileId, replaceImpact });
  } catch (e) {
    console.error('Preview error:', e);
    res.status(400).json({ error: e.message });
  }
});

/* ---------- Smart Import : Apply ---------- */
router.post('/:id/import-apply', requireRole(['platform_admin', 'tenant_admin', 'responsable']), preserveDbContext(upload.single('file')), async (req, res) => {
  const lotId = Number(req.params.id);

  try {
    const projectId = await getProjectIdForLot(lotId);
    if (!projectId) return res.status(404).json({ error: 'Lot introuvable' });
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });

    const { mode, sheetName, headerRow, mapping, excludedRows, roundId, companyId, companyName, fileId, importOperation, detectOptions } = JSON.parse(req.body.params || '{}');
    if (!mode) return res.status(400).json({ error: 'Mode requis (dpgf ou offer)' });
    if (!mapping) return res.status(400).json({ error: 'Mapping requis' });

    if (String(mode) === 'offer' && !roundId) {
      console.warn('[AMOUNT-DIAG][import.apply] Import offre sans roundId', {
        lotId,
        companyId: companyId ? Number(companyId) : null,
        companyName: companyName || null,
        userId: req.user?.id || null
      });
    }

    // Utiliser le fichier caché si disponible, sinon le fichier uploadé
    let buffer = req.file?.buffer;
    let mime = req.file?.mimetype;
    let name = req.file?.originalname;
    if (!buffer && fileId) {
      const entry = await getTempFile(fileId);
      buffer = entry?.buffer;
      mime = entry?.mime;
      name = entry?.name;
    }
    // `code` permet au front de rejouer l'appel en rattachant le fichier qu'il a
    // toujours en memoire, au lieu d'imposer a l'utilisateur de tout reprendre.
    if (!buffer) {
      return res.status(400).json({
        error: 'Fichier manquant. Veuillez relancer l\'import.',
        code: 'FICHIER_CACHE_EXPIRE',
      });
    }

    const isPdf = isPdfFile({ mime, name });
    if (isPdf) {
      buffer = await convertPdfToExcelBuffer({ buffer, headerRow: Number(headerRow) || null });
    }
    const result = await applyImport({
      buffer,
      mode,
      lotId,
      roundId: roundId ? Number(roundId) : null,
      companyId: companyId ? Number(companyId) : null,
      companyName: companyName || null,
      sheetName: isPdf ? 'PDF' : (sheetName || null),
      headerRow: isPdf ? 1 : (Number(headerRow) || 1),
      mapping,
      excludedRows: excludedRows || [],
      importOperation,
      detectOptions: detectOptions !== false,
    });

    if (String(mode) === 'offer') {
      const amountMismatchCount = Number(result?.amountMismatchCount || 0);
      const unmatchedDpgfCount = Number(result?.unmatchedDpgfCount || 0);
      const addedPostsCount = Number(result?.addedPostsCount || 0);
      if (amountMismatchCount > 0 || unmatchedDpgfCount > 0 || addedPostsCount > 0) {
        console.warn('[AMOUNT-DIAG][import.apply] Import offre avec anomalies fonctionnelles', {
          lotId,
          roundId: roundId ? Number(roundId) : null,
          companyId: Number(result?.companyId || companyId || 0) || null,
          matched: Number(result?.matched || 0),
          skipped: Number(result?.skipped || 0),
          amountMismatchCount,
          unmatchedDpgfCount,
          addedPostsCount,
          warnings: result?.warnings || []
        });
      }
    }

    // Nettoyer le fichier caché après usage
    if (fileId) tempFileCache.delete(fileId);

    res.json(result);
  } catch (e) {
    console.error('Import apply error:', e);
    res.status(400).json({ error: e.message });
  }
});

export default router;
