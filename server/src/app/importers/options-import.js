/**
 * Options Import — Détection et import automatique des options (variantes, PSE)
 * présentes dans les fichiers DPGF et offres entreprise.
 *
 * Une "option" est un mini-lot cochable dans le comparatif (tables options,
 * option_items, option_item_moe, option_item_offers). Jusqu'ici les options
 * étaient saisies à la main ; ce module les extrait automatiquement des
 * fichiers importés.
 *
 * Détection (heuristique, ligne par ligne) :
 *  - Une ligne titre (sans qty/PU/montant) du type "OPTIONS", "Option 1 - ...",
 *    "VARIANTES", "PSE", "Prestations supplémentaires..." ouvre une zone options.
 *  - Dans la zone, chaque sous-titre crée une nouvelle option ; les lignes de
 *    données qui suivent en deviennent les articles.
 *  - Sans sous-titre, chaque ligne de données de la zone devient une option
 *    à article unique (cas DPGF classique : "OPTIONS" puis une ligne par option).
 *  - Hors zone, une ligne marquée "(option)", "en option", "variante N", "PSE N"
 *    ou numérotée "O1"/"OPT 2" devient une option à article unique.
 *  - Une ligne "TOTAL", "chapitre", "lot N" referme la zone options.
 */

import {
  buildArticleFields,
  parseNumber,
  normalizeArticleNum,
  scoreDesignationMatch,
} from './import-utils.js';

/* =============== Détection =============== */

// Titres qui ouvrent une zone options (ligne sans données chiffrées)
const OPTION_HEADER_RES = [
  /^option(s)?\b/i,
  /^variante(s)?\b/i,
  /^pse\b/i,
  /^prestation(s)?\s+suppl/i,          // "Prestations supplémentaires (éventuelles)"
  /^tranche(s)?\s+(conditionnelle|optionnelle)/i,
];

// Marqueurs "option" portés par une ligne de données isolée
const OPTION_INLINE_RES = [
  /\((?:en\s+)?option(?:nelle?s?)?\)/i,  // "(option)", "(en option)", "(optionnelle)"
  /\ben\s+option\b/i,
  /^option\s*(?:n[°o]|#)?\s*\d+/i,       // "Option 1 : ..."
  /\bvariante\s*(?:n[°o]|#)?\s*\d+/i,
  /\bpse\s*(?:n[°o]|#)?\s*\d+/i,
];

// N° d'article typé option : "O1", "O 2.1", "OPT-3", "PSE 4"
const OPTION_NUM_RE = /^(?:o|opt|pse)[\s.\-]*\d/i;

// Titres qui referment la zone options / clôturent l'option courante
const SECTION_CLOSE_RE = /^\s*(total\b|chapitre\s|lot\s+\d|tranche\s)/i;
const SUBTOTAL_RE = /^\s*sous[\s-]*total/i;

function cleanText(value) {
  // Retire l'indentation nbsp ajoutée par buildDesignation + espaces parasites
  return String(value ?? '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isOptionHeader(designation) {
  const d = cleanText(designation);
  if (!d) return false;
  return OPTION_HEADER_RES.some((re) => re.test(d));
}

function hasInlineOptionMarker(designation) {
  const d = cleanText(designation);
  if (!d) return false;
  return OPTION_INLINE_RES.some((re) => re.test(d));
}

/** Retire le préfixe "O"/"OPT"/"PSE" d'un num d'option ("O1.2" → "1.2") */
function stripOptionNumPrefix(num) {
  const s = String(num ?? '').trim();
  if (!s) return s;
  if (OPTION_NUM_RE.test(s)) {
    return s.replace(/^(?:opt|pse|o)[\s.\-]*/i, '').trim() || s;
  }
  return s;
}

function extractRecord(row, mapping) {
  const { num, designation } = buildArticleFields(row, mapping);
  const unit = mapping.unit ? String(row[mapping.unit] ?? '').trim() : null;
  const qty = mapping.qty ? parseNumber(row[mapping.qty]) : null;
  const pu = mapping.unit_price ? parseNumber(row[mapping.unit_price]) : null;
  const mt = mapping.amount ? parseNumber(row[mapping.amount]) : null;
  return { num, designation, unit, qty, pu, mt, rowNum: row._rowNum ?? null };
}

/**
 * Sépare les lignes d'un fichier importé en lignes "principales" (DPGF/offre
 * classique) et sections d'options détectées.
 *
 * @param {Object[]} dataRows - Lignes brutes ({ colIndex: valeur, _rowNum? })
 * @param {Object} mapping   - Mapping colonnes validé ({ num, designation, ... })
 * @returns {{ mainRows: Object[], sections: {designation: string, rows: Object[]}[], optionRowNums: number[] }}
 */
export function splitOptionRows({ dataRows, mapping }) {
  const mainRows = [];
  const sections = [];
  const optionRowNums = [];

  let inOptionZone = false;
  let currentSection = null;   // section ouverte par un (sous-)titre

  const openSection = (designation) => {
    currentSection = { designation: cleanText(designation), rows: [] };
    sections.push(currentSection);
  };

  for (const row of dataRows) {
    const rec = extractRecord(row, mapping);
    const hasData = rec.qty != null || rec.pu != null || rec.mt != null;
    const label = cleanText(rec.designation);

    if (!hasData) {
      // --- Ligne titre / vide ---
      if (!label && !rec.num) {
        if (!inOptionZone) mainRows.push(row);
        continue;
      }
      if (isOptionHeader(label)) {
        inOptionZone = true;
        currentSection = null;
        // Titre porteur d'un nom précis ("Option 1 - Éclairage LED") → ouvre une option.
        // Titre générique ("OPTIONS", "VARIANTES") → chaque ligne suivante devient sa propre option.
        if (!/^(option|variante|pse)s?\s*:?$/i.test(label)) openSection(label);
        if (rec.rowNum != null) optionRowNums.push(rec.rowNum);
        continue;
      }
      if (inOptionZone) {
        if (SECTION_CLOSE_RE.test(label)) {
          // Fin de la zone options ; la ligne repart dans le flux principal
          inOptionZone = false;
          currentSection = null;
          mainRows.push(row);
        } else if (SUBTOTAL_RE.test(label)) {
          // Sous-total interne : clôture l'option courante, reste dans la zone
          currentSection = null;
          if (rec.rowNum != null) optionRowNums.push(rec.rowNum);
        } else {
          // Sous-titre → nouvelle option
          openSection(label);
          if (rec.rowNum != null) optionRowNums.push(rec.rowNum);
        }
        continue;
      }
      mainRows.push(row);
      continue;
    }

    // --- Ligne de données ---
    const record = { ...rec, num: stripOptionNumPrefix(rec.num) };
    if (inOptionZone) {
      if (currentSection) {
        currentSection.rows.push(record);
      } else {
        // Zone générique : chaque ligne = une option à article unique
        sections.push({ designation: label || `Option ${sections.length + 1}`, rows: [record] });
      }
      if (rec.rowNum != null) optionRowNums.push(rec.rowNum);
      continue;
    }
    if (hasInlineOptionMarker(label) || (rec.num && OPTION_NUM_RE.test(String(rec.num).trim()))) {
      sections.push({ designation: label || `Option ${sections.length + 1}`, rows: [record] });
      if (rec.rowNum != null) optionRowNums.push(rec.rowNum);
      continue;
    }
    mainRows.push(row);
  }

  // Purger les sections restées vides (titre d'option sans articles)
  const nonEmpty = sections.filter((s) => s.rows.length > 0 && s.designation);
  return { mainRows, sections: nonEmpty, optionRowNums };
}

/* =============== Import DPGF (options + articles + MOE) =============== */

/**
 * Trouve un tour à rattacher aux options quand l'appelant n'en fournit pas
 * (import DPGF depuis la vue projet) : premier tour du projet du lot.
 */
export async function resolveRoundIdForLot(client, lotId) {
  const res = await client.query(
    `SELECT r.id
     FROM rounds r
     JOIN lots l ON l.project_id = r.project_id
     WHERE l.id = $1
     ORDER BY r.round_number ASC, r.id ASC
     LIMIT 1`,
    [lotId]
  );
  return res.rows[0]?.id ?? null;
}

/**
 * Importe les sections d'options détectées dans une DPGF.
 * Une option existante (même désignation, même lot+tour) voit ses articles
 * remplacés ; les options absentes du fichier ne sont jamais supprimées
 * (elles peuvent avoir été saisies à la main).
 */
export async function importOptionSectionsDpgf(client, { lotId, roundId, sections }) {
  let optionsCreated = 0;
  let optionsUpdated = 0;
  let optionItemsImported = 0;

  for (const section of sections) {
    const designation = String(section.designation).slice(0, 255);
    const existing = await client.query(
      'SELECT id FROM options WHERE lot_id = $1 AND round_id = $2 AND LOWER(designation) = LOWER($3) LIMIT 1',
      [lotId, roundId, designation]
    );

    let optionId;
    if (existing.rowCount > 0) {
      optionId = existing.rows[0].id;
      await client.query('DELETE FROM option_items WHERE option_id = $1', [optionId]);
      optionsUpdated++;
    } else {
      const ins = await client.query(
        'INSERT INTO options (lot_id, round_id, designation) VALUES ($1, $2, $3) RETURNING id',
        [lotId, roundId, designation]
      );
      optionId = ins.rows[0].id;
      optionsCreated++;
    }

    for (const r of section.rows) {
      const itemIns = await client.query(
        'INSERT INTO option_items (option_id, num, designation, unit) VALUES ($1, $2, $3, $4) RETURNING id',
        [optionId, r.num || null, String(r.designation ?? '').slice(0, 255), r.unit || null]
      );
      if (r.qty != null || r.pu != null) {
        await client.query(
          'INSERT INTO option_item_moe (option_item_id, qty, unit_price) VALUES ($1, $2, $3)',
          [itemIns.rows[0].id, r.qty, r.pu]
        );
      }
      optionItemsImported++;
    }
  }

  return { optionsCreated, optionsUpdated, optionItemsImported };
}

/* =============== Import Offre (offres sur articles d'option) =============== */

const OPTION_MATCH_THRESHOLD = 60;
const OPTION_ITEM_MATCH_THRESHOLD = 70;

/**
 * Importe les sections d'options d'une offre entreprise : matche chaque section
 * sur les options existantes du lot+tour (désignation), puis chaque ligne sur
 * les articles de l'option (num puis désignation). Les options/articles absents
 * sont créés pour ne perdre aucune donnée chiffrée.
 */
export async function importOptionSectionsOffer(client, { lotId, roundId, companyId, sections }) {
  let optionOffersImported = 0;
  let optionsCreated = 0;
  let optionItemsCreated = 0;

  const optionsRes = await client.query(
    'SELECT id, designation FROM options WHERE lot_id = $1 AND round_id = $2 ORDER BY created_at ASC',
    [lotId, roundId]
  );
  const existingOptions = optionsRes.rows;
  const itemsByOption = new Map();
  if (existingOptions.length > 0) {
    const itemsRes = await client.query(
      `SELECT oi.id, oi.option_id, oi.num, oi.designation
       FROM option_items oi
       WHERE oi.option_id = ANY($1::int[])
       ORDER BY oi.id ASC`,
      [existingOptions.map((o) => o.id)]
    );
    for (const item of itemsRes.rows) {
      if (!itemsByOption.has(item.option_id)) itemsByOption.set(item.option_id, []);
      itemsByOption.get(item.option_id).push(item);
    }
  }

  for (const section of sections) {
    const designation = String(section.designation).slice(0, 255);

    // 1) Matcher la section sur une option existante (meilleur score)
    let matchedOption = null;
    let bestScore = 0;
    for (const opt of existingOptions) {
      const score = scoreDesignationMatch(opt.designation, designation);
      if (score > bestScore) { bestScore = score; matchedOption = opt; }
    }
    if (!matchedOption || bestScore < OPTION_MATCH_THRESHOLD) {
      // Option à article unique : retenter le match au niveau article
      // (la désignation de la ligne sert de désignation d'option côté DPGF)
      matchedOption = null;
    }

    let optionId;
    if (matchedOption) {
      optionId = matchedOption.id;
    } else {
      const ins = await client.query(
        'INSERT INTO options (lot_id, round_id, designation) VALUES ($1, $2, $3) RETURNING id',
        [lotId, roundId, designation]
      );
      optionId = ins.rows[0].id;
      existingOptions.push({ id: optionId, designation });
      itemsByOption.set(optionId, []);
      optionsCreated++;
    }

    const optionItems = itemsByOption.get(optionId) || [];

    for (const r of section.rows) {
      // 2) Matcher la ligne sur un article de l'option : num d'abord, puis désignation
      let matchedItem = null;
      const normNum = normalizeArticleNum(r.num);
      if (normNum) {
        matchedItem = optionItems.find((it) => normalizeArticleNum(it.num) === normNum);
      }
      if (!matchedItem && r.designation) {
        let bestItemScore = 0;
        for (const it of optionItems) {
          const score = scoreDesignationMatch(it.designation, r.designation);
          if (score > bestItemScore) { bestItemScore = score; matchedItem = it; }
        }
        if (bestItemScore < OPTION_ITEM_MATCH_THRESHOLD) matchedItem = null;
      }
      // Option à article unique des deux côtés → match direct
      if (!matchedItem && section.rows.length === 1 && optionItems.length === 1) {
        matchedItem = optionItems[0];
      }

      if (!matchedItem) {
        const itemIns = await client.query(
          'INSERT INTO option_items (option_id, num, designation, unit) VALUES ($1, $2, $3, $4) RETURNING id, num, designation',
          [optionId, r.num || null, String(r.designation ?? '').slice(0, 255), r.unit || null]
        );
        matchedItem = itemIns.rows[0];
        optionItems.push(matchedItem);
        itemsByOption.set(optionId, optionItems);
        optionItemsCreated++;
      }

      await client.query(
        `INSERT INTO option_item_offers (option_item_id, company_id, round_id, qty, unit_price, unit)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (option_item_id, company_id, round_id) DO UPDATE
         SET qty = EXCLUDED.qty, unit_price = EXCLUDED.unit_price, unit = EXCLUDED.unit`,
        [matchedItem.id, companyId, roundId, r.qty, r.pu, r.unit || null]
      );
      optionOffersImported++;
    }
  }

  return { optionOffersImported, optionsCreated, optionItemsCreated };
}
