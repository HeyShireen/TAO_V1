// server/src/routes/exports.js
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, BorderStyle, UnderlineType, HeadingLevel, AlignmentType } from 'docx';
import JSZip from 'jszip';
import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { query } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { canViewProject } from '../../utils/permissions.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOT_COMPARISON_TEMPLATE = path.join(__dirname, '../../templates/comparatif-etancheite-template.xlsx');
const ROUNDS_COMPARISON_TEMPLATE = path.join(__dirname, '../../templates/recapitulatif-template.xlsx');
const RAO_TEMPLATE = path.join(__dirname, '../../templates/rao-template.docx');
const DMX_LOGO_PATH = path.join(__dirname, '../../public/assets/logo.png');

// Toutes les routes nécessitent authentification
router.use(requireAuth);

const EXPORT_CURRENCY_FMT = '#,##0.00 "€"';
const EXPORT_PERCENT_FMT = '0.00%';
const EXPORT_QTY_FMT = '#,##0.00';
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
const QUESTION_EXPORT_STYLES = {
  veryLow: { fg: 'FF000000', bg: 'FFBFD7FF', accent: 'FF0D6EFD', bold: true },
  low: { fg: 'FF000000', bg: 'FFBDEFF8', accent: 'FF0DCAF0', bold: true },
  high: { fg: 'FF000000', bg: 'FFFFD7B8', accent: 'FFFD7E14', bold: true },
  veryHigh: { fg: 'FF000000', bg: 'FFF2B8BE', accent: 'FFDC3545', bold: true },
  unanswered: { fg: 'FF000000', bg: 'FFFFF3CD', accent: 'FFFFC107', bold: true },
  unitMismatch: { fg: 'FF000000', bg: 'FFFFE3A8', accent: 'FFF59E0B', bold: true },
  amountMismatch: { fg: 'FF000000', bg: 'FFE6DAF5', accent: 'FF6F42C1', bold: true }
};

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeHexColor(value, fallback = 'FFFFF3CD') {
  const raw = String(value || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `FF${raw.toUpperCase()}`;
  if (/^[0-9a-fA-F]{8}$/.test(raw)) return raw.toUpperCase();
  return fallback;
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
  const compact = normalizeUnitLabel(value).replace(/\s/g, '');
  if (!compact) return '';
  return new Map([
    ['uni', 'u'],
    ['u', 'u'],
    ['ens', 'fft'],
    ['fft', 'fft'],
    ['ml', 'm'],
    ['m', 'm'],
    ['m2', 'm2'],
    ['m3', 'm3']
  ]).get(compact) || compact;
}

function hasBlockingUnitMismatch(expectedUnit, offeredUnit, offeredAmount) {
  const amount = Number.parseFloat(offeredAmount);
  if (!Number.isFinite(amount) || amount === 0) return false;
  const expected = canonicalizeUnit(expectedUnit);
  const offered = canonicalizeUnit(offeredUnit);
  if (!expected || !offered) return false;
  return expected !== offered;
}

function getDeviationLevel(deviationPct, veryLow, low, high, veryHigh) {
  if (!Number.isFinite(deviationPct)) return null;
  if (deviationPct < -Math.abs(veryLow)) return 'veryLow';
  if (deviationPct < -Math.abs(low)) return 'low';
  if (deviationPct > Math.abs(veryHigh)) return 'veryHigh';
  if (deviationPct > Math.abs(high)) return 'high';
  return null;
}

function applyQuestionExportStyle(cell, styleKey, options = {}) {
  const style = QUESTION_EXPORT_STYLES[styleKey];
  if (!style) return;
  const bg = options.bg || style.bg;
  const accent = options.accent || style.accent || style.fg;
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: bg },
    bgColor: { argb: bg }
  };
  cell.font = { ...(cell.font || {}), color: { argb: style.fg }, bold: style.bold };
  cell.border = {
    ...(cell.border || {}),
    left: { style: 'medium', color: { argb: accent } },
    right: cell.border?.right || { style: 'thin' },
    top: cell.border?.top || { style: 'thin' },
    bottom: cell.border?.bottom || { style: 'thin' }
  };
}

function getCompanyTableEndColumn(companyCount, firstCompanyCol = 11, companyWidth = 9) {
  return firstCompanyCol + Math.max(companyCount, 0) * companyWidth - 1;
}

function resetTableArea(worksheet, { firstRow, lastRow, lastCol }) {
  for (let r = firstRow; r <= lastRow; r += 1) {
    worksheet.getRow(r).style = {};
    for (let c = 1; c <= lastCol; c += 1) {
      const cell = worksheet.getCell(r, c);
      const value = cell.value;
      cell.style = {};
      cell.value = value;
      cell.fill = { type: 'pattern', pattern: 'none' };
      cell.border = {};
    }
  }
}

function trimWorksheetAfterColumn(worksheet, lastCol) {
  const maxCol = Math.max(worksheet.columnCount || 0, worksheet.actualColumnCount || 0, 120);
  for (let c = lastCol + 1; c <= maxCol; c += 1) {
    const column = worksheet.getColumn(c);
    column.hidden = true;
    column.width = 0.1;
    column.eachCell({ includeEmpty: true }, cell => {
      cell.value = null;
      cell.style = {};
      cell.fill = { type: 'pattern', pattern: 'none' };
      cell.border = {};
    });
  }
}

function addDmxLogoAboveMoe(workbook, worksheet, moeStartCol) {
  try {
    const imageId = workbook.addImage({
      filename: DMX_LOGO_PATH,
      extension: 'png'
    });
    worksheet.addImage(imageId, {
      tl: { col: moeStartCol - 1, row: 10.2 },
      br: { col: moeStartCol + 3, row: 16.2 },
      editAs: 'oneCell'
    });
  } catch (err) {
    console.warn('Logo DMX non inséré dans l’export comparatif:', err.message);
  }
}

function applyMetricQuestionStyle({ valueCell, deltaCell = null, deviationPct, thresholds, metric }) {
  const level = getMetricQuestionStyleKey(deviationPct, thresholds, metric);
  if (!level) return;
  applyQuestionExportStyle(valueCell, level);
  if (deltaCell) applyQuestionExportStyle(deltaCell, level);
}

function getMetricQuestionStyleKey(deviationPct, thresholds, metric) {
  return getDeviationLevel(
    deviationPct,
    thresholds[`${metric}_very_low_threshold`],
    thresholds[`${metric}_low_threshold`],
    thresholds[`${metric}_high_threshold`],
    thresholds[`${metric}_very_high_threshold`]
  );
}

function fmtThreshold(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))).replace('.', ',');
}

function metricLegendLabel(metricLabel, direction, threshold) {
  const prefix = direction === 'low' ? 'inférieur' : 'supérieur';
  return `${metricLabel} ${prefix} à ${fmtThreshold(threshold)} %`;
}

function getQuestionLegendRows(thresholds) {
  return [
    {
      qty: `Quantité basse : ${fmtThreshold(thresholds.qty_low_threshold)} %`,
      price: `PU bas : ${fmtThreshold(thresholds.price_low_threshold)} %`,
      note: '',
      bg: QUESTION_EXPORT_STYLES.low.bg
    },
    {
      qty: `Quantité haute : ${fmtThreshold(thresholds.qty_high_threshold)} %`,
      price: `PU haut : ${fmtThreshold(thresholds.price_high_threshold)} %`,
      note: '',
      bg: QUESTION_EXPORT_STYLES.high.bg
    },
    {
      qty: `Quantité anormalement basse : > ${fmtThreshold(thresholds.qty_very_low_threshold)} %`,
      price: `PU anormalement bas : > ${fmtThreshold(thresholds.price_very_low_threshold)} %`,
      note: `Montant anormalement bas : > ${fmtThreshold(thresholds.amount_very_low_threshold)} %`,
      bg: QUESTION_EXPORT_STYLES.veryLow.bg
    },
    {
      qty: `Quantité anormalement haute : > ${fmtThreshold(thresholds.qty_very_high_threshold)} %`,
      price: `PU anormalement haut : > ${fmtThreshold(thresholds.price_very_high_threshold)} %`,
      note: `Montant anormalement haut : > ${fmtThreshold(thresholds.amount_very_high_threshold)} %`,
      bg: QUESTION_EXPORT_STYLES.veryHigh.bg
    }
  ];
}

function getQuestionLegendSpecialRows(unansweredFill) {
  return [
    {
      label: 'Article incomplet : Quantité ou prix unitaire non renseignés par l\'entreprise',
      bg: unansweredFill || QUESTION_EXPORT_STYLES.unanswered.bg
    },
    {
      label: 'Incohérence d\'unité : Unité de l\'offre différente de l\'unité MOE',
      bg: QUESTION_EXPORT_STYLES.unitMismatch.bg
    },
    {
      label: 'Montant incohérent : Montant de l\'article différent du produit (Quantité × Prix unitaire)',
      bg: QUESTION_EXPORT_STYLES.amountMismatch.bg
    }
  ];
}

function sanitizeFilenamePart(value, fallback = 'Export') {
  return String(value || fallback)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || fallback;
}

function sanitizeWorksheetName(value, fallback = 'Feuille') {
  const cleaned = String(value || fallback)
    .replace(/[\[\]\*\/\\\?:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned || fallback;
}

function applyBorder(cell, border = {}) {
  const existing = cell.border || {};
  const keepStrong = (provided, current, fallback) => {
    if (current?.style === 'medium' && provided?.style === 'thin') return current;
    return provided || current || fallback;
  };
  cell.border = {
    top: keepStrong(border.top, existing.top, { style: 'thin' }),
    left: keepStrong(border.left, existing.left, { style: 'thin' }),
    bottom: keepStrong(border.bottom, existing.bottom, { style: 'thin' }),
    right: keepStrong(border.right, existing.right, { style: 'thin' })
  };
}

function unmergeAllCells(worksheet) {
  const merges = [...(worksheet.model?.merges || [])];
  for (const range of merges) {
    worksheet.unMergeCells(range);
  }
}

function clearWorksheetValues(worksheet) {
  worksheet.eachRow({ includeEmpty: true }, row => {
    row.eachCell({ includeEmpty: true }, cell => {
      cell.value = null;
    });
  });
  worksheet.conditionalFormattings = [];
}

function clearWorkbookDefinedNames(workbook) {
  if (workbook.definedNames) {
    workbook.definedNames.model = [];
    workbook.definedNames.matrixMap = {};
  }
}

function clearWorksheetDrawings(worksheet) {
  if (Array.isArray(worksheet._media)) {
    worksheet._media = [];
  }
}

function formatLotLabel(lot) {
  const code = lot?.code ? `LOT ${lot.code}` : `LOT ${lot?.id || ''}`;
  const name = lot?.name ? ` : ${String(lot.name).toUpperCase()}` : '';
  return `${code}${name}`.trim();
}

function formatLotWorksheetName(lot) {
  const code = lot?.code ? `Lot ${lot.code}` : `Lot ${lot?.id || ''}`;
  const name = lot?.name ? ` ${lot.name}` : '';
  return sanitizeWorksheetName(`${code}${name}`.trim(), code);
}

function parseSelectedOptionIds(reqOrValue) {
  const raw = reqOrValue?.body?.selectedOptions
    ?? reqOrValue?.query?.selectedOptions
    ?? reqOrValue?.selectedOptions
    ?? reqOrValue;
  const values = Array.isArray(raw)
    ? raw
    : String(raw || '').split(',');
  return [...new Set(values.map(Number).filter(Number.isFinite))];
}

function itemExportKey(item) {
  if (item?.export_key) return item.export_key;
  return item?.is_option ? `option:${item.id}` : `item:${item?.id}`;
}

function addToMapTotal(map, key, value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return;
  map.set(key, (map.get(key) || 0) + amount);
}

async function fetchSelectedOptionItemsForLot({ lotId, roundId, selectedOptionIds, isEntreprise, userCompanyId }) {
  if (!selectedOptionIds?.length || !roundId) {
    return {
      rows: [],
      moeByItem: new Map(),
      offersByItemCompany: new Map()
    };
  }

  const itemsRes = await query(
    `SELECT oi.id, oi.num, oi.designation, oi.unit,
            opt.id AS option_id, opt.designation AS option_designation,
            oim.qty AS moe_qty, oim.unit_price AS moe_unit_price
     FROM option_items oi
     JOIN options opt ON opt.id = oi.option_id
     LEFT JOIN option_item_moe oim ON oim.option_item_id = oi.id
     WHERE opt.lot_id = $1
       AND opt.round_id = $2
       AND opt.id = ANY($3::int[])
     ORDER BY opt.created_at ASC, opt.id ASC, oi.num ASC, oi.id ASC`,
    [lotId, roundId, selectedOptionIds]
  );

  const optionItemIds = itemsRes.rows.map(row => Number(row.id)).filter(Number.isFinite);
  const rows = itemsRes.rows.map(row => ({
    id: Number(row.id),
    export_key: `option:${row.id}`,
    is_option: true,
    option_id: Number(row.option_id),
    option_designation: row.option_designation,
    num: row.num ? `O${row.num}` : 'Option',
    designation: `Option - ${row.option_designation}${row.designation ? ` - ${row.designation}` : ''}`,
    unit: row.unit
  }));

  const moeByItem = new Map();
  if (!isEntreprise) {
    for (const row of itemsRes.rows) {
      moeByItem.set(`option:${row.id}`, {
        qty: row.moe_qty,
        unit_price: row.moe_unit_price
      });
    }
  }

  const offersParams = [optionItemIds, roundId];
  let offersWhere = '';
  if (isEntreprise && userCompanyId) {
    offersParams.push(userCompanyId);
    offersWhere = ` AND oio.company_id = $${offersParams.length}`;
  }
  const offersRes = optionItemIds.length
    ? await query(
      `SELECT oio.*
       FROM option_item_offers oio
       WHERE oio.option_item_id = ANY($1::int[])
         AND oio.round_id = $2
         ${offersWhere}`,
      offersParams
    )
    : { rows: [] };

  const offersByItemCompany = new Map();
  for (const offer of offersRes.rows) {
    offersByItemCompany.set(`option:${Number(offer.option_item_id)}:${Number(offer.company_id)}`, {
      ...offer,
      item_id: Number(offer.option_item_id),
      amount: toNumberOrNull(offer.qty) !== null && toNumberOrNull(offer.unit_price) !== null
        ? Number(offer.qty) * Number(offer.unit_price)
        : null
    });
  }

  return { rows, moeByItem, offersByItemCompany };
}

async function fetchSelectedOptionTotals({ projectId, lotIds = [], roundIds = [], selectedOptionIds = [], isEntreprise = false, companyId = null, includeMoe = true }) {
  const empty = {
    moeByLot: new Map(),
    moeByOption: new Map(),
    offersByLotRoundCompany: new Map(),
    companiesByLot: new Map(),
    details: []
  };
  if (!selectedOptionIds.length) return empty;

  const params = [selectedOptionIds];
  const where = ['opt.id = ANY($1::int[])'];
  if (projectId) {
    params.push(projectId);
    where.push(`l.project_id = $${params.length}`);
  }
  if (lotIds.length) {
    params.push(lotIds);
    where.push(`opt.lot_id = ANY($${params.length}::int[])`);
  }
  if (roundIds.length) {
    params.push(roundIds);
    where.push(`opt.round_id = ANY($${params.length}::int[])`);
  }
  if (isEntreprise && companyId) {
    params.push(companyId);
    where.push(`oio.company_id = $${params.length}`);
  }

  const offersRes = await query(
    `SELECT opt.id AS option_id, opt.designation AS option_designation,
            opt.lot_id, opt.round_id, oio.company_id,
            COALESCE(NULLIF(lc.display_name, ''), c.name) AS company_name,
            COALESCE(SUM(COALESCE(oio.qty, 0) * COALESCE(oio.unit_price, 0)), 0) AS total
     FROM options opt
     JOIN lots l ON l.id = opt.lot_id
     JOIN option_items oi ON oi.option_id = opt.id
     JOIN option_item_offers oio ON oio.option_item_id = oi.id
     JOIN companies c ON c.id = oio.company_id
     LEFT JOIN lot_companies lc ON lc.company_id = oio.company_id AND lc.lot_id = opt.lot_id
     WHERE ${where.join(' AND ')}
     GROUP BY opt.id, opt.designation, opt.lot_id, opt.round_id, oio.company_id, lc.display_name, c.name
     ORDER BY opt.lot_id, opt.round_id, opt.designation, company_name`,
    params
  );

  const offersByLotRoundCompany = new Map();
  const companiesByLot = new Map();
  const details = [];
  for (const row of offersRes.rows) {
    const lotId = Number(row.lot_id);
    const roundId = Number(row.round_id);
    const compId = Number(row.company_id);
    const total = Number(row.total) || 0;
    addToMapTotal(offersByLotRoundCompany, `${lotId}:${roundId}:${compId}`, total);
    if (!companiesByLot.has(lotId)) companiesByLot.set(lotId, new Map());
    companiesByLot.get(lotId).set(compId, row.company_name);
    details.push({
      option_id: Number(row.option_id),
      option_designation: row.option_designation,
      lot_id: lotId,
      round_id: roundId,
      company_id: compId,
      company_name: row.company_name,
      offer_total: total
    });
  }

  const moeByLot = new Map();
  const moeByOption = new Map();
  if (includeMoe && !isEntreprise) {
    const moeParams = [selectedOptionIds];
    const moeWhere = ['opt.id = ANY($1::int[])'];
    if (projectId) {
      moeParams.push(projectId);
      moeWhere.push(`l.project_id = $${moeParams.length}`);
    }
    if (lotIds.length) {
      moeParams.push(lotIds);
      moeWhere.push(`opt.lot_id = ANY($${moeParams.length}::int[])`);
    }
    if (roundIds.length) {
      moeParams.push(roundIds);
      moeWhere.push(`opt.round_id = ANY($${moeParams.length}::int[])`);
    }
    const moeRes = await query(
      `SELECT opt.id AS option_id, opt.lot_id,
              COALESCE(SUM(COALESCE(oim.qty, 0) * COALESCE(oim.unit_price, 0)), 0) AS total
       FROM options opt
       JOIN lots l ON l.id = opt.lot_id
       JOIN option_items oi ON oi.option_id = opt.id
       LEFT JOIN option_item_moe oim ON oim.option_item_id = oi.id
       WHERE ${moeWhere.join(' AND ')}
       GROUP BY opt.id, opt.lot_id`,
      moeParams
    );
    for (const row of moeRes.rows) {
      const total = Number(row.total) || 0;
      moeByOption.set(Number(row.option_id), total);
      moeByLot.set(Number(row.lot_id), (moeByLot.get(Number(row.lot_id)) || 0) + total);
    }
  }

  return { moeByLot, moeByOption, offersByLotRoundCompany, companiesByLot, details };
}

// Transporteur email (réutilise la même config que utils/email.js)
let emailTransporter = null;
function getEmailTransporter() {
  if (!emailTransporter) {
    emailTransporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_PORT === '465',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 10000,
    });
  }
  return emailTransporter;
}

// Export Excel du récapitulatif d'un tour
async function fetchLotComparisonData({ lotId, roundId, req, selectedOptionIds = [] }) {
  const userId = req.user.id;
  const isEntreprise = req.user?.role === 'entreprise';
  const userCompanyId = req.user?.company_id || null;

  const lotRes = await query(
    `SELECT l.*, p.name AS project_name, p.reference, p.client, p.location, p.study_phase
     FROM lots l
     JOIN projects p ON p.id = l.project_id
     WHERE l.id = $1`,
    [lotId]
  );
  if (lotRes.rowCount === 0) {
    const err = new Error('Lot introuvable');
    err.status = 404;
    throw err;
  }
  const lot = lotRes.rows[0];
  const canView = await canViewProject(userId, lot.project_id, req.user.role, userCompanyId);
  if (!canView) {
    const err = new Error('Accès refusé');
    err.status = 403;
    throw err;
  }

  const roundRes = roundId
    ? await query('SELECT * FROM rounds WHERE id = $1 AND project_id = $2', [roundId, lot.project_id])
    : { rows: [] };
  const round = roundRes.rows[0] || null;

  const itemsRes = await query(
    `SELECT i.*, p.num AS parent_num, p.designation AS parent_designation
     FROM items i
     LEFT JOIN items p ON p.id = i.parent_item_id
     WHERE i.lot_id = $1
     ORDER BY i.position NULLS LAST, i.id`,
    [lotId]
  );
  const items = itemsRes.rows.map(item => ({ ...item, export_key: `item:${item.id}` }));
  const itemIds = items.map(i => Number(i.id)).filter(Number.isFinite);

  const moeRes = (!isEntreprise && itemIds.length)
    ? await query('SELECT * FROM moe_items WHERE item_id = ANY($1::int[])', [itemIds])
    : { rows: [] };
  const moeByItem = new Map(moeRes.rows.map(row => [`item:${Number(row.item_id)}`, row]));

  const companiesParams = [lotId];
  let companyWhere = '';
  if (isEntreprise && userCompanyId) {
    companiesParams.push(userCompanyId);
    companyWhere = 'AND c.id = $2';
  }
  const companiesRes = await query(
    `SELECT c.id, COALESCE(NULLIF(lc.display_name, ''), c.name) AS name, c.color
     FROM lot_companies lc
     JOIN companies c ON c.id = lc.company_id
     WHERE lc.lot_id = $1 ${companyWhere}
     ORDER BY lc.created_at, c.id`,
    companiesParams
  );
  const companies = companiesRes.rows;

  const offersParams = [itemIds];
  let offersWhere = '';
  if (roundId) {
    offersParams.push(roundId);
    offersWhere += ` AND o.round_id = $${offersParams.length}`;
  }
  if (isEntreprise && userCompanyId) {
    offersParams.push(userCompanyId);
    offersWhere += ` AND o.company_id = $${offersParams.length}`;
  }
  const offersRes = itemIds.length
    ? await query(`SELECT * FROM offers o WHERE o.item_id = ANY($1::int[])${offersWhere}`, offersParams)
    : { rows: [] };

  const offersByItemCompany = new Map();
  for (const offer of offersRes.rows) {
    offersByItemCompany.set(`item:${Number(offer.item_id)}:${Number(offer.company_id)}`, offer);
  }

  const optionData = await fetchSelectedOptionItemsForLot({
    lotId,
    roundId,
    selectedOptionIds,
    isEntreprise,
    userCompanyId
  });
  items.push(...optionData.rows);
  for (const [key, value] of optionData.moeByItem.entries()) {
    moeByItem.set(key, value);
  }
  for (const [key, value] of optionData.offersByItemCompany.entries()) {
    offersByItemCompany.set(key, value);
  }

  const thresholdsRes = await query('SELECT * FROM lot_threshold_config WHERE lot_id = $1', [lotId]);
  const thresholds = { ...DEFAULT_LOT_THRESHOLDS, ...(thresholdsRes.rows[0] || {}) };

  const questionConfigRes = await query(
    `SELECT
       CASE
         WHEN COALESCE(lqc.unanswered_comment_override, false) THEN lqc.unanswered_comment
         ELSE pqc.unanswered_comment
       END AS unanswered_comment,
       CASE
         WHEN COALESCE(lqc.unanswered_color_override, false) THEN lqc.unanswered_color
         ELSE pqc.unanswered_color
       END AS unanswered_color
     FROM lots l
     LEFT JOIN project_question_config pqc ON pqc.project_id = l.project_id
     LEFT JOIN lot_question_config lqc ON lqc.lot_id = l.id
     WHERE l.id = $1`,
    [lotId]
  );
  const questionConfig = questionConfigRes.rows[0] || {};

  const generatedQuestionsParams = [lotId];
  let generatedQuestionsWhere = '';
  if (roundId) {
    generatedQuestionsParams.push(roundId);
    generatedQuestionsWhere = `AND round_id = $${generatedQuestionsParams.length}`;
  }
  const generatedQuestionsRes = await query(
    `SELECT item_id, option_item_id, company_id, status, question_text, question_type
     FROM generated_questions
     WHERE lot_id = $1 ${generatedQuestionsWhere}`,
    generatedQuestionsParams
  );
  const questionsByItemCompany = new Map();
  for (const q of generatedQuestionsRes.rows) {
    if ((!q.item_id && !q.option_item_id) || !q.company_id) continue;
    const sourceKey = q.option_item_id ? `option:${Number(q.option_item_id)}` : `item:${Number(q.item_id)}`;
    const key = `${sourceKey}:${Number(q.company_id)}`;
    if (!questionsByItemCompany.has(key)) questionsByItemCompany.set(key, []);
    questionsByItemCompany.get(key).push(q);
  }
  return {
    lot,
    round,
    items,
    moeByItem,
    companies,
    offersByItemCompany,
    thresholds,
    questionConfig,
    questionsByItemCompany
  };
}

async function buildLotComparisonWorkbook({ lot, round, items, moeByItem, companies, offersByItemCompany, thresholds, questionConfig, questionsByItemCompany }) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(LOT_COMPARISON_TEMPLATE);
    for (const sheet of [...workbook.worksheets]) {
      if (sheet.name !== 'ETANCHEITE') workbook.removeWorksheet(sheet.id);
    }
    clearWorkbookDefinedNames(workbook);
  } catch (err) {
    console.warn('Template comparatif introuvable, génération depuis un classeur vierge:', err.message);
  }
  workbook.creator = 'AO Link';
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const ws = workbook.getWorksheet('ETANCHEITE') || workbook.addWorksheet('ETANCHEITE');
  ws.name = formatLotWorksheetName(lot);
  unmergeAllCells(ws);
  clearWorksheetDrawings(ws);
  clearWorksheetValues(ws);

  const moeStartCol = 7;
  const firstCompanyCol = 11;
  const companyWidth = 9;
  const companyCount = companies.length;
  const lastCol = Math.max(moeStartCol + 3, getCompanyTableEndColumn(companyCount, firstCompanyCol, companyWidth));
  const headerGroupRow = 20;
  const headerRow = 21;
  const dataStartRow = 22;
  const lastDataRow = dataStartRow + Math.max(items.length, 1) - 1;
  const totalRowNumber = lastDataRow + 2;
  ws.views = [{ state: 'frozen', xSplit: firstCompanyCol - 1, ySplit: 0, topLeftCell: `${ws.getColumn(firstCompanyCol).letter}1`, zoomScale: 55 }];

  if (ws.columnCount > lastCol) {
    ws.spliceColumns(lastCol + 1, ws.columnCount - lastCol);
  }
  resetTableArea(ws, { firstRow: headerGroupRow, lastRow: Math.max(totalRowNumber, ws.rowCount), lastCol });
  // Les cellules issues du template peuvent partager le même objet de style :
  // réinitialiser la zone de légende pour éviter qu'une écriture en écrase une autre.
  for (let r = 10; r < headerGroupRow; r += 1) {
    for (let c = 1; c <= lastCol; c += 1) {
      ws.getCell(r, c).style = {};
    }
  }

  ws.pageSetup = {
    paperSize: 8,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    verticalCentered: true,
    printTitlesRow: `${headerRow}:${headerRow}`
  };
  ws.pageSetup.printArea = `A1:${ws.getColumn(lastCol).letter}${totalRowNumber + 3}`;
  const unansweredFill = normalizeHexColor(questionConfig?.unanswered_color, QUESTION_EXPORT_STYLES.unanswered.bg);

  const baseWidths = { 1: 15.6, 2: 50.1, 3: 50.1, 4: 50.1, 5: 50.1, 6: 50.1, 7: 10.6, 8: 16.1, 9: 23, 10: 25.5 };
  for (let c = 1; c <= lastCol; c += 1) {
    if (baseWidths[c]) {
      ws.getColumn(c).width = baseWidths[c];
    } else {
      const pos = (c - firstCompanyCol) % companyWidth;
      ws.getColumn(c).width = [6, 16.1, 20, 23, 15.1, 15.1, 22.6, 72, 18.8][pos] || 14;
    }
  }
  for (let r = 5; r <= headerRow; r += 1) ws.getRow(r).height = r === headerRow ? 79.95 : 26.4;

  const titleFont = { name: 'Arial Narrow', size: 18, color: { argb: 'FF000000' } };
  const headerFont = { name: 'Arial Narrow', size: 18, color: { argb: 'FF000000' } };
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };

  ws.getCell('D1').value = lot.project_name || 'Nom du projet';
  ws.getCell('D2').value = lot.reference || 'Déscription de l\'affaire';
  ws.getCell('D3').value = lot.client || 'Maître d\'ouvrage';
  ws.getCell('D4').value = lot.location || 'Maître d\'œuvre';
  ws.getCell('D5').value = 'INDICE : 0';
  ws.getCell('D6').value = `PHASE D'ETUDE : ${lot.study_phase || round?.name || ''}`.trim();
  ws.getCell('D7').value = new Date();
  ws.getCell('D7').numFmt = 'dd/mm/yyyy';
  ws.getCell('D8').value = formatLotLabel(lot);
  ws.getCell('D9').value = 'TABLEAU D\'ANALYSE DES OFFRES :';
  ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'].forEach(addr => {
    ws.getCell(addr).font = { ...titleFont, bold: addr === 'D1' };
    ws.getCell(addr).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  });

  ws.mergeCells('B11:D11');
  ws.getCell('B11').value = 'Légende analyse';
  ws.getCell('B11').font = { name: 'Calibri', size: 18, bold: true };
  ws.getCell('B11').alignment = { horizontal: 'center', vertical: 'middle' };
  for (let c = 2; c <= 4; c += 1) {
    applyBorder(ws.getCell(11, c), {
      top: { style: 'medium' },
      bottom: { style: 'medium' },
      left: c === 2 ? { style: 'medium' } : { style: 'thin' },
      right: c === 4 ? { style: 'medium' } : { style: 'thin' }
    });
  }

  ['QUANTITE', 'PRIX UNITAIRE', 'MONTANT'].forEach((label, offset) => {
    const c = 2 + offset;
    const cell = ws.getCell(12, c);
    cell.value = label;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    cell.font = { name: 'Calibri', size: 16, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    applyBorder(cell, {
      top: { style: 'medium' },
      bottom: { style: 'thin' },
      left: c === 2 ? { style: 'medium' } : { style: 'thin' },
      right: c === 4 ? { style: 'medium' } : { style: 'thin' }
    });
  });

  getQuestionLegendRows(thresholds).forEach((entry, idx) => {
    const r = 13 + idx;
    [entry.qty, entry.price, entry.note].forEach((value, offset) => {
      const c = 2 + offset;
      const cell = ws.getCell(r, c);
      cell.value = value;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: entry.bg } };
      cell.font = { name: 'Calibri', size: 16 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      applyBorder(cell, {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: c === 2 ? { style: 'medium' } : { style: 'thin' },
        right: c === 4 ? { style: 'medium' } : { style: 'thin' }
      });
    });
  });

  getQuestionLegendSpecialRows(unansweredFill).forEach((entry, idx, specials) => {
    const r = 17 + idx;
    ws.mergeCells(r, 2, r, 4);
    for (let c = 2; c <= 4; c += 1) {
      const cell = ws.getCell(r, c);
      if (c === 2) cell.value = entry.label;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: entry.bg } };
      cell.font = { name: 'Calibri', size: 16 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      applyBorder(cell, {
        top: { style: 'thin' },
        bottom: { style: idx === specials.length - 1 ? 'medium' : 'thin' },
        left: c === 2 ? { style: 'medium' } : { style: 'thin' },
        right: c === 4 ? { style: 'medium' } : { style: 'thin' }
      });
    }
  });

  addDmxLogoAboveMoe(workbook, ws, moeStartCol);

  ws.mergeCells(headerGroupRow, moeStartCol, headerGroupRow, moeStartCol + 3);
  ws.getCell(headerGroupRow, moeStartCol).value = 'MOE';
  ws.getCell(headerGroupRow, moeStartCol).fill = headerFill;
  ws.getCell(headerGroupRow, moeStartCol).font = headerFont;
  ws.getCell(headerGroupRow, moeStartCol).alignment = { horizontal: 'center', vertical: 'middle' };
  applyBorder(ws.getCell(headerGroupRow, moeStartCol), { left: { style: 'double' } });

  ['Num', 'Désignation', '', '', '', '', 'U', 'Quantité', 'PU', 'Montant '].forEach((label, idx) => {
    const cell = ws.getCell(headerRow, idx + 1);
    if (label) cell.value = label;
    cell.font = headerFont;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    applyBorder(cell, {
      top: { style: idx + 1 >= moeStartCol ? 'double' : 'thin' },
      left: idx + 1 === moeStartCol ? { style: 'double' } : undefined
    });
  });
  ws.mergeCells(headerRow, 2, headerRow, 6);

  companies.forEach((company, index) => {
    const start = firstCompanyCol + index * companyWidth;
    const end = start + companyWidth - 1;
    ws.mergeCells(headerGroupRow, start, headerGroupRow, end);
    const title = ws.getCell(headerGroupRow, start);
    title.value = company.name || `Entreprise ${index + 1}`;
    title.fill = headerFill;
    title.font = { name: 'Calibri', size: 18 };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    applyBorder(title, { left: { style: 'double' } });

    ['U', 'Quantité', 'PU', 'Montant ', 'Ecart Qtés (en %)', 'Ecart PU (en %)', 'nb remarque', 'Remarque logiciel', 'Questions'].forEach((label, offset) => {
      const cell = ws.getCell(headerRow, start + offset);
      cell.value = label;
      cell.font = headerFont;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      applyBorder(cell, {
        left: offset === 0 ? { style: 'double' } : { style: 'thin' },
        right: offset === companyWidth - 1 ? { style: 'double' } : { style: 'thin' },
        top: { style: 'double' }
      });
    });
  });

  const rowsToWrite = items.length ? items : [{}];
  rowsToWrite.forEach((item, idx) => {
    const rowNumber = dataStartRow + idx;
    const row = ws.getRow(rowNumber);
    const questionStyleIntents = [];
    const key = itemExportKey(item);
    const moe = moeByItem.get(key) || {};
    const moeQty = toNumberOrNull(moe.qty);
    const moePu = toNumberOrNull(moe.unit_price);

    row.getCell(1).value = item.num || '';
    row.getCell(2).value = item.designation || '';
    ws.mergeCells(rowNumber, 2, rowNumber, 6);
    row.getCell(moeStartCol).value = item.unit || '';
    row.getCell(moeStartCol + 1).value = moeQty;
    row.getCell(moeStartCol + 2).value = moePu;
    row.getCell(moeStartCol + 3).value = moeQty !== null && moePu !== null ? moeQty * moePu : null;

    companies.forEach((company, cIdx) => {
      const start = firstCompanyCol + cIdx * companyWidth;
      const offer = offersByItemCompany.get(`${key}:${Number(company.id)}`) || {};
      const qty = toNumberOrNull(offer.qty);
      const pu = toNumberOrNull(offer.unit_price);
      const amount = toNumberOrNull(offer.amount) ?? (qty !== null && pu !== null ? qty * pu : null);
      const remark = offer.comment || '';
      const hasQty = qty !== null && qty !== 0;
      const hasPu = pu !== null && pu !== 0;
      const moeHasTotal = moeQty !== null && moeQty > 0 && moePu !== null && moePu > 0;
      const isUnanswered = moeHasTotal && !hasQty && !hasPu;
      const unitMismatch = hasBlockingUnitMismatch(item.unit, offer.unit, amount);
      const qtyDeviation = moeQty && qty !== null ? ((qty - moeQty) / moeQty) * 100 : null;
      const puDeviation = moePu && pu !== null ? ((pu - moePu) / moePu) * 100 : null;
      const moeAmount = moeQty !== null && moePu !== null ? moeQty * moePu : null;
      const amountDeviation = moeAmount && amount !== null ? ((amount - moeAmount) / moeAmount) * 100 : null;
      const generatedQuestions = questionsByItemCompany?.get(`${key}:${Number(company.id)}`) || [];
      const questionTexts = generatedQuestions
        .map(q => String(q.question_text || '').trim())
        .filter(Boolean);
      const amountMismatch = generatedQuestions.some(q => q.question_type === 'offer_amount_mismatch');
      row.getCell(start).value = offer.unit || item.unit || '';
      row.getCell(start + 1).value = qty;
      row.getCell(start + 2).value = pu;
      row.getCell(start + 3).value = amount;
      row.getCell(start + 4).value = qtyDeviation !== null ? qtyDeviation / 100 : null;
      row.getCell(start + 5).value = puDeviation !== null ? puDeviation / 100 : null;
      row.getCell(start + 6).value = questionTexts.length || (remark ? 1 : null);
      row.getCell(start + 7).value = questionTexts.length ? questionTexts.join('\n') : remark;
      row.getCell(start + 8).value = '';

      if (isUnanswered) {
        [start, start + 1, start + 2, start + 3].forEach(col => {
          questionStyleIntents.push({ col, styleKey: 'unanswered', options: { bg: unansweredFill } });
        });
      } else if (unitMismatch) {
        [start, start + 1, start + 2].forEach(col => {
          questionStyleIntents.push({ col, styleKey: 'unitMismatch' });
        });
      } else {
        const qtyStyle = getMetricQuestionStyleKey(qtyDeviation, thresholds, 'qty');
        if (qtyStyle) {
          questionStyleIntents.push({ col: start + 1, styleKey: qtyStyle });
          questionStyleIntents.push({ col: start + 4, styleKey: qtyStyle });
        }
        const priceStyle = getMetricQuestionStyleKey(puDeviation, thresholds, 'price');
        if (priceStyle) {
          questionStyleIntents.push({ col: start + 2, styleKey: priceStyle });
          questionStyleIntents.push({ col: start + 5, styleKey: priceStyle });
        }
        if (amountMismatch) {
          questionStyleIntents.push({ col: start + 3, styleKey: 'amountMismatch' });
        } else {
          const amountStyle = getMetricQuestionStyleKey(amountDeviation, thresholds, 'amount');
          if (amountStyle) {
            questionStyleIntents.push({ col: start + 3, styleKey: amountStyle });
          }
        }
      }
    });

    for (let c = 1; c <= lastCol; c += 1) {
      const cell = row.getCell(c);
      cell.font = { name: 'Arial Narrow', size: 12, ...(cell.font || {}) };
      cell.alignment = {
        vertical: 'middle',
        wrapText: c === 2 || (c >= firstCompanyCol && (c - firstCompanyCol) % companyWidth === 7)
      };
      applyBorder(cell, {
        left: c === moeStartCol || (c >= firstCompanyCol && (c - firstCompanyCol) % companyWidth === 0) ? { style: 'double' } : { style: 'thin' },
        right: c >= firstCompanyCol && (c - firstCompanyCol) % companyWidth === companyWidth - 1 ? { style: 'double' } : { style: 'thin' },
        bottom: { style: 'hair' }
      });
    }
    for (const intent of questionStyleIntents) {
      applyQuestionExportStyle(row.getCell(intent.col), intent.styleKey, intent.options || {});
    }
    companies.forEach((_, cIdx) => {
      const remarkCell = row.getCell(firstCompanyCol + cIdx * companyWidth + 7);
      remarkCell.alignment = { ...(remarkCell.alignment || {}), vertical: 'middle', wrapText: true };
    });
  });

  const totalRow = ws.getRow(totalRowNumber);
  totalRow.getCell(2).value = 'TOTAL';
  totalRow.font = { name: 'Arial Narrow', size: 18, bold: true };
  for (let c = 1; c <= lastCol; c += 1) {
    const cell = totalRow.getCell(c);
    cell.fill = headerFill;
    applyBorder(cell, {
      top: { style: 'double' },
      bottom: { style: 'double' },
      left: c === moeStartCol || (c >= firstCompanyCol && (c - firstCompanyCol) % companyWidth === 0) ? { style: 'double' } : undefined,
      right: c >= firstCompanyCol && (c - firstCompanyCol) % companyWidth === companyWidth - 1 ? { style: 'double' } : undefined
    });
  }
  [moeStartCol + 3, ...companies.map((_, idx) => firstCompanyCol + idx * companyWidth + 3)].forEach(col => {
    const letter = ws.getColumn(col).letter;
    totalRow.getCell(col).value = { formula: `SUM(${letter}${dataStartRow}:${letter}${lastDataRow})` };
    totalRow.getCell(col).numFmt = EXPORT_CURRENCY_FMT;
  });

  for (let r = dataStartRow; r <= totalRowNumber; r += 1) {
    ws.getCell(r, moeStartCol + 1).numFmt = EXPORT_QTY_FMT;
    ws.getCell(r, moeStartCol + 2).numFmt = EXPORT_CURRENCY_FMT;
    ws.getCell(r, moeStartCol + 3).numFmt = EXPORT_CURRENCY_FMT;
    companies.forEach((_, idx) => {
      const start = firstCompanyCol + idx * companyWidth;
      ws.getCell(r, start + 1).numFmt = EXPORT_QTY_FMT;
      ws.getCell(r, start + 2).numFmt = EXPORT_CURRENCY_FMT;
      ws.getCell(r, start + 3).numFmt = EXPORT_CURRENCY_FMT;
      ws.getCell(r, start + 4).numFmt = EXPORT_PERCENT_FMT;
      ws.getCell(r, start + 5).numFmt = EXPORT_PERCENT_FMT;
    });
  }

  ws.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: lastDataRow, column: lastCol }
  };

  if (ws.rowCount > totalRowNumber) {
    ws.spliceRows(totalRowNumber + 1, ws.rowCount - totalRowNumber);
  }
  trimWorksheetAfterColumn(ws, lastCol);

  return workbook;
}

async function handleLotComparisonExport(req, res) {
  try {
    const lotId = Number(req.params.lotId);
    const roundId = req.query.round_id ? Number(req.query.round_id) : null;
    const selectedOptionIds = parseSelectedOptionIds(req);
    if (!Number.isFinite(lotId)) return res.status(400).json({ error: 'lotId invalide' });

    const data = await fetchLotComparisonData({ lotId, roundId, req, selectedOptionIds });
    const workbook = await buildLotComparisonWorkbook(data);
    const buffer = await workbook.xlsx.writeBuffer();
    const lotPart = sanitizeFilenamePart(`${data.lot.code || `Lot_${lotId}`}_${data.lot.name || ''}`, `Lot_${lotId}`);
    const roundPart = data.round ? `_Tour${data.round.round_number}` : '';
    const filename = `Comparatif_${lotPart}${roundPart}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Export lot comparison error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur lors de l\'export' });
  }
}

router.get('/lot-comparison/:lotId', handleLotComparisonExport);
router.post('/lot-comparison/:lotId', handleLotComparisonExport);

async function handleSummaryExport(req, res) {
  try {
    const { roundId } = req.params;
    const userId = req.user.id;
    const isEntreprise = req.user?.role === 'entreprise';
    const userCompanyId = req.user?.company_id || null;
    const selectedOptionIds = parseSelectedOptionIds(req);

    // Récupérer les infos du tour et du projet
    const roundRes = await query(
      `SELECT r.*, p.name as project_name, p.reference
       FROM rounds r
       JOIN projects p ON r.project_id = p.id
       WHERE r.id = $1`,
      [roundId]
    );
    
    if (roundRes.rowCount === 0) {
      return res.status(404).json({ error: 'Tour introuvable' });
    }

    const round = roundRes.rows[0];
    const canViewDemoProject = await canViewProject(userId, round.project_id, req.user.role, req.user.company_id || null);
    if (!canViewDemoProject) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    // Vérifier l'accès au projet
    const accessCheck = await query(
      `SELECT 1 FROM projects p
       LEFT JOIN project_shares ps ON ps.project_id = p.id AND ps.shared_with_user_id = $2
       WHERE p.id = $1 AND (p.owner_id = $2 OR ps.shared_with_user_id IS NOT NULL OR $3 IN ('admin', 'responsable'))`,
      [round.project_id, userId, req.user.role]
    );

    if (accessCheck.rowCount === 0) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    // Récupérer les lots
    const lotsRes = await query(
      `SELECT id, code, name FROM lots WHERE project_id = $1 ORDER BY sort_order ASC, id ASC`,
      [round.project_id]
    );
    const lots = lotsRes.rows;
    const lotIds = lots.map(l => Number(l.id)).filter(Number.isFinite);

    // Récupérer les entreprises actives pour ce tour
    const companiesRes = await query(
      `SELECT DISTINCT c.id, c.name
       FROM companies c
       JOIN lot_companies lc ON lc.company_id = c.id
       JOIN lots l ON l.id = lc.lot_id
       WHERE l.project_id = $1
       ORDER BY c.name`,
      [round.project_id]
    );
    const companies = companiesRes.rows;

    // Récupérer toutes les données (items MOE + offres)
    const dataRes = await query(
      `SELECT 
         i.lot_id,
         i.num,
         i.designation,
         i.unit,
         m.qty as moe_qty,
         m.unit_price as moe_pu,
         m.amount as moe_amount,
         o.company_id,
         o.qty as offer_qty,
         o.unit_price as offer_pu
       FROM items i
       LEFT JOIN moe_items m ON m.item_id = i.id
       LEFT JOIN offers o ON o.item_id = i.id AND o.round_id = $1
       JOIN lots l ON l.id = i.lot_id
       WHERE l.project_id = $2
       ORDER BY i.lot_id, i.num`,
      [roundId, round.project_id]
    );

    // Organiser les données par lot
    const lotData = {};
    for (const row of dataRes.rows) {
      if (!lotData[row.lot_id]) {
        lotData[row.lot_id] = [];
      }
      let item = lotData[row.lot_id].find(it => it.num === row.num);
      if (!item) {
        item = {
          num: row.num,
          designation: row.designation,
          unit: row.unit,
          moe_qty: row.moe_qty,
          moe_pu: row.moe_pu,
          moe_amount: row.moe_amount,
          offers: {}
        };
        lotData[row.lot_id].push(item);
      }
      if (row.company_id) {
        item.offers[row.company_id] = {
          qty: row.offer_qty,
          pu: row.offer_pu
        };
      }
    }

    // Créer le workbook Excel
    const optionTotals = await fetchSelectedOptionTotals({
      projectId: round.project_id,
      lotIds,
      roundIds: [Number(roundId)],
      selectedOptionIds,
      isEntreprise,
      companyId: userCompanyId,
      includeMoe: true
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AO Link';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Récapitulatif');

    // En-tête du document
    worksheet.mergeCells('A1:E1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `Récapitulatif - ${round.project_name} (Tour ${round.round_number} - ${round.name || ''})`;
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 30;

    worksheet.addRow([]);

    // En-têtes colonnes principales
    const headerRow = worksheet.addRow([
      'Lot',
      'MOE Total (€)',
      ...companies.map(c => c.name),
      'Moins-disant (€)'
    ]);

    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 25;

    // Calculer les totaux par lot
    for (const lot of lots) {
      const items = lotData[lot.id] || [];
      
      // Total MOE
      let moeTotal = 0;
      for (const item of items) {
        const amount = parseFloat(item.moe_amount);
        if (Number.isFinite(amount)) moeTotal += amount;
      }
      moeTotal += optionTotals.moeByLot.get(Number(lot.id)) || 0;

      // Totaux par entreprise
      const companyTotals = companies.map(company => {
        let total = 0;
        for (const item of items) {
          const offer = item.offers[company.id];
          if (offer) {
            const qty = parseFloat(offer.qty) || 0;
            const pu = parseFloat(offer.pu) || 0;
            total += qty * pu;
          }
        }
        total += optionTotals.offersByLotRoundCompany.get(`${Number(lot.id)}:${Number(roundId)}:${Number(company.id)}`) || 0;
        return total || null;
      });

      // Moins-disant
      const validTotals = companyTotals.filter(t => t !== null && t > 0);
      const minTotal = validTotals.length > 0 ? Math.min(...validTotals) : null;

      const row = worksheet.addRow([
        `${lot.code || ''} ${lot.name}`.trim(),
        moeTotal,
        ...companyTotals,
        minTotal
      ]);

      // Format monétaire
      for (let col = 2; col <= 2 + companies.length; col++) {
        row.getCell(col).numFmt = '#,##0.00 €';
      }
      row.getCell(2 + companies.length + 1).numFmt = '#,##0.00 €';

      // Surligner le moins-disant
      if (minTotal !== null) {
        companyTotals.forEach((total, idx) => {
          if (total === minTotal) {
            row.getCell(3 + idx).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFD4EDDA' }
            };
            row.getCell(3 + idx).font = { bold: true };
          }
        });
      }
    }

    // Ligne de totaux généraux
    worksheet.addRow([]);
    const totalRow = worksheet.addRow(['TOTAL GÉNÉRAL']);
    totalRow.font = { bold: true, size: 12 };
    totalRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F3F3' }
    };

    // Calculer les totaux
    let moeGrandTotal = 0;
    const companyGrandTotals = companies.map(() => 0);

    for (const lot of lots) {
      const items = lotData[lot.id] || [];
      for (const item of items) {
        const amount = parseFloat(item.moe_amount);
        if (Number.isFinite(amount)) moeGrandTotal += amount;

        companies.forEach((company, idx) => {
          const offer = item.offers[company.id];
          if (offer) {
            const offerQty = parseFloat(offer.qty) || 0;
            const offerPu = parseFloat(offer.pu) || 0;
            companyGrandTotals[idx] += offerQty * offerPu;
          }
        });
      }
      moeGrandTotal += optionTotals.moeByLot.get(Number(lot.id)) || 0;
      companies.forEach((company, idx) => {
        companyGrandTotals[idx] += optionTotals.offersByLotRoundCompany.get(`${Number(lot.id)}:${Number(roundId)}:${Number(company.id)}`) || 0;
      });
    }

    totalRow.getCell(2).value = moeGrandTotal;
    totalRow.getCell(2).numFmt = '#,##0.00 €';

    companies.forEach((_, idx) => {
      totalRow.getCell(3 + idx).value = companyGrandTotals[idx];
      totalRow.getCell(3 + idx).numFmt = '#,##0.00 €';
    });

    const validGrandTotals = companyGrandTotals.filter(t => t > 0);
    const minGrandTotal = validGrandTotals.length > 0 ? Math.min(...validGrandTotals) : null;
    totalRow.getCell(3 + companies.length).value = minGrandTotal;
    totalRow.getCell(3 + companies.length).numFmt = '#,##0.00 €';

    // Ajuster les largeurs de colonnes
    worksheet.getColumn(1).width = 30;
    for (let i = 2; i <= 2 + companies.length + 1; i++) {
      worksheet.getColumn(i).width = 15;
    }

    // Bordures: appliquer sur toutes les cellules, y compris vides
    const headerCols = headerRow.cellCount; // nombre de colonnes de la table
    const lastRow = worksheet.lastRow.number;
    for (let r = 3; r <= lastRow; r++) { // à partir de la ligne d'en-tête
      for (let c = 1; c <= headerCols; c++) {
        const cell = worksheet.getCell(r, c);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      }
    }

    // Générer le fichier
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `Recap_${round.project_name.replace(/[^a-zA-Z0-9]/g, '_')}_Tour${round.round_number}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);

  } catch (err) {
    console.error('Export summary error:', err);
    res.status(500).json({ error: 'Erreur lors de l\'export' });
  }
}
router.get('/summary/:roundId', handleSummaryExport);
router.post('/summary/:roundId', handleSummaryExport);

function cloneExcelStyle(style) {
  return style ? JSON.parse(JSON.stringify(style)) : {};
}

function copyExcelRowStyle(sourceRow, targetRow, lastCol) {
  targetRow.height = sourceRow.height;
  targetRow.style = cloneExcelStyle(sourceRow.style);
  for (let c = 1; c <= lastCol; c += 1) {
    targetRow.getCell(c).style = cloneExcelStyle(sourceRow.getCell(c).style);
  }
}

function getRoundComparisonAmount(offersByLotRoundCompany, lotId, roundId, companyId) {
  if (!lotId || !roundId || !companyId) return null;
  const value = offersByLotRoundCompany.get(`${lotId}:${roundId}:${companyId}`);
  return value === undefined ? null : value;
}

function getSelectedRoundsForComparison(rounds, roundFromId, roundToId) {
  const selectedTo = rounds.find(r => Number(r.id) === Number(roundToId)) || rounds[rounds.length - 1] || null;
  const toIndex = selectedTo ? rounds.findIndex(r => Number(r.id) === Number(selectedTo.id)) : -1;
  const fallbackFrom = toIndex > 0 ? rounds[toIndex - 1] : rounds[0] || null;
  const selectedFrom = rounds.find(r => Number(r.id) === Number(roundFromId)) || fallbackFrom;
  return { selectedFrom, selectedTo };
}

function getRoundExportLabel(round, fallback = '') {
  if (!round) return fallback;
  const number = round.round_number ?? '';
  const name = round.name ? ` - ${round.name}` : '';
  return `Tour ${number}${name}`.trim();
}

async function buildRoundsComparisonWorkbook({
  project,
  rounds,
  lots,
  moeTotals,
  offersByLotRoundCompany,
  companiesByLot,
  bestPriceByLotRound,
  roundFromId,
  roundToId,
  isEntreprise
}) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(ROUNDS_COMPARISON_TEMPLATE);
    clearWorkbookDefinedNames(workbook);
    for (const sheet of [...workbook.worksheets]) {
      if (sheet.name !== 'RECAP') workbook.removeWorksheet(sheet.id);
    }
  } catch (err) {
    console.warn('Template récapitulatif introuvable, génération depuis un classeur vierge:', err.message);
  }

  workbook.creator = 'AO Link';
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const ws = workbook.getWorksheet('RECAP') || workbook.addWorksheet('RECAP');
  unmergeAllCells(ws);
  clearWorksheetDrawings(ws);
  clearWorksheetValues(ws);

  const { selectedFrom, selectedTo } = getSelectedRoundsForComparison(rounds, roundFromId, roundToId);
  const fromId = selectedFrom?.id || null;
  const toId = selectedTo?.id || null;
  const lastCol = 17; // A:Q, structure du modele AFFAIRE_TAO_RECAPITULATIF
  const dataStartRow = 14;
  const templateDataRow = ws.getRow(14);
  const templateTotalRow = ws.getRow(37);
  const generatedRows = [];
  const lotSpans = [];
  const lotTotals = [];

  for (const lot of lots) {
    const companiesMap = companiesByLot.get(lot.id) || new Map();
    const companies = Array.from(companiesMap.entries())
      .map(([id, name]) => ({ id: Number(id), name }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'));
    const rows = companies.length ? companies : [{ id: null, name: '' }];
    const moeTotal = isEntreprise ? null : (moeTotals.get(lot.id) || 0);
    const bestFrom = fromId ? (bestPriceByLotRound.get(`${lot.id}:${fromId}`) ?? null) : null;
    const bestTo = toId ? (bestPriceByLotRound.get(`${lot.id}:${toId}`) ?? null) : null;
    const ranking = rows
      .map(company => ({
        id: company.id,
        amount: getRoundComparisonAmount(offersByLotRoundCompany, lot.id, toId, company.id)
      }))
      .filter(entry => entry.id && Number.isFinite(entry.amount) && entry.amount > 0)
      .sort((a, b) => a.amount - b.amount);
    const rankByCompany = new Map(ranking.map((entry, index) => [entry.id, index + 1]));
    const spanStart = dataStartRow + generatedRows.length;

    for (const company of rows) {
      const fromAmount = getRoundComparisonAmount(offersByLotRoundCompany, lot.id, fromId, company.id);
      const toAmount = getRoundComparisonAmount(offersByLotRoundCompany, lot.id, toId, company.id);
      generatedRows.push({
        lot,
        company,
        moeTotal,
        fromAmount,
        toAmount,
        rank: rankByCompany.get(company.id) || null,
        isBest: bestTo !== null && toAmount !== null && Math.abs(toAmount - bestTo) < 0.01
      });
    }

    lotSpans.push({ start: spanStart, end: dataStartRow + generatedRows.length - 1 });
    lotTotals.push({ lot, moeTotal, bestFrom, bestTo });
  }

  const safeRowsCount = Math.max(generatedRows.length, 1);
  const lastDataRow = dataStartRow + safeRowsCount - 1;
  const blankRowNumber = lastDataRow + 1;
  const totalRowNumber = lastDataRow + 2;
  const deltaRowNumber = totalRowNumber + 1;
  const percentRowNumber = totalRowNumber + 2;

  if (ws.columnCount > lastCol) {
    ws.spliceColumns(lastCol + 1, ws.columnCount - lastCol);
  }

  for (let r = dataStartRow; r <= percentRowNumber; r += 1) {
    copyExcelRowStyle(r === totalRowNumber ? templateTotalRow : templateDataRow, ws.getRow(r), lastCol);
  }

  ws.views = [{ state: 'frozen', xSplit: 5, ySplit: 13, topLeftCell: 'F14', zoomScale: 85 }];
  ws.pageSetup = {
    paperSize: 8,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    verticalCentered: true,
    printTitlesRow: '12:13'
  };
  ws.pageSetup.printArea = `A1:Q${percentRowNumber}`;

  const today = new Date();
  ws.getCell('A1').value = 'AFFAIRE';
  ws.getCell('A2').value = project.name || project.reference || '';
  ws.getCell('A3').value = project.client || project.owner_name || 'MO';
  ws.getCell('A4').value = 'INDICE : V0';
  ws.getCell('A5').value = `PHASE D'ETUDE : ${project.study_phase || 'ACT'}`;
  ws.getCell('A6').value = today;
  ws.getCell('A6').numFmt = 'dd/mm/yyyy';
  ws.getCell('A8').value = 'TABLEAU COMPARATIF DES OFFRES TCE';
  ws.getCell('F10').value = selectedFrom?.round_number || '';
  ws.getCell('G10').value = getRoundExportLabel(selectedFrom, 'Tour de reference');
  ws.getCell('L8').value = 'Erreur entreprise';
  ws.getCell('L9').value = 'Montant fort';
  ws.getCell('L10').value = 'Montant faible';

  ws.mergeCells('C12:E12');
  ws.mergeCells('F12:L12');
  ws.mergeCells('M12:Q12');
  ws.getCell('C12').value = 'MOE';
  ws.getCell('F12').value = `ENTREPRISES - ${getRoundExportLabel(selectedTo, 'Tour selectionne')}`;
  ws.getCell('M12').value = 'ANALYSE';

  const headers = [
    'NUM',
    'LISTE DES LOTS',
    'Tranche ferme',
    'Variante',
    'Tranche ferme',
    'Classement',
    'ENTREPRISES',
    'Tranche ferme',
    'Poste ajoutes par l\'entreprise',
    'Variante',
    `Prix ${getRoundExportLabel(selectedFrom, 'reference')}`,
    `Tranche ferme ${getRoundExportLabel(selectedTo, '')}`.trim(),
    'Ecart reference / tour',
    'Ecarts MOE (€)',
    'Ecarts MOE (%)',
    'MOINS DISANT',
    'MIEUX DISANT'
  ];
  headers.forEach((label, index) => {
    const cell = ws.getCell(13, index + 1);
    cell.value = label;
    cell.alignment = { ...(cell.alignment || {}), horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  for (let r = 12; r <= 13; r += 1) {
    for (let c = 1; c <= lastCol; c += 1) {
      const cell = ws.getCell(r, c);
      cell.font = { ...(cell.font || {}), bold: true };
      applyBorder(cell);
    }
  }

  const rowsToWrite = generatedRows.length ? generatedRows : [{
    lot: {},
    company: {},
    moeTotal: null,
    fromAmount: null,
    toAmount: null,
    rank: null,
    isBest: false
  }];
  const percentBarRefs = [];

  rowsToWrite.forEach((entry, index) => {
    const rowNumber = dataStartRow + index;
    const row = ws.getRow(rowNumber);
    const moeTotal = entry.moeTotal;
    const fromAmount = entry.fromAmount;
    const toAmount = entry.toAmount;
    const ecartReference = toAmount !== null && fromAmount !== null ? toAmount - fromAmount : null;
    const ecartMoe = !isEntreprise && toAmount !== null && moeTotal !== null ? toAmount - moeTotal : null;
    const ecartMoePct = !isEntreprise && ecartMoe !== null && moeTotal ? ecartMoe / moeTotal : null;

    row.getCell(1).value = entry.lot?.code || '';
    row.getCell(2).value = entry.lot?.name || '';
    row.getCell(3).value = moeTotal;
    row.getCell(4).value = null;
    row.getCell(5).value = moeTotal;
    row.getCell(6).value = entry.rank;
    row.getCell(7).value = entry.company?.name || '';
    row.getCell(8).value = toAmount;
    row.getCell(9).value = null;
    row.getCell(10).value = null;
    row.getCell(11).value = fromAmount;
    row.getCell(12).value = toAmount;
    row.getCell(13).value = ecartReference;
    row.getCell(14).value = ecartMoe;
    row.getCell(15).value = ecartMoePct;
    if (ecartMoePct !== null) percentBarRefs.push(row.getCell(15).address);
    row.getCell(16).value = entry.isBest ? toAmount : null;
    row.getCell(17).value = null;

    for (let c = 1; c <= lastCol; c += 1) {
      const cell = row.getCell(c);
      cell.alignment = { ...(cell.alignment || {}), vertical: 'middle', wrapText: c === 2 || c === 7 };
      applyBorder(cell);
    }
    [3, 5, 8, 11, 12, 13, 14, 16, 17].forEach(col => {
      row.getCell(col).numFmt = EXPORT_CURRENCY_FMT;
    });
    row.getCell(15).numFmt = EXPORT_PERCENT_FMT;
    if (entry.isBest) {
      [6, 7, 8, 12, 16].forEach(col => {
        row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } };
        row.getCell(col).font = { ...(row.getCell(col).font || {}), bold: true };
      });
    }
  });

  for (const span of lotSpans) {
    if (span.end <= span.start) continue;
    [1, 2, 3, 4, 5].forEach(col => {
      try { ws.mergeCells(span.start, col, span.end, col); } catch (_) {}
      ws.getCell(span.start, col).alignment = { ...(ws.getCell(span.start, col).alignment || {}), vertical: 'middle', wrapText: true };
    });
  }

  const blankRow = ws.getRow(blankRowNumber);
  for (let c = 1; c <= lastCol; c += 1) {
    blankRow.getCell(c).value = null;
    blankRow.getCell(c).border = {};
  }

  const totalMoe = lotTotals.reduce((sum, item) => sum + (Number(item.moeTotal) || 0), 0);
  const totalFrom = lotTotals.reduce((sum, item) => sum + (Number(item.bestFrom) || 0), 0);
  const totalTo = lotTotals.reduce((sum, item) => sum + (Number(item.bestTo) || 0), 0);
  const totalDeltaReference = totalTo - totalFrom;
  const totalDeltaMoe = isEntreprise ? null : totalTo - totalMoe;
  const totalDeltaMoePct = !isEntreprise && totalMoe ? totalDeltaMoe / totalMoe : null;

  const totalRow = ws.getRow(totalRowNumber);
  totalRow.getCell(2).value = 'TOTAL HT';
  totalRow.getCell(3).value = isEntreprise ? null : totalMoe;
  totalRow.getCell(5).value = isEntreprise ? null : totalMoe;
  totalRow.getCell(11).value = totalFrom || null;
  totalRow.getCell(12).value = totalTo || null;
  totalRow.getCell(13).value = totalDeltaReference;
  totalRow.getCell(14).value = totalDeltaMoe;
  totalRow.getCell(15).value = totalDeltaMoePct;
  if (totalDeltaMoePct !== null) percentBarRefs.push(totalRow.getCell(15).address);
  totalRow.getCell(16).value = totalTo || null;
  totalRow.font = { ...(totalRow.font || {}), bold: true };
  for (let c = 1; c <= lastCol; c += 1) {
    applyBorder(totalRow.getCell(c), { top: { style: 'double' }, bottom: { style: 'double' } });
  }
  [3, 5, 8, 11, 12, 13, 14, 16, 17].forEach(col => {
    totalRow.getCell(col).numFmt = EXPORT_CURRENCY_FMT;
  });
  totalRow.getCell(15).numFmt = EXPORT_PERCENT_FMT;

  const deltaRow = ws.getRow(deltaRowNumber);
  deltaRow.getCell(16).value = !isEntreprise ? totalTo - totalMoe : null;
  deltaRow.getCell(17).value = null;
  deltaRow.getCell(16).numFmt = EXPORT_CURRENCY_FMT;
  deltaRow.getCell(17).numFmt = EXPORT_CURRENCY_FMT;

  const percentRow = ws.getRow(percentRowNumber);
  percentRow.getCell(16).value = !isEntreprise && totalMoe ? (totalTo - totalMoe) / totalMoe : null;
  percentRow.getCell(17).value = null;
  percentRow.getCell(16).numFmt = EXPORT_PERCENT_FMT;
  percentRow.getCell(17).numFmt = EXPORT_PERCENT_FMT;
  if (percentRow.getCell(16).value !== null) percentBarRefs.push(percentRow.getCell(16).address);

  const dataSheet = workbook.getWorksheet('Feuille Donnee') || workbook.getWorksheet('Feuille Donnée');
  if (dataSheet) {
    dataSheet.getCell('C3').value = today;
    dataSheet.getCell('C3').numFmt = 'dd/mm/yyyy';
    dataSheet.getCell('D3').value = project.study_phase || 'ACT';
    dataSheet.getCell('E3').value = project.client || '';
    dataSheet.getCell('F3').value = project.owner_name || '';
    dataSheet.getCell('G3').value = project.reference || project.name || '';
    dataSheet.getCell('H3').value = 'RECAPITULATIF';
    dataSheet.getCell('I3').value = project.name || '';
    dataSheet.getCell('J3').value = 'V0';
  }

  for (let c = 1; c <= lastCol; c += 1) {
    ws.getColumn(c).hidden = false;
  }
  addDivergingPercentDataBars(ws, percentBarRefs, 1);
  trimWorksheetAfterColumn(ws, lastCol);
  if (ws.rowCount > percentRowNumber) {
    ws.spliceRows(percentRowNumber + 1, ws.rowCount - percentRowNumber);
  }

  return workbook;
}

// Export Excel de la comparaison des tours
async function handleRoundsComparison(req, res) {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;
    const isEntreprise = req.user?.role === 'entreprise';
    const companyId = req.user?.company_id;
    const roundFromId = Number(req.query.round_from || req.query.roundFromId || req.query.from);
    const roundToId = Number(req.query.round_to || req.query.roundToId || req.query.to);
    const selectedOptionIds = parseSelectedOptionIds(req);
    const showAnalysis = Number.isFinite(roundFromId) && Number.isFinite(roundToId) && roundFromId !== roundToId;

    // Vérifier l'accès au projet
    const projectRes = await query(
      `SELECT p.*, 
         (p.owner_id = $2 OR EXISTS(SELECT 1 FROM project_shares WHERE project_id = p.id AND shared_with_user_id = $2) OR $3 IN ('admin', 'responsable')) as has_access
       FROM projects p
       WHERE p.id = $1`,
      [projectId, userId, req.user.role]
    );

    const canViewDemoProject = await canViewProject(userId, projectId, req.user.role, req.user.company_id || null);
    if (projectRes.rowCount === 0 || !projectRes.rows[0].has_access || !canViewDemoProject) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    const project = projectRes.rows[0];

    // Récupérer tous les tours du projet
    const roundsRes = await query(
      `SELECT id, round_number, name FROM rounds WHERE project_id = $1 ORDER BY round_number`,
      [projectId]
    );
    const rounds = roundsRes.rows;

    if (rounds.length === 0) {
      return res.status(404).json({ error: 'Aucun tour trouvé' });
    }

    // Récupérer les lots (tri numérique par code)
    const lotsRes = await query(
      `SELECT id, code, name, sort_order,
              ROW_NUMBER() OVER (ORDER BY sort_order ASC, id ASC) AS lot_order
       FROM lots
       WHERE project_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [projectId]
    );
    const lots = lotsRes.rows;

    // Totaux MOE par lot (non entreprise seulement)
    const moeTotals = new Map();
    if (!isEntreprise) {
      const moeRes = await query(
        `SELECT i.lot_id, COALESCE(SUM(m.amount), 0) as total
         FROM items i
         LEFT JOIN moe_items m ON m.item_id = i.id
         JOIN lots l ON l.id = i.lot_id
         WHERE l.project_id = $1
         GROUP BY i.lot_id`,
        [projectId]
      );
      for (const row of moeRes.rows) {
        moeTotals.set(row.lot_id, parseFloat(row.total) || 0);
      }
    }

    // Offres par lot / tour / entreprise
    const offersParams = [projectId];
    let offersWhere = '';
    if (isEntreprise && companyId) {
      offersParams.push(companyId);
      offersWhere = 'AND o.company_id = $2';
    }
    const offersRes = await query(
      `SELECT i.lot_id, o.round_id, o.company_id,
              COALESCE(NULLIF(lc.display_name, ''), c.name) as company_name,
              COALESCE(SUM(o.qty * o.unit_price), 0) as total
       FROM offers o
       JOIN items i ON i.id = o.item_id
       JOIN rounds r ON r.id = o.round_id
       JOIN companies c ON c.id = o.company_id
       JOIN lot_companies lc ON lc.company_id = o.company_id AND lc.lot_id = i.lot_id
       WHERE r.project_id = $1
       ${offersWhere}
       GROUP BY i.lot_id, o.round_id, o.company_id, lc.display_name, c.name`,
      offersParams
    );

    const offersByLotRoundCompany = new Map();
    const companiesByLot = new Map();
    const bestPriceByLotRound = new Map();

    for (const row of offersRes.rows) {
      const lotId = row.lot_id;
      const roundId = row.round_id;
      const compId = row.company_id;
      const total = parseFloat(row.total) || 0;
      const key = `${lotId}:${roundId}:${compId}`;
      const roundKey = `${lotId}:${roundId}`;

      offersByLotRoundCompany.set(key, total);

      if (!companiesByLot.has(lotId)) {
        companiesByLot.set(lotId, new Map());
      }
      companiesByLot.get(lotId).set(compId, row.company_name);

      const best = bestPriceByLotRound.get(roundKey);
      if (best === undefined || total < best) {
        bestPriceByLotRound.set(roundKey, total);
      }
    }

    const optionTotals = await fetchSelectedOptionTotals({
      projectId,
      lotIds: lots.map(l => Number(l.id)).filter(Number.isFinite),
      roundIds: rounds.map(r => Number(r.id)).filter(Number.isFinite),
      selectedOptionIds,
      isEntreprise,
      companyId,
      includeMoe: true
    });
    if (!isEntreprise) {
      for (const [lotId, total] of optionTotals.moeByLot.entries()) {
        moeTotals.set(lotId, (moeTotals.get(lotId) || 0) + total);
      }
    }
    for (const [key, total] of optionTotals.offersByLotRoundCompany.entries()) {
      offersByLotRoundCompany.set(key, (offersByLotRoundCompany.get(key) || 0) + total);
    }
    for (const [lotId, companyMap] of optionTotals.companiesByLot.entries()) {
      if (!companiesByLot.has(lotId)) companiesByLot.set(lotId, new Map());
      for (const [compId, name] of companyMap.entries()) {
        companiesByLot.get(lotId).set(compId, name);
      }
    }
    bestPriceByLotRound.clear();
    for (const [key, total] of offersByLotRoundCompany.entries()) {
      const [lotId, roundId] = key.split(':');
      const roundKey = `${lotId}:${roundId}`;
      const best = bestPriceByLotRound.get(roundKey);
      if (best === undefined || total < best) {
        bestPriceByLotRound.set(roundKey, total);
      }
    }

    // Récupérer toutes les entreprises assignées aux lots (y compris sans offres)
    const lotCompaniesParams = [projectId];
    let lcWhere = '';
    if (isEntreprise && companyId) {
      lotCompaniesParams.push(companyId);
      lcWhere = 'AND c.id = $2';
    }
    const lotCompaniesRes = await query(
      `SELECT lc.lot_id, c.id as company_id, COALESCE(NULLIF(lc.display_name, ''), c.name) as company_name
       FROM lot_companies lc
       JOIN companies c ON c.id = lc.company_id
       JOIN lots l ON l.id = lc.lot_id
       WHERE l.project_id = $1 ${lcWhere}
       ORDER BY company_name`,
      lotCompaniesParams
    );
    for (const row of lotCompaniesRes.rows) {
      if (!companiesByLot.has(row.lot_id)) {
        companiesByLot.set(row.lot_id, new Map());
      }
      if (!companiesByLot.get(row.lot_id).has(row.company_id)) {
        companiesByLot.get(row.lot_id).set(row.company_id, row.company_name);
      }
    }

    const workbook = await buildRoundsComparisonWorkbook({
      project,
      rounds,
      lots,
      moeTotals,
      offersByLotRoundCompany,
      companiesByLot,
      bestPriceByLotRound,
      roundFromId,
      roundToId,
      isEntreprise
    });
    const currencyFmt = EXPORT_CURRENCY_FMT;

    /*

    // Titre
    worksheet.mergeCells(1, 1, 1, totalCols);
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `Comparaison des Tours - ${project.name}`;
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 30;

    worksheet.addRow([]);

    // En-têtes (2 lignes, comme l'interface)
    const headerRow1 = worksheet.addRow([]);
    const headerRow2 = worksheet.addRow([]);
    headerRow1.height = 30;
    headerRow2.height = 30;

    let col = 1;
    worksheet.mergeCells(headerRow1.number, col, headerRow2.number, col);
    headerRow1.getCell(col).value = 'Lot';
    col += 1;

    if (!isEntreprise) {
      worksheet.mergeCells(headerRow1.number, col, headerRow2.number, col);
      headerRow1.getCell(col).value = 'MOE (€)';
      col += 1;
    }

    for (const round of rounds) {
      const startCol = col;
      const endCol = col + perRoundCols - 1;
      worksheet.mergeCells(headerRow1.number, startCol, headerRow1.number, endCol);
      headerRow1.getCell(startCol).value = `Tour ${round.round_number}${round.name ? ` - ${round.name}` : ''}`;

      headerRow2.getCell(col).value = 'Montant (€)';
      if (!isEntreprise) {
        headerRow2.getCell(col + 1).value = 'Ecart (€)';
        headerRow2.getCell(col + 2).value = 'Ecart (%)';
      }
      col += perRoundCols;
    }

    if (showAnalysis) {
      const startCol = col;
      const endCol = col + 2;
      worksheet.mergeCells(headerRow1.number, startCol, headerRow1.number, endCol);
      headerRow1.getCell(startCol).value = 'Analyse';
      headerRow2.getCell(col).value = 'Delta Montant';
      headerRow2.getCell(col + 1).value = 'Delta %';
      headerRow2.getCell(col + 2).value = 'Tendance';
    }

    for (let c = 1; c <= totalCols; c++) {
      const cell1 = headerRow1.getCell(c);
      const cell2 = headerRow2.getCell(c);
      [cell1, cell2].forEach(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' }
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      });
    }

    let totalMoe = 0;
    const totalsByRound = {};
    rounds.forEach(r => { totalsByRound[r.id] = 0; });

    for (const lot of lots) {
      const lotLabel = `${lot.code || ''} ${lot.name}`.trim();
      const moeTotal = moeTotals.get(lot.id) || 0;

      const lotRow = worksheet.addRow([]);
      lotRow.getCell(1).value = lotLabel;
      lotRow.font = { bold: true };
      lotRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F3F3' } };

      let currentCol = 2;
      if (!isEntreprise) {
        lotRow.getCell(currentCol).value = moeTotal;
        lotRow.getCell(currentCol).numFmt = currencyFmt;
        totalMoe += moeTotal;
        currentCol += 1;
      }

      for (const round of rounds) {
        const roundKey = `${lot.id}:${round.id}`;
        const bestPrice = bestPriceByLotRound.get(roundKey);
        if (bestPrice !== undefined) {
          lotRow.getCell(currentCol).value = bestPrice;
          lotRow.getCell(currentCol).numFmt = currencyFmt;
          totalsByRound[round.id] += bestPrice;
        }
        currentCol += 1;

        if (!isEntreprise) {
          if (bestPrice !== undefined) {
            const ecart = bestPrice - moeTotal;
            lotRow.getCell(currentCol).value = ecart;
            lotRow.getCell(currentCol).numFmt = deltaCurrencyFmt;
            currentCol += 1;

            const pct = moeTotal > 0 ? ecart / moeTotal : 0;
            lotRow.getCell(currentCol).value = pct;
            lotRow.getCell(currentCol).numFmt = deltaPercentFmt;
            currentCol += 1;
          } else {
            currentCol += 2;
          }
        }
      }

      if (showAnalysis) {
        const fromTotal = bestPriceByLotRound.get(`${lot.id}:${roundFromId}`) || 0;
        const toTotal = bestPriceByLotRound.get(`${lot.id}:${roundToId}`) || 0;
        const delta = toTotal - fromTotal;
        const deltaPct = fromTotal > 0 ? delta / fromTotal : 0;
        lotRow.getCell(currentCol).value = delta;
        lotRow.getCell(currentCol).numFmt = deltaCurrencyFmt;
        lotRow.getCell(currentCol + 1).value = deltaPct;
        lotRow.getCell(currentCol + 1).numFmt = deltaPercentFmt;
        lotRow.getCell(currentCol + 2).value = delta < 0 ? 'DOWN' : (delta > 0 ? 'UP' : 'SAME');
      }

      const companiesMap = companiesByLot.get(lot.id) || new Map();
      const companies = Array.from(companiesMap.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

      for (const company of companies) {
        const companyRow = worksheet.addRow([]);
        companyRow.getCell(1).value = company.name;
        companyRow.getCell(1).alignment = { indent: 1 };

        let cCol = 2;
        if (!isEntreprise) {
          companyRow.getCell(cCol).value = '-';
          cCol += 1;
        }

        for (const round of rounds) {
          const amount = offersByLotRoundCompany.get(`${lot.id}:${round.id}:${company.id}`) || 0;
          companyRow.getCell(cCol).value = amount;
          companyRow.getCell(cCol).numFmt = currencyFmt;
          cCol += 1;

          if (!isEntreprise) {
            const ecart = amount - moeTotal;
            companyRow.getCell(cCol).value = ecart;
            companyRow.getCell(cCol).numFmt = deltaCurrencyFmt;
            cCol += 1;

            const pct = moeTotal > 0 ? ecart / moeTotal : 0;
            companyRow.getCell(cCol).value = pct;
            companyRow.getCell(cCol).numFmt = deltaPercentFmt;
            cCol += 1;
          }
        }

        if (showAnalysis) {
          const fromAmount = offersByLotRoundCompany.get(`${lot.id}:${roundFromId}:${company.id}`) || 0;
          const toAmount = offersByLotRoundCompany.get(`${lot.id}:${roundToId}:${company.id}`) || 0;
          const delta = toAmount - fromAmount;
          const deltaPct = fromAmount > 0 ? delta / fromAmount : 0;
          companyRow.getCell(cCol).value = delta;
          companyRow.getCell(cCol).numFmt = deltaCurrencyFmt;
          companyRow.getCell(cCol + 1).value = deltaPct;
          companyRow.getCell(cCol + 1).numFmt = deltaPercentFmt;
          companyRow.getCell(cCol + 2).value = delta < 0 ? 'DOWN' : (delta > 0 ? 'UP' : 'SAME');
        }
      }
    }

    // Totaux
    worksheet.addRow([]);
    const totalRow = worksheet.addRow([]);
    totalRow.getCell(1).value = 'TOTAL GENERAL';
    totalRow.font = { bold: true, size: 12 };
    totalRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F3F3' }
    };

    let tCol = 2;
    if (!isEntreprise) {
      totalRow.getCell(tCol).value = totalMoe;
      totalRow.getCell(tCol).numFmt = currencyFmt;
      tCol += 1;
    }

    for (const round of rounds) {
      const total = totalsByRound[round.id] || 0;
      totalRow.getCell(tCol).value = total;
      totalRow.getCell(tCol).numFmt = currencyFmt;
      tCol += 1;

      if (!isEntreprise) {
        const ecart = total - totalMoe;
        totalRow.getCell(tCol).value = ecart;
        totalRow.getCell(tCol).numFmt = deltaCurrencyFmt;
        tCol += 1;

        const pct = totalMoe > 0 ? ecart / totalMoe : 0;
        totalRow.getCell(tCol).value = pct;
        totalRow.getCell(tCol).numFmt = deltaPercentFmt;
        tCol += 1;
      }
    }

    if (showAnalysis) {
      const fromTotal = totalsByRound[roundFromId] || 0;
      const toTotal = totalsByRound[roundToId] || 0;
      const delta = toTotal - fromTotal;
      const deltaPct = fromTotal > 0 ? delta / fromTotal : 0;
      totalRow.getCell(tCol).value = delta;
      totalRow.getCell(tCol).numFmt = deltaCurrencyFmt;
      totalRow.getCell(tCol + 1).value = deltaPct;
      totalRow.getCell(tCol + 1).numFmt = deltaPercentFmt;
      totalRow.getCell(tCol + 2).value = delta < 0 ? 'DOWN' : (delta > 0 ? 'UP' : 'SAME');
    }

    // Ajuster largeurs
    worksheet.getColumn(1).width = 30;
    for (let i = 2; i <= totalCols; i++) {
      worksheet.getColumn(i).width = 16;
    }

    // Bordures: appliquer sur toutes les cellules, y compris vides
    const lastRow2 = worksheet.lastRow.number;
    for (let r = headerRow1.number; r <= lastRow2; r++) {
      for (let c = 1; c <= totalCols; c++) {
        const cell = worksheet.getCell(r, c);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      }
    }

    */

    // --- Onglet Simulation (si données fournies en POST) ---
    const simulationData = Array.isArray(req.body?.simulations)
      ? req.body.simulations.filter(sim => sim && typeof sim === 'object')
      : [];
    const simulationRoundId = Number(req.body?.simulationRoundId);
    if (simulationData.length > 0 && Number.isFinite(simulationRoundId)) {
      // Calculer les totaux d'offres par lot/entreprise pour le tour de simulation
      const simOffersRes = await query(
        `SELECT i.lot_id, o.company_id,
                COALESCE(NULLIF(lc.display_name, ''), c.name) as company_name,
                COALESCE(SUM(o.qty * o.unit_price), 0) as total
         FROM offers o
         JOIN items i ON i.id = o.item_id
         JOIN companies c ON c.id = o.company_id
         JOIN lot_companies lc ON lc.company_id = o.company_id AND lc.lot_id = i.lot_id
         WHERE o.round_id = $1 AND i.lot_id = ANY($2::int[])
         GROUP BY i.lot_id, o.company_id, lc.display_name, c.name`,
        [simulationRoundId, lots.map(l => l.id)]
      );

      const simOffersByLotCompany = new Map();
      const allCompanyNames = new Map();
      for (const row of simOffersRes.rows) {
        const key = `${row.lot_id}:${row.company_id}`;
        simOffersByLotCompany.set(key, parseFloat(row.total) || 0);
        allCompanyNames.set(key, row.company_name);
        allCompanyNames.set(Number(row.company_id), row.company_name);
      }

      // Calculer les totaux des options sélectionnées par lot/entreprise
      const optionTotalsByLotCompany = new Map();
      if (selectedOptionIds.length > 0) {
        const optRes = await query(
          `SELECT o.lot_id, oio.company_id, SUM(oio.qty * oio.unit_price) as total
           FROM option_item_offers oio
           JOIN option_items oi ON oi.id = oio.option_item_id
           JOIN options o ON o.id = oi.option_id
           WHERE oio.round_id = $1 AND o.id = ANY($2::int[])
           GROUP BY o.lot_id, oio.company_id`,
          [simulationRoundId, selectedOptionIds]
        );
        for (const row of optRes.rows) {
          const key = `${row.lot_id}:${row.company_id}`;
          optionTotalsByLotCompany.set(key, (optionTotalsByLotCompany.get(key) || 0) + (parseFloat(row.total) || 0));
        }
      }

      // Fonction pour obtenir le total d'une entreprise sur un lot (offres + options)
      function getCompanyLotTotal(lotId, compId) {
        const base = simOffersByLotCompany.get(`${lotId}:${compId}`) || 0;
        const opt = optionTotalsByLotCompany.get(`${lotId}:${compId}`) || 0;
        return base + opt;
      }

      const existingSimulationSheet = workbook.getWorksheet('Simulation');
      if (existingSimulationSheet) workbook.removeWorksheet(existingSimulationSheet.id);
      const simSheet = workbook.addWorksheet('Simulation');
      const simPerCol = isEntreprise ? 1 : 2;
      const simTotalCols = 1 + (isEntreprise ? 0 : 1) + (simulationData.length * simPerCol);

      // Titre
      simSheet.mergeCells(1, 1, 1, simTotalCols);
      const simTitleCell = simSheet.getCell('A1');
      simTitleCell.value = `Simulation - ${project.name}`;
      simTitleCell.font = { size: 16, bold: true };
      simTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      simSheet.getRow(1).height = 30;
      simSheet.addRow([]);

      // En-têtes (2 lignes)
      const simHeaderRow1 = simSheet.addRow([]);
      const simHeaderRow2 = simSheet.addRow([]);
      simHeaderRow1.height = 30;
      simHeaderRow2.height = 30;

      let sCol = 1;
      simSheet.mergeCells(simHeaderRow1.number, sCol, simHeaderRow2.number, sCol);
      simHeaderRow1.getCell(sCol).value = 'Lot';
      sCol += 1;

      if (!isEntreprise) {
        simSheet.mergeCells(simHeaderRow1.number, sCol, simHeaderRow2.number, sCol);
        simHeaderRow1.getCell(sCol).value = 'MOE (€)';
        sCol += 1;
      }

      for (const sim of simulationData) {
        const startCol = sCol;
        const endCol = sCol + simPerCol - 1;
        simSheet.mergeCells(simHeaderRow1.number, startCol, simHeaderRow1.number, endCol);
        simHeaderRow1.getCell(startCol).value = sim.name || 'Simulation';
        simHeaderRow2.getCell(sCol).value = 'Montant (€)';
        if (!isEntreprise) {
          simHeaderRow2.getCell(sCol + 1).value = 'Entreprise';
        }
        sCol += simPerCol;
      }

      // Style des en-têtes
      for (let c = 1; c <= simTotalCols; c++) {
        [simHeaderRow1.getCell(c), simHeaderRow2.getCell(c)].forEach(cell => {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        });
      }

      const simTotalBySim = simulationData.map(() => 0);

      for (const lot of lots) {
        const lotLabel = `${lot.code || ''} ${lot.name}`.trim();
        const moeTotal = moeTotals.get(lot.id) || 0;
        const simRow = simSheet.addRow([]);
        simRow.getCell(1).value = lotLabel;

        let cIdx = 2;
        if (!isEntreprise) {
          simRow.getCell(cIdx).value = moeTotal;
          simRow.getCell(cIdx).numFmt = currencyFmt;
          cIdx += 1;
        }

        simulationData.forEach((sim, simIdx) => {
          const selections = sim.selections || {};
          const lotIdStr = String(lot.id);
          const hasExplicit = lotIdStr in selections;
          const selectedValue = hasExplicit ? selections[lotIdStr] : sim.defaultCompanyId;
          const selectedCompanyId = (selectedValue === 0 || selectedValue === null || selectedValue === undefined) ? null : Number(selectedValue);

          let amount = null;
          let companyName = 'MOE';

          if (selectedCompanyId) {
            const compTotal = getCompanyLotTotal(lot.id, selectedCompanyId);
            if (compTotal > 0) {
              amount = compTotal;
              companyName = allCompanyNames.get(`${lot.id}:${selectedCompanyId}`) || allCompanyNames.get(selectedCompanyId) || `Entreprise ${selectedCompanyId}`;
            } else {
              amount = moeTotal > 0 ? moeTotal : null;
              companyName = 'MOE (pas d\'offre)';
            }
          } else {
            amount = moeTotal > 0 ? moeTotal : null;
            companyName = 'MOE';
          }

          simRow.getCell(cIdx).value = amount;
          simRow.getCell(cIdx).numFmt = currencyFmt;
          if (!isEntreprise) {
            simRow.getCell(cIdx + 1).value = companyName;
          }
          cIdx += simPerCol;

          if (amount !== null) {
            simTotalBySim[simIdx] += amount;
          }
        });
      }

      // Ligne totaux
      simSheet.addRow([]);
      const simTotalRow = simSheet.addRow([]);
      simTotalRow.getCell(1).value = 'TOTAL';
      simTotalRow.font = { bold: true, size: 12 };
      simTotalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F3F3' } };

      let tIdx = 2;
      if (!isEntreprise) { tIdx += 1; }
      simulationData.forEach((sim, simIdx) => {
        simTotalRow.getCell(tIdx).value = simTotalBySim[simIdx];
        simTotalRow.getCell(tIdx).numFmt = currencyFmt;
        tIdx += simPerCol;
      });

      // Largeurs
      simSheet.getColumn(1).width = 30;
      for (let i = 2; i <= simTotalCols; i++) {
        simSheet.getColumn(i).width = 18;
      }

      // Bordures
      const simLastRow = simSheet.lastRow.number;
      for (let r = simHeaderRow1.number; r <= simLastRow; r++) {
        for (let c = 1; c <= simTotalCols; c++) {
          simSheet.getCell(r, c).border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `ComparaisonTours_${project.name.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);

  } catch (err) {
    console.error('Export rounds comparison error:', err);
    res.status(500).json({ error: 'Erreur lors de l\'export' });
  }
}
router.get('/rounds-comparison/:projectId', handleRoundsComparison);
router.post('/rounds-comparison/:projectId', handleRoundsComparison);

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDateFr(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('fr-FR');
}

function formatMoneyFr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function raoValue(value, placeholder) {
  const text = value === null || value === undefined || value === '' ? placeholder : value;
  return {
    text: String(text),
    placeholder: value === null || value === undefined || value === ''
  };
}

function wordRun(value, { bold = false, color = '000000', highlight = false } = {}) {
  const safe = typeof value === 'object' && value !== null ? value : { text: value, placeholder: false };
  const effectiveHighlight = highlight || safe.placeholder;
  return `<w:r><w:rPr>${bold ? '<w:b/>' : ''}<w:color w:val="${effectiveHighlight ? '9C6500' : color}"/>${effectiveHighlight ? '<w:highlight w:val="yellow"/>' : ''}</w:rPr><w:t xml:space="preserve">${xmlEscape(safe.text)}</w:t></w:r>`;
}

function wordParagraph(runs, { style = null, spacingAfter = 120 } = {}) {
  const body = Array.isArray(runs)
    ? runs.join('')
    : (typeof runs === 'string' && runs.trim().startsWith('<w:') ? runs : wordRun(runs));
  const pStyle = style ? `<w:pStyle w:val="${style}"/>` : '';
  return `<w:p><w:pPr>${pStyle}<w:spacing w:after="${spacingAfter}"/></w:pPr>${body}</w:p>`;
}

function wordCell(content, { header = false, placeholder = false } = {}) {
  const fill = header ? 'D9EAF7' : (placeholder ? 'FFF2CC' : 'FFFFFF');
  return `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/></w:tcPr>${content}</w:tc>`;
}

function wordTable(rows) {
  const border = '<w:top w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:left w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:right w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="808080"/>';
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${border}</w:tblBorders></w:tblPr>${rows.map(row => `<w:tr>${row.join('')}</w:tr>`).join('')}</w:tbl>`;
}

function wordSimpleCell(value, options = {}) {
  const safe = typeof value === 'object' && value !== null ? value : { text: value, placeholder: false };
  return wordCell(wordParagraph(wordRun(safe, { bold: options.header }), { spacingAfter: 0 }), {
    header: options.header,
    placeholder: safe.placeholder
  });
}

function appendWordSection(documentXml, sectionXml) {
  const bodyEnd = documentXml.lastIndexOf('</w:body>');
  if (bodyEnd === -1) return documentXml;

  const beforeBodyEnd = documentXml.slice(0, bodyEnd);
  const sectPrIndex = beforeBodyEnd.lastIndexOf('<w:sectPr');
  if (sectPrIndex === -1) {
    return `${beforeBodyEnd}${sectionXml}${documentXml.slice(bodyEnd)}`;
  }

  let paragraphStart = -1;
  const paragraphStartPattern = /<w:p(?:\s|>)/g;
  let match;
  while ((match = paragraphStartPattern.exec(beforeBodyEnd.slice(0, sectPrIndex))) !== null) {
    paragraphStart = match.index;
  }
  const previousParagraphEnd = beforeBodyEnd.lastIndexOf('</w:p>', sectPrIndex);
  const insertIndex = paragraphStart !== -1 && paragraphStart > previousParagraphEnd
    ? paragraphStart
    : sectPrIndex;
  return `${documentXml.slice(0, insertIndex)}${sectionXml}${documentXml.slice(insertIndex)}`;
}

function replaceTemplateText(documentXml, replacements) {
  let xml = documentXml;
  for (const [needle, value] of replacements) {
    if (!needle || value === null || value === undefined || value === '') continue;
    xml = xml.split(xmlEscape(needle)).join(xmlEscape(value));
  }
  return xml;
}

function replaceTextRunSequence(documentXml, sequence, replacements, maxOccurrences = Infinity) {
  const runRegex = /<w:t\b[^>]*>[\s\S]*?<\/w:t>/g;
  const nodes = [];
  let match;
  while ((match = runRegex.exec(documentXml)) !== null) {
    const full = match[0];
    const openEnd = full.indexOf('>') + 1;
    const closeStart = full.lastIndexOf('</w:t>');
    nodes.push({
      start: match.index,
      contentStart: match.index + openEnd,
      contentEnd: match.index + closeStart,
      text: full.slice(openEnd, closeStart)
    });
  }

  const edits = [];
  let occurrences = 0;
  for (let i = 0; i <= nodes.length - sequence.length && occurrences < maxOccurrences; i += 1) {
    let ok = true;
    for (let j = 0; j < sequence.length; j += 1) {
      if (nodes[i + j].text !== sequence[j]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (let j = 0; j < sequence.length; j += 1) {
      edits.push({
        start: nodes[i + j].contentStart,
        end: nodes[i + j].contentEnd,
        value: xmlEscape(replacements[j] ?? '')
      });
    }
    occurrences += 1;
    i += sequence.length - 1;
  }

  let xml = documentXml;
  edits.sort((a, b) => b.start - a.start).forEach(edit => {
    xml = `${xml.slice(0, edit.start)}${edit.value}${xml.slice(edit.end)}`;
  });
  return xml;
}

function applyRaoCoverVariables(documentXml, { project, rounds }) {
  const phase = project.study_phase || rounds[rounds.length - 1]?.name || 'ACT';
  const today = formatDateFr(new Date());
  const reference = project.reference || `TAO${project.id}`;

  let xml = replaceTemplateText(documentXml, [
    ['SKY CENTER', project.name],
    ['BATI10401', reference],
    ['Rapport d\'analyse ACT', `Rapport d'analyse ${phase}`]
  ]);

  xml = replaceTextRunSequence(xml, ['17', '/1', '2', '/202', '4'], [today, '', '', '', ''], 1);
  xml = replaceTextRunSequence(xml, ['17', '/1', '2', '/2024'], [today, '', '', ''], 1);
  xml = replaceTextRunSequence(xml, [
    'Masselot / Silveira / Chamaa / Seutin / Tadjine / Yanogo\u00A0/ Starop',
    'oli',
    ' / Demassieux'
  ], ['', '', ''], 1);
  xml = replaceTemplateText(xml, [
    ['Roudani\u00A0/ Latour', ''],
    ['Christian KOPP', ''],
    ['Victor SANCHEZ', ''],
    ['Paul-Henri BONJEAN', ''],
    ['KD', '']
  ]);

  return xml;
}

function getRaoLatestRound(rounds) {
  return rounds[rounds.length - 1] || null;
}

function getRaoCompanyTotals({ companies, lots, latestRound, offersByRoundCompanyLot }) {
  if (!latestRound) return [];
  return companies.map(company => {
    const total = lots.reduce((sum, lot) => sum + Number(offersByRoundCompanyLot[latestRound.id]?.[company.id]?.[lot.id] || 0), 0);
    return { ...company, total };
  }).filter(company => company.total > 0);
}

function getRaoLotCompanyNames({ lot, rounds, companies, offersByRoundCompanyLot }) {
  return companies
    .filter(company => rounds.some(round => offersByRoundCompanyLot[round.id]?.[company.id]?.[lot.id] !== undefined))
    .map(company => company.name)
    .join(', ');
}

function firstOrPlaceholder(values, index, placeholder) {
  const value = values[index];
  return value === null || value === undefined || value === '' ? placeholder : value;
}

function applyRaoBusinessPlaceholders(documentXml, { project, lots, rounds, companies, moeTotals, offersByRoundCompanyLot, questions }) {
  const latestRound = getRaoLatestRound(rounds);
  const companyTotals = getRaoCompanyTotals({ companies, lots, latestRound, offersByRoundCompanyLot })
    .sort((a, b) => a.total - b.total);
  const totalMoe = lots.reduce((sum, lot) => sum + Number(moeTotals[lot.id] || 0), 0);
  const bestOfferTotal = companyTotals[0]?.total || 0;
  const deltaBest = bestOfferTotal && totalMoe ? bestOfferTotal - totalMoe : null;
  const deltaBestPct = deltaBest !== null && totalMoe ? `${deltaBest >= 0 ? '+' : ''}${((deltaBest / totalMoe) * 100).toFixed(1).replace('.', ',')} %` : '[+/- X %]';
  const lotsSorted = [...lots].sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'fr', { numeric: true }));
  const lotLabels = lotsSorted.map(lot => `${lot.code || `Lot ${lot.id}`} : ${lot.name || ''}`.trim());
  const latestRoundLabel = latestRound ? `Tour ${latestRound.round_number}${latestRound.name ? ` - ${latestRound.name}` : ''}` : '[DATE]';
  const offerAnalysisDate = latestRound ? formatDateFr(latestRound.created_at || latestRound.updated_at || project.study_date) || latestRoundLabel : '[DATE]';
  const projectLocation = project.location || '[ADRESSE]';
  const [firstLocationPart, ...restLocationParts] = String(projectLocation).split(',');
  const city = restLocationParts.join(',').trim() || project.location || '[VILLE]';
  const firstLot = lotsSorted[0] || {};
  const firstLotCompanies = firstLot.id ? getRaoLotCompanyNames({ lot: firstLot, rounds, companies, offersByRoundCompanyLot }) : '';
  const questionsByCompany = new Map();
  for (const q of questions || []) {
    if (!q.company_id) continue;
    questionsByCompany.set(Number(q.company_id), (questionsByCompany.get(Number(q.company_id)) || 0) + 1);
  }
  const retainedCompany = companyTotals[0] || null;
  const variantsPlaceholder = '[À COMPLÉTER - variantes non renseignées dans TAO]';
  const unknownPlaceholder = '[À COMPLÉTER]';
  const consultationLotsText = lotLabels.length ? lotLabels.join('\n') : '[LOT 1] : [INTITULÉ DU LOT 1]';
  const designationDate = latestRound ? offerAnalysisDate : '[DATE]';

  const replacements = new Map([
    ['[NOM OPÉRATION]', project.name || '[NOM OPÉRATION]'],
    ['[ADRESSE]', firstLocationPart || projectLocation],
    ['[VILLE]', city],
    ['[DESCRIPTION SUCCINCTE DU PROJET]', `${project.name || 'Projet'}${project.reference ? ` - affaire ${project.reference}` : ''}`],
    ['[DATE LANCEMENT CONSULTATION]', formatDateFr(project.study_date) || '[DATE LANCEMENT CONSULTATION]'],
    ['[DATE LIMITE REMISE OFFRES]', latestRound ? offerAnalysisDate : '[DATE LIMITE REMISE OFFRES]'],
    ['[DATE REMISE OFFRE]', latestRound ? offerAnalysisDate : '[DATE REMISE OFFRE]'],
    ['[DATE]', offerAnalysisDate],
    ['[LOT 1]', lotsSorted[0]?.code || '[LOT 1]'],
    ['[INTITULÉ DU LOT 1]', lotsSorted[0]?.name || '[INTITULÉ DU LOT 1]'],
    ['[LOT 2]', lotsSorted[1]?.code || '[LOT 2]'],
    ['[INTITULÉ DU LOT 2]', lotsSorted[1]?.name || '[INTITULÉ DU LOT 2]'],
    ['[LOT N]', lotsSorted.length > 2 ? lotsSorted.slice(2).map(lot => lot.code || `Lot ${lot.id}`).join(', ') : '[LOT N]'],
    ['[INTITULÉ DU LOT N]', lotsSorted.length > 2 ? lotsSorted.slice(2).map(lot => lot.name || '').filter(Boolean).join(', ') : '[INTITULÉ DU LOT N]'],
    ['[INTITULÉ DU LOT]', firstLot.name || '[INTITULÉ DU LOT]'],
    ['[MONTANT ESTIMATION GLOBALE €]', formatMoneyFr(totalMoe)],
    ['[MONTANT TOTAL €]', formatMoneyFr(totalMoe)],
    ['[POSITIONNEMENT DES OFFRES PAR RAPPORT À L’ESTIMATION — homogénéité, dispersion, postes critiques]', companyTotals.length ? `Offres recues sur ${latestRoundLabel}. Offre la mieux disante : ${companyTotals[0].name} (${formatMoneyFr(companyTotals[0].total)} HT), ecart vs estimation MOE : ${deltaBestPct}.` : '[POSITIONNEMENT DES OFFRES PAR RAPPORT À L’ESTIMATION — homogénéité, dispersion, postes critiques]'],
    ['[ENTREPRISE N]', companies.map(c => c.name).join(', ') || '[ENTREPRISE N]'],
    ['[ENTREPRISE RETENUE]', retainedCompany?.name || '[ENTREPRISE RETENUE]'],
    ['[ENTREPRISE X]', retainedCompany?.name || companyTotals[0]?.name || companies[0]?.name || '[ENTREPRISE X]'],
    ['[MONTANT €]', bestOfferTotal ? formatMoneyFr(bestOfferTotal) : '[MONTANT €]'],
    ['[+/- X %]', deltaBestPct],
    ['[+/- MONTANT €]', deltaBest !== null ? formatMoneyFr(deltaBest) : '[+/- MONTANT €]'],
    ['[PRÉSENTATION GÉNÉRALE DE L’OFFRE]', 'Analyse qualitative à compléter par la MOE. Les montants et questions disponibles sont repris dans les tableaux TAO.'],
    ['[CONFORME / NON CONFORME / RÉSERVES — préciser]', 'A confirmer apres analyse technique.'],
    ['[DURÉE D’EXÉCUTION]', '[DURÉE D’EXÉCUTION]'],
    ['[OUI / NON – préciser]', '[OUI / NON – préciser]'],
    ['[LISTE DES SOUS-TRAITANTS]', '[LISTE DES SOUS-TRAITANTS]'],
    ['[POSTE / VARIANTE]', variantsPlaceholder],
    ['[INTITULÉ]', variantsPlaceholder],
    ['[DESCRIPTION]', variantsPlaceholder],
    ['[FAVORABLE / DÉFAVORABLE / À ÉTUDIER]', '[À COMPLÉTER - avis MOE]'],
    ['[JUSTIFICATION]', retainedCompany ? `${retainedCompany.name} est actuellement l'offre la mieux disante sur les montants renseignes dans TAO.` : '[JUSTIFICATION]'],
    ['[JUSTIFICATION TECHNIQUE ET FINANCIÈRE]', retainedCompany ? `Proposition a confirmer apres analyse technique. A date, ${retainedCompany.name} presente le meilleur montant renseigne (${formatMoneyFr(retainedCompany.total)} HT).` : '[JUSTIFICATION TECHNIQUE ET FINANCIÈRE]'],
    ['[POINTS DE VIGILANCE TRANSVERSAUX — clauses, délais, sous-traitance, garanties, etc.]', questions?.length ? `${questions.length} question(s) / réserve(s) générée(s) dans TAO, à traiter avant finalisation.` : '[POINTS DE VIGILANCE TRANSVERSAUX — clauses, délais, sous-traitance, garanties, etc.]'],
    ['[POINT D’ATTENTION 1 — risque planning, dépendance entre lots, validation MOA…]', '[À COMPLÉTER - point planning / interfaces]'],
    ['[POINT D’ATTENTION 2]', '[À COMPLÉTER - point contractuel / technique]'],
    ['[PLANNING DE DÉSIGNATION ET DE MISE AU POINT DES MARCHÉS]', `Désignation cible : ${designationDate}. Planning de mise au point des marchés à compléter.`],
    ['[OPÉRATION DE RÉFÉRENCE 1]', '[OPÉRATION DE RÉFÉRENCE 1]'],
    ['[OPÉRATION DE RÉFÉRENCE 2]', '[OPÉRATION DE RÉFÉRENCE 2]'],
    ['[À COMMENTER]', unknownPlaceholder],
    ['[PRÉCISER]', unknownPlaceholder],
    ['[À COMPLÉTER]', unknownPlaceholder],
    ['[À COMPLÉTER — variantes à retenir / écarter et justification]', variantsPlaceholder]
  ]);

  for (let i = 0; i < 5; i += 1) {
    const lot = lotsSorted[i];
    replacements.set(`[POSTE ${i + 1}]`, lot ? `${lot.code || `Lot ${lot.id}`} - ${lot.name || ''}`.trim() : `[POSTE ${i + 1}]`);
    replacements.set(`[MONTANT ${i + 1} €]`, lot ? formatMoneyFr(moeTotals[lot.id] || 0) : `[MONTANT ${i + 1} €]`);
  }

  for (let i = 0; i < 4; i += 1) {
    const company = companyTotals[i] || companies[i];
    const name = company?.name || `[ENTREPRISE ${i + 1}]`;
    const total = company?.total || 0;
    const delta = total && totalMoe ? total - totalMoe : null;
    const deltaPct = delta !== null && totalMoe ? `${delta >= 0 ? '+' : ''}${((delta / totalMoe) * 100).toFixed(1).replace('.', ',')} %` : '[+/- X %]';
    replacements.set(`[ENTREPRISE ${i + 1}]`, name);
    replacements.set(`[POINT FORT ${i + 1}]`, '[À COMPLÉTER - point fort]');
    replacements.set(`[POINT DE VIGILANCE ${i + 1}]`, questionsByCompany.get(Number(company?.id)) ? `${questionsByCompany.get(Number(company.id))} question(s) / réserve(s) identifiée(s) dans TAO.` : '[POINT DE VIGILANCE À COMPLÉTER]');
    replacements.set(`[MONTANT OFFRE ENTREPRISE ${i + 1}]`, total ? formatMoneyFr(total) : '[MONTANT €]');
    replacements.set(`${name} : [MONTANT €] – écart vs estimation MOE : [+/- X %]`, `${name} : ${total ? formatMoneyFr(total) : '[MONTANT €]'} - ecart vs estimation MOE : ${deltaPct}`);
  }

  if (firstLotCompanies) {
    replacements.set('[ENTREPRISE 1]', companyTotals[0]?.name || companies[0]?.name || firstLotCompanies.split(', ')[0] || '[ENTREPRISE 1]');
  }

  let xml = documentXml;
  xml = xml.replace('[LOT 1] : [INTITULÉ DU LOT 1]\n[LOT 2] : [INTITULÉ DU LOT 2]\n[LOT N] : [INTITULÉ DU LOT N]', xmlEscape(consultationLotsText));
  for (const [key, value] of replacements.entries()) {
    xml = replaceTemplateText(xml, [[key, value]]);
  }
  xml = xml.replace(/Macrolot XX/g, `Macrolot ${firstLot.code || firstLot.id || 'XX'}`);
  xml = xml.replace(/macrolot\s+XX/g, `macrolot ${firstLot.code || firstLot.id || 'XX'}`);
  return xml;
}

function highlightRemainingRaoPlaceholders(documentXml) {
  return documentXml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, run => {
    if (!/<w:t\b[^>]*>[^<]*\[[^\]]+\][^<]*<\/w:t>/.test(run)) return run;
    if (run.includes('<w:highlight ')) return run;
    if (run.includes('<w:rPr>')) {
      return run.replace('</w:rPr>', '<w:highlight w:val="yellow"/><w:color w:val="9C6500"/></w:rPr>');
    }
    const openEnd = run.indexOf('>') + 1;
    return `${run.slice(0, openEnd)}<w:rPr><w:highlight w:val="yellow"/><w:color w:val="9C6500"/></w:rPr>${run.slice(openEnd)}`;
  });
}

async function replaceRaoCoverLogo(zip) {
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (!relsFile) return;
  let rels = await relsFile.async('string');
  rels = rels.replace('Target="media/image4.emf"', 'Target="media/dmx-logo.png"');
  zip.file('word/_rels/document.xml.rels', rels);
  zip.file('word/media/dmx-logo.png', await fs.readFile(DMX_LOGO_PATH));
}

function buildRaoGeneratedSection({ project, lots, rounds, companies, moeTotals, offersByRoundCompanyLot, questions, selectedOptionDetails = [], selectedOptionMoeByOption = new Map() }) {
  const latestRound = rounds[rounds.length - 1] || null;
  const projectRows = [
    ['Variable', 'Valeur'],
    ['Nom affaire', raoValue(project.name, '{{NOM_AFFAIRE}}')],
    ['Reference', raoValue(project.reference, '{{REFERENCE_AFFAIRE}}')],
    ['Maître d\'ouvrage / Client', raoValue(project.client, '{{MAITRE_OUVRAGE}}')],
    ['Localisation', raoValue(project.location, '{{ADRESSE_OPERATION}}')],
    ['Phase d\'etude', raoValue(project.study_phase || latestRound?.name, '{{PHASE_ETUDE}}')],
    ['Date d\'etude', raoValue(formatDateFr(project.study_date), '{{DATE_ETUDE}}')],
    ['Date édition RAO', formatDateFr(new Date())],
    ['Auteur(s)', raoValue('', '{{AUTEURS_RAO}}')],
    ['Verificateur(s)', raoValue('', '{{VERIFICATEURS_RAO}}')],
    ['Destinataires', raoValue('', '{{DESTINATAIRES_RAO}}')],
    ['Process consultation', raoValue('', '{{PROCESS_CONSULTATION}}')],
    ['Criteres de jugement', raoValue('', '{{CRITERES_JUGEMENT_OFFRES}}')]
  ];

  const lotRows = [
    ['Lot', 'Nom', 'MOE', 'Entreprises consultees']
  ];
  for (const lot of lots) {
    const lotCompanyNames = companies
      .filter(company => rounds.some(round => offersByRoundCompanyLot[round.id]?.[company.id]?.[lot.id] !== undefined))
      .map(company => company.name)
      .join(', ');
    lotRows.push([
      lot.code || `Lot ${lot.id}`,
      lot.name || '',
      formatMoneyFr(moeTotals[lot.id] || 0),
      raoValue(lotCompanyNames, '{{ENTREPRISES_CONSULTEES}}')
    ]);
  }

  const offerRows = [
    ['Tour', 'Lot', 'Entreprise', 'Montant offre']
  ];
  for (const round of rounds) {
    for (const lot of lots) {
      for (const company of companies) {
        const amount = offersByRoundCompanyLot[round.id]?.[company.id]?.[lot.id];
        if (amount === undefined) continue;
        offerRows.push([
          `Tour ${round.round_number}${round.name ? ` - ${round.name}` : ''}`,
          `${lot.code || ''} ${lot.name || ''}`.trim(),
          company.name,
          formatMoneyFr(amount)
        ]);
      }
    }
  }
  if (offerRows.length === 1) {
    offerRows.push(['{{TOUR}}', '{{LOT}}', '{{ENTREPRISE}}', raoValue('', '{{MONTANT_OFFRE}}')]);
  }

  const questionRows = [
    ['Lot', 'Entreprise', 'Article', 'Question / reserve']
  ];
  questions.slice(0, 250).forEach(q => {
    const company = companies.find(c => Number(c.id) === Number(q.company_id));
    const lot = lots.find(l => Number(l.id) === Number(q.lot_id));
    questionRows.push([
      lot ? `${lot.code || ''} ${lot.name || ''}`.trim() : '',
      company?.name || `Entreprise ${q.company_id || ''}`,
      `${q.num || ''} ${q.designation || ''}`.trim(),
      q.question_text || q.comment || ''
    ]);
  });
  if (questionRows.length === 1) {
    questionRows.push([raoValue('', '{{LOT}}'), raoValue('', '{{ENTREPRISE}}'), raoValue('', '{{ARTICLE}}'), raoValue('', '{{QUESTION_OU_RESERVE}}')]);
  }

  const optionRows = [
    ['Tour', 'Lot', 'Option', 'Entreprise', 'MOE option', 'Montant offre option']
  ];
  for (const detail of selectedOptionDetails) {
    const round = rounds.find(r => Number(r.id) === Number(detail.round_id));
    const lot = lots.find(l => Number(l.id) === Number(detail.lot_id));
    optionRows.push([
      round ? `Tour ${round.round_number}${round.name ? ` - ${round.name}` : ''}` : '',
      lot ? `${lot.code || ''} ${lot.name || ''}`.trim() : '',
      detail.option_designation || `Option ${detail.option_id}`,
      detail.company_name || `Entreprise ${detail.company_id || ''}`,
      formatMoneyFr(selectedOptionMoeByOption.get(Number(detail.option_id)) || 0),
      formatMoneyFr(detail.offer_total)
    ]);
  }
  if (optionRows.length === 1) {
    optionRows.push(['-', '-', 'Aucune option cochee', '-', '-', '-']);
  }

  const toTable = rows => wordTable(rows.map((row, rowIndex) => row.map(value => wordSimpleCell(value, { header: rowIndex === 0 }))));

  return [
    wordParagraph(wordRun('DONNEES TAO GENEREES', { bold: true }), { style: 'Titre1', spacingAfter: 180 }),
    wordParagraph([
      wordRun('Les champs surlignes en jaune sont des variables metier non encore disponibles dans TAO. '),
      wordRun('Ils restent volontairement visibles pour être complétés ou raccordés plus tard.', { color: '9C6500', highlight: true })
    ], { spacingAfter: 180 }),
    wordParagraph(wordRun('Variables projet', { bold: true }), { style: 'Titre2' }),
    toTable(projectRows),
    wordParagraph('', { spacingAfter: 160 }),
    wordParagraph(wordRun('Lots et entreprises', { bold: true }), { style: 'Titre2' }),
    toTable(lotRows),
    wordParagraph('', { spacingAfter: 160 }),
    wordParagraph(wordRun('Montants d\'offres par tour', { bold: true }), { style: 'Titre2' }),
    toTable(offerRows),
    wordParagraph('', { spacingAfter: 160 }),
    wordParagraph(wordRun('Options retenues', { bold: true }), { style: 'Titre2' }),
    toTable(optionRows),
    wordParagraph('', { spacingAfter: 160 }),
    wordParagraph(wordRun('Questions et reserves', { bold: true }), { style: 'Titre2' }),
    toTable(questionRows),
    wordParagraph('', { spacingAfter: 160 }),
    wordParagraph(wordRun('Placeholders RAO a raccorder', { bold: true }), { style: 'Titre2' }),
    toTable([
      ['Champ', 'Placeholder'],
      ['Synthese operation', raoValue('', '{{SYNTHESE_OPERATION}}')],
      ['Planning consultation', raoValue('', '{{PLANNING_CONSULTATION}}')],
      ['Ateliers / negociations', raoValue('', '{{ATELIERS_NEGOCIATIONS}}')],
      ['Analyse qualitative par entreprise', raoValue('', '{{ANALYSE_QUALITATIVE_ENTREPRISE}}')],
      ['Conclusion / attribution proposee', raoValue('', '{{CONCLUSION_ATTRIBUTION}}')]
    ])
  ].join('');
}

async function buildRaoTemplateDocument({ project, lots, rounds, companies, moeTotals, offersByRoundCompanyLot, questions, selectedOptionDetails = [], selectedOptionMoeByOption = new Map() }) {
  const templateBuffer = await fs.readFile(RAO_TEMPLATE);
  const zip = await JSZip.loadAsync(templateBuffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('Template RAO invalide: word/document.xml introuvable');

  let documentXml = await documentFile.async('string');
  documentXml = applyRaoCoverVariables(documentXml, { project, rounds });
  documentXml = applyRaoBusinessPlaceholders(documentXml, {
    project,
    lots,
    rounds,
    companies,
    moeTotals,
    offersByRoundCompanyLot,
    questions
  });
  documentXml = highlightRemainingRaoPlaceholders(documentXml);
  await replaceRaoCoverLogo(zip);

  const generatedSection = buildRaoGeneratedSection({
    project,
    lots,
    rounds,
    companies,
    moeTotals,
    offersByRoundCompanyLot,
    questions,
    selectedOptionDetails,
    selectedOptionMoeByOption
  });
  documentXml = appendWordSection(documentXml, generatedSection);
  zip.file('word/document.xml', documentXml);

  return zip.generateAsync({ type: 'nodebuffer' });
}

// Générer le RAO (Rapport d'Analyse d'Offre) complet pour un projet en Word
async function handleRaoExport(req, res) {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;
    const selectedOptionIds = parseSelectedOptionIds(req);

    // Récupérer le projet
    const projectRes = await query(
      `SELECT * FROM projects WHERE id = $1`,
      [projectId]
    );
    if (projectRes.rowCount === 0) return res.status(404).json({ error: 'Projet introuvable' });
    const project = projectRes.rows[0];
    const canViewDemoProject = await canViewProject(userId, projectId, req.user.role, req.user.company_id || null);
    if (!canViewDemoProject) return res.status(403).json({ error: 'Accès refusé' });

    // Vérifier l'accès
    const accessCheck = await query(
      `SELECT 1 FROM projects WHERE id = $1 AND (owner_id = $2 OR $3 IN ('admin', 'responsable'))`,
      [projectId, userId, req.user.role]
    );
    if (accessCheck.rowCount === 0) return res.status(403).json({ error: 'Accès refusé' });

    // Récupérer tous les lots du projet
    const lotsRes = await query(
      `SELECT id, code, name FROM lots WHERE project_id = $1 ORDER BY sort_order ASC, id ASC`,
      [projectId]
    );
    const lots = lotsRes.rows;

    if (lots.length === 0) {
      return res.status(400).json({ error: 'Aucun lot trouvé pour ce projet' });
    }

    // Récupérer les phases/tours du projet
    const roundsRes = await query(
      `SELECT * FROM rounds WHERE project_id = $1 ORDER BY round_number ASC`,
      [projectId]
    );
    const rounds = roundsRes.rows;

    if (rounds.length === 0) {
      return res.status(400).json({ error: 'Aucune phase créée pour ce projet' });
    }

    // Récupérer les entreprises ayant déposé une offre sur le projet (toutes phases confondues)
    const companiesRes = await query(
      `SELECT DISTINCT c.id, c.name
       FROM companies c
       JOIN offers o ON o.company_id = c.id
       JOIN items i ON i.id = o.item_id
       JOIN rounds r ON r.id = o.round_id
       WHERE r.project_id = $1
       ORDER BY c.name`,
      [projectId]
    );
    const companies = companiesRes.rows;

    // Totaux MOE par lot
    const moeTotals = {};
    const moeRes = await query(
      `SELECT i.lot_id, m.amount
       FROM items i
       LEFT JOIN moe_items m ON m.item_id = i.id
       WHERE i.lot_id = ANY($1::int[])`,
      [lots.map(l => l.id)]
    );
    moeRes.rows.forEach(r => {
      const amount = Number(r.amount);
      if (Number.isFinite(amount)) moeTotals[r.lot_id] = (moeTotals[r.lot_id] || 0) + amount;
    });

    // Offres par phase / entreprise / lot
    const offersRes = await query(
      `SELECT o.company_id, o.round_id, COALESCE(o.amount, COALESCE(o.qty, 0) * COALESCE(o.unit_price, 0)) AS amount, i.lot_id
       FROM offers o
       JOIN items i ON i.id = o.item_id
       JOIN rounds r ON r.id = o.round_id
       WHERE r.project_id = $1`,
      [projectId]
    );
    const offersByRoundCompanyLot = {};
    offersRes.rows.forEach(o => {
      if (!offersByRoundCompanyLot[o.round_id]) offersByRoundCompanyLot[o.round_id] = {};
      if (!offersByRoundCompanyLot[o.round_id][o.company_id]) offersByRoundCompanyLot[o.round_id][o.company_id] = {};
      offersByRoundCompanyLot[o.round_id][o.company_id][o.lot_id] = (offersByRoundCompanyLot[o.round_id][o.company_id][o.lot_id] || 0) + Number(o.amount || 0);
    });

    const optionTotals = await fetchSelectedOptionTotals({
      projectId,
      lotIds: lots.map(l => Number(l.id)).filter(Number.isFinite),
      roundIds: rounds.map(r => Number(r.id)).filter(Number.isFinite),
      selectedOptionIds,
      isEntreprise: req.user?.role === 'entreprise',
      companyId: req.user?.company_id || null,
      includeMoe: true
    });
    for (const [lotId, total] of optionTotals.moeByLot.entries()) {
      moeTotals[lotId] = (moeTotals[lotId] || 0) + total;
    }
    for (const [key, total] of optionTotals.offersByLotRoundCompany.entries()) {
      const [lotId, roundId, companyId] = key.split(':').map(Number);
      if (!offersByRoundCompanyLot[roundId]) offersByRoundCompanyLot[roundId] = {};
      if (!offersByRoundCompanyLot[roundId][companyId]) offersByRoundCompanyLot[roundId][companyId] = {};
      offersByRoundCompanyLot[roundId][companyId][lotId] = (offersByRoundCompanyLot[roundId][companyId][lotId] || 0) + total;
    }
    const companyIds = new Set(companies.map(c => Number(c.id)));
    for (const companyMap of optionTotals.companiesByLot.values()) {
      for (const [optionCompanyId, companyName] of companyMap.entries()) {
        if (!companyIds.has(Number(optionCompanyId))) {
          companies.push({ id: Number(optionCompanyId), name: companyName });
          companyIds.add(Number(optionCompanyId));
        }
      }
    }

    // Questions par lot / entreprise
    const questionsRes = await query(
      `SELECT gq.*,
        CASE WHEN gq.option_item_id IS NOT NULL THEN
          CASE WHEN oi.num IS NULL OR oi.num = '' THEN '' ELSE 'O' || oi.num END
          ELSE i.num END AS num,
        CASE WHEN gq.option_item_id IS NOT NULL
          THEN COALESCE(o.designation || ' — ' || oi.designation, oi.designation)
          ELSE i.designation END AS designation,
        COALESCE(i.unit, oi.unit) AS unit
       FROM generated_questions gq
       JOIN lots l ON l.id = gq.lot_id
       LEFT JOIN items i ON i.id = gq.item_id
       LEFT JOIN option_items oi ON oi.id = gq.option_item_id
       LEFT JOIN options o ON o.id = oi.option_id
       WHERE l.project_id = $1
       ORDER BY gq.question_type, gq.company_id, (gq.option_item_id IS NOT NULL), COALESCE(i.num, oi.num)`,
      [projectId]
    );
    const questions = questionsRes.rows;

    const raoBuffer = await buildRaoTemplateDocument({
      project,
      lots,
      rounds,
      companies,
      moeTotals,
      offersByRoundCompanyLot,
      questions,
      selectedOptionDetails: optionTotals.details,
      selectedOptionMoeByOption: optionTotals.moeByOption
    });
    const raoFilename = `RAO_${project.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${raoFilename}"`);
    return res.send(raoBuffer);

    // Construire le document Word
    const children = [];

    // Titre principal (Titre 1)
    children.push(
      new Paragraph({
        text: `RAO - Rapport d'Analyse d'Offre`,
        heading: HeadingLevel.HEADING_1,
        bold: true,
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: `Projet: ${project.name}`,
        alignment: AlignmentType.CENTER,
        spacing: { after: 50 }
      }),
      new Paragraph({
        text: `Date: ${new Date().toLocaleDateString('fr-FR')}`,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      })
    );

    const fmtMoney = v => Number.isFinite(v) ? `${v.toFixed(2)} €` : '-';

    // Boucler sur chaque phase/tour
    for (const round of rounds) {
      // Titre Phase (Heading 2)
      children.push(
        new Paragraph({
          text: `Phase ${round.round_number}: ${round.name || ''}`,
          heading: HeadingLevel.HEADING_2,
          bold: true,
          spacing: { before: 300, after: 200 }
        })
      );

      // Tableau récapitulatif global : Lot × Entreprises
      children.push(
        new Paragraph({
          text: `Tableau Récapitulatif`,
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 150, after: 100 }
        })
      );

      const recapRows = [
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ text: 'Lot', bold: true })] }),
            new TableCell({ children: [new Paragraph({ text: 'MOE Total (€)', bold: true })] }),
            ...companies.map(c => new TableCell({ children: [new Paragraph({ text: c.name, bold: true })] }))
          ]
        })
      ];

      lots.forEach(lot => {
        recapRows.push(
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ text: lot.name || lot.code || `Lot ${lot.id}` })] }),
              new TableCell({ children: [new Paragraph({ text: fmtMoney(moeTotals[lot.id] || 0) })] }),
              ...companies.map(c => {
                const offer = offersByRoundCompanyLot[round.id]?.[c.id]?.[lot.id];
                return new TableCell({ children: [new Paragraph({ text: fmtMoney(offer) })] });
              })
            ]
          })
        );
      });

      children.push(
        new Table({ rows: recapRows, width: { size: 100, type: 'pct' } }),
        new Paragraph({ text: '' })
      );

      // Pour chaque entreprise : récap offre + fiche questions + analyse technique
      companies.forEach(company => {
        // Titre entreprise (Heading 3)
        children.push(
          new Paragraph({
            text: company.name,
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 150 }
          })
        );

        // A. Récap de l'offre (tableau Lot/MOE/Offre)
        children.push(
          new Paragraph({
            text: `A. Récapitulatif de l'offre`,
            heading: HeadingLevel.HEADING_4,
            spacing: { before: 100, after: 100 }
          })
        );

        const offerRows = [
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ text: 'Lot', bold: true })] }),
              new TableCell({ children: [new Paragraph({ text: 'MOE Total (€)', bold: true })] }),
              new TableCell({ children: [new Paragraph({ text: 'Offre (€)', bold: true })] })
            ]
          })
        ];

        lots.forEach(lot => {
          const offer = offersByRoundCompanyLot[round.id]?.[company.id]?.[lot.id];
          offerRows.push(
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ text: lot.name || lot.code || `Lot ${lot.id}` })] }),
                new TableCell({ children: [new Paragraph({ text: fmtMoney(moeTotals[lot.id] || 0) })] }),
                new TableCell({ children: [new Paragraph({ text: fmtMoney(offer) })] })
              ]
            })
          );
        });

        children.push(
          new Table({ rows: offerRows, width: { size: 100, type: 'pct' } }),
          new Paragraph({ text: '' })
        );

        // B. Fiche questions
        children.push(
          new Paragraph({
            text: `B. Fiche Questions`,
            heading: HeadingLevel.HEADING_4,
            spacing: { before: 150, after: 100 }
          })
        );

        const companyQuestions = questions.filter(q => q.company_id === company.id);
        if (companyQuestions.length > 0) {
          const questionRows = [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ text: 'N°', bold: true })] }),
                new TableCell({ children: [new Paragraph({ text: 'Article', bold: true })] }),
                new TableCell({ children: [new Paragraph({ text: 'Question', bold: true })] }),
                new TableCell({ children: [new Paragraph({ text: 'Commentaire', bold: true })] })
              ]
            })
          ];

          companyQuestions.forEach((q, idx) => {
            const articleText = `${q.num ?? ''}${q.designation ? ` — ${q.designation}` : ''}`.trim();
            questionRows.push(
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: `${idx + 1}` })] }),
                  new TableCell({ children: [new Paragraph({ text: articleText || '-' })] }),
                  new TableCell({ children: [new Paragraph({ text: q.question_text || '-' })] }),
                  new TableCell({ children: [new Paragraph({ text: q.comment || '(À compléter)' })] })
                ]
              })
            );
          });

          children.push(
            new Table({ rows: questionRows, width: { size: 100, type: 'pct' } }),
            new Paragraph({ text: '' })
          );
        } else {
          children.push(
            new Paragraph({
              text: '(Aucune question pour cette entreprise)',
              spacing: { after: 100 }
            })
          );
        }

        // C. Analyse technique
        children.push(
          new Paragraph({
            text: `C. Analyse Technique`,
            heading: HeadingLevel.HEADING_4,
            spacing: { before: 150, after: 100 }
          }),
          new Paragraph({
            text: '(À compléter par les responsables)',
            italics: true,
            spacing: { after: 200 }
          }),
          new Paragraph({ text: '' }),
          new Paragraph({ text: '' })
        );
      });
    }

    // Créer le document
    const doc = new Document({ 
      sections: [{ 
        children: children
      }] 
    });
    const buffer = await Packer.toBuffer(doc);

    const filename = `RAO_${project.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Erreur génération RAO:', err);
    res.status(500).json({ error: 'Erreur lors de la génération du RAO: ' + err.message });
  }
}
router.get('/rao/:projectId', handleRaoExport);
router.post('/rao/:projectId', handleRaoExport);

// ===== Envoi d'export par email =====
function extractFilenameFromDisposition(contentDisposition, fallback) {
  if (!contentDisposition) return fallback;
  const match = contentDisposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

async function fetchInternalExport(req, path, { method = 'GET', body = null, fallbackFilename = 'export.bin' } = {}) {
  const internalRes = await fetch(`${req.protocol}://${req.get('host')}${path}`, {
    method,
    headers: {
      'Cookie': req.headers.cookie || '',
      'Authorization': req.headers.authorization || '',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!internalRes.ok) {
    const err = await internalRes.json().catch(() => ({ error: 'Erreur export' }));
    const error = new Error(err.error || 'Erreur export');
    error.status = internalRes.status;
    throw error;
  }

  return {
    buffer: Buffer.from(await internalRes.arrayBuffer()),
    filename: extractFilenameFromDisposition(internalRes.headers.get('content-disposition'), fallbackFilename),
    contentType: internalRes.headers.get('content-type') || 'application/octet-stream'
  };
}

async function generateExportFile(req, exportType, exportParams = {}) {
  if (exportType === 'rounds-comparison') {
    const { projectId, roundFrom, roundTo, simulations = [], simulationRoundId = '', selectedOptions = [] } = exportParams;
    if (!projectId) throw new Error('projectId requis pour cet export');

    const params = new URLSearchParams();
    if (roundFrom) params.set('round_from', String(roundFrom));
    if (roundTo) params.set('round_to', String(roundTo));
    const path = `/api/exports/rounds-comparison/${projectId}${params.toString() ? `?${params.toString()}` : ''}`;

    return fetchInternalExport(req, path, {
      method: 'POST',
      body: { simulations, simulationRoundId, selectedOptions },
      fallbackFilename: `ComparaisonTours_${projectId}.xlsx`
    });
  }

  if (exportType === 'summary') {
    const { roundId, selectedOptions = [] } = exportParams;
    if (!roundId) throw new Error('roundId requis pour cet export');
    return fetchInternalExport(req, `/api/exports/summary/${roundId}`, {
      method: 'POST',
      body: { selectedOptions },
      fallbackFilename: `AnalyseLot_Tour${roundId}.xlsx`
    });
  }

  if (exportType === 'lot-comparison') {
    const { lotId, roundId, selectedOptions = [] } = exportParams;
    if (!lotId) throw new Error('lotId requis pour cet export');
    const params = new URLSearchParams();
    if (roundId) params.set('round_id', roundId);
    return fetchInternalExport(req, `/api/exports/lot-comparison/${lotId}${params.toString() ? `?${params.toString()}` : ''}`, {
      method: 'POST',
      body: { selectedOptions },
      fallbackFilename: `Comparatif_Lot_${lotId}.xlsx`
    });
  }

  if (exportType === 'questions') {
    const { lotId, roundId, companyId, status: filterStatus } = exportParams;
    if (!lotId) throw new Error('lotId requis pour cet export');
    const params = new URLSearchParams();
    if (roundId) params.set('round_id', String(roundId));
    if (companyId) params.set('company_id', String(companyId));
    if (filterStatus) params.set('status', String(filterStatus));
    return fetchInternalExport(req, `/api/question-config/lot/${lotId}/export-excel${params.toString() ? `?${params.toString()}` : ''}`, {
      fallbackFilename: `Fiches_Questions_Lot_${lotId}.xlsx`
    });
  }

  if (exportType === 'rao') {
    const { projectId, selectedOptions = [] } = exportParams;
    if (!projectId) throw new Error('projectId requis pour cet export');
    return fetchInternalExport(req, `/api/exports/rao/${projectId}`, {
      method: 'POST',
      body: { selectedOptions },
      fallbackFilename: `RAO_${projectId}.docx`
    });
  }

  throw new Error(`Type d'export inconnu: ${exportType}`);
}

function sanitizeZipSegment(value, fallback = 'Sans_nom') {
  const clean = String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return clean || fallback;
}

function getZipStructure({ projectId, projectName, projectReference, roundLabel }) {
  const projectFolderName = sanitizeZipSegment(
    [projectReference, projectName].filter(Boolean).join('_'),
    `Projet_${projectId}`
  );
  const root = `Affaire_${projectFolderName}`;
  const roundFolder = sanitizeZipSegment(roundLabel || 'Tour_non_defini');

  return {
    root,
    rao: `${root}/01_RAO`,
    roundsComparison: `${root}/02_Comparaison_des_tours`,
    roundSummaries: `${root}/03_Recapitulatifs_par_tour/${roundFolder}`,
    lotComparisons: `${root}/04_Comparatifs_par_lot/${roundFolder}`,
    questionSheets: `${root}/05_Fiches_questions/${roundFolder}`
  };
}

function getMaxAbsCellValue(worksheet, refs) {
  let max = 0;
  for (const ref of refs) {
    const value = worksheet.getCell(ref).value;
    const numeric = typeof value === 'object' && value?.result !== undefined ? Number(value.result) : Number(value);
    if (Number.isFinite(numeric)) {
      max = Math.max(max, Math.abs(numeric));
    }
  }
  return max;
}

function blendArgbColor(fromArgb, toArgb, ratio) {
  const amount = Math.max(0, Math.min(1, ratio));
  const from = normalizeHexColor(fromArgb, 'FFFFFFFF').slice(2);
  const to = normalizeHexColor(toArgb, 'FFFFFFFF').slice(2);
  const channels = [0, 2, 4].map(offset => {
    const start = parseInt(from.slice(offset, offset + 2), 16);
    const end = parseInt(to.slice(offset, offset + 2), 16);
    return Math.round(start + (end - start) * amount).toString(16).padStart(2, '0');
  });
  return `FF${channels.join('').toUpperCase()}`;
}

function addDivergingPercentDataBars(worksheet, refs, priority = 1) {
  const filteredRefs = refs.filter(ref => worksheet.getCell(ref).value !== null && worksheet.getCell(ref).value !== undefined);
  if (!filteredRefs.length) return;
  const maxAbs = Math.max(getMaxAbsCellValue(worksheet, filteredRefs), 0.01);

  filteredRefs.forEach(ref => {
    const cell = worksheet.getCell(ref);
    const numeric = typeof cell.value === 'object' && cell.value?.result !== undefined
      ? Number(cell.value.result)
      : Number(cell.value);
    if (!Number.isFinite(numeric) || numeric === 0) return;
    const ratio = Math.min(Math.abs(numeric) / maxAbs, 1);
    const targetColor = numeric > 0 ? 'FFE06666' : 'FF63BE7B';
    const textColor = numeric > 0 ? 'FF9C0006' : 'FF006100';
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: blendArgbColor('FFFFFFFF', targetColor, 0.25 + ratio * 0.55) }
    };
    cell.font = {
      ...(cell.font || {}),
      color: { argb: textColor },
      bold: Math.abs(numeric) >= maxAbs * 0.66
    };
  });
}

async function getBundleLotSelection({ projectId, questionLotId, questionLotIds }) {
  const projectLotsRes = await query(
    `SELECT id, code, name FROM lots WHERE project_id = $1 ORDER BY sort_order ASC, id ASC`,
    [projectId]
  );
  const projectLots = projectLotsRes.rows || [];
  const projectLotIds = new Set(projectLots.map(l => Number(l.id)).filter(Number.isFinite));

  const explicitLotIds = Array.isArray(questionLotIds)
    ? [...new Set(questionLotIds.map(id => Number(id)).filter(Number.isFinite))]
    : [];

  let lotIdsToExport = [];
  if (explicitLotIds.length > 0) {
    lotIdsToExport = explicitLotIds;
  } else {
    const lotSelection = String(questionLotId || '').trim().toLowerCase();
    if (!lotSelection || lotSelection === 'all') {
      lotIdsToExport = projectLots.map(l => Number(l.id)).filter(Number.isFinite);
    } else {
      const singleLotId = Number(questionLotId);
      if (!Number.isFinite(singleLotId)) {
        const err = new Error('questionLotId invalide');
        err.status = 400;
        throw err;
      }
      lotIdsToExport = [singleLotId];
    }
  }

  lotIdsToExport = lotIdsToExport.filter(lotId => projectLotIds.has(lotId));
  return { projectLots, lotIdsToExport };
}

router.post('/project-bundle-zip', async (req, res) => {
  try {
    const {
      projectId,
      currentRoundId,
      questionLotId,
      questionLotIds = [],
      selections = {},
      roundsComparisonParams = {},
      selectedOptions = []
    } = req.body || {};
    const bundleSelectedOptions = parseSelectedOptionIds(selectedOptions);

    if (!projectId) return res.status(400).json({ error: 'projectId requis' });
    const selectedKeys = Object.entries(selections).filter(([, enabled]) => !!enabled).map(([key]) => key);
    if (selectedKeys.length === 0) {
      return res.status(400).json({ error: 'Aucun export sélectionné' });
    }

    const projectMetaRes = await query(
      `SELECT name, reference FROM projects WHERE id = $1`,
      [projectId]
    );
    if (projectMetaRes.rowCount === 0) {
      return res.status(404).json({ error: 'Projet introuvable' });
    }
    const canViewDemoProject = await canViewProject(req.user.id, projectId, req.user.role, req.user.company_id || null);
    if (!canViewDemoProject) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    // Determine rounds to process: one specific round or all project rounds
    let roundsToProcess = [];
    if (currentRoundId) {
      const r = await query(
        `SELECT id, round_number, name FROM rounds WHERE id = $1 AND project_id = $2`,
        [currentRoundId, projectId]
      );
      if (r.rowCount > 0) roundsToProcess.push(r.rows[0]);
    } else if (selections.lotAnalysis || selections.lotComparisons || selections.questionSheets) {
      const r = await query(
        `SELECT id, round_number, name FROM rounds WHERE project_id = $1 ORDER BY round_number`,
        [projectId]
      );
      roundsToProcess.push(...r.rows);
    }

    const firstRound = roundsToProcess[0];
    const mainRoundLabel = firstRound
      ? `Tour_${firstRound.round_number}${firstRound.name ? `_${firstRound.name}` : ''}`
      : 'Tour_non_defini';
    const projectName = projectMetaRes.rows[0]?.name;
    const projectReference = projectMetaRes.rows[0]?.reference;

    const zipStructure = getZipStructure({ projectId, projectName, projectReference, roundLabel: mainRoundLabel });

    const zip = new JSZip();
    const needsLotScopedExports = selections.lotAnalysis || selections.lotComparisons || selections.questionSheets;
    const bundleLotSelection = needsLotScopedExports
      ? await getBundleLotSelection({ projectId, questionLotId, questionLotIds })
      : { projectLots: [], lotIdsToExport: [] };

    if (needsLotScopedExports && bundleLotSelection.lotIdsToExport.length === 0) {
      return res.status(400).json({ error: 'Aucun lot valide sélectionné pour les exports par lot' });
    }

    if (selections.rao) {
      const file = await generateExportFile(req, 'rao', { projectId, selectedOptions: bundleSelectedOptions });
      zip.file(`${zipStructure.rao}/${sanitizeZipSegment(file.filename, 'RAO.docx')}`, file.buffer);
    }

    if (selections.roundsCompare) {
      const file = await generateExportFile(req, 'rounds-comparison', {
        projectId,
        ...roundsComparisonParams,
        selectedOptions: roundsComparisonParams.selectedOptions || bundleSelectedOptions
      });
      zip.file(`${zipStructure.roundsComparison}/${sanitizeZipSegment(file.filename, 'Comparaison_Tours.xlsx')}`, file.buffer);
    }

    if (selections.lotAnalysis) {
      for (const round of roundsToProcess) {
        const roundLbl = `Tour_${round.round_number}${round.name ? `_${round.name}` : ''}`;
        const rStruct = getZipStructure({ projectId, projectName, projectReference, roundLabel: roundLbl });
        try {
          const file = await generateExportFile(req, 'summary', { roundId: round.id, selectedOptions: bundleSelectedOptions });
          zip.file(`${rStruct.roundSummaries}/${sanitizeZipSegment(file.filename, `Recapitulatif_Tour_${round.id}.xlsx`)}`, file.buffer);
        } catch (e) {
          if (e.status !== 404) throw e;
        }
      }
    }

    if ((selections.lotAnalysis || selections.lotComparisons) && roundsToProcess.length > 0) {
      const byId = new Map(bundleLotSelection.projectLots.map(l => [Number(l.id), l]));
      for (const round of roundsToProcess) {
        const roundLbl = `Tour_${round.round_number}${round.name ? `_${round.name}` : ''}`;
        const rStruct = getZipStructure({ projectId, projectName, projectReference, roundLabel: roundLbl });
        for (const lotId of bundleLotSelection.lotIdsToExport) {
          const lot = byId.get(Number(lotId));
          const lotPrefix = sanitizeZipSegment(`${lot?.code || `Lot_${lotId}`}_${lot?.name || ''}`, `Lot_${lotId}`);
          try {
            const file = await generateExportFile(req, 'lot-comparison', { lotId, roundId: round.id, selectedOptions: bundleSelectedOptions });
            const filename = sanitizeZipSegment(file.filename, `Comparatif_Lot_${lotId}_Tour_${round.round_number}.xlsx`);
            zip.file(`${rStruct.lotComparisons}/${lotPrefix}/${filename}`, file.buffer);
          } catch (e) {
            if (e.status !== 404) throw e;
          }
        }
      }
    }

    if (selections.questionSheets && roundsToProcess.length > 0) {
      const projectLots = bundleLotSelection.projectLots;
      const lotIdsToExport = bundleLotSelection.lotIdsToExport;
      const byId = new Map(projectLots.map(l => [Number(l.id), l]));
      const lotCompaniesRes = await query(
        `SELECT lc.lot_id, c.id as company_id, COALESCE(NULLIF(lc.display_name, ''), c.name) as company_name
         FROM lot_companies lc
         JOIN companies c ON c.id = lc.company_id
         WHERE lc.lot_id = ANY($1::bigint[])
         ORDER BY lc.created_at, company_name`,
        [lotIdsToExport]
      );
      const companiesByLotId = new Map();
      for (const row of lotCompaniesRes.rows) {
        const lotKey = Number(row.lot_id);
        if (!companiesByLotId.has(lotKey)) companiesByLotId.set(lotKey, []);
        companiesByLotId.get(lotKey).push({
          id: Number(row.company_id),
          name: row.company_name
        });
      }

      for (const round of roundsToProcess) {
        const roundLbl = `Tour_${round.round_number}${round.name ? `_${round.name}` : ''}`;
        const rStruct = getZipStructure({ projectId, projectName, projectReference, roundLabel: roundLbl });
        for (const lotId of lotIdsToExport) {
          const lotCompanies = companiesByLotId.get(Number(lotId)) || [];
          if (lotCompanies.length === 0) continue;
          try {
            const lot = byId.get(Number(lotId));
            const lotPrefix = sanitizeZipSegment(`${lot?.code || `Lot_${lotId}`}_${lot?.name || ''}`, `Lot_${lotId}`);
            for (const company of lotCompanies) {
              const file = await generateExportFile(req, 'questions', {
                lotId,
                roundId: round.id,
                companyId: company.id
              });
              const companyPrefix = sanitizeZipSegment(company.name, `Entreprise_${company.id}`);
              const filename = sanitizeZipSegment(
                `${companyPrefix}_Fiches_Questions_Lot_${lotId}_Tour_${round.round_number}.xlsx`,
                `Entreprise_${company.id}_Fiches_Questions.xlsx`
              );
              const zipPath = `${rStruct.questionSheets}/${lotPrefix}/${companyPrefix}/${filename}`;
              zip.file(zipPath, file.buffer);
            }
          } catch (e) {
            if (e.status !== 404) throw e;
          }
        }
      }
    }

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    const safeDate = new Date().toISOString().split('T')[0];
    const filename = `Exports_Projet_${projectId}_${safeDate}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(zipBuffer);
  } catch (err) {
    console.error('Erreur génération ZIP exports:', err);
    const status = Number.isInteger(err?.status) ? err.status : 500;
    res.status(status).json({ error: err.message || 'Erreur lors de la génération du ZIP' });
  }
});

// ===== SUIVI DES ENVOIS DE FICHES QUESTIONS =====

// Récupérer le statut d'envoi pour toutes les entreprises d'un lot/tour
router.get('/questions-send-status', async (req, res) => {
  try {
    const lotId = Number(req.query.lotId);
    const roundId = Number(req.query.roundId);
    if (!lotId || !roundId) {
      return res.status(400).json({ error: 'lotId et roundId obligatoires' });
    }

    // Vérifier accès au lot
    const lotRes = await query('SELECT project_id FROM lots WHERE id = $1', [lotId]);
    if (lotRes.rowCount === 0) return res.status(404).json({ error: 'Lot introuvable' });

    const userId = req.user.id;
    const projectId = lotRes.rows[0].project_id;
    const accessCheck = await query(
      `SELECT 1 FROM projects p
       LEFT JOIN project_shares ps ON ps.project_id = p.id AND ps.shared_with_user_id = $2
       WHERE p.id = $1 AND (p.owner_id = $2 OR ps.shared_with_user_id IS NOT NULL OR $3 IN ('admin', 'responsable'))`,
      [projectId, userId, req.user.role]
    );
    if (accessCheck.rowCount === 0) return res.status(403).json({ error: 'Accès non autorisé' });

    // Récupérer les entreprises du lot + leur dernier envoi
    const result = await query(
      `SELECT c.id, COALESCE(NULLIF(lc.display_name, ''), c.name) AS name, c.email, c.color,
              s.sent_at AS last_sent_at,
              s.sent_to_email AS last_sent_to_email,
              u.email AS sent_by_email,
              s.email_subject AS last_email_subject,
              (SELECT COUNT(*) FROM question_sheet_sends
               WHERE lot_id = $1 AND round_id = $2 AND company_id = c.id) AS send_count
       FROM lot_companies lc
       JOIN companies c ON c.id = lc.company_id
       LEFT JOIN LATERAL (
         SELECT qs.sent_at, qs.sent_to_email, qs.sent_by, qs.email_subject
         FROM question_sheet_sends qs
         WHERE qs.lot_id = $1 AND qs.round_id = $2 AND qs.company_id = c.id
         ORDER BY qs.sent_at DESC
         LIMIT 1
       ) s ON true
       LEFT JOIN users u ON u.id = s.sent_by
       WHERE lc.lot_id = $1
       ORDER BY lc.created_at, name`,
      [lotId, roundId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur récupération suivi envois:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération du suivi' });
  }
});

// Export ZIP des fiches questions: un fichier par entreprise
router.get('/questions-by-company/:lotId', async (req, res) => {
  try {
    const lotId = Number(req.params.lotId);
    const roundId = Number(req.query.round_id);
    const status = req.query.status ? String(req.query.status) : '';
    const companyIdFilter = req.query.company_id ? Number(req.query.company_id) : null;
    const isEntreprise = req.user?.role === 'entreprise';
    const userCompanyId = req.user?.company_id || null;

    if (!lotId) return res.status(400).json({ error: 'lotId invalide' });
    if (!roundId) return res.status(400).json({ error: 'round_id obligatoire' });

    const lotRes = await query('SELECT project_id FROM lots WHERE id = $1', [lotId]);
    if (lotRes.rowCount === 0) return res.status(404).json({ error: 'Lot introuvable' });

    const projectId = lotRes.rows[0].project_id;
    const accessCheck = await query(
      `SELECT 1 FROM projects p
       LEFT JOIN project_shares ps ON ps.project_id = p.id AND ps.shared_with_user_id = $2
       WHERE p.id = $1 AND (p.owner_id = $2 OR ps.shared_with_user_id IS NOT NULL OR $3 IN ('admin', 'responsable'))`,
      [projectId, req.user.id, req.user.role]
    );
    if (accessCheck.rowCount === 0) return res.status(403).json({ error: 'Accès non autorisé' });

    const params = [lotId];
    let companyWhere = '';
    if (isEntreprise) {
      if (!userCompanyId) return res.status(403).json({ error: 'Aucune entreprise associée à ce compte' });
      params.push(userCompanyId);
      companyWhere = ` AND c.id = $${params.length}`;
    } else if (companyIdFilter) {
      params.push(companyIdFilter);
      companyWhere = ` AND c.id = $${params.length}`;
    }

    const companiesRes = await query(
      `SELECT c.id, COALESCE(NULLIF(lc.display_name, ''), c.name) AS name
       FROM lot_companies lc
       JOIN companies c ON c.id = lc.company_id
       WHERE lc.lot_id = $1${companyWhere}
       ORDER BY lc.created_at, name`,
      params
    );

    if (companiesRes.rowCount === 0) {
      return res.status(404).json({ error: 'Aucune entreprise trouvée pour ce lot' });
    }

    const zip = new JSZip();
    let addedCount = 0;
    for (const company of companiesRes.rows) {
      try {
        const file = await generateExportFile(req, 'questions', {
          lotId,
          roundId,
          companyId: Number(company.id),
          status
        });

        const companyPrefix = sanitizeZipSegment(company.name, `Entreprise_${company.id}`);
        const fileName = sanitizeZipSegment(
          `${companyPrefix}_Fiches_Questions_Lot_${lotId}_Tour_${roundId}.xlsx`,
          `Entreprise_${company.id}_Fiches_Questions.xlsx`
        );
        zip.file(fileName, file.buffer);
        addedCount++;
      } catch (e) {
        if (e.status !== 404) throw e;
      }
    }

    if (addedCount === 0) {
      return res.status(404).json({ error: 'Aucune fiche question à exporter pour les entreprises sélectionnées' });
    }

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    const safeDate = new Date().toISOString().split('T')[0];
    const filename = `Fiches_Questions_Lot_${lotId}_Par_Entreprise_${safeDate}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(zipBuffer);
  } catch (err) {
    console.error('Erreur export fiches questions par entreprise:', err);
    const status = Number.isInteger(err?.status) ? err.status : 500;
    res.status(status).json({ error: err.message || 'Erreur lors de l\'export' });
  }
});

// Envoyer la fiche question à une entreprise spécifique et enregistrer l'envoi
router.post('/send-questions-to-company', async (req, res) => {
  try {
    const { lotId, roundId, companyId, email, subject, message } = req.body;

    if (!lotId || !roundId || !companyId || !email) {
      return res.status(400).json({ error: 'lotId, roundId, companyId et email obligatoires' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Adresse email invalide' });
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({ error: 'Configuration email non disponible sur le serveur' });
    }

    // Vérifier accès
    const lotRes = await query('SELECT project_id FROM lots WHERE id = $1', [lotId]);
    if (lotRes.rowCount === 0) return res.status(404).json({ error: 'Lot introuvable' });

    const projectId = lotRes.rows[0].project_id;
    const userId = req.user.id;
    const accessCheck = await query(
      `SELECT 1 FROM projects p
       LEFT JOIN project_shares ps ON ps.project_id = p.id AND ps.shared_with_user_id = $2
       WHERE p.id = $1 AND (p.owner_id = $2 OR ps.shared_with_user_id IS NOT NULL OR $3 IN ('admin', 'responsable'))`,
      [projectId, userId, req.user.role]
    );
    if (accessCheck.rowCount === 0) return res.status(403).json({ error: 'Accès non autorisé' });

    // Générer le fichier Excel des fiches questions filtré par entreprise
    const { buffer, filename, contentType } = await generateExportFile(req, 'questions', {
      lotId: Number(lotId),
      roundId: Number(roundId),
      companyId: String(companyId)
    });

    const finalSubject = subject || `Fiches Questions - Lot ${lotId}`;
    const mailOptions = {
      from: `"AO Link" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: finalSubject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Fiches Questions AO Link</h2>
          ${message ? `<p style="white-space: pre-line;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : ''}
          <p style="color: #666; font-size: 14px; margin-top: 20px;">
            Veuillez trouver ci-joint le fichier Excel des fiches questions exporté depuis AO Link.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="color: #999; font-size: 12px;">
            Envoyé par ${req.user.email} via AO Link
          </p>
        </div>
      `,
      attachments: [{ filename, content: buffer, contentType }]
    };

    await getEmailTransporter().sendMail(mailOptions);

    // Enregistrer l'envoi
    await query(
      `INSERT INTO question_sheet_sends (lot_id, round_id, company_id, sent_by, sent_to_email, email_subject)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [lotId, roundId, companyId, userId, email, finalSubject]
    );

    console.log(`✅ Fiches questions envoyées à ${email} (lot ${lotId}, tour ${roundId}, entreprise ${companyId}) par ${req.user.email}`);
    res.json({ success: true, sent_to: email });

  } catch (err) {
    console.error('Erreur envoi fiches questions:', err);
    res.status(500).json({ error: 'Erreur lors de l\'envoi: ' + err.message });
  }
});

router.post('/send-email', async (req, res) => {
  try {
    const { to, subject, message, exportType, exportParams } = req.body;

    // Validation des champs obligatoires
    if (!to || !subject || !exportType) {
      return res.status(400).json({ error: 'Champs obligatoires manquants (to, subject, exportType)' });
    }

    // Validation basique des adresses email
    const emailList = Array.isArray(to) ? to : to.split(',').map(e => e.trim()).filter(Boolean);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const email of emailList) {
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: `Adresse email invalide: ${email}` });
      }
    }

    // Vérifier que l'email est configuré
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({ error: 'Configuration email non disponible sur le serveur' });
    }

    const { buffer, filename, contentType } = await generateExportFile(req, exportType, exportParams || {});

    // Envoyer l'email avec la pièce jointe
    const mailOptions = {
      from: `"AO Link" <${process.env.EMAIL_USER}>`,
      to: emailList.join(', '),
      subject: subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Export AO Link</h2>
          ${message ? `<p style="white-space: pre-line;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : ''}
          <p style="color: #666; font-size: 14px; margin-top: 20px;">
            Veuillez trouver ci-joint le fichier Excel exporté depuis AO Link.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="color: #999; font-size: 12px;">
            Envoyé par ${req.user.email} via AO Link
          </p>
        </div>
      `,
      attachments: [{
        filename: filename,
        content: buffer,
        contentType: contentType
      }]
    };

    await getEmailTransporter().sendMail(mailOptions);
    console.log(`✅ Export email envoyé à ${emailList.join(', ')} par ${req.user.email}`);
    res.json({ success: true, message: `Email envoyé à ${emailList.length} destinataire(s)` });

  } catch (err) {
    console.error('Erreur envoi email export:', err);
    res.status(500).json({ error: 'Erreur lors de l\'envoi de l\'email: ' + err.message });
  }
});

export default router;
