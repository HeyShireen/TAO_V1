import ExcelJS from 'exceljs';
import pdfParse from 'pdf-parse';
import { execFile } from 'child_process';
import crypto from 'crypto';
import fsSync from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { promisify } from 'util';
import { query, pool } from '../db.js';

/**
 * Smart Importer — Gère l'import de fichiers Excel avec formats variés.
 * 
 * Workflow en 2 étapes :
 *   1. preview()  → Lit le fichier, détecte les colonnes, retourne un aperçu + mapping suggéré
 *   2. apply()    → Applique le mapping validé par l'utilisateur pour importer les données
 *
 * Modes :
 *   - "dpgf"     → Import de la DPGF MOE (crée les items + données MOE dans un lot)
 *   - "offer"    → Import d'une offre entreprise (matche par Num/position sur items existants)
 */

const normalize = (s) => (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

// Patterns de détection automatique des colonnes
const COLUMN_PATTERNS = {
  num:         ['n°', 'num', 'no', 'numéro', 'numero', 'n °', 'art', 'article', 'poste', 'ref', 'réf', 'code'],
  designation: ['désignation', 'designation', 'libellé', 'libelle', 'description', 'intitulé', 'intitule', 'ouvrage', 'prestation'],
  unit:        ['unité', 'unite', 'u.'],
  qty:         ['quantité', 'quantite', 'qté', 'qte', 'q', 'qt', 'nombre', 'nb'],
  unit_price:  ['prix unitaire', 'pu', 'p.u.', 'p.u', 'prix unit', 'prix u'],
  amount:      ['montant', 'mt', 'total', 'prix total', 'sous-total', 'sous total', 'somme'],
};

// Patterns courts qui ne doivent matcher qu'en mot entier (exact ou bordé par espaces)
const WORD_BOUNDARY_PATTERNS = new Set(['pu', 'mt', 'q', 'qt', 'nb', 'no']);

// Patterns pour détecter les lignes sous-total / titre de chapitre à ignorer
const SUBTITLE_PATTERNS = [
  /^\s*sous[\s-]*total/i,
  /^\s*total\s/i,
  /^\s*total$/i,
  /^\s*s\.?\s*t\.?\s*$/i,
  /^\s*chapitre\s/i,
  /^\s*lot\s+\d/i,
  /^\s*tranche\s/i,
];

function isSubtotalOrTitleRow(designation, num, hasQty, hasPu) {
  if (!designation) return false;
  const d = String(designation).trim();
  // Ligne avec désignation mais sans quantité ni prix → probable titre
  if (d && !hasQty && !hasPu && !num) return true;
  // Patterns explicites
  return SUBTITLE_PATTERNS.some(p => p.test(d));
}

/**
 * Lit un fichier Excel et retourne un aperçu des données + suggestions de mapping.
 * @param {Buffer} buffer - Le buffer du fichier Excel
 * @param {string} [sheetName] - Nom de l'onglet à utiliser (optionnel, sinon premier onglet)
 * @returns {{ sheets: string[], selectedSheet: string, headers: {index: number, name: string}[], suggestedMapping: object, previewRows: object[], totalRows: number }}
 */
export async function previewExcel({ buffer, sheetName, headerRow: headerRowOverride }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheetNames = wb.worksheets.map(ws => ws.name);
  if (sheetNames.length === 0) throw new Error('Fichier Excel vide');

  // Sélectionner l'onglet
  const ws = sheetName
    ? wb.worksheets.find(s => s.name === sheetName) || wb.worksheets[0]
    : wb.worksheets[0];

  // Détecter la ligne d'en-tête (ou utiliser le choix de l'utilisateur)
  let headerRowIdx = headerRowOverride ? Number(headerRowOverride) : 0;
  if (!headerRowIdx || headerRowIdx < 1) {
    headerRowIdx = 1;
    const maxScan = Math.min(20, ws.rowCount);
    for (let r = 1; r <= maxScan; r++) {
      const row = ws.getRow(r);
      let filledCount = 0;
      row.eachCell({ includeEmpty: false }, () => filledCount++);
      if (filledCount >= 3) {
        headerRowIdx = r;
        break;
      }
    }
  }

  // Déterminer le nombre max de colonnes utilisées (en-tête + premières lignes de données)
  const headerRow = ws.getRow(headerRowIdx);
  let maxCol = headerRow.cellCount || 0;
  // Scanner quelques lignes de données pour trouver des colonnes supplémentaires
  for (let r = headerRowIdx + 1; r <= Math.min(headerRowIdx + 10, ws.rowCount); r++) {
    const dr = ws.getRow(r);
    if (dr && dr.cellCount > maxCol) maxCol = dr.cellCount;
  }
  if (maxCol === 0) throw new Error('Aucun en-tête détecté');

  // Extraire les en-têtes pour TOUTES les colonnes (y compris celles sans en-tête)
  const headers = [];
  for (let c = 1; c <= maxCol; c++) {
    const cell = headerRow.getCell(c);
    const text = cellToString(cell);
    headers.push({ index: c, name: text || `Col ${c} (vide)` });
  }

  // Auto-détection du mapping
  const suggestedMapping = autoDetectMapping(headers);

  // Extraire TOUTES les lignes pour prévisualisation
  const previewRows = [];
  const dataStartRow = headerRowIdx + 1;
  for (let r = dataStartRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row || row.cellCount === 0) continue;
    const obj = { _rowNum: r };
    let hasAny = false;
    for (const h of headers) {
      const cell = row.getCell(h.index);
      const val = cellToValue(cell);
      obj[h.index] = val;
      if (val !== null && val !== '') hasAny = true;
    }
    if (hasAny) {
      previewRows.push(obj);
    }
  }

  // Compter les lignes de données (non vides)
  let totalRows = 0;
  for (let r = dataStartRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row || row.cellCount === 0) continue;
    let hasAny = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cellToValue(cell) !== null && cellToValue(cell) !== '') hasAny = true;
    });
    if (hasAny) totalRows++;
  }

  return {
    sheets: sheetNames,
    selectedSheet: ws.name,
    headerRow: headerRowIdx,
    headers,
    suggestedMapping,
    previewRows,
    totalRows,
  };
}

/**
 * Lit un fichier PDF et retourne un aperçu des données + suggestions de mapping.
 * Le PDF doit contenir un tableau avec colonnes séparées par des espaces.
 * @param {Buffer} buffer - Le buffer du fichier PDF
 * @param {number} [headerRow] - Numéro de ligne d'en-tête (optionnel)
 */
export async function previewPdf({ buffer, headerRow }) {
  const { headers, rows, headerRow: resolvedHeaderRow } = await parsePdfTable({ buffer, headerRow });
  const suggestedMapping = autoDetectMapping(headers);

  const previewRows = rows.map((r) => {
    const obj = { _rowNum: r.rowNum };
    for (const h of headers) {
      obj[h.index] = r.cols[h.index - 1] ?? '';
    }
    return obj;
  });

  return {
    sheets: ['PDF'],
    selectedSheet: 'PDF',
    headerRow: resolvedHeaderRow,
    headers,
    suggestedMapping,
    previewRows,
    totalRows: rows.length,
  };
}

/**
 * Convertit un PDF en fichier Excel (en memoire) pour reutiliser le flow d'import existant.
 * @param {Buffer} buffer - Le buffer du fichier PDF
 * @param {number} [headerRow] - Ligne d'en-tete (optionnel)
 */
export async function convertPdfToExcelBuffer({ buffer, headerRow }) {
  const tabulaBuffer = await tryConvertPdfWithTabula(buffer);
  if (tabulaBuffer) return tabulaBuffer;

  const { headers, rows } = await parsePdfTable({ buffer, headerRow });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('PDF');

  ws.addRow(headers.map(h => h.name));
  for (const row of rows) {
    const values = headers.map((h, idx) => row.cols[idx] ?? '');
    ws.addRow(values);
  }

  return wb.xlsx.writeBuffer();
}

/**
 * Applique l'import avec le mapping validé par l'utilisateur.
 * 
 * @param {Object} params
 * @param {Buffer}  params.buffer     - Fichier Excel
 * @param {string}  params.mode       - "dpgf" ou "offer"
 * @param {number}  params.lotId      - ID du lot cible
 * @param {number}  [params.roundId]  - ID du tour (obligatoire pour mode "offer")
 * @param {number}  [params.companyId] - ID entreprise (obligatoire pour mode "offer")
 * @param {string}  [params.companyName] - Nom entreprise (si nouvelle, pour mode "offer")
 * @param {string}  params.sheetName  - Onglet sélectionné
 * @param {number}  params.headerRow  - Numéro de ligne d'en-tête
 * @param {Object}  params.mapping    - { num: colIndex|colIndex[], designation: colIndex|colIndex[], unit: colIndex, qty: colIndex, unit_price: colIndex, amount: colIndex }
 */
export async function applyImport({ buffer, mode, lotId, roundId, companyId, companyName, sheetName, headerRow, mapping, excludedRows, importOperation = 'replace' }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets.find(s => s.name === sheetName) || wb.worksheets[0];

  // Lignes exclues par l'utilisateur (numéros de ligne Excel)
  const excluded = new Set((excludedRows || []).map(Number));

  // Extraire les en-têtes pour validation (toutes les colonnes)
  const headers = [];
  const hRow = ws.getRow(headerRow);
  let maxCol = hRow.cellCount || 0;
  for (let r = headerRow + 1; r <= Math.min(headerRow + 5, ws.rowCount); r++) {
    const dr = ws.getRow(r);
    if (dr && dr.cellCount > maxCol) maxCol = dr.cellCount;
  }
  for (let c = 1; c <= maxCol; c++) {
    const cell = hRow.getCell(c);
    headers.push({ index: c, name: cellToString(cell) || `Col ${c}` });
  }

  // Extraire toutes les lignes de données (sauf exclues)
  // Limiter aux colonnes mappées pour importer uniquement les champs sélectionnés
  const usedCols = new Set();
  for (const [field, val] of Object.entries(mapping || {})) {
    if (val == null) continue;
    if (field === 'designation' || field === 'num') {
      const arr = Array.isArray(val) ? val : [val];
      arr.forEach(ci => usedCols.add(Number(ci)));
    } else {
      usedCols.add(Number(val));
    }
  }
  const dataRows = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    if (excluded.has(r)) continue;
    const row = ws.getRow(r);
    if (!row || row.cellCount === 0) continue;

    const obj = {};
    let hasAny = false;
    for (const h of headers) {
      if (usedCols.size && !usedCols.has(h.index)) continue;
      const val = cellToValue(row.getCell(h.index));
      obj[h.index] = val;
      if (val !== null && val !== '') hasAny = true;
    }
    if (hasAny) dataRows.push(obj);
  }

  return runImportWithRows({ mode, lotId, roundId, companyId, companyName, dataRows, mapping, importOperation });
}

/**
 * Applique l'import depuis un fichier PDF.
 */
export async function applyImportPdf({ buffer, mode, lotId, roundId, companyId, companyName, headerRow, mapping, excludedRows, importOperation = 'replace' }) {
  const { headers, rows } = await parsePdfTable({ buffer, headerRow });

  const excluded = new Set((excludedRows || []).map(Number));
  const usedCols = new Set();
  for (const [field, val] of Object.entries(mapping || {})) {
    if (val == null) continue;
    if (field === 'designation' || field === 'num') {
      const arr = Array.isArray(val) ? val : [val];
      arr.forEach(ci => usedCols.add(Number(ci)));
    } else {
      usedCols.add(Number(val));
    }
  }

  const dataRows = [];
  for (const r of rows) {
    if (excluded.has(r.rowNum)) continue;
    const obj = {};
    let hasAny = false;
    for (const h of headers) {
      if (usedCols.size && !usedCols.has(h.index)) continue;
      const val = r.cols[h.index - 1] ?? '';
      obj[h.index] = val;
      if (val !== null && val !== '') hasAny = true;
    }
    if (hasAny) dataRows.push(obj);
  }

  return runImportWithRows({ mode, lotId, roundId, companyId, companyName, dataRows, mapping, importOperation });
}

function normalizeImportOperation(value) {
  return value === 'update' ? 'update' : 'replace';
}

function runImportWithRows({ mode, lotId, roundId, companyId, companyName, dataRows, mapping, importOperation = 'replace' }) {
  const normalizedMapping = normalizeImportMapping(mapping);
  const operation = normalizeImportOperation(importOperation);

  if (dataRows.length === 0) throw new Error('Aucune donnée à importer');

  if (mode === 'dpgf') {
    return importDPGF({ lotId, dataRows, mapping: normalizedMapping, importOperation: operation });
  }
  if (mode === 'offer') {
    if (!companyId && !companyName) throw new Error('Entreprise requise');
    if (!roundId) throw new Error('Round ID requis');
    return importOffer({ lotId, roundId, companyId, companyName, dataRows, mapping: normalizedMapping, importOperation: operation });
  }
  throw new Error(`Mode inconnu: ${mode}`);
}

/* =============== Import DPGF (crée items + MOE) =============== */
async function importDPGF({ lotId, dataRows, mapping, importOperation = 'replace' }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updateOnly = importOperation === 'update';

    const normalizeForMatch = (value) => normalizeArticleNum(value);

    // Vérifier si le lot a déjà des items
    const existingItems = await client.query('SELECT COUNT(*) FROM items WHERE lot_id = $1', [lotId]);
    const hasExisting = Number(existingItems.rows[0].count) > 0;

    let itemsImported = 0;
    let itemsUpdated = 0;
    let itemsSkipped = 0;
    const touchedItemIds = [];

    if (hasExisting) {
      // UPDATE mode : matcher par Num ou position
      const currentItems = await client.query(
        'SELECT id, num, designation, position FROM items WHERE lot_id = $1 ORDER BY position NULLS LAST, id',
        [lotId]
      );

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const num = buildNum(row, mapping.num);
        const designation = buildDesignation(row, mapping.designation);
        const unit = mapping.unit ? String(row[mapping.unit] ?? '').trim() : null;
        const qty = mapping.qty ? parseNumber(row[mapping.qty]) : null;
        const pu = mapping.unit_price ? parseNumber(row[mapping.unit_price]) : null;
        const mt = mapping.amount ? parseNumber(row[mapping.amount]) : (qty != null && pu != null ? qty * pu : null);
        
        // Capturer les commentaires pour MOE (texte saisi dans les cellules de quantité, PU ou montant)
        const moeComments = [];
        if (mapping.qty && extractComment(row[mapping.qty])) moeComments.push(extractComment(row[mapping.qty]));
        if (mapping.unit_price && extractComment(row[mapping.unit_price])) moeComments.push(extractComment(row[mapping.unit_price]));
        if (mapping.amount && extractComment(row[mapping.amount])) moeComments.push(extractComment(row[mapping.amount]));
        const moeComment = moeComments.length > 0 ? moeComments.join(' | ') : null;

        // Matcher par Num d'abord, puis designation. La position est seulement un
        // dernier recours pour eviter de masquer une insertion au milieu.
        let matchedItem = null;
        if (num) {
          const normalizedNum = normalizeForMatch(num);
          matchedItem = currentItems.rows.find((it) => {
            if (touchedItemIds.includes(Number(it.id))) return false;
            const candidate = normalizeForMatch(it.num);
            return normalizedNum && candidate && candidate === normalizedNum;
          });
        }
        if (!matchedItem && designation) {
          const normalizedDesignation = compactDesignationForMatch(designation);
          matchedItem = currentItems.rows.find((it) =>
            !touchedItemIds.includes(Number(it.id))
            && normalizedDesignation
            && compactDesignationForMatch(it.designation) === normalizedDesignation
          );
        }
        if (!matchedItem && !num && !designation && i < currentItems.rows.length) {
          matchedItem = currentItems.rows[i];
        }

        if (matchedItem) {
          touchedItemIds.push(Number(matchedItem.id));
          // Mettre à jour l'item existant
          await client.query(
            'UPDATE items SET num = COALESCE($2, num), designation = COALESCE(NULLIF($3, \'\'), designation), unit = COALESCE($4, unit) WHERE id = $1',
            [matchedItem.id, num, designation, unit]
          );
          // Upsert MOE
          await client.query(`
            INSERT INTO moe_items (item_id, qty, unit_price, amount, comment) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (item_id) DO UPDATE SET qty = EXCLUDED.qty, unit_price = EXCLUDED.unit_price, amount = EXCLUDED.amount, comment = EXCLUDED.comment
          `, [matchedItem.id, qty, pu, mt, moeComment]);
          itemsUpdated++;
        } else if (!updateOnly) {
          // Nouvel item
          const pos = i + 1;
          const insRes = await client.query(
            'INSERT INTO items (lot_id, num, designation, unit, position) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [lotId, num, designation || '(importé)', unit, pos]
          );
          touchedItemIds.push(Number(insRes.rows[0].id));
          await client.query(
            'INSERT INTO moe_items (item_id, qty, unit_price, amount, comment) VALUES ($1, $2, $3, $4, $5)',
            [insRes.rows[0].id, qty, pu, mt, moeComment]
          );
          itemsImported++;
        } else {
          itemsSkipped++;
        }
      }
      await reconcileAddedItemsWithDpgf(client, lotId, touchedItemIds);
      if (!updateOnly) {
        await client.query(
          `DELETE FROM items
           WHERE lot_id = $1
             AND source_company_id IS NOT NULL
             AND parent_item_id IS NOT NULL
             AND NOT (parent_item_id = ANY($2::bigint[]))`,
          [lotId, touchedItemIds]
        );
        await client.query(
          `DELETE FROM items
           WHERE lot_id = $1
             AND source_company_id IS NULL
             AND NOT (id = ANY($2::bigint[]))`,
          [lotId, touchedItemIds]
        );
      }
    } else if (!updateOnly) {
      // INSERT mode : créer tous les items
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const num = buildNum(row, mapping.num);
        const designation = buildDesignation(row, mapping.designation);
        const unit = mapping.unit ? String(row[mapping.unit] ?? '').trim() : null;
        const qty = mapping.qty ? parseNumber(row[mapping.qty]) : null;
        const pu = mapping.unit_price ? parseNumber(row[mapping.unit_price]) : null;
        const mt = mapping.amount ? parseNumber(row[mapping.amount]) : (qty != null && pu != null ? qty * pu : null);
        
        // Capturer les commentaires pour MOE (texte saisi dans les cellules de quantité, PU ou montant)
        const moeComments = [];
        if (mapping.qty && extractComment(row[mapping.qty])) moeComments.push(extractComment(row[mapping.qty]));
        if (mapping.unit_price && extractComment(row[mapping.unit_price])) moeComments.push(extractComment(row[mapping.unit_price]));
        if (mapping.amount && extractComment(row[mapping.amount])) moeComments.push(extractComment(row[mapping.amount]));
        const moeComment = moeComments.length > 0 ? moeComments.join(' | ') : null;

        if (!designation && !num) continue; // Skip lignes vides

        // Détecter les lignes de sous-total / titre de chapitre
        if (isSubtotalOrTitleRow(designation, num, qty != null, pu != null)) continue;

        const pos = i + 1;
        const insRes = await client.query(
          'INSERT INTO items (lot_id, num, designation, unit, position) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [lotId, num, designation || '', unit, pos]
        );
        touchedItemIds.push(Number(insRes.rows[0].id));
        await client.query(
          'INSERT INTO moe_items (item_id, qty, unit_price, amount, comment) VALUES ($1, $2, $3, $4, $5)',
          [insRes.rows[0].id, qty, pu, mt, moeComment]
        );
        itemsImported++;
      }
      await reconcileAddedItemsWithDpgf(client, lotId, touchedItemIds);
    } else {
      itemsSkipped = dataRows.length;
    }

    await client.query('COMMIT');
    return { ok: true, mode: 'dpgf', importOperation, itemsImported, itemsUpdated, itemsSkipped };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* =============== Import Offre Entreprise =============== */
/**
 * Algorithme de matching séquentiel :
 *  - On parcourt les lignes du fichier entreprise une par une.
 *  - Pour chaque ligne, on compare avec l'article DPGF courant (curseur DPGF).
 *  - Si la ligne est vide (pas de qty/pu/mt) → on la saute, on n'avance pas le curseur DPGF.
 *  - Si la ligne correspond à l'article DPGF courant (par Num ET/OU désignation) → on importe, on avance le curseur DPGF.
 *  - Si la ligne ne correspond PAS → c'est un "poste ajouté par l'entreprise".
 *    On ne l'importe pas dans la DPGF, on le met dans un tableau à part avec du contexte.
 *    Le curseur DPGF ne bouge PAS (l'entreprise a juste inséré une ligne en plus).
 */
async function importOffer({ lotId, roundId, companyId, companyName, dataRows, mapping, importOperation = 'replace' }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updateOnly = importOperation === 'update';

    if (!roundId) {
      console.warn('[AMOUNT-DIAG][import.offer] Exécution sans roundId', {
        lotId: Number(lotId),
        companyId: companyId ? Number(companyId) : null,
        companyName: companyName || null
      });
    }

    // Résoudre l'entreprise
    let resolvedCompanyId = companyId ? Number(companyId) : null;
    if (!resolvedCompanyId && companyName) {
      const existing = await client.query(
        'SELECT id FROM companies WHERE lower(name) = lower($1)',
        [companyName.trim()]
      );
      if (existing.rowCount > 0) {
        resolvedCompanyId = existing.rows[0].id;
      } else if (!updateOnly) {
        const inserted = await client.query(
          'INSERT INTO companies (name) VALUES ($1) RETURNING id',
          [companyName.trim()]
        );
        resolvedCompanyId = inserted.rows[0].id;
      }
    }
    if (!resolvedCompanyId) throw new Error('Impossible de résoudre l\'entreprise');

    // Associer l'entreprise au lot
    await client.query(
      'INSERT INTO lot_companies (lot_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [lotId, resolvedCompanyId]
    );

    // Charger les items DPGF existants du lot (ordonnés par position)
    const itemsRes = await client.query(
      'SELECT id, num, designation, unit, position FROM items WHERE lot_id = $1 AND source_company_id IS NULL ORDER BY position NULLS LAST, id',
      [lotId]
    );
    const dpgfItems = itemsRes.rows;
    const dpgfItemsByNum = new Map();
    dpgfItems.forEach((item, index) => {
      const norm = normalizeArticleNum(item.num);
      if (!norm) return;
      if (!dpgfItemsByNum.has(norm)) dpgfItemsByNum.set(norm, []);
      dpgfItemsByNum.get(norm).push({ item, index });
    });

    if (dpgfItems.length === 0) {
      throw new Error('Le lot ne contient aucun article. Importez d\'abord la DPGF.');
    }

    const projectConfigRes = await client.query(
      `SELECT pqc.offer_amount_mismatch_comment
       FROM lots l
       LEFT JOIN project_question_config pqc ON pqc.project_id = l.project_id
       WHERE l.id = $1`,
      [lotId]
    );
    const offerAmountMismatchTemplate = String(
      projectConfigRes.rows[0]?.offer_amount_mismatch_comment
      || 'Montant total incohérent dans la DPGF : le montant importé est conservé.'
    ).trim();

    let clearedExistingOffers = 0;
    let clearedAddedItems = 0;
    if (!updateOnly) {
      // Nettoyage prealable: on remplace integralement les donnees de cette entreprise
      // pour ce lot + tour, y compris celles non presentes dans le nouvel import.
      const clearExistingRes = await client.query(
        `DELETE FROM offers o
         USING items i
         WHERE o.item_id = i.id
           AND i.lot_id = $1
           AND o.company_id = $2
           AND o.round_id = $3`,
        [lotId, resolvedCompanyId, roundId]
      );
      clearedExistingOffers = Number(clearExistingRes.rowCount || 0);
      const clearedAddedItemsRes = await client.query(
        `DELETE FROM items i
         WHERE i.lot_id = $1
           AND i.source_company_id = $2
           AND NOT EXISTS (
             SELECT 1 FROM offers o
             WHERE o.item_id = i.id
           )`,
        [lotId, resolvedCompanyId]
      );
      clearedAddedItems = Number(clearedAddedItemsRes.rowCount || 0);
    }

    // --- Helpers de normalisation pour le matching ---
    function normalizeNum(n) {
      return normalizeArticleNum(n);
    }

    function normalizeDesig(d) {
      if (!d) return '';
      return String(d).trim().toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u00A0\u2007\u200B\u202F\u2009]/g, ' ')  // espaces spéciaux → espace normal
        .replace(/\s+/g, ' ')            // compresser espaces multiples
        .replace(/[''`]/g, "'")           // normaliser apostrophes
        .replace(/[-–—]/g, '-')           // normaliser tirets
        .trim();
    }

      function compactDesigForTolerance(d) {
        return normalizeDesig(d)
          .replace(/[^a-z0-9]/g, '');
      }

      function levenshteinDistance(a, b, maxDistance = Infinity) {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;
        if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

        let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
        for (let i = 1; i <= a.length; i++) {
          const current = [i];
          let minInRow = current[0];
          for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            const value = Math.min(
              previous[j] + 1,
              current[j - 1] + 1,
              previous[j - 1] + cost
            );
            current[j] = value;
            if (value < minInRow) minInRow = value;
          }
          if (minInRow > maxDistance) return maxDistance + 1;
          previous = current;
        }
        return previous[b.length];
      }

      function isSameDesignationWithinTolerance(dpgfDesig, importDesig) {
        const normalizedA = normalizeDesig(dpgfDesig);
        const normalizedB = normalizeDesig(importDesig);
        if (!normalizedA || !normalizedB) return normalizedA === normalizedB;
        if (normalizedA === normalizedB) return true;

        const compactA = compactDesigForTolerance(dpgfDesig);
        const compactB = compactDesigForTolerance(importDesig);
        if (!compactA || !compactB) return compactA === compactB;
        if (compactA === compactB) return true;

        const maxDistance = compactA.length <= 12 && compactB.length <= 12 ? 1 : 2;
        const distance = levenshteinDistance(compactA, compactB, maxDistance);
        const longestLength = Math.max(compactA.length, compactB.length);
        return distance <= maxDistance && distance / longestLength <= 0.12;
      }

      function extractDesignationSeriesMarker(designation) {
        const normalized = normalizeDesig(designation);
        if (!normalized) return null;
        const match = normalized.match(/^(.*?)(?:[\s\-_/().]+)(\d+|[a-z])$/i);
        if (!match) return null;
        const stem = match[1].trim();
        const token = match[2].trim().toLowerCase();
        if (!stem || !token) return null;
        return {
          stem,
          token,
          compactStem: stem.replace(/[^a-z0-9]/g, ''),
          tokenType: /^\d+$/.test(token) ? 'number' : 'letter',
        };
      }

      function hasConflictingSeriesMarker(dpgfDesig, importDesig) {
        const markerA = extractDesignationSeriesMarker(dpgfDesig);
        const markerB = extractDesignationSeriesMarker(importDesig);
        if (!markerA || !markerB) return false;
        if (markerA.tokenType !== markerB.tokenType) return false;
        if (markerA.token === markerB.token) return false;
        if (!markerA.compactStem || !markerB.compactStem) return false;

        if (markerA.compactStem === markerB.compactStem) return true;

        const longestStem = Math.max(markerA.compactStem.length, markerB.compactStem.length);
        const stemMaxDistance = longestStem <= 12 ? 1 : 2;
        const stemDistance = levenshteinDistance(markerA.compactStem, markerB.compactStem, stemMaxDistance);
        return stemDistance <= stemMaxDistance && stemDistance / longestStem <= 0.12;
      }

    /** Compare deux désignations. Retourne un score de 0 (aucun match) à 100 (identique) */
    function designationMatch(dpgfDesig, importDesig) {
      const a = normalizeDesig(dpgfDesig);
      const b = normalizeDesig(importDesig);
      if (!a || !b) return 0;
      // Si deux lignes ont la même base mais finissent par des marqueurs de série différents
      // (1/2/3 ou A/B/C), on interdit le match pour éviter les permutations.
      if (hasConflictingSeriesMarker(dpgfDesig, importDesig)) return 0;
      // Match exact
      if (a === b) return 100;
      // L'import commence par la DPGF (l'entreprise a ajouté du texte après)
      if (b.startsWith(a)) return 90;
      // La DPGF commence par l'import (l'entreprise a tronqué)
      if (a.startsWith(b) && b.length > a.length * 0.6) return 85;
      // Calcul de similarité par mots communs
      const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 2));
      const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 2));
      if (wordsA.size === 0 || wordsB.size === 0) return 0;
      let common = 0;
      for (const w of wordsA) { if (wordsB.has(w)) common++; }
      const ratio = common / Math.max(wordsA.size, wordsB.size);
      return Math.round(ratio * 80); // max 80 pour un match par mots
    }

    // Seuil minimum de similarité pour considérer que ça matche
    const MATCH_THRESHOLD = 50;

    let dpgfCursor = 0;             // Position dans les items DPGF
    let matched = 0;
    let skipped = 0;
    let amountMismatchCount = 0;
    const addedPosts = [];          // Postes ajoutés par l'entreprise (pas dans la DPGF)
    const matchDetails = [];
    let currentParentDpgfItem = null;

    function formatAmountForComment(value) {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return '';
      return numericValue.toFixed(2);
    }

    function buildAmountMismatchComment({ importedAmount, calculatedAmount, template }) {
      if (!template) return null;
      const deltaAmount = Number(importedAmount) - Number(calculatedAmount);
      return String(template)
        .replace(/\{\{\s*montant_total\s*\}\}/gi, formatAmountForComment(importedAmount))
        .replace(/\{\{\s*montant_calcule\s*\}\}/gi, formatAmountForComment(calculatedAmount))
        .replace(/\{\{\s*ecart\s*\}\}/gi, formatAmountForComment(deltaAmount));
    }

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      let num = buildNum(row, mapping.num);
      const unit = mapping.unit ? String(row[mapping.unit] ?? '').trim() : null;
      let importedDesignation = mapping.designation ? buildDesignation(row, mapping.designation) : '';
      const designationNum = splitArticleNumAndDesignation(importedDesignation);
      if (!num && designationNum?.num) {
        num = designationNum.num;
        importedDesignation = designationNum.designation;
      } else if (num && !looksLikeArticleNum(num)) {
        if (!importedDesignation) importedDesignation = String(num).trim();
        num = null;
      } else if (num && designationNum?.num && normalizeNum(num) === normalizeNum(designationNum.num)) {
        importedDesignation = designationNum.designation;
      }
      const qty = mapping.qty ? parseNumber(row[mapping.qty]) : null;
      const pu = mapping.unit_price ? parseNumber(row[mapping.unit_price]) : null;
      const mt = mapping.amount ? parseNumber(row[mapping.amount]) : (qty != null && pu != null ? qty * pu : null);
      const calculatedAmount = (qty != null && pu != null) ? qty * pu : null;
      const hasAmountMismatch = mt != null
        && calculatedAmount != null
        && Math.abs(Number(mt) - Number(calculatedAmount)) > 0.01;
      const amountMismatchComment = hasAmountMismatch
        ? buildAmountMismatchComment({
            importedAmount: mt,
            calculatedAmount,
            template: offerAmountMismatchTemplate,
          })
        : null;

      // Capturer les commentaires pour l'offre (texte saisi dans les cellules de quantité, PU ou montant)
      const offerValueComments = [];
      if (mapping.qty && extractComment(row[mapping.qty])) offerValueComments.push(extractComment(row[mapping.qty]));
      if (mapping.unit_price && extractComment(row[mapping.unit_price])) offerValueComments.push(extractComment(row[mapping.unit_price]));
      if (mapping.amount && extractComment(row[mapping.amount])) offerValueComments.push(extractComment(row[mapping.amount]));
      const valueComment = offerValueComments.join(' | ') || null;

      // Ligne vide (pas de qty/pu/mt) → skip
      // MAIS : si la désignation ou le N° de cette ligne vide correspond à l'article DPGF courant,
      // on avance le curseur DPGF (c'est un titre/sous-total qui existe aussi dans la DPGF)
      const hasData = (qty != null && qty !== 0) || (pu != null && pu !== 0) || (mt != null && mt !== 0);
      if (!hasData) {
        skipped++;
        if (num) {
          const normImport = normalizeNum(num);
          const numMatches = normImport ? (dpgfItemsByNum.get(normImport) || []) : [];
          const preferred = numMatches.find(({ index }) => index >= dpgfCursor) || numMatches[0];
          if (preferred) {
            currentParentDpgfItem = preferred.item;
            dpgfCursor = Math.max(dpgfCursor, preferred.index + 1);
            continue;
          }
        }
        // Vérifier si cette ligne vide correspond à l'item DPGF courant → avancer le curseur
        if (dpgfCursor < dpgfItems.length) {
          const dpgfItem = dpgfItems[dpgfCursor];
          let emptyLineMatchesDpgf = false;
          // Match par Num
          if (num && dpgfItem.num) {
            const normImport = normalizeNum(num);
            const normDpgf = normalizeNum(dpgfItem.num);
            if (normImport && normDpgf && normImport === normDpgf) emptyLineMatchesDpgf = true;
          }
          // Match par désignation
          if (!emptyLineMatchesDpgf && importedDesignation) {
            const score = designationMatch(dpgfItem.designation, importedDesignation);
            if (score >= MATCH_THRESHOLD) emptyLineMatchesDpgf = true;
          }
          if (emptyLineMatchesDpgf) {
            if (num && dpgfItem.num) currentParentDpgfItem = dpgfItem;
            dpgfCursor++; // Cet item DPGF est un titre/en-tête, on le consomme
          }
        }
        continue;
      }

      // --- Tentative de match avec l'article DPGF courant (+ lookahead) ---
      // Si l'item DPGF au curseur courant ne matche pas, on cherche dans les N suivants.
      // Cela permet de passer par-dessus des titres/en-têtes DPGF que l'entreprise n'a pas
      // inclus dans son fichier (lignes sans valeurs chiffrées).
      let isMatch = false;
      let matchScore = 0;
      let matchMethod = '';
      let matchLookaheadOffset = 0;
      let matchDpgfIndex = -1;

      // Fenêtre de lookahead (par numéro uniquement pour limiter les faux positifs)
      const LOOKAHEAD_LIMIT = 15;

      if (num) {
        const normImport = normalizeNum(num);
        const numMatches = normImport ? (dpgfItemsByNum.get(normImport) || []) : [];
        const preferred = numMatches.find(({ index }) => index >= dpgfCursor) || numMatches[0];
        if (preferred) {
          isMatch = true;
          matchScore = 100;
          matchMethod = preferred.index >= dpgfCursor ? 'num-global' : 'num-global-backtrack';
          matchDpgfIndex = preferred.index;
        }
      }

      for (let look = 0; !isMatch && look < LOOKAHEAD_LIMIT && dpgfCursor + look < dpgfItems.length; look++) {
        const dpgfItem = dpgfItems[dpgfCursor + look];

        let candidateMatch = false;
        let candidateScore = 0;
        let candidateMethod = '';

        // 1. Match par Num (si les deux ont un Num et qu'ils sont identiques)
        if (num && dpgfItem.num) {
          const normImport = normalizeNum(num);
          const normDpgf = normalizeNum(dpgfItem.num);
          if (normImport && normDpgf && normImport === normDpgf) {
            candidateMatch = true;
            candidateScore = 100;
            candidateMethod = 'num';
          }
        }

        // 2. Match par désignation (si pas encore matché par Num)
        //    Pour le lookahead (look > 0), seuil relevé à 80 pour éviter les faux positifs
        if (!candidateMatch && importedDesignation) {
          const score = designationMatch(dpgfItem.designation, importedDesignation);
          const threshold = look === 0 ? MATCH_THRESHOLD : (!num ? 90 : 80);
          const canDesignationLookahead = look === 0 || num || !dpgfItem.num;
          if (score >= threshold) {
            if (canDesignationLookahead) {
              candidateMatch = true;
              candidateScore = score;
              candidateMethod = !num && look > 0 ? 'designation-subline' : 'designation';
            }
          }
        }

        // 3. Si pas de Num dans l'import ni dans la DPGF, et pas de désignation →
        //    match par position si le Num du DPGF est aussi vide (uniquement au curseur courant)
        if (!candidateMatch && look === 0 && !num && !dpgfItem.num && !importedDesignation) {
          candidateMatch = true;
          candidateScore = 30;
          candidateMethod = 'position';
        }

        if (candidateMatch) {
          isMatch = true;
          matchScore = candidateScore;
          matchMethod = candidateMethod;
          matchLookaheadOffset = look;
          matchDpgfIndex = dpgfCursor + look;
          break;
        }

        // Sans Num dans l'import, ne pas faire de lookahead au-delà du curseur courant :
        // le risque de faux positif sur la désignation seule est trop élevé.
        if (!num && look > 0 && dpgfItem.num) break;
      }

      if (isMatch) {
        // Si le match a été trouvé par lookahead, avancer le curseur jusqu'à l'article matché
        // (les items DPGF intermédiaires n'ont pas été couverts par cette ligne entreprise)
        if (matchDpgfIndex >= 0 && matchDpgfIndex > dpgfCursor) {
          dpgfCursor = matchDpgfIndex;
        } else if (matchLookaheadOffset > 0) {
          dpgfCursor += matchLookaheadOffset;
        }
        const dpgfItem = dpgfItems[matchDpgfIndex >= 0 ? matchDpgfIndex : dpgfCursor];
        if (num && dpgfItem.num) currentParentDpgfItem = dpgfItem;
        // Extraire un commentaire si l'entreprise a ajouté du texte à la désignation
        let desigComment = null;
        const baseDesig = String(dpgfItem.designation ?? '').trim();
        const offerDesig = String(importedDesignation ?? '').trim();
        if (baseDesig && offerDesig) {
          const baseLower = baseDesig.toLowerCase();
          const offerLower = offerDesig.toLowerCase();
          if (offerLower.startsWith(baseLower)) {
            const extra = offerDesig.slice(baseDesig.length).trim();
            if (extra) {
              desigComment = extra.replace(/^[-–—:]+/, '').trim();
            }
          }
        }
        
        // Fusionner les commentaires de désignation et des cellules de valeurs
        const allComments = [];
        if (desigComment) allComments.push(desigComment);
        if (valueComment) allComments.push(valueComment);
        if (amountMismatchComment && !allComments.includes(amountMismatchComment)) {
          allComments.push(amountMismatchComment);
          amountMismatchCount++;
        }
        const offerComment = allComments.length > 0 ? allComments.join(' | ') : null;

        // Sauvegarder la désignation entreprise si elle diffère de la désignation DPGF
        const normDpgfDesig = normalizeDesig(dpgfItem.designation);
        const normImportDesig = normalizeDesig(importedDesignation);
        const offerDesignation = (normImportDesig && normDpgfDesig && !isSameDesignationWithinTolerance(dpgfItem.designation, importedDesignation))
          ? String(importedDesignation).trim()
          : null;

        await client.query(`
          INSERT INTO offers (item_id, company_id, round_id, unit, qty, unit_price, amount, comment, offer_designation)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (item_id, company_id, round_id) DO UPDATE
          SET unit = EXCLUDED.unit, qty = EXCLUDED.qty, unit_price = EXCLUDED.unit_price, amount = EXCLUDED.amount,
              comment = COALESCE(EXCLUDED.comment, offers.comment),
              offer_designation = EXCLUDED.offer_designation
        `, [dpgfItem.id, resolvedCompanyId, roundId, unit, qty, pu, mt, offerComment, offerDesignation]);

        matched++;
        matchDetails.push({
          row: i + 1,
          num,
          importDesignation: offerDesig || '(vide)',
          dpgfDesignation: dpgfItem.designation || '(vide)',
          dpgfNum: dpgfItem.num || null,
          matchMethod,
          matchScore,
        });

        // Avancer le curseur DPGF
        dpgfCursor++;
      } else if (!updateOnly) {
        // --- Poste ajouté par l'entreprise (pas dans la DPGF) ---

        // Contexte : quel article DPGF était attendu à cette position
        const expectedDpgf = dpgfCursor < dpgfItems.length ? dpgfItems[dpgfCursor] : null;
        const prevDpgf = dpgfCursor > 0 ? dpgfItems[dpgfCursor - 1] : null;

        addedPosts.push({
          row: i + 1,
          num: num || null,
          designation: String(importedDesignation || '').trim() || '(vide)',
          unit: unit || null,
          parentItemId: currentParentDpgfItem?.id || prevDpgf?.id || null,
          parentNum: currentParentDpgfItem?.num || prevDpgf?.num || null,
          parentDesignation: currentParentDpgfItem?.designation || prevDpgf?.designation || null,
          qty,
          unit_price: pu,
          amount: mt,
          comment: valueComment,
          context: {
            afterDpgfNum: prevDpgf?.num || null,
            afterDpgfDesignation: prevDpgf?.designation || null,
            expectedDpgfNum: expectedDpgf?.num || null,
            expectedDpgfDesignation: expectedDpgf?.designation || null,
          }
        });
        // Ne PAS avancer le curseur DPGF
      } else {
        skipped++;
      }
    }

    // --- Sauvegarder les postes ajoutés par l'entreprise en fin de lot ---
    // Ces items sont ajoutés après le dernier item existant, avec source_company_id pour les identifier
    if (addedPosts.length > 0) {
      // Trouver la position max actuelle dans le lot
      const maxPosRes = await client.query(
        'SELECT COALESCE(MAX(position), 0) AS max_pos FROM items WHERE lot_id = $1',
        [lotId]
      );
      let nextPos = Number(maxPosRes.rows[0].max_pos) + 1;

      for (const post of addedPosts) {
        const designation = post.designation || '(poste ajouté)';
        const insRes = await client.query(
          'INSERT INTO items (lot_id, num, designation, unit, position, source_company_id, parent_item_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [lotId, post.num, designation, post.unit, nextPos, resolvedCompanyId, post.parentItemId || null]
        );
        const newItemId = insRes.rows[0].id;
        post.savedItemId = newItemId;

        // Créer l'offre associée pour cette entreprise
        await client.query(`
          INSERT INTO offers (item_id, company_id, round_id, unit, qty, unit_price, amount, comment)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (item_id, company_id, round_id) DO UPDATE
          SET unit = EXCLUDED.unit, qty = EXCLUDED.qty, unit_price = EXCLUDED.unit_price, amount = EXCLUDED.amount, comment = EXCLUDED.comment
        `, [newItemId, resolvedCompanyId, roundId, post.unit, post.qty, post.unit_price, post.amount, post.comment]);

        nextPos++;
      }
    }

    // Items DPGF non couverts (restants après le dernier match)
    const unmatchedDpgf = dpgfItems.slice(dpgfCursor).map(it => ({
      num: it.num,
      designation: it.designation,
      position: it.position,
    }));

    await client.query('COMMIT');
    const warnings = [];
    if (unmatchedDpgf.length > 0) {
      warnings.push(`${unmatchedDpgf.length} article(s) DPGF n'ont pas été couverts par l'offre entreprise.`);
    }
    if (amountMismatchCount > 0) {
      warnings.push(`${amountMismatchCount} ligne(s) avec incohérence montant total / montant calculé : commentaire automatique ajouté.`);
      console.warn('[AMOUNT-DIAG][import.offer] Incohérences montant importé vs calculé', {
        lotId: Number(lotId),
        roundId: roundId ? Number(roundId) : null,
        companyId: Number(resolvedCompanyId),
        amountMismatchCount,
        matched,
        skipped
      });
    }

    return {
      ok: true,
      mode: 'offer',
      importOperation,
      companyId: resolvedCompanyId,
      clearedExistingOffers,
      clearedAddedItems,
      matched,
      skipped,
      amountMismatchCount,
      totalItems: dpgfItems.length,
      addedPosts,
      addedPostsCount: addedPosts.length,
      unmatchedDpgf,
      unmatchedDpgfCount: unmatchedDpgf.length,
      matchDetails: matchDetails.slice(0, 30),
      warnings,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* =============== Fusion désignation multi-colonnes =============== */
/**
 * Fusionne plusieurs colonnes de désignation avec indentation hiérarchique.
 * Chaque colonne supplémentaire ajoute 1 espace (non-sécable) d'indentation.
 * @param {Object} row - La ligne de données
 * @param {number|number[]} designationCols - Index de colonne(s)
 * @returns {string} Désignation fusionnée avec indentation
 */
function buildDesignation(row, designationCols) {
  if (!designationCols) return '';
  if (!Array.isArray(designationCols)) designationCols = [designationCols];
  if (designationCols.length === 0) return '';
  const sorted = [...designationCols].sort((a, b) => a - b);
  // Chercher la dernière colonne non vide (niveau le plus profond)
  for (let i = sorted.length - 1; i >= 0; i--) {
    const val = String(row[sorted[i]] ?? '').trim();
    if (val) {
      return '\u00A0'.repeat(i) + val;
    }
  }
  return '';
}

function buildNum(row, numCols) {
  if (!numCols) return null;
  const cols = Array.isArray(numCols) ? numCols : [numCols];
  if (cols.length === 0) return null;

  const sorted = [...cols].sort((a, b) => a - b);
  const parts = [];
  for (const c of sorted) {
    const v = String(row[c] ?? '').trim();
    if (v) parts.push(v);
  }
  if (parts.length === 0) return null;
  // Fusion stricte des colonnes N° article pour reconstruire une reference unique.
  return parts.join('');
}

function splitArticleNumAndDesignation(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalizedSpaces = raw.replace(/[\u00A0\u202F\u2009]+/g, ' ');
  const match = normalizedSpaces.match(/^(\d+(?:[._\-\/]\d+)*(?:[._\-\/]?[a-z])?)(?:\s+(.+))?$/i);
  if (!match) return null;
  return {
    num: match[1],
    designation: (match[2] || '').trim(),
  };
}

function looksLikeArticleNum(value) {
  return !!splitArticleNumAndDesignation(value)?.num;
}

function normalizeArticleNum(value) {
  if (!value) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s\u00A0\u202F]/g, '')
    .replace(/[._\-/]+/g, '')
    .replace(/^0+(?=\d)/, '')
    .replace(/\.0+$/, '');
}

function normalizeDesignationForMatch(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00A0\u2007\u200B\u202F\u2009]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[''`]/g, "'")
    .replace(/[-–—]/g, '-')
    .trim();
}

function compactDesignationForMatch(value) {
  return normalizeDesignationForMatch(value).replace(/[^a-z0-9]/g, '');
}

function addedItemMatchesDpgf(added, dpgf) {
  const addedNum = normalizeArticleNum(added.num);
  const dpgfNum = normalizeArticleNum(dpgf.num);
  if (addedNum && dpgfNum) return addedNum === dpgfNum;

  const addedDesignation = compactDesignationForMatch(added.designation);
  const dpgfDesignation = compactDesignationForMatch(dpgf.designation);
  return !!addedDesignation && !!dpgfDesignation && addedDesignation === dpgfDesignation;
}

async function moveAddedItemOffersToDpgf(client, { addedItemId, dpgfItemId }) {
  await client.query(
    `UPDATE offers target
     SET unit = COALESCE(target.unit, source.unit),
         qty = COALESCE(target.qty, source.qty),
         unit_price = COALESCE(target.unit_price, source.unit_price),
         amount = COALESCE(target.amount, source.amount),
         comment = COALESCE(target.comment, source.comment),
         offer_designation = COALESCE(target.offer_designation, source.offer_designation)
     FROM offers source
     WHERE source.item_id = $1
       AND target.item_id = $2
       AND target.company_id = source.company_id
       AND target.round_id IS NOT DISTINCT FROM source.round_id`,
    [addedItemId, dpgfItemId]
  );

  await client.query(
    `DELETE FROM offers source
     USING offers target
     WHERE source.item_id = $1
       AND target.item_id = $2
       AND target.company_id = source.company_id
       AND target.round_id IS NOT DISTINCT FROM source.round_id`,
    [addedItemId, dpgfItemId]
  );

  await client.query('UPDATE offers SET item_id = $2 WHERE item_id = $1', [addedItemId, dpgfItemId]);
}

async function reconcileAddedItemsWithDpgf(client, lotId, dpgfItemIds) {
  const ids = [...new Set((dpgfItemIds || []).map(Number).filter(Number.isFinite))];
  if (ids.length === 0) return 0;

  const dpgfRes = await client.query(
    'SELECT id, num, designation FROM items WHERE lot_id = $1 AND source_company_id IS NULL AND id = ANY($2::bigint[])',
    [lotId, ids]
  );
  const addedRes = await client.query(
    'SELECT id, num, designation FROM items WHERE lot_id = $1 AND source_company_id IS NOT NULL',
    [lotId]
  );

  let reconciled = 0;
  const usedAddedIds = new Set();
  for (const dpgf of dpgfRes.rows) {
    const added = addedRes.rows.find((candidate) =>
      !usedAddedIds.has(Number(candidate.id)) && addedItemMatchesDpgf(candidate, dpgf)
    );
    if (!added) continue;

    await moveAddedItemOffersToDpgf(client, { addedItemId: added.id, dpgfItemId: dpgf.id });
    await client.query('DELETE FROM items WHERE id = $1', [added.id]);
    usedAddedIds.add(Number(added.id));
    reconciled++;
  }
  return reconciled;
}

function normalizeImportMapping(mapping) {
  const m = { ...(mapping || {}) };
  if (m.designation != null && !Array.isArray(m.designation)) {
    m.designation = [m.designation];
  }
  if (m.num != null && !Array.isArray(m.num)) {
    m.num = [m.num];
  }
  return m;
}

/* =============== Helpers =============== */
function cellToString(cell) {
  const v = cell?.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    return (v.text ?? v.result ?? v.richText?.map(t => t.text).join('') ?? v.hyperlink ?? '').toString().trim();
  }
  return String(v).trim();
}

function cellToValue(cell) {
  const v = cell?.value;
  if (v == null) return null;
  if (typeof v === 'object') {
    const text = v.text ?? v.result ?? v.richText?.map(t => t.text).join('') ?? v.hyperlink ?? null;
    return text != null ? text : null;
  }
  return v;
}

function parseNumber(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number') return isFinite(val) ? val : null;
  // Gestion des formats français : "1 234,56" → 1234.56
  let s = String(val).trim();
  if (s === '') return null;
  // Style (123) => -123
  if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
  // Supprimer symboles courants et espaces (séparateur milliers)
  s = s.replace(/[€$£¥₹%]/g, '');
  s = s.replace(/[\u00A0\u202F\u2009\s]/g, '');
  // Retirer tout ce qui n'est pas chiffre, séparateur décimal ou signe
  s = s.replace(/[^0-9,\.\-]/g, '');
  // Si après nettoyage il ne reste rien (ou juste un signe), pas de nombre
  if (s === '' || s === '-' || s === '.' || s === ',') return null;
  // Garder un seul signe moins en tête
  if (s.indexOf('-') > 0) s = s.replace(/(?!^)-/g, '');
  // Si virgule et pas de point → format français
  if (s.includes(',') && !s.includes('.')) {
    s = s.replace(',', '.');
  }
  // Si point et virgule → format "1.234,56"
  else if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  let n = Number(s);
  if (isFinite(n)) return n;

  // Fallback: extraire le premier nombre lisible (ex: "61.1.0" -> 61.1)
  const m = s.match(/-?\d+(?:[\.,]\d+)?/);
  if (!m) return null;
  const token = m[0].replace(',', '.');
  n = Number(token);
  return isFinite(n) ? n : null;
}

/** Extrait le commentaire d'une valeur (texte qui n'est pas un nombre) */
function extractComment(val) {
  if (val == null || val === '') return null;
  const str = String(val).trim();
  if (str === '') return null;
  // Si c'est un nombre valide, pas de commentaire
  const n = parseNumber(val);
  if (n !== null) return null;
  // Sinon, retourner le texte comme commentaire
  return str;
}

function autoDetectMapping(headers) {
  const mapping = {};
  const usedIndexes = new Set();

  // Tenter de matcher chaque type de colonne
  for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
    let bestMatch = null;
    let bestScore = 0;

    for (const h of headers) {
      if (usedIndexes.has(h.index)) continue;
      const nh = normalize(h.name);
      
      for (const pattern of patterns) {
        let score = 0;
        const needWordBoundary = WORD_BOUNDARY_PATTERNS.has(pattern);

        if (nh === pattern) {
          score = 100; // Match exact
        } else if (needWordBoundary) {
          // Pour les patterns courts (pu, mt, q...), exiger un match en mot entier
          const re = new RegExp(`(^|\\s)${pattern.replace(/\./g, '\\.')}($|\\s)`);
          if (re.test(nh)) score = 90;
          // Sinon on ne matche PAS (évite "cumul" → "u", "recapu" → "pu", etc.)
        } else if (nh.startsWith(pattern + ' ') || nh.endsWith(' ' + pattern)) {
          score = 80;
        } else if (nh.includes(pattern)) {
          score = 60;
        }
        
        // Bonus pour les premiers mots (plus susceptibles d'être le bon)
        if (score > 0 && nh.indexOf(pattern) === 0) score += 10;
        
        if (score > bestScore) {
          bestScore = score;
          bestMatch = h;
        }
      }
    }

    if (bestMatch && bestScore >= 60) {
      mapping[field] = bestMatch.index;
      usedIndexes.add(bestMatch.index);
    }
  }

  // Convertir designation en tableau pour le support multi-colonnes
  if (mapping.designation != null) {
    mapping.designation = [mapping.designation];
  }

  return mapping;
}

/* =============== PDF parsing =============== */
async function parsePdfTable({ buffer, headerRow }) {
  const { text } = await pdfParse(buffer);
  const lines = (text || '')
    .split(/\r?\n/)
    .map(line => line.replace(/\u00A0/g, ' ').trimEnd())
    .filter(line => line.trim() !== '');

  if (lines.length === 0) throw new Error('PDF vide ou illisible');

  const headerRowIdx = Number(headerRow) || 0;
  const useHeuristic = shouldUsePdfHeuristic(lines);

  if (useHeuristic) {
    const rows = [];
    const startIndex = headerRowIdx > 0 ? headerRowIdx : 0;
    for (let i = startIndex; i < lines.length; i++) {
      const cols = parsePdfLineHeuristic(lines[i]);
      if (cols.length === 0) continue;
      rows.push({ rowNum: i + 1, cols });
    }

    const headers = PDF_FALLBACK_HEADERS.map((name, idx) => ({ index: idx + 1, name }));
    return { headers, rows, headerRow: headerRowIdx || 1 };
  }

  let detectedHeaderRowIdx = headerRowIdx;
  let headerCols = null;

  if (detectedHeaderRowIdx > 0) {
    if (detectedHeaderRowIdx > lines.length) throw new Error('Ligne d\'en-tete invalide');
    headerCols = splitPdfColumns(lines[detectedHeaderRowIdx - 1]);
  } else {
    const detected = detectPdfHeader(lines);
    detectedHeaderRowIdx = detected.headerRowIdx;
    headerCols = detected.headerCols;
  }

  if (!headerCols || headerCols.length === 0) throw new Error('Aucun en-tete detecte');

  let maxCol = headerCols.length;
  const rows = [];
  for (let i = detectedHeaderRowIdx; i < lines.length; i++) {
    const cols = splitPdfColumns(lines[i]);
    if (cols.length === 0) continue;
    maxCol = Math.max(maxCol, cols.length);
    rows.push({ rowNum: i + 1, cols });
  }

  const headers = [];
  for (let c = 1; c <= maxCol; c++) {
    const name = headerCols[c - 1] ?? `Col ${c} (vide)`;
    headers.push({ index: c, name });
  }

  return { headers, rows, headerRow: detectedHeaderRowIdx };
}

function splitPdfColumns(line) {
  const trimmed = (line || '').trim();
  if (!trimmed) return [];
  let parts = trimmed.split(/\s{2,}|\t+/).map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1 && trimmed.includes('|')) {
    parts = trimmed.split('|').map(p => p.trim()).filter(Boolean);
  }
  return parts;
}

function detectPdfHeader(lines) {
  const maxScan = Math.min(40, lines.length);
  let best = { headerRowIdx: 1, headerCols: splitPdfColumns(lines[0] || ''), score: 0 };

  for (let i = 0; i < maxScan; i++) {
    const cols = splitPdfColumns(lines[i]);
    if (cols.length < 2) continue;
    const headers = cols.map((name, idx) => ({ index: idx + 1, name }));
    const mapping = autoDetectMapping(headers);
    const score = Object.keys(mapping).length;
    if (score > best.score) {
      best = { headerRowIdx: i + 1, headerCols: cols, score };
    }
  }

  if (best.score >= 2) return best;

  for (let i = 0; i < maxScan; i++) {
    const cols = splitPdfColumns(lines[i]);
    if (cols.length >= 3) {
      return { headerRowIdx: i + 1, headerCols: cols, score: 1 };
    }
  }

  return best;
}

const execFileAsync = promisify(execFile);

async function tryConvertPdfWithTabula(buffer) {
  const jarPath = resolveTabulaJarPath();
  if (!jarPath) {
    throw new Error('Tabula introuvable. Placez tabula.jar dans server/tools/tabula/ ou definissez TABULA_JAR_PATH.');
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aolink-tabula-'));
  const pdfPath = path.join(tempDir, `${crypto.randomUUID()}.pdf`);
  const csvPath = path.join(tempDir, `${crypto.randomUUID()}.csv`);

  try {
    await fs.writeFile(pdfPath, buffer);
    await execFileAsync('java', [
      '-jar',
      jarPath,
      '--pages', 'all',
      '--format', 'CSV',
      '--outfile', csvPath,
      '--guess',
      pdfPath,
    ], { windowsHide: true, maxBuffer: 20 * 1024 * 1024 });

    const csvContent = await fs.readFile(csvPath, 'utf8');
    const wb = new ExcelJS.Workbook();
    await wb.csv.read(Readable.from([csvContent]), { worksheetName: 'PDF' });
    return wb.xlsx.writeBuffer();
  } finally {
    await safeUnlink(pdfPath);
    await safeUnlink(csvPath);
    await safeRmdir(tempDir);
  }
}

function resolveTabulaJarPath() {
  const envPath = process.env.TABULA_JAR_PATH;
  if (envPath && fsSync.existsSync(envPath)) return envPath;
  const defaultPath = path.resolve(process.cwd(), 'tools', 'tabula', 'tabula.jar');
  if (fsSync.existsSync(defaultPath)) return defaultPath;
  return null;
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  try { await fs.unlink(filePath); } catch (e) { /* ignore */ }
}

async function safeRmdir(dirPath) {
  if (!dirPath) return;
  try { await fs.rmdir(dirPath); } catch (e) { /* ignore */ }
}

const PDF_FALLBACK_HEADERS = [
  'Designation',
  'Unite',
  'Quantite',
  'Prix unitaire',
  'Montant',
];

const PDF_UNITS = new Set([
  'u', 'un', 'unite', 'unites', 'm', 'm2', 'm3', 'ml', 'kg', 't', 'h', 'j', 'pc', 'ens', 'lot', 'forfait',
]);

function shouldUsePdfHeuristic(lines) {
  const maxScan = Math.min(30, lines.length);
  if (maxScan === 0) return true;
  let withColumns = 0;
  for (let i = 0; i < maxScan; i++) {
    const cols = splitPdfColumns(lines[i]);
    if (cols.length >= 3) withColumns++;
  }
  return withColumns / maxScan < 0.3;
}

function parsePdfLineHeuristic(line) {
  const trimmed = (line || '').replace(/\u00A0/g, ' ').trim();
  if (!trimmed) return [];

  const tokens = trimmed.split(/\s+/);
  let unitIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].toLowerCase();
    if (PDF_UNITS.has(t)) unitIdx = i;
  }

  if (unitIdx === -1) {
    return [trimmed, '', '', '', ''];
  }

  const designation = tokens.slice(0, unitIdx).join(' ').trim();
  const unit = tokens[unitIdx];
  const tail = tokens.slice(unitIdx + 1).join(' ');
  const numbers = extractPdfNumbers(tail);

  let qty = '';
  let unitPrice = '';
  let amount = '';

  if (numbers.length >= 3) {
    const last = numbers.slice(-3);
    qty = last[0];
    unitPrice = last[1];
    amount = last[2];
  } else if (numbers.length === 2) {
    qty = numbers[0];
    unitPrice = numbers[1];
  } else if (numbers.length === 1) {
    qty = numbers[0];
  }

  return [designation, unit, qty, unitPrice, amount];
}

function extractPdfNumbers(text) {
  const matches = String(text || '').match(/-?\d{1,3}(?:[ \u00A0\u202F]\d{3})*(?:[\.,]\d+)?|-?\d+(?:[\.,]\d+)?/g);
  return matches || [];
}
