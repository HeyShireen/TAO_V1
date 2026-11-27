/**
 * Helpers partagés entre les importers (smart-import, options-import).
 * Extraction de champs, parsing de nombres et normalisation pour le matching.
 */

/* =============== Parsing de valeurs =============== */

/**
 * Convertit une cellule en nombre, ou retourne null.
 *
 * Regle de surete : on ne devine jamais. Une cellule qui n'est pas un nombre
 * complet (reference textuelle, numero d'article, plage de valeurs) retourne
 * null plutot qu'une valeur approchee — un mauvais mapping de colonne doit se
 * voir comme une absence de valeur, et non produire un montant faux.
 * Seules decorations tolerees : symbole monetaire, pourcentage, et unite
 * accolee APRES la valeur (« 12,50 €/m2 », « 1500 HT », « 3 m³ »).
 */
export function parseNumber(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number') return isFinite(val) ? val : null;
  // Gestion des formats français : "1 234,56" → 1234.56
  let s = String(val).trim();
  if (s === '') return null;
  // Style (123) => -123
  if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
  // Supprimer symboles courants et espaces (séparateur milliers)
  s = s.replace(/[€$£¥₹%]/g, '');
  s = s.replace(/[   \s]/g, '');
  if (s === '') return null;
  // Unite accolee a la valeur : on la retire, mais seulement si elle SUIT un
  // nombre (« 12,50/m2 » -> « 12,50 »). « REF-12 » ne correspond pas.
  s = s.replace(/^(-?[\d.,]+)\/?[a-z°]+[23²³]?$/i, '$1');
  // Plus aucune lettre ne doit subsister : une reference textuelle ne doit pas
  // ressortir en nombre silencieusement (« REF-12 » donnait -12).
  if (/[a-z°²³]/i.test(s)) return null;
  // Un signe moins ailleurs qu'en tete n'est pas un nombre (« 12-14 »).
  if (s.indexOf('-') > 0) return null;
  // Si virgule et pas de point → format français
  if (s.includes(',') && !s.includes('.')) {
    s = s.replace(',', '.');
  }
  // Si point et virgule → format "1.234,56"
  else if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  // Milliers separes par des points, sans decimale : non ambigu a partir de
  // deux groupes (« 1.234.567 » ne peut pas etre un decimal).
  else if (/^-?\d{1,3}(?:\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  // La valeur doit etre un nombre complet : pas de repli qui extrairait
  // « 61.1 » de « 61.1.0 ».
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
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
  // Fusion des colonnes N° article avec un separateur canonique : deux
  // colonnes « 1 » et « 2 » designent l'article 1.2, pas l'article 12.
  return parts.join('.');
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
    num: numericParts.length ? numericParts.join('.') : null,
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

/**
 * Cle de rapprochement d'un numero d'article.
 *
 * Les separateurs sont REMPLACES par un point canonique, jamais supprimes :
 * « 1.2 », « 1-2 » et « 1 / 2 » designent le meme article, mais « 1.2 » et
 * « 12 » sont deux articles differents. Les supprimer rendait « 1.20 » et
 * « 120 » indiscernables, et produisait un faux positif au score 100 —
 * le numero d'article etant le critere de rapprochement prioritaire.
 */
export function normalizeArticleNum(value) {
  if (!value) return '';
  const compact = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s  ]/g, '');
  if (!compact) return '';
  const segments = compact.split(/[._\-/]+/).filter((seg) => seg !== '');
  if (segments.length === 0) return '';
  return segments
    .map((seg) => seg.replace(/^0+(?=[0-9])/, '')) // zeros de tete, par segment
    .join('.')
    .replace(/\.0+$/, ''); // « 1.0 » (coercition Excel d'un « 1 ») -> « 1 »
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
 * Distance de Levenshtein, bornee : retourne maxDistance + 1 des que la
 * distance depasse la borne, pour eviter de calculer la matrice entiere.
 */
export function levenshteinDistance(a, b, maxDistance = Infinity) {
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
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current[j] = value;
      if (value < minInRow) minInRow = value;
    }
    if (minInRow > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[b.length];
}

/** Deux designations identiques a une faute de frappe pres. */
export function isSameDesignationWithinTolerance(a, b) {
  const normalizedA = normalizeDesignationForMatch(a);
  const normalizedB = normalizeDesignationForMatch(b);
  if (!normalizedA || !normalizedB) return normalizedA === normalizedB;
  if (normalizedA === normalizedB) return true;

  const compactA = compactDesignationForMatch(a);
  const compactB = compactDesignationForMatch(b);
  if (!compactA || !compactB) return compactA === compactB;
  if (compactA === compactB) return true;

  const maxDistance = compactA.length <= 12 && compactB.length <= 12 ? 1 : 2;
  const distance = levenshteinDistance(compactA, compactB, maxDistance);
  const longestLength = Math.max(compactA.length, compactB.length);
  return distance <= maxDistance && distance / longestLength <= 0.12;
}

function extractDesignationSeriesMarker(designation) {
  const normalized = normalizeDesignationForMatch(designation);
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

/**
 * Deux designations qui partagent la meme base mais finissent par des marqueurs
 * de serie differents (1/2/3 ou A/B/C) ne doivent JAMAIS etre appariees : c'est
 * le garde-fou anti-permutation (« Diffuseur type 1 » ne doit pas recevoir le
 * prix de « Diffuseur type 2 »). Il reste prioritaire sur tout score.
 */
export function hasConflictingSeriesMarker(a, b) {
  const markerA = extractDesignationSeriesMarker(a);
  const markerB = extractDesignationSeriesMarker(b);
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

/**
 * Score de similarite (0-100) entre deux designations. SCOREUR UNIQUE du
 * projet : importDPGF, importOffer, options-import et la reconciliation des
 * postes ajoutes passent tous par ici. Une seconde implementation divergente
 * vivait dans smart-import.js ; elle a ete supprimee.
 *
 *   0 = marqueurs de serie incompatibles, ou rien en commun
 * 100 = identique apres normalisation
 *  90 = la seconde commence par la premiere (l'entreprise a enrichi le libelle)
 *  85 = la premiere commence par la seconde (l'entreprise a tronque)
 * <80 = similarite par mots
 *
 * @param {string} a designation de reference (DPGF)
 * @param {string} b designation comparee (offre)
 */
export function scoreDesignationMatch(a, b) {
  const na = normalizeDesignationForMatch(a);
  const nb = normalizeDesignationForMatch(b);
  if (!na || !nb) return 0;
  if (hasConflictingSeriesMarker(a, b)) return 0;
  if (na === nb) return 100;
  // L'un est le prefixe de l'autre (texte ajoute ou tronque par l'entreprise)
  if (nb.startsWith(na)) return 90;
  if (na.startsWith(nb) && nb.length > na.length * 0.6) return 85;
  // Similarite par mots de longueur > 2
  const wordsA = new Set(na.split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(nb.split(/\s+/).filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let common = 0;
  for (const w of wordsA) if (wordsB.has(w)) common++;
  return Math.round((common / Math.max(wordsA.size, wordsB.size)) * 80);
}
