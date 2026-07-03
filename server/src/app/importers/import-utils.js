/**
 * Helpers partagés entre les importers (smart-import, options-import).
 * Extraction de champs, parsing de nombres et normalisation pour le matching.
 */

/* =============== Parsing de valeurs =============== */

export function parseNumber(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number') return isFinite(val) ? val : null;
  // Gestion des formats français : "1 234,56" → 1234.56
  let s = String(val).trim();
  if (s === '') return null;
  // Style (123) => -123
  if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
  // Supprimer symboles courants et espaces (séparateur milliers)
  s = s.replace(/[\u20AC$\u00A3\u00A5\u20B9%]/g, '');
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
export function extractComment(val) {
  if (val == null || val === '') return null;
  const str = String(val).trim();
  if (str === '') return null;
  // Si c'est un nombre valide, pas de commentaire
  const n = parseNumber(val);
  if (n !== null) return null;
  // Sinon, retourner le texte comme commentaire
  return str;
}

/* =============== Détection de lignes titre / sous-total =============== */

// Patterns pour détecter les lignes sous-total / titre de chapitre à ignorer
export const SUBTITLE_PATTERNS = [
  /^\s*sous[\s-]*total/i,
  /^\s*total\s/i,
  /^\s*total$/i,
  /^\s*s\.?\s*t\.?\s*$/i,
  /^\s*chapitre\s/i,
  /^\s*lot\s+\d/i,
  /^\s*tranche\s/i,
];

export function isSubtotalOrTitleRow(designation) {
  if (!designation) return false;
  const d = String(designation).trim();
  // Une désignation sans quantité/prix n'est pas forcément un titre : l'entreprise
  // peut renseigner ces valeurs plus tard lors de l'import de son offre. On ne
  // filtre donc que les motifs explicites de sous-total / titre de chapitre.
  return SUBTITLE_PATTERNS.some(p => p.test(d));
}

/* =============== Extraction Num / Désignation =============== */

/**
 * Fusionne plusieurs colonnes de désignation avec indentation hiérarchique.
 * Chaque colonne supplémentaire ajoute 1 espace (non-sécable) d'indentation.
 * @param {Object} row - La ligne de données
 * @param {number|number[]} designationCols - Index de colonne(s)
 * @returns {string} Désignation fusionnée avec indentation
 */
export function buildDesignation(row, designationCols) {
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

export function buildNum(row, numCols) {
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

export function buildArticleFields(row, mapping) {
  let num = buildNum(row, mapping?.num);
  let designation = buildDesignation(row, mapping?.designation);
  const split = splitMixedNumDesignationColumns(row, mapping?.num);
  if (split) {
    num = split.num;
    if (!designation && split.designation) designation = split.designation;
  }
  return { num, designation };
}

export function splitMixedNumDesignationColumns(row, numCols) {
  if (!numCols) return null;
  const cols = (Array.isArray(numCols) ? numCols : [numCols])
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (cols.length === 0) return null;

  const numericParts = [];
  const designationParts = [];
  let hasNonNumericInNumCols = false;

  cols.forEach((col, index) => {
    const val = String(row[col] ?? '').trim();
    if (!val) return;
    if (looksLikeArticleNum(val)) {
      numericParts.push(val);
    } else {
      hasNonNumericInNumCols = true;
      designationParts.push({ index, val });
    }
  });

  if (!hasNonNumericInNumCols) return null;
  const deepestDesignation = designationParts[designationParts.length - 1];
  return {
    num: numericParts.length ? numericParts.join('') : null,
    designation: deepestDesignation ? `${'\u00A0'.repeat(deepestDesignation.index)}${deepestDesignation.val}` : '',
  };
}

export function splitArticleNumAndDesignation(value) {
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

export function looksLikeArticleNum(value) {
  return !!splitArticleNumAndDesignation(value)?.num;
}

/* =============== Normalisation pour le matching =============== */

export function normalizeArticleNum(value) {
  if (!value) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s\u00A0\u202F]/g, '')
    .replace(/[._\-/]+/g, '')
    .replace(/^0+(?=\d)/, '')
    .replace(/\.0+$/, '');
}

export function normalizeDesignationForMatch(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00A0\u2007\u200B\u202F\u2009]/g, ' ')
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compactDesignationForMatch(value) {
  return normalizeDesignationForMatch(value).replace(/[^a-z0-9]/g, '');
}

/**
 * Score de similarité (0-100) entre deux désignations.
 * 100 = identique, 90/85 = préfixe l'un de l'autre, ≤80 = similarité par mots (Jaccard).
 */
export function scoreDesignationMatch(a, b) {
  const na = normalizeDesignationForMatch(a);
  const nb = normalizeDesignationForMatch(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  // L'un est le préfixe de l'autre (entreprise a tronqué ou ajouté du texte après)
  if (nb.startsWith(na) && na.length > nb.length * 0.6) return 90;
  if (na.startsWith(nb) && nb.length > na.length * 0.6) return 85;
  // Similarité Jaccard sur les mots de longueur > 2
  const wordsA = new Set(na.split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(nb.split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let common = 0;
  for (const w of wordsA) if (wordsB.has(w)) common++;
  const union = new Set([...wordsA, ...wordsB]).size;
  return Math.round(common / union * 80);
}
