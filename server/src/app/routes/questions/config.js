// server/src/routes/question-config.js
import express from 'express';
import { query, pool } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { canEditProject, canViewProject } from '../../utils/permissions.js';

const router = express.Router();
router.use(requireAuth);

const DEFAULT_LOT_THRESHOLDS = {
  qty_very_low_threshold: 25,
  qty_low_threshold: 10,
  qty_high_threshold: 10,
  qty_very_high_threshold: 25,
  price_very_low_threshold: 25,
  price_low_threshold: 10,
  price_high_threshold: 10,
  price_very_high_threshold: 25,
  amount_very_low_threshold: 25,
  amount_low_threshold: 10,
  amount_high_threshold: 10,
  amount_very_high_threshold: 25
};

const LOT_THRESHOLD_FIELDS = Object.keys(DEFAULT_LOT_THRESHOLDS);

function normalizeThreshold(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, number);
}

function excelNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeExportUnit(unit) {
  return String(unit || '')
    .trim()
    .replace(/m2/gi, 'm²')
    .replace(/m3/gi, 'm³');
}

function escapeExcelFormatText(value) {
  return String(value || '').replace(/"/g, '""');
}

function questionValueNumberFormat(questionType, unit) {
  const normalizedUnit = normalizeExportUnit(unit);
  const suffix = (() => {
    if (String(questionType || '').startsWith('qty_')) return normalizedUnit;
    if (String(questionType || '').startsWith('price_')) return normalizedUnit ? `€/${normalizedUnit}` : '€';
    if (String(questionType || '').startsWith('amount_') || questionType === 'unit_mismatch') return '€';
    return normalizedUnit;
  })();
  return suffix ? `#,##0.0000 "${escapeExcelFormatText(suffix)}"` : '#,##0.0000';
}

function normalizeUnitLabel(value) {
  if (!value) return '';
  return String(value).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00A0\u2007\u200B\u202F\u2009]/g, ' ')
    .replace(/[²]/g, '2')
    .replace(/[³]/g, '3')
    .replace(/[-\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizeUnit(value) {
  const normalized = normalizeUnitLabel(value);
  if (!normalized) return '';
  const compact = normalized.replace(/\s/g, '');
  if (!compact) return '';
  const strictAliases = new Map([
    ['uni', 'u'],
    ['u', 'u'],
    ['ens', 'fft'],
    ['fft', 'fft'],
    ['ml', 'm'],
    ['m', 'm'],
    ['m2', 'm2'],
    ['m3', 'm3'],
  ]);
  return strictAliases.get(compact) || compact;
}

function areUnitsEquivalent(expectedUnit, offeredUnit) {
  const canonicalExpected = canonicalizeUnit(expectedUnit);
  const canonicalOffered = canonicalizeUnit(offeredUnit);
  if (!canonicalExpected || !canonicalOffered) return true;
  return canonicalExpected === canonicalOffered;
}

function hasBlockingUnitMismatch(expectedUnit, offeredUnit, offeredAmount) {
  const amount = Number.parseFloat(offeredAmount);
  if (!Number.isFinite(amount) || amount === 0) return false;
  if (!String(expectedUnit || '').trim() || !String(offeredUnit || '').trim()) return false;
  return !areUnitsEquivalent(expectedUnit, offeredUnit);
}

function buildUnitMismatchComment(expectedUnit) {
  const safeExpectedUnit = String(expectedUnit || '').trim();
  if (!safeExpectedUnit) return '';
  return `Ce poste doit être chiffré en ${safeExpectedUnit}.`;
}

// Autoriser uniquement admin ou responsable pour la configuration et la génération
function requireManager(req, res, next) {
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'responsable') {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  next();
}

// ========== Configuration Projet ==========

// Obtenir la config des questions pour un projet
router.get('/project/:projectId', requireManager, async (req, res) => {
  try {
    const { projectId } = req.params;
    
    let config = await query(
      'SELECT * FROM project_question_config WHERE project_id = $1',
      [projectId]
    );
    
    // Si pas de config, créer avec valeurs par défaut
    if (config.rowCount === 0) {
      config = await query(
        `INSERT INTO project_question_config (project_id) 
         VALUES ($1) RETURNING *`,
        [projectId]
      );
    }
    
    res.json(config.rows[0]);
  } catch (err) {
    console.error('Erreur récupération config projet:', err);
    res.status(500).json({ error: 'Impossible de récupérer la configuration' });
  }
});

// Mettre à jour la config des questions pour un projet
router.put('/project/:projectId', requireManager, async (req, res) => {
  try {
    const { projectId } = req.params;
    const {
      question_qty_very_low,
      question_qty_low,
      question_qty_high,
      question_qty_very_high,
      question_price_very_low,
      question_price_low,
      question_price_high,
      question_price_very_high,
      question_amount_very_low,
      question_amount_low,
      question_amount_high,
      question_amount_very_high,
      unanswered_comment,
      unanswered_color,
      offer_amount_mismatch_comment,
      question_unit_mismatch
    } = req.body;
    
    const result = await query(
      `INSERT INTO project_question_config 
        (project_id, question_qty_very_low, question_qty_low, question_qty_high, question_qty_very_high, question_price_very_low, question_price_low, question_price_high, question_price_very_high, question_amount_very_low, question_amount_low, question_amount_high, question_amount_very_high, unanswered_comment, unanswered_color, offer_amount_mismatch_comment, question_unit_mismatch, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now())
       ON CONFLICT (project_id) 
       DO UPDATE SET 
         question_qty_very_low = EXCLUDED.question_qty_very_low,
         question_qty_low = EXCLUDED.question_qty_low,
         question_qty_high = EXCLUDED.question_qty_high,
         question_qty_very_high = EXCLUDED.question_qty_very_high,
         question_price_very_low = EXCLUDED.question_price_very_low,
         question_price_low = EXCLUDED.question_price_low,
         question_price_high = EXCLUDED.question_price_high,
         question_price_very_high = EXCLUDED.question_price_very_high,
         question_amount_very_low = EXCLUDED.question_amount_very_low,
         question_amount_low = EXCLUDED.question_amount_low,
         question_amount_high = EXCLUDED.question_amount_high,
         question_amount_very_high = EXCLUDED.question_amount_very_high,
         unanswered_comment = EXCLUDED.unanswered_comment,
         unanswered_color = EXCLUDED.unanswered_color,
         offer_amount_mismatch_comment = EXCLUDED.offer_amount_mismatch_comment,
         question_unit_mismatch = EXCLUDED.question_unit_mismatch,
         updated_at = now()
       RETURNING *`,
      [projectId, question_qty_very_low, question_qty_low, question_qty_high, question_qty_very_high, question_price_very_low, question_price_low, question_price_high, question_price_very_high, question_amount_very_low, question_amount_low, question_amount_high, question_amount_very_high, unanswered_comment, unanswered_color, offer_amount_mismatch_comment, question_unit_mismatch]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur mise à jour config projet:', err);
    res.status(500).json({ error: 'Impossible de mettre à jour la configuration' });
  }
});

// ========== Configuration Lot (seuils) ==========

// Obtenir les seuils de tous les lots d'un projet
router.get('/project/:projectId/lot-thresholds', requireManager, async (req, res) => {
  try {
    const { projectId } = req.params;
    const canView = await canViewProject(req.user.id, projectId, req.user.role, req.user.company_id || null);
    if (!canView) return res.status(403).json({ error: 'Accès refusé' });

    const result = await query(
      `SELECT
         l.id AS lot_id,
         l.code,
         l.name,
         ${LOT_THRESHOLD_FIELDS.map(field => `COALESCE(ltc.${field}, ${DEFAULT_LOT_THRESHOLDS[field]}) AS ${field}`).join(',\n         ')}
       FROM lots l
       LEFT JOIN lot_threshold_config ltc ON ltc.lot_id = l.id
       WHERE l.project_id = $1
       ORDER BY l.sort_order ASC, l.id ASC`,
      [projectId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur recuperation seuils projet:', err);
    res.status(500).json({ error: 'Impossible de recuperer les seuils des lots' });
  }
});

// Mettre à jour les seuils de plusieurs lots d'un projet
router.put('/project/:projectId/lot-thresholds', requireManager, async (req, res) => {
  const client = await pool.connect();
  try {
    const { projectId } = req.params;
    const thresholds = Array.isArray(req.body?.thresholds) ? req.body.thresholds : [];
    if (thresholds.length === 0) {
      return res.status(400).json({ error: 'Liste de seuils vide' });
    }

    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });

    await client.query('BEGIN');

    const lotsRes = await client.query('SELECT id FROM lots WHERE project_id = $1', [projectId]);
    const projectLotIds = new Set(lotsRes.rows.map(row => Number(row.id)));

    let updated = 0;
    for (const row of thresholds) {
      const lotId = Number(row?.lot_id);
      if (!Number.isFinite(lotId) || !projectLotIds.has(lotId)) continue;

      const values = LOT_THRESHOLD_FIELDS.map(field => normalizeThreshold(row[field], DEFAULT_LOT_THRESHOLDS[field]));
      await client.query(
        `INSERT INTO lot_threshold_config
          (lot_id, ${LOT_THRESHOLD_FIELDS.join(', ')}, updated_at)
         VALUES ($1, ${LOT_THRESHOLD_FIELDS.map((_, idx) => `$${idx + 2}`).join(', ')}, now())
         ON CONFLICT (lot_id)
         DO UPDATE SET
           ${LOT_THRESHOLD_FIELDS.map(field => `${field} = EXCLUDED.${field}`).join(',\n           ')},
           updated_at = now()`,
        [lotId, ...values]
      );
      updated += 1;
    }

    await client.query('COMMIT');
    res.json({ ok: true, updated });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Erreur mise a jour seuils projet:', err);
    res.status(500).json({ error: 'Impossible de mettre a jour les seuils des lots' });
  } finally {
    client.release();
  }
});

// Obtenir les seuils pour un lot
router.get('/lot/:lotId/thresholds', requireManager, async (req, res) => {
  try {
    const { lotId } = req.params;
    
    let config = await query(
      'SELECT * FROM lot_threshold_config WHERE lot_id = $1',
      [lotId]
    );
    
    // Si pas de config, créer avec valeurs par défaut (10%)
    if (config.rowCount === 0) {
      config = await query(
        `INSERT INTO lot_threshold_config (lot_id) 
         VALUES ($1) RETURNING *`,
        [lotId]
      );
    }
    
    res.json(config.rows[0]);
  } catch (err) {
    console.error('Erreur récupération seuils lot:', err);
    res.status(500).json({ error: 'Impossible de récupérer les seuils' });
  }
});

// Mettre à jour les seuils pour un lot
router.put('/lot/:lotId/thresholds', requireManager, async (req, res) => {
  try {
    const { lotId } = req.params;
    const {
      qty_very_low_threshold,
      qty_low_threshold,
      qty_high_threshold,
      qty_very_high_threshold,
      price_very_low_threshold,
      price_low_threshold,
      price_high_threshold,
      price_very_high_threshold,
      amount_very_low_threshold,
      amount_low_threshold,
      amount_high_threshold,
      amount_very_high_threshold
    } = req.body;
    
    const result = await query(
      `INSERT INTO lot_threshold_config 
        (lot_id, qty_very_low_threshold, qty_low_threshold, qty_high_threshold, qty_very_high_threshold, price_very_low_threshold, price_low_threshold, price_high_threshold, price_very_high_threshold, amount_very_low_threshold, amount_low_threshold, amount_high_threshold, amount_very_high_threshold, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
       ON CONFLICT (lot_id) 
       DO UPDATE SET 
         qty_very_low_threshold = EXCLUDED.qty_very_low_threshold,
         qty_low_threshold = EXCLUDED.qty_low_threshold,
         qty_high_threshold = EXCLUDED.qty_high_threshold,
         qty_very_high_threshold = EXCLUDED.qty_very_high_threshold,
         price_very_low_threshold = EXCLUDED.price_very_low_threshold,
         price_low_threshold = EXCLUDED.price_low_threshold,
         price_high_threshold = EXCLUDED.price_high_threshold,
         price_very_high_threshold = EXCLUDED.price_very_high_threshold,
         amount_very_low_threshold = EXCLUDED.amount_very_low_threshold,
         amount_low_threshold = EXCLUDED.amount_low_threshold,
         amount_high_threshold = EXCLUDED.amount_high_threshold,
         amount_very_high_threshold = EXCLUDED.amount_very_high_threshold,
         updated_at = now()
       RETURNING *`,
      [lotId, qty_very_low_threshold, qty_low_threshold, qty_high_threshold, qty_very_high_threshold, price_very_low_threshold, price_low_threshold, price_high_threshold, price_very_high_threshold, amount_very_low_threshold, amount_low_threshold, amount_high_threshold, amount_very_high_threshold]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur mise à jour seuils lot:', err);
    res.status(500).json({ error: 'Impossible de mettre à jour les seuils' });
  }
});

// ========== Génération et gestion des fiches questions ==========

// Générer les fiches questions pour un lot et un tour
router.post('/lot/:lotId/generate', requireManager, async (req, res) => {
  try {
    const { lotId } = req.params;
    const { round_id } = req.body;
    
    if (!round_id) {
      return res.status(400).json({ error: 'round_id requis' });
    }
    const roundId = round_id;
    
    // 1. Récupérer les seuils du lot
    const thresholdsRes = await query(
      'SELECT * FROM lot_threshold_config WHERE lot_id = $1',
      [lotId]
    );
    const thresholds = thresholdsRes.rows[0] || {
      qty_very_low_threshold: 25,
      qty_low_threshold: 10,
      qty_high_threshold: 10,
      qty_very_high_threshold: 25,
      price_very_low_threshold: 25,
      price_low_threshold: 10,
      price_high_threshold: 10,
      price_very_high_threshold: 25,
      amount_very_low_threshold: 25,
      amount_low_threshold: 10,
      amount_high_threshold: 10,
      amount_very_high_threshold: 25
    };
    
    // 2. Récupérer les questions du projet
    const lotRes = await query('SELECT project_id FROM lots WHERE id = $1', [lotId]);
    if (lotRes.rowCount === 0) {
      return res.status(404).json({ error: 'Lot introuvable' });
    }
    const projectId = lotRes.rows[0].project_id;
    
    const questionsRes = await query(
      'SELECT * FROM project_question_config WHERE project_id = $1',
      [projectId]
    );
    const questions = questionsRes.rows[0] || {
      question_qty_very_low: 'Pourquoi la quantité est-elle bien inférieure à la MOE ?',
      question_qty_low: 'Pourquoi la quantité est-elle inférieure à la MOE ?',
      question_qty_high: 'Pourquoi la quantité est-elle supérieure à la MOE ?',
      question_qty_very_high: 'Pourquoi la quantité est-elle bien supérieure à la MOE ?',
      question_price_very_low: 'Pourquoi le prix unitaire est-il bien inférieur à la MOE ?',
      question_price_low: 'Pourquoi le prix unitaire est-il inférieur à la MOE ?',
      question_price_high: 'Pourquoi le prix unitaire est-il supérieur à la MOE ?',
      question_price_very_high: 'Pourquoi le prix unitaire est-il bien supérieur à la MOE ?',
      question_amount_very_low: 'Pourquoi le montant est-il bien inférieur à la MOE ?',
      question_amount_low: 'Pourquoi le montant est-il inférieur à la MOE ?',
      question_amount_high: 'Pourquoi le montant est-il supérieur à la MOE ?',
      question_amount_very_high: 'Pourquoi le montant est-il bien supérieur à la MOE ?',
      question_unit_mismatch: 'Pourquoi l\'unité de chiffrage est-elle différente de l\'unité MOE ({unit}) ?'
    };
    
    // 3. Récupérer les items, MOE et offres
    const itemsRes = await query(
      'SELECT * FROM items WHERE lot_id = $1',
      [lotId]
    );
    const items = itemsRes.rows;
    const itemsById = new Map(items.map(item => [item.id, item]));
    
    const moeRes = await query(
      'SELECT * FROM moe_items WHERE item_id = ANY($1::int[])',
      [items.map(i => i.id)]
    );
    const moeByItem = new Map(moeRes.rows.map(m => [m.item_id, m]));
    
    const offersRes = await query(
      'SELECT * FROM offers WHERE item_id = ANY($1::int[]) AND round_id = $2',
      [items.map(i => i.id), roundId]
    );
    const companiesRes = await query(
      'SELECT company_id FROM lot_companies WHERE lot_id = $1',
      [lotId]
    );
    
    // 4. Générer les questions
    const generated = [];
    const getComparableAmount = (row, options = {}) => {
      const allowCalculated = options.allowCalculated !== false;
      const directAmount = Number.parseFloat(row?.amount);
      if (Number.isFinite(directAmount)) return directAmount;
      if (!allowCalculated) return null;
      const qty = Number.parseFloat(row?.qty);
      const unitPrice = Number.parseFloat(row?.unit_price);
      if (Number.isFinite(qty) && Number.isFinite(unitPrice)) {
        return qty * unitPrice;
      }
      return null;
    }
    const hasFilledNumber = (value) => {
      const n = Number.parseFloat(value);
      return Number.isFinite(n) && n !== 0;
    };
    const isOfferUnanswered = (row) => {
      if (!row) return true;
      return !hasFilledNumber(row.qty) || !hasFilledNumber(row.unit_price);
    };

    const upsertQuestion = async ({ itemId, optionItemId, companyId, type, text, moeValue, offerValue, deviationPct, comment = null }) => {
      if (itemId) {
        await query(
          `INSERT INTO generated_questions 
            (lot_id, item_id, company_id, question_type, question_text, moe_value, offer_value, deviation_pct, comment, round_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (round_id, lot_id, item_id, company_id, question_type)
             WHERE item_id IS NOT NULL
           DO UPDATE SET 
             question_text = EXCLUDED.question_text,
             moe_value = EXCLUDED.moe_value,
             offer_value = EXCLUDED.offer_value,
             deviation_pct = EXCLUDED.deviation_pct,
             comment = EXCLUDED.comment`,
          [lotId, itemId, companyId, type, text, moeValue, offerValue, deviationPct, comment, roundId]
        );
      } else if (optionItemId) {
        await query(
          `INSERT INTO generated_questions 
            (lot_id, option_item_id, company_id, question_type, question_text, moe_value, offer_value, deviation_pct, comment, round_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (round_id, lot_id, option_item_id, company_id, question_type)
             WHERE option_item_id IS NOT NULL
           DO UPDATE SET 
             question_text = EXCLUDED.question_text,
             moe_value = EXCLUDED.moe_value,
             offer_value = EXCLUDED.offer_value,
             deviation_pct = EXCLUDED.deviation_pct,
             comment = EXCLUDED.comment`,
          [lotId, optionItemId, companyId, type, text, moeValue, offerValue, deviationPct, comment, roundId]
        );
      }
    };

    const nonUnitQuestionTypes = [
      'qty_very_low', 'qty_low', 'qty_high', 'qty_very_high',
      'price_very_low', 'price_low', 'price_high', 'price_very_high',
      'amount_very_low', 'amount_low', 'amount_high', 'amount_very_high'
    ];
    const answeredQuestionTypes = [...nonUnitQuestionTypes, 'unit_mismatch'];
    const deleteQuestionTypes = async ({ itemId, optionItemId, companyId, types }) => {
      if (itemId) {
        await query(
          `DELETE FROM generated_questions
           WHERE lot_id = $1
             AND round_id = $2
             AND item_id = $3
             AND company_id = $4
             AND question_type = ANY($5::text[])`,
          [lotId, roundId, itemId, companyId, types]
        );
        return;
      }
      if (optionItemId) {
        await query(
          `DELETE FROM generated_questions
           WHERE lot_id = $1
             AND round_id = $2
             AND option_item_id = $3
             AND company_id = $4
             AND question_type = ANY($5::text[])`,
          [lotId, roundId, optionItemId, companyId, types]
        );
      }
    };

    const deleteCompetingQuestionsForUnitMismatch = async ({ itemId, optionItemId, companyId }) => {
      if (itemId) {
        await query(
          `DELETE FROM generated_questions
           WHERE lot_id = $1
             AND round_id = $2
             AND item_id = $3
             AND company_id = $4
             AND question_type = ANY($5::text[])`,
          [lotId, roundId, itemId, companyId, nonUnitQuestionTypes]
        );
        return;
      }
      if (optionItemId) {
        await query(
          `DELETE FROM generated_questions
           WHERE lot_id = $1
             AND round_id = $2
             AND option_item_id = $3
             AND company_id = $4
             AND question_type = ANY($5::text[])`,
          [lotId, roundId, optionItemId, companyId, nonUnitQuestionTypes]
        );
      }
    };

    const insertUnansweredQuestion = async ({ itemId, optionItemId, companyId, moeAmount }) => {
      await deleteQuestionTypes({
        itemId,
        optionItemId,
        companyId,
        types: answeredQuestionTypes
      });
      const text = questions.unanswered_comment || 'Article sans réponse';
      await upsertQuestion({
        itemId,
        optionItemId,
        companyId,
        type: 'unanswered',
        text,
        moeValue: moeAmount,
        offerValue: null,
        deviationPct: null,
        comment: text
      });
      generated.push({
        ...(itemId ? { item_id: itemId } : { option_item_id: optionItemId }),
        company_id: companyId,
        type: 'unanswered'
      });
    };

    const offersByItemCompany = new Map(
      offersRes.rows.map(offer => [`${Number(offer.item_id)}_${Number(offer.company_id)}`, offer])
    );
    const companyIds = companiesRes.rows.map(row => Number(row.company_id)).filter(Number.isFinite);

    for (const item of items) {
      const moe = moeByItem.get(item.id);
      if (!moe) continue;
      const moeAmount = getComparableAmount(moe);
      if (moeAmount == null || moeAmount === 0) continue;

      for (const companyId of companyIds) {
        const offer = offersByItemCompany.get(`${Number(item.id)}_${companyId}`);
        if (!isOfferUnanswered(offer)) {
          await deleteQuestionTypes({ itemId: item.id, companyId, types: ['unanswered'] });
          continue;
        }
        await insertUnansweredQuestion({ itemId: item.id, companyId, moeAmount });
      }
    }

    for (const offer of offersRes.rows) {
      const moe = moeByItem.get(offer.item_id);
      if (!moe) continue;
      const item = itemsById.get(offer.item_id);
      
      // Offre considérée comme "oubliée" : qty ET unit_price à 0 ou null → pas de fiche question
      if (isOfferUnanswered(offer)) continue;
      const offerAmount = getComparableAmount(offer);
      const shouldSkipUnitAnalysis = hasBlockingUnitMismatch(item?.unit, offer.unit, offerAmount);
      if (shouldSkipUnitAnalysis) {
        const moeUnit = String(item?.unit || '').trim();
        const unitMismatchText = (questions.question_unit_mismatch || 'Pourquoi l\'unité de chiffrage est-elle différente de l\'unité MOE ({unit}) ?')
          .replace(/\{unit\}/g, moeUnit);
        await deleteCompetingQuestionsForUnitMismatch({
          itemId: offer.item_id,
          companyId: offer.company_id
        });
        await upsertQuestion({
          itemId: offer.item_id,
          companyId: offer.company_id,
          type: 'unit_mismatch',
          text: unitMismatchText,
          moeValue: null,
          offerValue: offerAmount,
          deviationPct: null,
          comment: buildUnitMismatchComment(moeUnit)
        });
        generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'unit_mismatch' });
      }
      
      // Vérifier écart quantité
      if (!shouldSkipUnitAnalysis && moe.qty != null && offer.qty != null && moe.qty !== 0) {
        const qtyDev = ((offer.qty - moe.qty) / moe.qty) * 100;
        
        if (qtyDev < -Math.abs(thresholds.qty_very_low_threshold)) {
          // Quantité très basse
          await upsertQuestion({
            itemId: offer.item_id,
            companyId: offer.company_id,
            type: 'qty_very_low',
            text: questions.question_qty_very_low,
            moeValue: moe.qty,
            offerValue: offer.qty,
            deviationPct: qtyDev
          });
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'qty_very_low' });
        } else if (qtyDev < -Math.abs(thresholds.qty_low_threshold)) {
          // Quantité basse
          await upsertQuestion({
            itemId: offer.item_id,
            companyId: offer.company_id,
            type: 'qty_low',
            text: questions.question_qty_low,
            moeValue: moe.qty,
            offerValue: offer.qty,
            deviationPct: qtyDev
          });
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'qty_low' });
        } else if (qtyDev > Math.abs(thresholds.qty_very_high_threshold)) {
          // Quantité très haute
          await upsertQuestion({
            itemId: offer.item_id,
            companyId: offer.company_id,
            type: 'qty_very_high',
            text: questions.question_qty_very_high,
            moeValue: moe.qty,
            offerValue: offer.qty,
            deviationPct: qtyDev
          });
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'qty_very_high' });
        } else if (qtyDev > Math.abs(thresholds.qty_high_threshold)) {
          // Quantité haute
          await upsertQuestion({
            itemId: offer.item_id,
            companyId: offer.company_id,
            type: 'qty_high',
            text: questions.question_qty_high,
            moeValue: moe.qty,
            offerValue: offer.qty,
            deviationPct: qtyDev
          });
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'qty_high' });
        }
      }
      
      // Vérifier écart prix
      if (!shouldSkipUnitAnalysis && moe.unit_price != null && offer.unit_price != null && moe.unit_price !== 0) {
        const priceDev = ((offer.unit_price - moe.unit_price) / moe.unit_price) * 100;
        
        if (priceDev < -Math.abs(thresholds.price_very_low_threshold)) {
          // Prix très bas
          await upsertQuestion({
            itemId: offer.item_id,
            companyId: offer.company_id,
            type: 'price_very_low',
            text: questions.question_price_very_low,
            moeValue: moe.unit_price,
            offerValue: offer.unit_price,
            deviationPct: priceDev
          });
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'price_very_low' });
        } else if (priceDev < -Math.abs(thresholds.price_low_threshold)) {
          // Prix bas
          await upsertQuestion({
            itemId: offer.item_id,
            companyId: offer.company_id,
            type: 'price_low',
            text: questions.question_price_low,
            moeValue: moe.unit_price,
            offerValue: offer.unit_price,
            deviationPct: priceDev
          });
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'price_low' });
        } else if (priceDev > Math.abs(thresholds.price_very_high_threshold)) {
          // Prix très haut
          await upsertQuestion({
            itemId: offer.item_id,
            companyId: offer.company_id,
            type: 'price_very_high',
            text: questions.question_price_very_high,
            moeValue: moe.unit_price,
            offerValue: offer.unit_price,
            deviationPct: priceDev
          });
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'price_very_high' });
        } else if (priceDev > Math.abs(thresholds.price_high_threshold)) {
          // Prix haut
          await upsertQuestion({
            itemId: offer.item_id,
            companyId: offer.company_id,
            type: 'price_high',
            text: questions.question_price_high,
            moeValue: moe.unit_price,
            offerValue: offer.unit_price,
            deviationPct: priceDev
          });
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'price_high' });
        }
      }

      const moeAmount = getComparableAmount(moe, { allowCalculated: false });
      if (!shouldSkipUnitAnalysis && moeAmount != null && offerAmount != null && moeAmount !== 0) {
        const amountDev = ((offerAmount - moeAmount) / moeAmount) * 100;

        if (amountDev < -Math.abs(thresholds.amount_very_low_threshold)) {
          await upsertQuestion({
            itemId: offer.item_id,
            companyId: offer.company_id,
            type: 'amount_very_low',
            text: questions.question_amount_very_low,
            moeValue: moeAmount,
            offerValue: offerAmount,
            deviationPct: amountDev
          });
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'amount_very_low' });
        } else if (amountDev < -Math.abs(thresholds.amount_low_threshold)) {
          await upsertQuestion({
            itemId: offer.item_id,
            companyId: offer.company_id,
            type: 'amount_low',
            text: questions.question_amount_low,
            moeValue: moeAmount,
            offerValue: offerAmount,
            deviationPct: amountDev
          });
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'amount_low' });
        } else if (amountDev > Math.abs(thresholds.amount_very_high_threshold)) {
          await upsertQuestion({
            itemId: offer.item_id,
            companyId: offer.company_id,
            type: 'amount_very_high',
            text: questions.question_amount_very_high,
            moeValue: moeAmount,
            offerValue: offerAmount,
            deviationPct: amountDev
          });
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'amount_very_high' });
        } else if (amountDev > Math.abs(thresholds.amount_high_threshold)) {
          await upsertQuestion({
            itemId: offer.item_id,
            companyId: offer.company_id,
            type: 'amount_high',
            text: questions.question_amount_high,
            moeValue: moeAmount,
            offerValue: offerAmount,
            deviationPct: amountDev
          });
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'amount_high' });
        }
      }
    }

    // 5. Ajouter les options (items d'option)
    const optionItemsRes = await query(
      `SELECT oi.id, oi.unit
       FROM option_items oi
       JOIN options o ON o.id = oi.option_id
       WHERE o.lot_id = $1 AND o.round_id = $2`,
      [lotId, roundId]
    );
    const optionItemIds = optionItemsRes.rows.map(r => r.id);
    const optionUnitsById = new Map(optionItemsRes.rows.map(row => [Number(row.id), row.unit || '']));

    if (optionItemIds.length > 0) {
      const optionMoeRes = await query(
        'SELECT * FROM option_item_moe WHERE option_item_id = ANY($1::int[])',
        [optionItemIds]
      );
      const moeByOptionItem = new Map(optionMoeRes.rows.map(m => [m.option_item_id, m]));

      const optionOffersRes = await query(
        'SELECT * FROM option_item_offers WHERE option_item_id = ANY($1::int[]) AND round_id = $2',
        [optionItemIds, roundId]
      );
      const optionOffersByItemCompany = new Map(
        optionOffersRes.rows.map(offer => [`${Number(offer.option_item_id)}_${Number(offer.company_id)}`, offer])
      );

      for (const optionItemId of optionItemIds) {
        const moe = moeByOptionItem.get(optionItemId);
        if (!moe) continue;
        const moeAmount = getComparableAmount(moe);
        if (moeAmount == null || moeAmount === 0) continue;

        for (const companyId of companyIds) {
          const offer = optionOffersByItemCompany.get(`${Number(optionItemId)}_${companyId}`);
          if (!isOfferUnanswered(offer)) {
            await deleteQuestionTypes({ optionItemId, companyId, types: ['unanswered'] });
            continue;
          }
          await insertUnansweredQuestion({ optionItemId, companyId, moeAmount });
        }
      }

      for (const offer of optionOffersRes.rows) {
        const moe = moeByOptionItem.get(offer.option_item_id);
        if (!moe) continue;
        const optionUnit = optionUnitsById.get(Number(offer.option_item_id)) || '';

        // Offre option considérée comme "oubliée" : qty ET unit_price à 0 ou null → pas de fiche question
        if (isOfferUnanswered(offer)) continue;
        const offerAmount = getComparableAmount(offer);
        const shouldSkipUnitAnalysis = hasBlockingUnitMismatch(optionUnit, offer.unit, offerAmount);

        if (shouldSkipUnitAnalysis) {
          const unitMismatchText = (questions.question_unit_mismatch || 'Pourquoi l\'unité de chiffrage est-elle différente de l\'unité MOE ({unit}) ?')
            .replace(/\{unit\}/g, optionUnit);
          await deleteCompetingQuestionsForUnitMismatch({
            optionItemId: offer.option_item_id,
            companyId: offer.company_id
          });
          await upsertQuestion({
            optionItemId: offer.option_item_id,
            companyId: offer.company_id,
            type: 'unit_mismatch',
            text: unitMismatchText,
            moeValue: null,
            offerValue: offerAmount,
            deviationPct: null,
            comment: buildUnitMismatchComment(optionUnit)
          });
          generated.push({ option_item_id: offer.option_item_id, company_id: offer.company_id, type: 'unit_mismatch' });
        }

        if (!shouldSkipUnitAnalysis && moe.qty != null && offer.qty != null && moe.qty !== 0) {
          const qtyDev = ((offer.qty - moe.qty) / moe.qty) * 100;
          if (qtyDev < -Math.abs(thresholds.qty_very_low_threshold)) {
            await upsertQuestion({
              optionItemId: offer.option_item_id,
              companyId: offer.company_id,
              type: 'qty_very_low',
              text: questions.question_qty_very_low,
              moeValue: moe.qty,
              offerValue: offer.qty,
              deviationPct: qtyDev
            });
            generated.push({ option_item_id: offer.option_item_id, company_id: offer.company_id, type: 'qty_very_low' });
          } else if (qtyDev < -Math.abs(thresholds.qty_low_threshold)) {
            await upsertQuestion({
              optionItemId: offer.option_item_id,
              companyId: offer.company_id,
              type: 'qty_low',
              text: questions.question_qty_low,
              moeValue: moe.qty,
              offerValue: offer.qty,
              deviationPct: qtyDev
            });
            generated.push({ option_item_id: offer.option_item_id, company_id: offer.company_id, type: 'qty_low' });
          } else if (qtyDev > Math.abs(thresholds.qty_very_high_threshold)) {
            await upsertQuestion({
              optionItemId: offer.option_item_id,
              companyId: offer.company_id,
              type: 'qty_very_high',
              text: questions.question_qty_very_high,
              moeValue: moe.qty,
              offerValue: offer.qty,
              deviationPct: qtyDev
            });
            generated.push({ option_item_id: offer.option_item_id, company_id: offer.company_id, type: 'qty_very_high' });
          } else if (qtyDev > Math.abs(thresholds.qty_high_threshold)) {
            await upsertQuestion({
              optionItemId: offer.option_item_id,
              companyId: offer.company_id,
              type: 'qty_high',
              text: questions.question_qty_high,
              moeValue: moe.qty,
              offerValue: offer.qty,
              deviationPct: qtyDev
            });
            generated.push({ option_item_id: offer.option_item_id, company_id: offer.company_id, type: 'qty_high' });
          }
        }

        if (!shouldSkipUnitAnalysis && moe.unit_price != null && offer.unit_price != null && moe.unit_price !== 0) {
          const priceDev = ((offer.unit_price - moe.unit_price) / moe.unit_price) * 100;
          if (priceDev < -Math.abs(thresholds.price_very_low_threshold)) {
            await upsertQuestion({
              optionItemId: offer.option_item_id,
              companyId: offer.company_id,
              type: 'price_very_low',
              text: questions.question_price_very_low,
              moeValue: moe.unit_price,
              offerValue: offer.unit_price,
              deviationPct: priceDev
            });
            generated.push({ option_item_id: offer.option_item_id, company_id: offer.company_id, type: 'price_very_low' });
          } else if (priceDev < -Math.abs(thresholds.price_low_threshold)) {
            await upsertQuestion({
              optionItemId: offer.option_item_id,
              companyId: offer.company_id,
              type: 'price_low',
              text: questions.question_price_low,
              moeValue: moe.unit_price,
              offerValue: offer.unit_price,
              deviationPct: priceDev
            });
            generated.push({ option_item_id: offer.option_item_id, company_id: offer.company_id, type: 'price_low' });
          } else if (priceDev > Math.abs(thresholds.price_very_high_threshold)) {
            await upsertQuestion({
              optionItemId: offer.option_item_id,
              companyId: offer.company_id,
              type: 'price_very_high',
              text: questions.question_price_very_high,
              moeValue: moe.unit_price,
              offerValue: offer.unit_price,
              deviationPct: priceDev
            });
            generated.push({ option_item_id: offer.option_item_id, company_id: offer.company_id, type: 'price_very_high' });
          } else if (priceDev > Math.abs(thresholds.price_high_threshold)) {
            await upsertQuestion({
              optionItemId: offer.option_item_id,
              companyId: offer.company_id,
              type: 'price_high',
              text: questions.question_price_high,
              moeValue: moe.unit_price,
              offerValue: offer.unit_price,
              deviationPct: priceDev
            });
            generated.push({ option_item_id: offer.option_item_id, company_id: offer.company_id, type: 'price_high' });
          }
        }

        const moeAmount = getComparableAmount(moe);
        if (!shouldSkipUnitAnalysis && moeAmount != null && offerAmount != null && moeAmount !== 0) {
          const amountDev = ((offerAmount - moeAmount) / moeAmount) * 100;
          if (amountDev < -Math.abs(thresholds.amount_very_low_threshold)) {
            await upsertQuestion({
              optionItemId: offer.option_item_id,
              companyId: offer.company_id,
              type: 'amount_very_low',
              text: questions.question_amount_very_low,
              moeValue: moeAmount,
              offerValue: offerAmount,
              deviationPct: amountDev
            });
            generated.push({ option_item_id: offer.option_item_id, company_id: offer.company_id, type: 'amount_very_low' });
          } else if (amountDev < -Math.abs(thresholds.amount_low_threshold)) {
            await upsertQuestion({
              optionItemId: offer.option_item_id,
              companyId: offer.company_id,
              type: 'amount_low',
              text: questions.question_amount_low,
              moeValue: moeAmount,
              offerValue: offerAmount,
              deviationPct: amountDev
            });
            generated.push({ option_item_id: offer.option_item_id, company_id: offer.company_id, type: 'amount_low' });
          } else if (amountDev > Math.abs(thresholds.amount_very_high_threshold)) {
            await upsertQuestion({
              optionItemId: offer.option_item_id,
              companyId: offer.company_id,
              type: 'amount_very_high',
              text: questions.question_amount_very_high,
              moeValue: moeAmount,
              offerValue: offerAmount,
              deviationPct: amountDev
            });
            generated.push({ option_item_id: offer.option_item_id, company_id: offer.company_id, type: 'amount_very_high' });
          } else if (amountDev > Math.abs(thresholds.amount_high_threshold)) {
            await upsertQuestion({
              optionItemId: offer.option_item_id,
              companyId: offer.company_id,
              type: 'amount_high',
              text: questions.question_amount_high,
              moeValue: moeAmount,
              offerValue: offerAmount,
              deviationPct: amountDev
            });
            generated.push({ option_item_id: offer.option_item_id, company_id: offer.company_id, type: 'amount_high' });
          }
        }
      }
    }
    
    res.json({ generated: generated.length, questions: generated });
  } catch (err) {
    console.error('Erreur génération fiches questions:', err);
    res.status(500).json({ error: 'Impossible de générer les fiches questions' });
  }
});

// Supprimer toutes les fiches questions pour un lot et un tour
router.delete('/lot/:lotId', requireManager, async (req, res) => {
  try {
    const { lotId } = req.params;
    const roundId = req.query.round_id;

    if (!roundId) {
      return res.status(400).json({ error: 'round_id requis' });
    }
    if (!/^\d+$/.test(String(lotId)) || !/^\d+$/.test(String(roundId))) {
      return res.status(400).json({ error: 'Paramètres invalides' });
    }

    const result = await query(
      'DELETE FROM generated_questions WHERE lot_id = $1 AND round_id = $2',
      [Number(lotId), Number(roundId)]
    );

    res.json({ ok: true, deleted: result.rowCount });
  } catch (err) {
    console.error('Erreur suppression fiches questions:', err);
    res.status(500).json({ error: 'Impossible de supprimer les fiches questions' });
  }
});

// Liste des fiches questions d'un lot et d'un tour
router.get('/lot/:lotId', async (req, res) => {
  try {
    const { lotId } = req.params;
    const { status, company_id, round_id } = req.query;
    const isEntreprise = req.user?.role === 'entreprise';
    
    let sql = `
      SELECT gq.*, 
        CASE WHEN gq.option_item_id IS NOT NULL THEN
          CASE WHEN oi.num IS NULL OR oi.num = '' THEN '' ELSE 'O' || oi.num END
          ELSE i.num END AS num,
        CASE WHEN gq.option_item_id IS NOT NULL
          THEN COALESCE(o.designation || ' — ' || oi.designation, oi.designation)
          ELSE i.designation END AS designation,
        COALESCE(i.unit, oi.unit) AS unit,
        (gq.option_item_id IS NOT NULL) AS is_option,
        COALESCE(NULLIF(lc.display_name, ''), c.name) as company_name
      FROM generated_questions gq
      LEFT JOIN items i ON i.id = gq.item_id
      LEFT JOIN option_items oi ON oi.id = gq.option_item_id
      LEFT JOIN options o ON o.id = oi.option_id
      JOIN companies c ON c.id = gq.company_id
      LEFT JOIN lot_companies lc ON lc.lot_id = gq.lot_id AND lc.company_id = gq.company_id
      WHERE gq.lot_id = $1
    `;
    
    const params = [lotId];
    
    if (round_id) {
      sql += ` AND gq.round_id = $${params.length + 1}`;
      params.push(round_id);
    }
    
    if (status) {
      sql += ` AND gq.status = $${params.length + 1}`;
      params.push(status);
    }
    
    // Si utilisateur entreprise, forcer le filtre sur sa company_id
    if (isEntreprise && req.user?.company_id) {
      sql += ` AND gq.company_id = $${params.length + 1}`;
      params.push(req.user.company_id);
    } else if (company_id) {
      sql += ` AND gq.company_id = $${params.length + 1}`;
      params.push(company_id);
    }
    
    sql += ` ORDER BY company_name, (gq.option_item_id IS NOT NULL), COALESCE(i.num, oi.num), gq.question_type`;
    
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur récupération fiches questions:', err);
    res.status(500).json({ error: 'Impossible de récupérer les fiches questions' });
  }
});

// Créer une fiche question manuelle
router.post('/question', requireManager, async (req, res) => {
  try {
    const {
      lot_id,
      round_id,
      item_id,
      option_item_id,
      company_id,
      question_text,
      question_type,
      status
    } = req.body || {};

    if (!lot_id || !round_id || !company_id || !question_text || !question_type) {
      return res.status(400).json({ error: 'Champs requis: lot_id, round_id, company_id, question_text, question_type' });
    }

    const lotId = Number(lot_id);
    const roundId = Number(round_id);
    const companyId = Number(company_id);
    const itemId = item_id != null ? Number(item_id) : null;
    const optionItemId = option_item_id != null ? Number(option_item_id) : null;

    if (!Number.isFinite(lotId) || !Number.isFinite(roundId) || !Number.isFinite(companyId)) {
      return res.status(400).json({ error: 'Paramètres numériques invalides' });
    }

    if ((itemId == null && optionItemId == null) || (itemId != null && optionItemId != null)) {
      return res.status(400).json({ error: 'Fournir exactement un seul identifiant: item_id ou option_item_id' });
    }

    const safeText = String(question_text).trim();
    if (!safeText) {
      return res.status(400).json({ error: 'question_text vide' });
    }

    const safeType = String(question_type).trim();
    const safeStatus = status ? String(status).trim() : 'pending';

    let result;

    if (itemId != null) {
      result = await query(
        `INSERT INTO generated_questions
          (lot_id, round_id, item_id, company_id, question_type, question_text, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (round_id, lot_id, item_id, company_id, question_type)
           WHERE item_id IS NOT NULL
         DO UPDATE SET
           question_text = EXCLUDED.question_text,
           status = EXCLUDED.status
         RETURNING *`,
        [lotId, roundId, itemId, companyId, safeType, safeText, safeStatus]
      );
    } else {
      result = await query(
        `INSERT INTO generated_questions
          (lot_id, round_id, option_item_id, company_id, question_type, question_text, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (round_id, lot_id, option_item_id, company_id, question_type)
           WHERE option_item_id IS NOT NULL
         DO UPDATE SET
           question_text = EXCLUDED.question_text,
           status = EXCLUDED.status
         RETURNING *`,
        [lotId, roundId, optionItemId, companyId, safeType, safeText, safeStatus]
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erreur création fiche question:', err);
    if (err?.code === '23514') {
      return res.status(400).json({ error: 'Type de question invalide' });
    }
    if (err?.code === '23503') {
      return res.status(400).json({ error: 'Référence invalide (lot/tour/item/entreprise)' });
    }
    res.status(500).json({ error: 'Impossible de créer la fiche question' });
  }
});

// Mettre à jour une fiche question (réponse, statut)
router.put('/question/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { comment, status, question_text, company_id } = req.body || {};
    const isEntreprise = req.user?.role === 'entreprise';

    if (!id || !/^\d+$/.test(id)) {
      return res.status(400).json({ error: 'ID invalide' });
    }
    const questionId = Number(id);
    
    // Si entreprise, vérifier que la question lui appartient
    if (isEntreprise && req.user?.company_id) {
      const checkResult = await query(
        'SELECT company_id FROM generated_questions WHERE id = $1',
        [questionId]
      );
      if (checkResult.rowCount === 0) {
        return res.status(404).json({ error: 'Fiche question introuvable' });
      }
      if (checkResult.rows[0].company_id !== req.user.company_id) {
        return res.status(403).json({ error: 'Accès refusé - Cette question ne vous appartient pas' });
      }

      // Une entreprise peut répondre, mais ne peut pas réassigner/éditer le texte de la fiche.
      if (question_text !== undefined || company_id !== undefined) {
        return res.status(403).json({ error: 'Accès refusé - Modification non autorisée' });
      }
    }

    const updates = [];
    const params = [];

    if (comment !== undefined) {
      params.push(comment);
      updates.push(`comment = $${params.length}`);
    }

    if (status !== undefined) {
      params.push(status);
      updates.push(`status = $${params.length}`);
      updates.push(`answered_at = CASE WHEN $${params.length} = 'answered' THEN now() ELSE answered_at END`);
    }

    if (question_text !== undefined) {
      const safeText = String(question_text).trim();
      if (!safeText) {
        return res.status(400).json({ error: 'question_text vide' });
      }
      params.push(safeText);
      updates.push(`question_text = $${params.length}`);
    }

    if (company_id !== undefined) {
      const companyId = Number(company_id);
      if (!Number.isFinite(companyId)) {
        return res.status(400).json({ error: 'company_id invalide' });
      }
      params.push(companyId);
      updates.push(`company_id = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    params.push(questionId);

    const result = await query(
      `UPDATE generated_questions
       SET ${updates.join(', ')}
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Fiche question introuvable' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur mise à jour fiche question:', err);
    res.status(500).json({ error: 'Impossible de mettre à jour la fiche question' });
  }
});

// Valider une fiche question
router.put('/question/:id/validate', requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !/^\d+$/.test(id)) {
      return res.status(400).json({ error: 'ID invalide' });
    }

    const questionId = Number(id);
    const result = await query(
      `UPDATE generated_questions
       SET status = 'validated',
           answered_at = COALESCE(answered_at, now())
       WHERE id = $1
       RETURNING *`,
      [questionId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Fiche question introuvable' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur validation fiche question:', err);
    res.status(500).json({ error: 'Impossible de valider la fiche question' });
  }
});

// Désactiver la validation d'une fiche question
router.put('/question/:id/unvalidate', requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !/^\d+$/.test(id)) {
      return res.status(400).json({ error: 'ID invalide' });
    }

    const questionId = Number(id);
    const result = await query(
      `UPDATE generated_questions
       SET status = 'pending'
       WHERE id = $1
       RETURNING *`,
      [questionId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Fiche question introuvable' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur désactivation validation fiche question:', err);
    res.status(500).json({ error: 'Impossible de désactiver la validation de la fiche question' });
  }
});

// Validation globale des fiches questions d'un lot/tour (optionnellement filtrée par entreprise)
router.put('/lot/:lotId/validate', requireManager, async (req, res) => {
  try {
    const { lotId } = req.params;
    const roundId = req.query.round_id || req.body?.round_id;
    const companyId = req.query.company_id || req.body?.company_id;

    if (!roundId) {
      return res.status(400).json({ error: 'round_id requis' });
    }
    if (!/^\d+$/.test(String(lotId)) || !/^\d+$/.test(String(roundId))) {
      return res.status(400).json({ error: 'Paramètres invalides' });
    }
    if (companyId != null && companyId !== '' && !/^\d+$/.test(String(companyId))) {
      return res.status(400).json({ error: 'company_id invalide' });
    }

    const params = [Number(lotId), Number(roundId)];
    let sql = `
      UPDATE generated_questions
      SET status = 'validated',
          answered_at = COALESCE(answered_at, now())
      WHERE lot_id = $1
        AND round_id = $2
    `;

    if (companyId != null && companyId !== '') {
      params.push(Number(companyId));
      sql += ` AND company_id = $${params.length}`;
    }

    sql += ' RETURNING id';
    const result = await query(sql, params);
    res.json({ ok: true, updated: result.rowCount });
  } catch (err) {
    console.error('Erreur validation globale fiches questions:', err);
    res.status(500).json({ error: 'Impossible de valider les fiches questions' });
  }
});

// Supprimer une fiche question
router.delete('/question/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const isEntreprise = req.user?.role === 'entreprise';

    if (!id || !/^\d+$/.test(id)) {
      return res.status(400).json({ error: 'ID invalide' });
    }
    const questionId = Number(id);
    
    // Si entreprise, vérifier que la question lui appartient
    if (isEntreprise && req.user?.company_id) {
      const checkResult = await query(
        'SELECT company_id FROM generated_questions WHERE id = $1',
        [questionId]
      );
      if (checkResult.rowCount === 0) {
        return res.status(404).json({ error: 'Fiche question introuvable' });
      }
      if (checkResult.rows[0].company_id !== req.user.company_id) {
        return res.status(403).json({ error: 'Accès refusé - Cette question ne vous appartient pas' });
      }
    }
    
    await query('DELETE FROM generated_questions WHERE id = $1', [questionId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur suppression fiche question:', err);
    res.status(500).json({ error: 'Impossible de supprimer la fiche question' });
  }
});

// Export Excel des fiches questions
router.get('/lot/:lotId/export-excel', async (req, res) => {
  try {
    const { lotId } = req.params;
    const { status, company_id, round_id } = req.query;
    const isEntreprise = req.user?.role === 'entreprise';
    
    // Import dynamique de exceljs pour une meilleure mise en forme
    const ExcelJS = (await import('exceljs')).default;
    
    // Récupérer les données
    let sql = `
      SELECT gq.*, 
        CASE WHEN gq.option_item_id IS NOT NULL THEN
          CASE WHEN oi.num IS NULL OR oi.num = '' THEN '' ELSE 'O' || oi.num END
          ELSE i.num END AS num,
        CASE WHEN gq.option_item_id IS NOT NULL
          THEN COALESCE(o.designation || ' — ' || oi.designation, oi.designation)
          ELSE i.designation END AS designation,
        COALESCE(i.unit, oi.unit) AS unit,
        (gq.option_item_id IS NOT NULL) AS is_option,
        COALESCE(NULLIF(lc.display_name, ''), c.name) as company_name,
        l.name as lot_name,
        p.name as project_name
      FROM generated_questions gq
      LEFT JOIN items i ON i.id = gq.item_id
      LEFT JOIN option_items oi ON oi.id = gq.option_item_id
      LEFT JOIN options o ON o.id = oi.option_id
      JOIN companies c ON c.id = gq.company_id
      LEFT JOIN lot_companies lc ON lc.lot_id = gq.lot_id AND lc.company_id = gq.company_id
      JOIN lots l ON l.id = gq.lot_id
      JOIN projects p ON p.id = l.project_id
      WHERE gq.lot_id = $1
    `;
    
    const params = [lotId];
    
    if (round_id) {
      sql += ` AND gq.round_id = $${params.length + 1}`;
      params.push(round_id);
    }
    
    if (status) {
      sql += ` AND gq.status = $${params.length + 1}`;
      params.push(status);
    }
    
    // Si utilisateur entreprise, forcer le filtre sur sa company_id
    if (isEntreprise && req.user?.company_id) {
      sql += ` AND gq.company_id = $${params.length + 1}`;
      params.push(req.user.company_id);
    } else if (company_id) {
      sql += ` AND gq.company_id = $${params.length + 1}`;
      params.push(company_id);
    }
    
    sql += ` ORDER BY company_name, (gq.option_item_id IS NOT NULL), COALESCE(i.num, oi.num), gq.question_type`;
    
    const result = await query(sql, params);
    const questions = result.rows;
    
    if (questions.length === 0) {
      return res.status(404).json({ error: 'Aucune fiche question à exporter' });
    }
    
    // Grouper les questions par entreprise
    const questionsByCompany = new Map();
    questions.forEach(q => {
      if (!questionsByCompany.has(q.company_id)) {
        questionsByCompany.set(q.company_id, {
          name: q.company_name,
          questions: []
        });
      }
      questionsByCompany.get(q.company_id).questions.push(q);
    });
    
    // Créer le workbook avec ExcelJS
    const workbook = new ExcelJS.Workbook();
    
    // Créer un onglet par entreprise (même format que la fiche question affichée)
    for (const [companyId, companyData] of questionsByCompany) {
      // Nom de l'onglet (limité à 31 caractères pour Excel)
      let sheetName = companyData.name.substring(0, 31);
      
      const worksheet = workbook.addWorksheet(sheetName);
      
      // Colonnes identiques à l'affichage de la fiche question
      worksheet.columns = [
        { header: 'Entreprise', key: 'company', width: 20 },
        { header: 'Article', key: 'article', width: 40 },
        { header: 'Type', key: 'type', width: 22 },
        { header: 'Question', key: 'question', width: 50 },
        { header: 'Écart (%)', key: 'deviation', width: 12 },
        { header: 'Valeur MOE', key: 'moe_value', width: 14 },
        { header: 'Valeur Offre', key: 'offer_value', width: 14 },
        { header: 'Réponse', key: 'comment', width: 40 },
        { header: 'Statut', key: 'status', width: 14 }
      ];
      
      // Styliser l'en-tête
      const headerRow = worksheet.getRow(1);
      headerRow.height = 25;
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      headerRow.border = {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' }
      };
      
      // Ajouter les données pour cette entreprise
      companyData.questions.forEach(q => {
        const typeLabel = {
          'unanswered': 'Réponse oubliée',
          'unit_mismatch': 'Unité à vérifier',
          'qty_very_low': 'Qté Très Basse',
          'qty_low': 'Qté Basse',
          'qty_high': 'Qté Haute',
          'qty_very_high': 'Qté Très Haute',
          'price_very_low': 'Prix Très Bas',
          'price_low': 'Prix Bas',
          'price_high': 'Prix Haut',
          'price_very_high': 'Prix Très Haut',
          'amount_very_low': 'Montant Très Bas',
          'amount_low': 'Montant Bas',
          'amount_high': 'Montant Haut',
          'amount_very_high': 'Montant Très Haut'
        }[q.question_type] || q.question_type;
        
        const statusLabel = {
          'pending': 'En attente',
          'answered': 'Répondue',
          'dismissed': 'Ignorée'
        }[q.status] || q.status;

        // Article combiné (num - designation) comme dans l'affichage
        const articleLabel = q.num ? `${q.num} - ${q.designation || ''}` : (q.designation || '');
        
        const row = worksheet.addRow({
          company: q.company_name,
          article: articleLabel,
          type: typeLabel,
          question: q.question_text,
          deviation: excelNumber(q.deviation_pct),
          moe_value: excelNumber(q.moe_value),
          offer_value: excelNumber(q.offer_value),
          comment: q.comment || '',
          status: statusLabel
        });
        
        // Appliquer les styles de base
        row.alignment = { vertical: 'top', wrapText: true };
        row.border = {
          top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
        };
        
        // Colonne Écart (%) - Format et coloration selon la valeur
        const deviationCell = row.getCell(5);
        const deviationValue = excelNumber(q.deviation_pct);
        if (deviationValue !== null) {
          deviationCell.numFmt = '0.0000"%"';
          deviationCell.alignment = { horizontal: 'right', vertical: 'top' };
          const ecartAbs = Math.abs(deviationValue);
          if (ecartAbs > 20) {
            deviationCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } };
            deviationCell.font = { color: { argb: 'FFCC0000' }, bold: true };
          } else if (ecartAbs > 10) {
            deviationCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE5CC' } };
            deviationCell.font = { color: { argb: 'FFCC6600' } };
          }
        }
        
        // Colonnes Valeur MOE et Valeur Offre - Format numérique
        const moeCell = row.getCell(6);
        const offerCell = row.getCell(7);
        const valueNumFmt = questionValueNumberFormat(q.question_type, q.unit);
        if (excelNumber(q.moe_value) !== null) {
          moeCell.numFmt = valueNumFmt;
          moeCell.alignment = { horizontal: 'right', vertical: 'top' };
        }
        if (excelNumber(q.offer_value) !== null) {
          offerCell.numFmt = valueNumFmt;
          offerCell.alignment = { horizontal: 'right', vertical: 'top' };
        }
        
        // Colonne Type - Coloration selon le type (mêmes couleurs que l'affichage)
        const typeCell = row.getCell(3);
        if (q.question_type === 'unit_mismatch') {
          typeCell.font = { color: { argb: 'FF6F42C1' }, bold: true };
        } else if (q.question_type?.includes('very_low')) {
          typeCell.font = { color: { argb: 'FF0D6EFD' }, bold: true };
        } else if (q.question_type?.includes('_low')) {
          typeCell.font = { color: { argb: 'FF0DCAF0' }, bold: true };
        } else if (q.question_type?.includes('very_high')) {
          typeCell.font = { color: { argb: 'FFDC3545' }, bold: true };
        } else if (q.question_type?.includes('_high')) {
          typeCell.font = { color: { argb: 'FFFD7E14' }, bold: true };
        }
        
        // Colonne Statut - Coloration selon le statut
        const statusCell = row.getCell(9);
        if (statusLabel === 'En attente') {
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
        } else if (statusLabel === 'Répondue') {
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1E7DD' } };
        } else if (statusLabel === 'Ignorée') {
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
        }
      });
      
      // Figer la première ligne
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    }
    
    // Générer le buffer Excel
    const buffer = await workbook.xlsx.writeBuffer();
    
    // Envoyer le fichier
    const filename = `Fiches_Questions_Lot_${lotId}_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
    
  } catch (err) {
    console.error('Erreur export Excel:', err);
    res.status(500).json({ error: 'Impossible d\'exporter les fiches questions' });
  }
});

export default router;
