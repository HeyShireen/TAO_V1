// server/src/public/app.js
// Front monolithique (same-origin)
const API_ROOT = window.location.origin;
const API_BASE = API_ROOT + '/api';

/* ====== Logo error handling ====== */
document.addEventListener('DOMContentLoaded', () => {
  const loginLogo = document.getElementById('login-logo');
  const headerLogo = document.getElementById('header-logo');
  
  if (loginLogo) {
    loginLogo.addEventListener('error', function() {
      this.style.display = 'none';
    });
  }
  
  if (headerLogo) {
    headerLogo.addEventListener('error', function() {
      this.style.display = 'none';
    });
  }
});

/* ====== Auth ================= */
let token = localStorage.getItem('token') || null;
let currentUser = null;     // {id, email, role}
let currentProject = null;
let currentRound = null;    // Tour/phase actuel
let currentLot = null;
let currentProjectLots = [];
let globalLotThresholds = [];

let lotCompanies = [];      // [{id,name}]
let sheetRows = [];         // [{ item_id, num, designation, unit, moe:{qty,pu}, offers:{[cid]:{u,qty,pu}} }]
let lotOptions = [];        // [{ id, designation, unit, offers:[{company_id,qty,unit_price}], checked:bool }]
let unansweredConfig = { comment: 'Article sans réponse', color: '#fff3cd' }; // config for unanswered cells
const unexpectedAnswerMarker = {
  label: 'Réponse non attendue',
  color: '#e83e8c'
};
let selectedRoundOptions = new Set();
let questionsEditorAutoRefreshInterval = null; // Pour l'auto-actualisation de l'éditeur
const undoStack = [];
const redoStack = [];
let sheetSelection = {
  anchor: null,
  focus: null,
  explicit: false,
  mouseDown: false,
  dragging: false
};
const DEFAULT_SIMULATIONS = 3;
let roundsSimulations = [];
let roundsSimulationsInitialized = false;
let pendingEmailExport = null;
let dataExportContext = 'data-sheet';
let currentProjectExport = { projectId: null, projectName: '', lots: [], scopeLevel: 'project', scopeLotId: null };
let nextSimulationId = 1;
const MACRO_LOT_COLORS_STORAGE_KEY = 'macroLotColorsByProject';
const QUESTION_COLUMN_WIDTH_STORAGE_KEY = 'questionsEditorQuestionColumnWidth';
const LOT_THRESHOLD_FIELDS = [
  'qty_very_low_threshold', 'qty_low_threshold', 'qty_high_threshold', 'qty_very_high_threshold',
  'price_very_low_threshold', 'price_low_threshold', 'price_high_threshold', 'price_very_high_threshold',
  'amount_very_low_threshold', 'amount_low_threshold', 'amount_high_threshold', 'amount_very_high_threshold'
];
const LOT_THRESHOLD_DEFAULTS = {
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
const GLOBAL_THRESHOLD_GROUPS = [
  {
    title: 'Seuils de Quantité',
    icon: 'box',
    fields: [
      { key: 'qty_very_low_threshold', label: 'Très Basse', color: '#0d6efd' },
      { key: 'qty_low_threshold', label: 'Basse', color: '#0dcaf0' },
      { key: 'qty_high_threshold', label: 'Haute', color: '#fd7e14' },
      { key: 'qty_very_high_threshold', label: 'Très Haute', color: '#dc3545' }
    ]
  },
  {
    title: 'Seuils de Prix Unitaire',
    icon: 'chart',
    fields: [
      { key: 'price_very_low_threshold', label: 'Très Bas', color: '#0d6efd' },
      { key: 'price_low_threshold', label: 'Bas', color: '#0dcaf0' },
      { key: 'price_high_threshold', label: 'Haut', color: '#fd7e14' },
      { key: 'price_very_high_threshold', label: 'Très Haut', color: '#dc3545' }
    ]
  },
  {
    title: 'Seuils de Montant',
    icon: 'chart',
    fields: [
      { key: 'amount_very_low_threshold', label: 'Très Bas', color: '#0d6efd' },
      { key: 'amount_low_threshold', label: 'Bas', color: '#0dcaf0' },
      { key: 'amount_high_threshold', label: 'Haut', color: '#fd7e14' },
      { key: 'amount_very_high_threshold', label: 'Très Haut', color: '#dc3545' }
    ]
  }
];
const QUESTION_CONFIG_FIELDS = {
  qty_very_low_threshold: 'question_qty_very_low',
  qty_low_threshold: 'question_qty_low',
  qty_high_threshold: 'question_qty_high',
  qty_very_high_threshold: 'question_qty_very_high',
  price_very_low_threshold: 'question_price_very_low',
  price_low_threshold: 'question_price_low',
  price_high_threshold: 'question_price_high',
  price_very_high_threshold: 'question_price_very_high',
  amount_very_low_threshold: 'question_amount_very_low',
  amount_low_threshold: 'question_amount_low',
  amount_high_threshold: 'question_amount_high',
  amount_very_high_threshold: 'question_amount_very_high'
};

/* ====== Helpers DOM ====== */
const qs  = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const ICON_SPRITE = './assets/icons.svg#icon-';
const icon = (name, className = '') => {
  const classes = ['icon', className].filter(Boolean).join(' ');
  return `<svg class="${classes}" aria-hidden="true"><use href="${ICON_SPRITE}${name}"></use></svg>`;
};
const show = (sel) => {
  const el = qs(sel);
  if (!el) return;
  el.classList.remove('hidden');
  // Fallback: si un modal reste display:none (cascade CSS), forcer flex
  if (el.classList.contains('modal')) {
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none') {
      el.style.display = 'flex';
    }
  }
};
const hide = (sel) => {
  const el = qs(sel);
  if (!el) return;
  el.classList.add('hidden');
  if (el.classList.contains('modal')) {
    // Nettoyage inline éventuel pour permettre re-hide correct
    el.style.display = 'none';
  }
};
const setText = (sel, t) => { const el = qs(sel); if (el) el.textContent = t; };
const setHtml = (sel, html) => { const el = qs(sel); if (el) el.innerHTML = html; };

function clampQuestionColumnWidth(width) {
  const n = Number(width);
  if (!Number.isFinite(n)) return 360;
  return Math.max(260, Math.min(900, Math.round(n)));
}

function getQuestionColumnWidth() {
  return clampQuestionColumnWidth(localStorage.getItem(QUESTION_COLUMN_WIDTH_STORAGE_KEY) || 360);
}

function applyQuestionColumnWidth(width) {
  const table = qs('#questions-editor-table');
  if (!table) return;
  table.style.setProperty('--questions-question-width', `${clampQuestionColumnWidth(width)}px`);
}

function initQuestionColumnResize() {
  const handle = qs('#questions-question-resize');
  const table = qs('#questions-editor-table');
  if (!handle || !table) return;

  applyQuestionColumnWidth(getQuestionColumnWidth());

  handle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = getQuestionColumnWidth();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent) => {
      const nextWidth = clampQuestionColumnWidth(startWidth + moveEvent.clientX - startX);
      applyQuestionColumnWidth(nextWidth);
    };

    const onUp = (upEvent) => {
      const nextWidth = clampQuestionColumnWidth(startWidth + upEvent.clientX - startX);
      localStorage.setItem(QUESTION_COLUMN_WIDTH_STORAGE_KEY, String(nextWidth));
      applyQuestionColumnWidth(nextWidth);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/* ====== Delete Confirmation Modal ====== */
let deleteConfirmationCallback = null;
const showDeleteConfirmation = (options = {}) => {
  const {
    title = 'Confirmer la suppression',
    message = 'Êtes-vous sûr de vouloir supprimer cet élément ?',
    extra = '', // texte supplémentaire (ex: avertissements)
    confirmLabel = 'Supprimer',
    confirmType = 'danger', // 'danger' | 'primary'
    onConfirm = null,
    onCancel = null
  } = options;
  
  // Mettre à jour le contenu de la modal
  setText('#delete-confirmation-title', title);
  setText('#delete-confirmation-message', message);
  
  const extraEl = qs('#delete-confirmation-extra');
  if (extra) {
    setHtml('#delete-confirmation-extra', extra);
    extraEl.style.display = 'block';
  } else {
    extraEl.style.display = 'none';
  }

  const confirmBtn = qs('#delete-confirmation-confirm');
  const titleEl = qs('#delete-confirmation-title');
  if (confirmBtn) {
    confirmBtn.textContent = confirmLabel;
    if (confirmType === 'danger') {
      confirmBtn.style.backgroundColor = 'var(--danger)';
      confirmBtn.style.color = '#fff';
      confirmBtn.style.borderColor = 'var(--danger)';
      if (titleEl) titleEl.style.color = 'var(--danger)';
    } else {
      confirmBtn.style.backgroundColor = '';
      confirmBtn.style.color = '';
      confirmBtn.style.borderColor = '';
      if (titleEl) titleEl.style.color = '';
    }
  }
  
  // Stocker le callback
  deleteConfirmationCallback = onConfirm;
  
  // Afficher la modal
  show('#delete-confirmation-modal');
};

const hideDeleteConfirmation = () => {
  hide('#delete-confirmation-modal');
  deleteConfirmationCallback = null;
};

/* ====== Num parse/format (FR friendly) ====== */
function parseNum(v){
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  let s = String(v).trim();
  
  // Supprimer les symboles monétaires (€, $, £, etc.) et autres caractères spéciaux
  s = s.replace(/[€$£¥₹]/g, '');
  
  // Enlever espaces (y compris insécables U+00A0, U+202F, U+2009)
  s = s.replace(/[\u00A0\u202F\u2009\s]/g, '');
  
  // Style (123) => -123
  if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
  
  // Formats mixtes : 1.234,56 (FR) / 1,234.56 (EN)
  const lastComma = s.lastIndexOf(',');
  const lastDot   = s.lastIndexOf('.');
  
  if (lastComma > -1 || lastDot > -1) {
    const last = Math.max(lastComma, lastDot);
    const decSep = s[last];
    // Supprimer tous les autres séparateurs de milliers
    s = s
      .replace(/[.,]/g, (m, idx) => (idx === last ? m : ''))
      .replace(decSep, '.');
  }
  
  // Garder uniquement chiffres, point décimal et signe moins
  s = s.replace(/[^0-9.\-]/g,'');
  
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function formatNum(n){
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}
function amountOf(q, pu){
  const n1 = parseNum(q), n2 = parseNum(pu);
  if (!Number.isFinite(n1) || !Number.isFinite(n2)) return '';
  return formatNum(n1 * n2);
}
function amountCellHtml(q, pu, comment, fallbackAmount = null){
  const computed = amountOf(q, pu);
  const amt = computed || (Number.isFinite(parseNum(fallbackAmount)) ? formatNum(parseNum(fallbackAmount)) : '');
  if (!comment) return amt;
  return `${amt || ''}<span class="comment-badge" title="${escapeHtml(comment)}">!</span>`;
}

const QUESTIONS_UNIT_MISMATCH_COMMENT_TEMPLATE = 'Ce poste doit être chiffré en {unit}.';

function normalizeUnitLabel(value) {
  if (!value) return '';
  return String(value).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00A0\u2007\u200B\u202F\u2009]/g, ' ')
    .replace(/[²]/g, '2')
    .replace(/[³]/g, '3')
    .replace(/[-–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizeUnit(value) {
  const normalized = normalizeUnitLabel(value);
  if (!normalized) return '';

  const compact = normalized.replace(/\s/g, '');
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

function getUnitMismatchInfo(expectedUnit, offeredUnit, offeredAmount) {
  const safeExpectedUnit = String(expectedUnit || '').trim();
  const safeOfferedUnit = String(offeredUnit || '').trim();
  const amount = parseNum(offeredAmount);

  if (!safeExpectedUnit || !safeOfferedUnit) return { hasMismatch: false };
  if (!Number.isFinite(amount) || amount === 0) return { hasMismatch: false };
  if (areUnitsEquivalent(safeExpectedUnit, safeOfferedUnit)) return { hasMismatch: false };

  const comment = QUESTIONS_UNIT_MISMATCH_COMMENT_TEMPLATE.replace('{unit}', safeExpectedUnit);
  return {
    hasMismatch: true,
    expectedUnit: safeExpectedUnit,
    offeredUnit: safeOfferedUnit,
    comment,
    commentHtml: `<span class="unit-mismatch-note" title="Unité attendue: ${escapeHtml(safeExpectedUnit)} | Unité entreprise: ${escapeHtml(safeOfferedUnit)}">${escapeHtml(comment)}</span>`
  };
}

/**
 * Génère un HTML pour afficher un commentaire d'offre sous forme de pastille colorée
 * @param {string} comment - Le texte du commentaire
 * @param {string} companyColor - La couleur hex de l'entreprise (ex: #ff0000)
 * @param {string} companyName - Le nom de l'entreprise
 * @returns {string} HTML de la pastille
 */
function offerCommentBadgeHtml(comment, companyColor, companyName) {
  if (!comment) return '';
  
  // Couleur par defaut si pas de couleur d'entreprise
  const bgColor = companyColor || '#999';
  const label = String(companyName || '').trim() || 'Commentaire';
  const style = `background-color: ${bgColor}; color: #fff; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-left: 4px; display: inline-block; vertical-align: middle; max-width: 92px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
  
  return `<span class="offer-comment-badge" style="${style}" title="${escapeHtml(label)}: ${escapeHtml(comment)}">${escapeHtml(label)}</span>`;
}
/** Génère les puces cliquables pour les entreprises dont la désignation diffère de la DPGF */
function offerDesigPillsHtml(companies) {
  const diffCompanies = (companies || []).filter(c => c.offer_designation);
  if (!diffCompanies.length) return '';
  return diffCompanies.map(c => {
    const bg = c.color || '#888';
    const safeName = escapeHtml(c.name || '');
    const safeDesig = escapeHtml(c.offer_designation || '');
    return `<span class="offer-desig-pill" data-company="${safeName}" data-desig="${safeDesig}" style="display:inline-flex;align-items:center;cursor:pointer;background:${bg};color:#fff;padding:1px 7px;border-radius:10px;font-size:10px;margin-left:5px;vertical-align:middle;opacity:0.9" title="Désignation différente : cliquez pour voir">🏢 ${safeName}</span>`;
  }).join('');
}
/** Affiche le popover de désignation entreprise sous la puce cliquée */
function showOfferDesigPopover(pill) {
  closeOfferDesigPopover();
  const companyName = pill.dataset.company || '';
  const designation = pill.dataset.desig || '';
  const pop = document.createElement('div');
  pop.id = 'offer-desig-popover';
  pop.dataset.for = companyName + '|' + designation;
  pop.style.cssText = 'position:fixed;z-index:9999;background:var(--card,#fff);border:1px solid var(--border,#ddd);border-radius:8px;padding:12px 16px;max-width:440px;min-width:180px;box-shadow:0 4px 24px rgba(0,0,0,0.18);font-size:0.88em;line-height:1.5';
  pop.innerHTML = `<div style="font-weight:700;font-size:0.82em;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted,#888);margin-bottom:6px">${escapeHtml(companyName)}</div><div style="color:var(--fg)">${escapeHtml(designation)}</div>`;
  document.body.appendChild(pop);
  const rect = pill.getBoundingClientRect();
  const pw = pop.offsetWidth || 300;
  const ph = pop.offsetHeight || 80;
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + pw > window.innerWidth - 16) left = window.innerWidth - pw - 16;
  if (top + ph > window.innerHeight - 16) top = rect.top - ph - 6;
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top = Math.max(8, top) + 'px';
}
/** Ferme le popover de désignation entreprise */
function closeOfferDesigPopover() {
  const pop = document.getElementById('offer-desig-popover');
  if (pop) pop.remove();
}

function attachOfferDesigPillDelegates(container) {
  if (!container || container.dataset.desigPillListenerAttached) return;
  container.dataset.desigPillListenerAttached = 'true';

  container.addEventListener('click', (e) => {
    const pill = e.target.closest('.offer-desig-pill');
    if (!pill) {
      closeOfferDesigPopover();
      return;
    }
    e.stopPropagation();
    const forId = (pill.dataset.company || '') + '|' + (pill.dataset.desig || '');
    const existing = document.getElementById('offer-desig-popover');
    if (existing && existing.dataset.for === forId) {
      closeOfferDesigPopover();
      return;
    }
    showOfferDesigPopover(pill);
  });

  if (!document.body.dataset.offerDesigPopoverGlobalCloseAttached) {
    document.body.dataset.offerDesigPopoverGlobalCloseAttached = 'true';
    document.addEventListener('click', closeOfferDesigPopover);
  }
}
/** Returns true when a company has not answered an item (qty or pu empty/zero). */
function isOfferUnanswered(qty, pu) {
  const qStr = (qty == null ? '' : String(qty)).trim();
  const pStr = (pu  == null ? '' : String(pu )).trim();
  const qEmpty = qStr === '' || parseFloat(qStr) === 0 || isNaN(parseFloat(qStr));
  const pEmpty = pStr === '' || parseFloat(pStr) === 0 || isNaN(parseFloat(pStr));
  return qEmpty || pEmpty;
}
/** Returns true when an offer has values while MOE has no expected total on that row */
function isOfferUnexpected(moeHasTotal, qty, pu) {
  if (moeHasTotal) return false;
  const q = parseNum(qty);
  const p = parseNum(pu);
  const hasQty = Number.isFinite(q) && q !== 0;
  const hasPu = Number.isFinite(p) && p !== 0;
  return hasQty || hasPu;
}
/** Convert hex color (#rrggbb) to rgba string */
function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0,2), 16) || 0;
  const g = parseInt(h.substring(2,4), 16) || 0;
  const b = parseInt(h.substring(4,6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}
/** Apply unanswered style to a DOM cell: border-left solid + transparent bg */
function applyUnansweredStyle(td, color) {
  if (!color) return;
  td.style.setProperty('border-left', `3px solid ${color}`, 'important');
  td.style.setProperty('background-color', hexToRgba(color, 0.15), 'important');
}
/** Remove unanswered style from a DOM cell */
function removeUnansweredStyle(td) {
  td.style.borderLeft = '';
  td.style.backgroundColor = '';
}
/** Generate inline style string for unanswered cells in HTML templates */
function unansweredStyleStr(color) {
  if (!color) return '';
  return `border-left:3px solid ${color};background:${hexToRgba(color, 0.15)};`;
}

function companyColorFor(cid) {
  const company = lotCompanies.find(x => String(x.id) === String(cid));
  return company?.color || '';
}

function applyCompanyColumnStyle(el, cid, strong = false) {
  const color = companyColorFor(cid);
  if (!el || !color) return;
  el.style.setProperty('border-left', `${strong ? 3 : 2}px solid ${color}`, 'important');
  el.style.setProperty('background-color', hexToRgba(color, strong ? 0.18 : 0.08), 'important');
}

function updateSheetLegend() {
  const unansweredSwatch = qs('#sheet-legend-unanswered-swatch');
  if (unansweredSwatch) {
    const c = unansweredConfig.color || '#ffc107';
    unansweredSwatch.style.borderLeft = `3px solid ${c}`;
    unansweredSwatch.style.background = hexToRgba(c, 0.15);
  }
  const unansweredLabel = qs('#sheet-legend-unanswered-label');
  if (unansweredLabel) {
    unansweredLabel.textContent = unansweredConfig.comment || 'Article sans réponse';
  }

  const unexpectedSwatch = qs('#sheet-legend-unexpected-swatch');
  if (unexpectedSwatch) {
    const c = unexpectedAnswerMarker.color;
    unexpectedSwatch.style.borderLeft = `3px solid ${c}`;
    unexpectedSwatch.style.background = hexToRgba(c, 0.15);
  }
  const unexpectedLabel = qs('#sheet-legend-unexpected-label');
  if (unexpectedLabel) {
    unexpectedLabel.textContent = unexpectedAnswerMarker.label;
  }
}

/* ====== Loading Spinner ====== */
function showLoader() { qs('#global-loader')?.classList.remove('hidden'); }
function hideLoader() { qs('#global-loader')?.classList.add('hidden'); }

/* ====== API ====== */
async function api(path, opts = {}) {
  const url = API_BASE + path;
  const headers = opts.headers || {};
  
  // Cookie HttpOnly: pas d'Authorization, on envoie les credentials
  if (token && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${token}`;
  }
  
  let body = opts.body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  
  // Afficher le loader sauf si désactivé explicitement
  const showLoading = opts.showLoader !== false;
  if (showLoading) showLoader();
  
  try {
    const res = await fetch(url, { ...opts, headers, body, credentials: 'include' });
    const isJson = res.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await res.json().catch(()=> ({})) : await res.text();
    if (!res.ok) {
      const msg = (isJson && data?.error) ? data.error : (data || res.statusText);
      showNotify({ title: 'Erreur', message: msg, type: 'error' });
      throw new Error(msg);
    }
    return data;
  } finally {
    if (showLoading) hideLoader();
  }
}

/* ================= Notifications ================= */
function showNotify({ title = 'Info', message = '', type = 'info' }) {
  const modal = qs('#notify-modal');
  const titleEl = qs('#notify-title');
  const msgEl = qs('#notify-message');
  const okBtn = qs('#notify-ok');
  const closeBtn = qs('#notify-close');
  if (!modal || !titleEl || !msgEl) return;
  titleEl.textContent = title;
  msgEl.textContent = message;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  modal.classList.remove('notify-success','notify-error','notify-info');
  modal.classList.add(type === 'error' ? 'notify-error' : (type === 'success' ? 'notify-success' : 'notify-info'));
  const close = () => { modal.classList.add('hidden'); modal.style.display='none'; };
  okBtn?.addEventListener('click', close, { once: true });
  closeBtn?.addEventListener('click', close, { once: true });
  modal.addEventListener('click', (e)=>{ if (e.target.id === 'notify-modal') close(); }, { once: true });
}

// Popup dédié à la vérification d'email avec renvoi de lien
async function showVerifyEmailPopup(email) {
  const modal = qs('#notify-modal');
  const titleEl = qs('#notify-title');
  const msgEl = qs('#notify-message');
  const okBtn = qs('#notify-ok');
  const closeBtn = qs('#notify-close');
  if (!modal || !titleEl || !msgEl) return;

  titleEl.textContent = 'Vérification email requise';
  msgEl.innerHTML = `
    <p style="margin:0 0 12px 0;">Votre email <strong>${email}</strong> doit être vérifié avant connexion.</p>
    <div class="row gap" style="flex-wrap:wrap;align-items:center">
      <button id="resend-verif" class="btn">${icon('mail')}Renvoyer l'email</button>
      <span class="muted" style="font-size:12px">Pensez à vérifier vos spams / promotions.</span>
    </div>
  `;

  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  modal.classList.remove('notify-success','notify-error','notify-info');
  modal.classList.add('notify-info');
  if (okBtn) okBtn.textContent = 'Fermer';

  const close = () => { modal.classList.add('hidden'); modal.style.display='none'; };
  okBtn?.addEventListener('click', close, { once: true });
  closeBtn?.addEventListener('click', close, { once: true });
  modal.addEventListener('click', (e)=>{ if (e.target.id === 'notify-modal') close(); }, { once: true });

  qs('#resend-verif')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Envoi...';
    try {
      const res = await api('/auth/resend-verification', { method:'POST', body:{ email }, showLoader:false });
      msgEl.innerHTML = `<p style="color:#28a745;margin:0;">${icon('check-circle')}${res.message}</p>`;
    } catch (err) {
      if (err.cooldown) {
        msgEl.innerHTML = `<p style="color:#dc3545;margin:0;">${icon('clock')}${err.message}</p>`;
      } else {
        msgEl.innerHTML = `<p style="color:#dc3545;margin:0;">${icon('x-circle')}${err.message}</p>`;
      }
      btn.disabled = false;
      btn.innerHTML = `${icon('mail')}Renvoyer l'email`;
    }
  }, { once:true });
}

/* ================= Onglets ================= */
function activateTab(id){
  // Mettre à jour la navigation principale
  qsa('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  qsa('.tabpanel').forEach(p => p.id === id ? show('#'+id) : hide('#'+p.id));
  
  // Afficher/masquer la sous-navigation des tours
  if (id === 'tab-rounds' || id === 'round-content') {
    show('#rounds-subnav');
  } else {
    hide('#rounds-subnav');
  }
  
  // Si on active l'onglet tours, activer par défaut la liste des tours
  if (id === 'tab-rounds') {
    activateRoundsTab('rounds-list-view');
  }

  // Si on active l'onglet paramètres, recharger la liste des projets
  if (id === 'tab-settings') {
    loadProjectsManagement();
  }
}
function enableTab(id, enabled=true){
  const btn = qsa('.nav-btn').find(b => b.dataset.tab === id);
  if (btn){ btn.disabled = !enabled; }
}

/* ================= Sous-onglets dans l'inventaire des tours ================= */
function activateRoundsTab(id){
  const btns = qsa('#tab-rounds .tour-tab-btn');
  const panels = qsa('#tab-rounds .tour-tabpanel');
  
  btns.forEach(b => b.classList.toggle('active', b.dataset.roundsTab === id));
  panels.forEach(p => p.id === id ? p.classList.remove('hidden') : p.classList.add('hidden'));
  
  // Charger les données selon l'onglet
  if (id === 'rounds-compare-view') {
    loadRoundsComparison();
  }
}

/* ================= Sous-onglets pour un tour sélectionné ================= */
function activateTourTab(id){
  const btns = qsa('#round-content .tour-tab-btn');
  const panels = qsa('#round-content .tour-tabpanel');
  
  btns.forEach(b => b.classList.toggle('active', b.dataset.tourTab === id));
  panels.forEach(p => p.id === id ? p.classList.remove('hidden') : p.classList.add('hidden'));
  
  // Charger les données selon l'onglet
  if (id === 'tour-lots') {
    loadLotsForRound();
  } else if (id === 'tour-config') {
    loadGlobalLotThresholds();
  }
}

function disableTourTabs(tabIds){
  tabIds.forEach(id => {
    const btn = qs(`[data-tour-tab="${id}"]`);
    if (btn) btn.disabled = true;
  });
}

function enableTourTabs(tabIds){
  tabIds.forEach(id => {
    const btn = qs(`[data-tour-tab="${id}"]`);
    if (btn) btn.disabled = false;
  });
}

/* ================= Sous-onglets pour les lots ================= */
function activateSubtab(id){
  qsa('.subnav-tab').forEach(b => b.classList.toggle('active', b.dataset.subtab === id));
  qsa('.subtabpanel').forEach(p => p.id === id ? p.classList.remove('hidden') : p.classList.add('hidden'));
  
  // Arrêter l'auto-actualisation si on quitte l'éditeur de questions
  if (id !== 'subtab-questions-editor') {
    stopQuestionsEditorAutoRefresh();
  }
  
  // Charger la liste et l'éditeur de questions
  if (id === 'subtab-questions-editor' && currentLot) {
    refreshQuestions();
    loadQuestionsEditor({ silent: true });
  }
}

/* ================= Auth ================= */
function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

function updateCurrentUser() {
  if (token) {
    const payload = parseJwt(token);
    console.log('JWT Payload:', payload);
    if (payload) {
      currentUser = { id: payload.id, email: payload.email, role: payload.role || 'visionneur' };
      console.log('Current user updated:', currentUser);
      // Ajuster l'UI selon le rôle
      applyRoleVisibility();
    }
  }
  // Pas de warning si pas de token : c'est normal avant connexion
}

// Masquer certains onglets selon le rôle
function applyRoleVisibility(){
  const tourCfgBtn = document.querySelector('[data-tour-tab="tour-config"]');
  if (tourCfgBtn) {
    tourCfgBtn.style.display = isEntreprise() ? 'none' : '';
  }
}

async function login(email, password){
  const r = await fetch(API_BASE + '/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password })});
  const j = await r.json(); 
  if (!r.ok) {
    // Préserver les propriétés additionnelles pour les cas spéciaux (email non vérifié, etc.)
    const error = new Error(j.error || 'Identifiants invalides');
    Object.assign(error, j); // Copier toutes les propriétés (emailNotVerified, userId, etc.)
    throw error;
  }
  token = j.token; localStorage.setItem('token', token); 
  updateCurrentUser();
  return j.user;
}

/* ================= Permissions helpers ================= */
function isAdmin() { return currentUser && currentUser.role === 'admin'; }
function isResponsable() { return currentUser && currentUser.role === 'responsable'; }
function isVisionneur() { return currentUser && currentUser.role === 'visionneur'; }
function isEntreprise() { return currentUser && currentUser.role === 'entreprise'; }
function isResponsableOrAdmin() { return isAdmin() || isResponsable(); }
function canCreateProject() { return isAdmin() || isResponsable(); }
function canShareProject() { return isAdmin() || isResponsable(); }

/* ================= Admin - Gestion des utilisateurs ================= */
async function loadUsers() {
  if (!isAdmin()) return;
  try {
    const users = await api('/users');
    renderUsersTable(users);
  } catch (err) {
    console.error('Erreur chargement users:', err);
  }
}

function renderUsersTable(users) {
  const tbody = qs('#users-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  for (const user of users) {
    const tr = document.createElement('tr');
    const roleOptions = ['visionneur', 'entreprise', 'responsable', 'admin'];
    const roleSelect = roleOptions.map(r => 
      `<option value="${r}" ${r === user.role ? 'selected' : ''}>${r.charAt(0).toUpperCase() + r.slice(1)}</option>`
    ).join('');
    
    const companyDisplay = user.company_name 
      ? `<span style="color:var(--primary);">${user.company_name}</span>` 
      : '<span class="muted">—</span>';
    const verificationStatus = user.email_verified
      ? '<span style="color:var(--success);font-weight:600;">Vérifié</span>'
      : '<span style="color:var(--warning);font-weight:600;">En attente</span>';
    
    tr.innerHTML = `
      <td>${user.id}</td>
      <td>${user.email}</td>
      <td>
        <select class="user-role-select" id="user-role-${user.id}" name="user-role-${user.id}" data-user-id="${user.id}">
          ${roleSelect}
        </select>
      </td>
      <td>${companyDisplay}</td>
      <td>${verificationStatus}</td>
      <td>${new Date(user.created_at).toLocaleDateString()}</td>
      <td>
        ${!user.email_verified ? `<button class="btn ghost btn-sm" data-verify-user="${user.id}">Valider</button>` : ''}
        <button class="btn ghost btn-sm" data-change-role="${user.id}">Modifier rôle</button>
        ${user.role === 'entreprise' ? `<button class="btn ghost btn-sm" data-assign-company="${user.id}">Attribuer entreprise</button>` : ''}
        <button class="btn ghost btn-sm" data-delete-user="${user.id}">Supprimer</button>
      </td>
    `;
    
    // Event listeners pour les boutons
    const verifyBtn = tr.querySelector(`[data-verify-user="${user.id}"]`);
    const changeBtn = tr.querySelector(`[data-change-role="${user.id}"]`);
    const assignBtn = tr.querySelector(`[data-assign-company="${user.id}"]`);
    const deleteBtn = tr.querySelector(`[data-delete-user="${user.id}"]`);
    
    if (verifyBtn) {
      verifyBtn.addEventListener('click', () => verifyUserEmail(user));
    }
    if (changeBtn) {
      changeBtn.addEventListener('click', () => changeUserRole(user.id));
    }
    if (assignBtn) {
      assignBtn.addEventListener('click', () => openAssignCompanyModal(user));
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => deleteUser(user.id));
    }
    
    tbody.appendChild(tr);
  }
}

async function verifyUserEmail(user) {
  showDeleteConfirmation({
    title: 'Valider une adresse email',
    message: `Confirmer la validation manuelle de l'adresse ${user.email} ?`,
    extra: '<strong>⚠️ Attention:</strong> L\'utilisateur pourra se connecter sans utiliser le lien reçu par email.',
    onConfirm: async () => {
      try {
        await api(`/users/${user.id}/verify-email`, { method: 'POST' });
        showNotify({ title: 'Succès', message: 'Adresse email validée avec succès', type: 'success' });
        loadUsers();
      } catch (err) {
        showNotify({ title: 'Erreur', message: err.message, type: 'error' });
      }
    }
  });
}

async function changeUserRole(userId) {
  const select = document.querySelector(`.user-role-select[data-user-id="${userId}"]`);
  if (!select) return;
  
  const newRole = select.value;
  
  try {
    await api(`/users/${userId}/role`, { method: 'PATCH', body: { role: newRole } });
    showNotify({ title: 'Succès', message: 'Rôle modifié avec succès', type: 'success' });
    loadUsers();
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
}

async function deleteUser(userId) {
  showDeleteConfirmation({
    title: 'Supprimer un utilisateur',
    message: 'Êtes-vous sûr de vouloir supprimer cet utilisateur ? Cette action ne peut pas être annulée.',
    extra: '<strong>⚠️ Attention:</strong> Cet utilisateur ne pourra plus accéder à l\'application.',
    onConfirm: async () => {
      try {
        await api(`/users/${userId}`, { method: 'DELETE' });
        showNotify({ title: 'Succès', message: 'Utilisateur supprimé', type: 'success' });
        loadUsers();
      } catch (err) {
        showNotify({ title: 'Erreur', message: err.message, type: 'error' });
      }
    }
  });
}

/* ================= Attribution d'entreprise ================= */
let currentAssignUserId = null;

async function openAssignCompanyModal(user) {
  currentAssignUserId = user.id;
  const modal = qs('#assign-company-modal');
  const userInfo = qs('#assign-company-user-info');
  const projectSelect = qs('#assign-company-project');
  const companySelect = qs('#assign-company-company');
  const confirmBtn = qs('#assign-company-confirm-btn');
  
  userInfo.textContent = `Utilisateur : ${user.email} (ID: ${user.id})`;
  
  // Charger les projets
  try {
    const projects = await api('/projects');
    projectSelect.innerHTML = '<option value="">-- Choisir un projet --</option>';
    projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name}${p.reference ? ' (' + p.reference + ')' : ''}`;
      projectSelect.appendChild(opt);
    });
  } catch (err) {
    showNotify({ title: 'Erreur', message: 'Impossible de charger les projets', type: 'error' });
    return;
  }
  
  // Reset
  companySelect.innerHTML = '<option value="">-- D\'abord sélectionner un projet --</option>';
  companySelect.disabled = true;
  confirmBtn.disabled = true;
  
  // Event: changement de projet
  projectSelect.onchange = async () => {
    const projectId = projectSelect.value;
    if (!projectId) {
      companySelect.innerHTML = '<option value="">-- D\'abord sélectionner un projet --</option>';
      companySelect.disabled = true;
      confirmBtn.disabled = true;
      return;
    }
    
    try {
      // Charger les entreprises liées à ce projet (via les lots)
      const companies = await api(`/projects/${projectId}/companies`);
      companySelect.innerHTML = '<option value="">-- Choisir une entreprise --</option>';
      companies.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        companySelect.appendChild(opt);
      });
      companySelect.disabled = false;
    } catch (err) {
      showNotify({ title: 'Erreur', message: 'Impossible de charger les entreprises', type: 'error' });
    }
  };
  
  // Event: changement d'entreprise
  companySelect.onchange = () => {
    confirmBtn.disabled = !companySelect.value;
  };
  
  show('#assign-company-modal');
}

async function assignCompanyToUser() {
  const companyId = qs('#assign-company-company').value;
  if (!companyId || !currentAssignUserId) return;
  
  try {
    const data = await api(`/users/${currentAssignUserId}/company`, { 
      method: 'PATCH', 
      body: { company_id: companyId } 
    });
    
    // Si un nouveau token est retourné (utilisateur s'attribue à lui-même), le sauvegarder
    if (data.token) {
      localStorage.setItem('token', data.token);
      token = data.token;
      // Mettre à jour currentUser avec les nouvelles données
      if (data.user) {
        currentUser = { ...currentUser, company_id: data.user.company_id };
      }
      showNotify({ title: 'Succès', message: 'Entreprise attribuée avec succès. Vos données ont été mises à jour.', type: 'success' });
      
      // Recharger la page pour actualiser toutes les vues
      setTimeout(() => window.location.reload(), 1500);
    } else {
      showNotify({ title: 'Succès', message: 'Entreprise attribuée avec succès. L\'utilisateur doit se reconnecter pour voir les changements.', type: 'success' });
    }
    
    hide('#assign-company-modal');
    loadUsers();
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
}

// Fonction pour rafraîchir le token de l'utilisateur courant
async function refreshCurrentUserToken() {
  try {
    const data = await api('/auth/refresh-token', { method: 'POST' });
    if (data.token) {
      localStorage.setItem('token', data.token);
      token = data.token;
      currentUser = data.user;
      return true;
    }
    return false;
  } catch (err) {
    console.error('[refreshCurrentUserToken] Erreur:', err);
    return false;
  }
}

/* ================= Gestion des Projets ================= */
async function loadProjectsManagement() {
  if (!isResponsableOrAdmin()) return;
  try {
    const projects = await api('/projects');
    renderProjectsManagementTable(projects);
  } catch (err) {
    console.error('Erreur chargement projets:', err);
    showNotify({ title: 'Erreur', message: 'Impossible de charger les projets', type: 'error' });
  }
}

function renderProjectsManagementTable(projects) {
  const tbody = qs('#admin-projects-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  if (projects.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted text-center">Aucun projet</td></tr>';
    return;
  }
  
  for (const project of projects) {
    const tr = document.createElement('tr');
    const createdDate = new Date(project.created_at).toLocaleDateString();
    
    tr.innerHTML = `
      <td><strong>${project.name}</strong></td>
      <td>${project.reference ? project.reference : '<span class="muted">—</span>'}</td>
      <td>${project.client ? project.client : '<span class="muted">—</span>'}</td>
      <td>${createdDate}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn ghost btn-sm" data-admin-edit-project="${project.id}">${icon('edit')}Modifier</button>
        <button class="btn ghost btn-sm" style="color:var(--danger)" data-delete-project="${project.id}">${icon('trash')}Supprimer</button>
      </td>
    `;
    
    const editBtn = tr.querySelector(`[data-admin-edit-project="${project.id}"]`);
    if (editBtn) {
      editBtn.addEventListener('click', () => openEditProjectModal(project.id));
    }

    const deleteBtn = tr.querySelector(`[data-delete-project="${project.id}"]`);
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => deleteProject(project.id, project.name));
    }
    
    tbody.appendChild(tr);
  }
}

async function deleteProject(projectId, projectName) {
  showDeleteConfirmation({
    title: 'Supprimer un projet',
    message: `Êtes-vous sûr de vouloir supprimer le projet "${projectName}" ?`,
    extra: `<strong>⚠️ Attention:</strong> Cette action est irréversible. Toutes les données du projet seront supprimées définitivement (lots, articles, offres, etc.).`,
    onConfirm: async () => {
      try {
        await api(`/projects/${projectId}`, { method: 'DELETE' });
        showNotify({ title: 'Succès', message: 'Projet supprimé avec succès', type: 'success' });
        await loadProjectsManagement();
      } catch (err) {
        showNotify({ title: 'Erreur', message: err.message, type: 'error' });
      }
    }
  });
}

/* ================= Partage de projets ================= */
let currentShareProjectId = null;

async function openShareModal(projectId) {
  currentShareProjectId = projectId;
  show('#share-modal');
  
  // Charger la liste des visionneurs disponibles
  try {
    const viewers = await api(`/shares/available-viewers?projectId=${projectId}`);
    const select = qs('#share-viewer-select');
    select.innerHTML = '<option value="">-- Sélectionner un visionneur --</option>';
    viewers.forEach(v => {
      select.innerHTML += `<option value="${v.id}">${v.email}</option>`;
    });
    
    // Charger les partages existants
    loadExistingShares(projectId);
  } catch (err) {
    console.error('Erreur chargement visionneurs:', err);
  }
}

async function loadExistingShares(projectId) {
  try {
    const shares = await api(`/shares/projects/${projectId}`);
    const container = qs('#existing-shares');
    
    if (shares.length === 0) {
      container.innerHTML = '<p class="muted">Aucun partage pour l\'instant</p>';
      return;
    }
    
    container.innerHTML = shares.map(s => `
      <div class="share-item">
        <div class="share-item-info">
          <div class="share-item-email">${s.shared_with_email}</div>
          <div class="share-item-perms">${s.can_edit ? 'Lecture + Modification' : 'Lecture seule'}</div>
        </div>
        <button class="btn ghost btn-sm remove-share-btn" data-project-id="${projectId}" data-user-id="${s.shared_with_user_id}">Retirer</button>
      </div>
    `).join('');
    
    // Attacher les événements de suppression
    container.querySelectorAll('.remove-share-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const projId = btn.dataset.projectId;
        const usrId = btn.dataset.userId;
        removeShare(projId, usrId);
      });
    });
  } catch (err) {
    console.error('Erreur chargement partages:', err);
  }
}

async function shareProject() {
  const viewerId = qs('#share-viewer-select').value;
  const canEdit = qs('#share-can-edit').checked;
  
  if (!viewerId) {
    showNotify({ title: 'Validation', message: 'Sélectionnez un visionneur', type: 'info' });
  }
  
  try {
    await api(`/shares/projects/${currentShareProjectId}`, {
      method: 'POST',
      body: { userId: viewerId, canView: true, canEdit }
    });
    
    showNotify({ title: 'Succès', message: 'Projet partagé avec succès', type: 'success' });
    qs('#share-viewer-select').value = '';
    qs('#share-can-edit').checked = false;
    await openShareModal(currentShareProjectId);
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
}

async function removeShare(projectId, userId) {
  showDeleteConfirmation({
    title: 'Retirer ce partage',
    message: 'Êtes-vous sûr de vouloir retirer ce partage ? Cet utilisateur ne pourra plus accéder au projet.',
    onConfirm: async () => {
      try {
        await api(`/shares/projects/${projectId}/users/${userId}`, { method: 'DELETE' });
        showNotify({ title: 'Succès', message: 'Partage retiré', type: 'success' });
        await openShareModal(projectId);
      } catch (err) {
        showNotify({ title: 'Erreur', message: err.message, type: 'error' });
      }
    }
  });
}

function closeShareModal() {
  hide('#share-modal');
  currentShareProjectId = null;
}

/* ================= Édition du projet ================= */
let currentEditProjectId = null;

async function openEditProjectModal(projectId) {
  currentEditProjectId = projectId;
  try {
    // Récupérer les données du projet
    const { project } = await api('/projects/' + projectId);
    
    // Remplir les champs
    setValue('#edit-proj-name', project.name || '');
    setValue('#edit-proj-ref', project.reference || '');
    setValue('#edit-proj-client', project.client || '');
    setValue('#edit-proj-date', project.study_date ? project.study_date.split('T')[0] : '');
    
    // Charger les visionneurs disponibles
    await loadEditShareViewers();
    
    // Charger les partages existants
    await loadEditExistingShares(projectId);
    
    show('#edit-project-modal');
  } catch (err) {
    showNotify({ title: 'Erreur', message: 'Erreur lors du chargement du projet: ' + err.message, type: 'error' });
  }
}

function closeEditProjectModal() {
  hide('#edit-project-modal');
  currentEditProjectId = null;
}

async function loadEditShareViewers() {
  try {
    if (!currentEditProjectId) return;
    const users = await api(`/shares/available-viewers?projectId=${currentEditProjectId}`);
    const select = qs('#edit-share-viewer');
    select.innerHTML = '<option value="">-- Sélectionner un visionneur --</option>';
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.email;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Erreur chargement visionneurs:', err);
  }
}

async function loadEditExistingShares(projectId) {
  try {
    const shares = await api(`/shares/projects/${projectId}`);
    const container = qs('#edit-existing-shares');
    container.innerHTML = '';
    
    if (!shares || shares.length === 0) {
      container.innerHTML = '<p class="muted" style="font-size:12px;">Aucun partage pour le moment</p>';
      return;
    }
    
    shares.forEach(share => {
      const badge = document.createElement('div');
      badge.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px;background:var(--input-bg);border-radius:6px;margin-bottom:6px;';
      const userId = share.shared_with_user_id;
      badge.innerHTML = `
        <span>${escapeHtml(share.shared_with_email || share.viewer_email)} ${share.can_edit ? '(édition)' : '(lecture)'}</span>
        <button class="btn ghost" type="button" style="font-size:12px;padding:2px;margin:0;" data-remove-project-share="${userId}">×</button>
      `;
      badge.querySelector('[data-remove-project-share]')?.addEventListener('click', () => {
        removeProjectShare(userId);
      });
      container.appendChild(badge);
    });
  } catch (err) {
    console.error('Erreur chargement partages:', err);
  }
}

async function addEditProjectShare() {
  const viewerId = qs('#edit-share-viewer').value;
  const canEdit = qs('#edit-share-can-edit').checked;
  
  if (!viewerId) {
    showNotify({ title: 'Validation', message: 'Sélectionnez un visionneur', type: 'info' });
    return;
  }
  
  try {
    await api(`/shares/projects/${currentEditProjectId}`, {
      method: 'POST',
      body: { userId: parseInt(viewerId), canEdit }
    });
    showNotify({ title: 'Succès', message: 'Partage ajouté', type: 'success' });
    qs('#edit-share-viewer').value = '';
    qs('#edit-share-can-edit').checked = false;
    await loadEditShareViewers();
    await loadEditExistingShares(currentEditProjectId);
  } catch (err) {
    showNotify({ title: 'Erreur', message: 'Erreur lors de l\'ajout du partage: ' + err.message, type: 'error' });
  }
}

async function removeProjectShare(shareId) {
  showDeleteConfirmation({
    title: 'Retirer ce partage',
    message: 'Êtes-vous sûr de vouloir retirer ce partage ? Cet utilisateur ne pourra plus accéder au projet.',
    onConfirm: async () => {
      try {
        // shareId est en réalité shared_with_user_id, donc on a besoin du projectId aussi
        await api(`/shares/projects/${currentEditProjectId}/users/${shareId}`, { method: 'DELETE' });
        showNotify({ title: 'Succès', message: 'Partage retiré', type: 'success' });
        await loadEditShareViewers();
        await loadEditExistingShares(currentEditProjectId);
      } catch (err) {
        showNotify({ title: 'Erreur', message: 'Erreur lors de la suppression: ' + err.message, type: 'error' });
      }
    }
  });
}

async function saveEditProject() {
  const name = getValue('#edit-proj-name').trim();
  const ref = getValue('#edit-proj-ref').trim();
  const client = getValue('#edit-proj-client').trim();
  const date = getValue('#edit-proj-date');
  
  if (!name) {
    showNotify({ title: 'Validation', message: 'Le nom est obligatoire', type: 'info' });
    return;
  }
  
  try {
    await api(`/projects/${currentEditProjectId}`, {
      method: 'PUT',
      body: { name, ref, client, date }
    });
    showNotify({ title: 'Succès', message: 'Projet mis à jour avec succès', type: 'success' });
    await refreshProjects();
    closeEditProjectModal();
  } catch (err) {
    showNotify({ title: 'Erreur', message: 'Erreur lors de la sauvegarde: ' + err.message, type: 'error' });
  }
}

function getValue(selector) {
  const el = qs(selector);
  return el ? el.value : '';
}

function setValue(selector, value) {
  const el = qs(selector);
  if (el) el.value = value;
}

/* ================= Demandes d'accès ================= */

// Ouvrir la modal de demande d'accès
async function openAccessRequestModal() {
  try {
    // Charger mes demandes en cours
    await loadMyAccessRequests();
    
    show('#access-request-modal');
  } catch (err) {
    showNotify({ title: 'Erreur', message: 'Erreur lors du chargement des projets: ' + err.message, type: 'error' });
  }
}

// Charger mes demandes d'accès
async function loadMyAccessRequests() {
  try {
    const requests = await api('/access-requests/my-requests');
    const container = qs('#my-access-requests');
    
    if (requests.length === 0) {
      container.innerHTML = '<p class="muted">Aucune demande en cours</p>';
      return;
    }
    
    container.innerHTML = requests.map(r => {
      const statusBadge = r.status === 'pending' ? `${icon('clock')}En attente` 
        : r.status === 'approved' ? `${icon('check-circle')}Approuvée` 
        : `${icon('x-circle')}Rejetée`;
      
      return `
        <div class="share-item" style="margin-bottom: 10px; padding: 10px; background: var(--card); border: 1px solid var(--border); border-radius: 5px;">
          <strong>${r.project_name}</strong>
          <span style="margin-left: 10px; font-size: 0.9em;">${statusBadge}</span>
          <div style="font-size: 0.85em; color: var(--muted); margin-top: 5px;">
            Demandé le ${new Date(r.created_at).toLocaleDateString()}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Erreur chargement demandes:', err);
  }
}

// Soumettre une demande d'accès
async function submitAccessRequest() {
  const projectName = qs('#access-request-project-name').value.trim();
  const message = qs('#access-request-message').value.trim();
  
  if (!projectName) {
    showNotify({ title: 'Validation', message: 'Veuillez indiquer le nom du projet', type: 'info' });
  }
  
  try {
    await api('/access-requests', {
      method: 'POST',
      body: { projectName, message }
    });
    
    showNotify({ title: 'Succès', message: 'Demande envoyée. Un responsable examinera votre demande.', type: 'success' });
    qs('#access-request-project-name').value = '';
    qs('#access-request-message').value = '';
    await loadMyAccessRequests();
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
}

function closeAccessRequestModal() {
  hide('#access-request-modal');
}

// Charger les demandes d'accès (responsable/admin)
async function loadAccessRequests() {
  try {
    const status = qs('#filter-access-requests-status')?.value || '';
    const params = status ? `?status=${status}` : '';
    const requests = await api('/access-requests' + params);
    
    const tbody = qs('#access-requests-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (requests.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted);">Aucune demande</td></tr>';
      return;
    }
    
    for (const req of requests) {
      const tr = document.createElement('tr');
      
      const statusBadge = req.status === 'pending' ? `<span style="color:#ffa500;">${icon('clock')}En attente</span>`
        : req.status === 'approved' ? `<span style="color:#28a745;">${icon('check-circle')}Approuvée</span>`
        : `<span style="color:#dc3545;">${icon('x-circle')}Rejetée</span>`;
      
      const actions = req.status === 'pending' 
        ? `<button class="btn btn-sm" data-approve-id="${req.id}">${icon('check-circle')}Approuver</button>
          <button class="btn ghost btn-sm" data-reject-id="${req.id}">${icon('x-circle')}Rejeter</button>`
        : `<span class="muted">Par ${req.reviewed_by_email || 'N/A'}</span>`;
      
      tr.innerHTML = `
        <td>${new Date(req.created_at).toLocaleDateString()}</td>
        <td>${req.user_email}</td>
        <td>${req.project_name}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${req.message || ''}">${req.message || '<em class="muted">Aucun message</em>'}</td>
        <td>${statusBadge}</td>
        <td>${actions}</td>
      `;
      
      // Event listeners pour Approuver/Rejeter
      const approveBtn = tr.querySelector('[data-approve-id]');
      const rejectBtn = tr.querySelector('[data-reject-id]');
      
      if (approveBtn) {
        approveBtn.addEventListener('click', () => openApproveAccessModal(req.id));
      }
      if (rejectBtn) {
        rejectBtn.addEventListener('click', () => rejectAccessRequest(req.id));
      }
      
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error('Erreur chargement demandes:', err);
  }
}

// Approuver une demande
// Nouvelle logique d'approbation via modal
let approveState = { requestId: null, projects: [], filtered: [], selectedProjectId: null };

async function openApproveAccessModal(requestId) {
  approveState = { requestId, projects: [], filtered: [], selectedProjectId: [] };
  const contextEl = qs('#approve-access-context');
  const selectedEl = qs('#approve-selected');
  const confirmBtn = qs('#approve-confirm-btn');
  const searchInput = qs('#approve-search');
  if (!contextEl || !selectedEl || !confirmBtn) {
    showNotify({ title: 'Erreur', message: 'Interface: éléments modal introuvables', type: 'error' });
    return;
  }
  selectedEl.textContent = 'Chargement des projets...';
  confirmBtn.disabled = true;
  if (searchInput) searchInput.value = '';
  contextEl.innerHTML = `Demande #${requestId} — sélectionner un projet à partager`;
  show('#approve-access-modal');
  
  try {
    const projects = await api('/projects');
    approveState.projects = projects;
    approveState.filtered = projects;
    if (projects.length === 0) {
      selectedEl.textContent = 'Aucun projet disponible. Créez un projet d\'abord.';
      return;
    }
    selectedEl.textContent = 'Aucun projet sélectionné.';
    initApproveProjectSelection();
    renderApproveProjects();
  } catch(err) {
    selectedEl.textContent = 'Erreur lors du chargement des projets.';
    contextEl.innerHTML += '<br><span style="color:#dc3545;">Impossible de charger les projets.</span>';
  }
}

function renderApproveProjects() {
  const tbody = qs('#approve-projects-tbody');
  if (!tbody) return;
  const list = approveState.filtered;
  
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:12px;text-align:center;color:var(--muted);">Aucun projet trouvé</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(p => {
    const selected = Array.isArray(approveState.selectedProjectId) 
      ? approveState.selectedProjectId.includes(Number(p.id))
      : approveState.selectedProjectId === Number(p.id);
    return `<tr data-project-id="${p.id}" class="approve-project-row" style="cursor:pointer;">
      <td style="padding:10px 12px;text-align:center;"><input id="select-project-${p.id}" name="select-project-${p.id}" type="checkbox" value="${p.id}" ${selected?'checked':''} data-select-project="${p.id}" /></td>
      <td style="padding:10px 12px;font-weight:${selected?'600':'400'};">${p.name}</td>
      <td style="padding:10px 12px;">${p.reference || '—'}</td>
      <td style="padding:10px 12px;">${p.client || '—'}</td>
    </tr>`;
  }).join('');
}

// Event delegation pour la sélection de projet (initialisé une seule fois)
function initApproveProjectSelection() {
  const tbody = qs('#approve-projects-tbody');
  if (!tbody || tbody.dataset.listenerAttached) return;
  tbody.dataset.listenerAttached = 'true';
  
  tbody.addEventListener('change', (e) => {
    const checkbox = e.target;
    
    if (checkbox.type !== 'checkbox') return;
    
    const projectId = parseInt(checkbox.value);
    
    // Initialiser comme tableau si nécessaire
    if (!Array.isArray(approveState.selectedProjectId)) {
      approveState.selectedProjectId = approveState.selectedProjectId ? [approveState.selectedProjectId] : [];
    }
    
    if (checkbox.checked) {
      // Ajouter à la sélection
      if (!approveState.selectedProjectId.includes(projectId)) {
        approveState.selectedProjectId.push(projectId);
      }
    } else {
      // Retirer de la sélection
      approveState.selectedProjectId = approveState.selectedProjectId.filter(id => id !== projectId);
    }
    
    // Mettre à jour l'affichage - chercher dans projects ou filtered
    let selectedProjects = approveState.projects.filter(p => approveState.selectedProjectId.includes(p.id));
    if (selectedProjects.length === 0) {
      selectedProjects = approveState.filtered.filter(p => approveState.selectedProjectId.includes(p.id));
    }
    
    // Activer le bouton dès qu'il y a des IDs, même si on ne trouve pas les noms
    if (approveState.selectedProjectId.length === 0) {
      setText('#approve-selected', 'Cliquez sur un projet pour le sélectionner');
      qs('#approve-confirm-btn').disabled = true;
    } else if (selectedProjects.length === 1) {
      setHtml('#approve-selected', `${icon('check-circle')}${selectedProjects[0].name}`);
      qs('#approve-confirm-btn').disabled = false;
    } else if (selectedProjects.length > 1) {
      setHtml('#approve-selected', `${icon('check-circle')}${selectedProjects.length} projets sélectionnés`);
      qs('#approve-confirm-btn').disabled = false;
    } else {
      // Fallback: on a des IDs mais pas les objets projet - activer quand même
      setHtml('#approve-selected', `${icon('check-circle')}${approveState.selectedProjectId.length} projet(s) sélectionné(s)`);
      qs('#approve-confirm-btn').disabled = false;
    }
    
    renderApproveProjects();
  });
  
  // Permettre le clic sur la ligne entière
  tbody.addEventListener('click', (e) => {
    const row = e.target.closest('.approve-project-row');
    if (!row || e.target.type === 'checkbox') return;
    
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (checkbox) checkbox.click();
  });
}

function filterApproveProjects(term) {
  const t = term.trim().toLowerCase();
  approveState.filtered = approveState.projects.filter(p => {
    return p.name.toLowerCase().includes(t) || (p.reference||'').toLowerCase().includes(t) || (p.client||'').toLowerCase().includes(t);
  });
  renderApproveProjects();
}

async function confirmApproveAccess() {
  const selectedIds = Array.isArray(approveState.selectedProjectId) 
    ? approveState.selectedProjectId 
    : (approveState.selectedProjectId ? [approveState.selectedProjectId] : []);
  
  if (selectedIds.length === 0) return;
  
  const canEdit = qs('#approve-can-edit').checked;
  
  try {
    // Approuver pour chaque projet sélectionné
    for (const projectId of selectedIds) {
      await api(`/access-requests/${approveState.requestId}/approve`, {
        method: 'PATCH',
        body: { projectId, canEdit }
      });
    }
    hide('#approve-access-modal');
    showNotify({ title: 'Succès', message: `Demande approuvée et ${selectedIds.length} projet(s) partagé(s)`, type: 'success' });
    loadAccessRequests();
  } catch(err) {
    showNotify({ title: 'Erreur', message: 'Erreur approbation: ' + err.message, type: 'error' });
  }
}

function cancelApproveAccessModal() {
  hide('#approve-access-modal');
}

// Rejeter une demande
async function rejectAccessRequest(requestId) {
  const reason = prompt('Raison du rejet (optionnel) :');
  if (reason === null) return; // Annulé
  
  try {
    await api(`/access-requests/${requestId}/reject`, { 
      method: 'PATCH',
      body: { reason }
    });
    showNotify({ title: 'Info', message: 'Demande rejetée. L\'utilisateur a été notifié.', type: 'info' });
    loadAccessRequests();
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
}

/* ================= Projets / Lots ================= */
function renderProjects(list){
  const tbody = qs('#projects-table tbody'); tbody.innerHTML='';
  
  // Message si aucun projet
  if (list.length === 0) {
    const message = isVisionneur() 
      ? `${icon('inbox')}Aucun projet partagé avec vous.<br><small>Cliquez sur "Demander l\'accès" ci-dessus pour faire une demande.</small>`
      : `${icon('inbox')}Aucun projet créé.<br><small>Créez votre premier projet ci-dessus.</small>`;
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--muted);">${message}</td></tr>`;
    return;
  }
  
  for (const p of list){
    const tr = document.createElement('tr');
    const shareBtn = canShareProject() ? `<button class="btn ghost btn-sm" data-share-id="${p.id}">${icon('link')}Partager</button>` : '';
    const editBtn = canShareProject() ? `<button class="btn ghost btn-sm" data-edit-id="${p.id}">${icon('edit')}Éditer</button>` : '';
    tr.innerHTML = `<td>${p.id}</td><td>${p.name}</td><td>${p.reference||''}</td><td>${p.client||''}</td><td>${new Date(p.created_at).toLocaleString()}</td><td><button class="btn btn-sm">Ouvrir</button> ${editBtn} ${shareBtn}</td>`;
    tr.querySelector('button.btn:not(.ghost)').addEventListener('click', () => openProject(p.id));
    
    // Event listener pour le bouton Éditer
    const editBtnEl = tr.querySelector('[data-edit-id]');
    if (editBtnEl) {
      editBtnEl.addEventListener('click', () => openEditProjectModal(p.id));
    }
    
    // Event listener pour le bouton Partager
    const shareBtnEl = tr.querySelector('[data-share-id]');
    if (shareBtnEl) {
      shareBtnEl.addEventListener('click', () => openShareModal(p.id));
    }

    tbody.appendChild(tr);
  }
}

function extractFilenameFromDisposition(contentDisposition, fallback) {
  if (!contentDisposition) return fallback;
  const match = contentDisposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

async function downloadFromApi(url, {
  method = 'GET',
  body = null,
  filenameFallback = 'export.bin'
} = {}) {
  const options = {
    method,
    credentials: 'include',
    headers: {}
  };
  if (token) {
    options.headers.Authorization = `Bearer ${token}`;
  }
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  if (!response.ok) {
    let msg = 'Erreur export';
    try {
      const data = await response.json();
      msg = data?.error || msg;
    } catch {
      try { msg = await response.text(); } catch {}
    }
    throw new Error(msg || 'Erreur export');
  }

  const blob = await response.blob();
  const filename = extractFilenameFromDisposition(response.headers.get('content-disposition'), filenameFallback);
  const link = document.createElement('a');
  const downloadUrl = URL.createObjectURL(blob);
  link.href = downloadUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);
}

function populateProjectExportSelects() {
  const questionLotSelect = qs('#project-export-question-lot');
  if (!questionLotSelect) return;

  const allLotsOption = '<option value="all">Tous les lots</option>';
  const lotOptions = currentProjectExport.lots.map(l =>
    `<option value="${l.id}">${l.code ? `${l.code} - ` : ''}${l.name}</option>`
  ).join('');

  questionLotSelect.innerHTML = `${allLotsOption}${lotOptions}`;

  if (currentProjectExport.scopeLevel === 'lot' && currentProjectExport.scopeLotId) {
    questionLotSelect.value = String(currentProjectExport.scopeLotId);
    questionLotSelect.disabled = true;
  } else {
    questionLotSelect.value = 'all';
    questionLotSelect.disabled = false;
  }
}

function applyProjectExportScopeUI() {
  const scopeHint = qs('#project-export-scope-hint');
  const isLotScope = currentProjectExport.scopeLevel === 'lot';

  if (scopeHint) {
    scopeHint.textContent = isLotScope
      ? 'Portée: lot courant uniquement. Les exports non liés au lot sont masqués.'
      : 'Portée: affaire/projet complet. Sélectionnez les exports à inclure dans le ZIP.';
  }

  const roundsCompareInput = qs('#project-export-rounds-compare');
  const roundsCompareLabel = roundsCompareInput?.closest('label');

  if (roundsCompareInput && roundsCompareLabel) {
    roundsCompareInput.checked = isLotScope ? false : roundsCompareInput.checked;
    roundsCompareInput.disabled = isLotScope;
    roundsCompareLabel.classList.toggle('hidden', isLotScope);
  }
}

function toggleProjectExportFields() {
  const questionChecked = !!qs('#project-export-question-sheets')?.checked;
  const questionFields = qs('#project-export-question-fields');
  if (questionFields) questionFields.classList.toggle('hidden', !questionChecked);
}

function closeProjectExportModal() {
  hide('#project-export-modal');
}

async function openProjectExportModal(projectId, projectName = '', context = {}) {
  try {
    if (!currentRound?.id) {
      throw new Error('Sélectionnez d\'abord une phase');
    }

    const title = qs('#project-export-title');
    if (title) {
      const phaseLabel = `Tour ${currentRound.round_number}${currentRound.name ? ` - ${currentRound.name}` : ''}`;
      title.textContent = `${projectName ? `Projet: ${projectName}` : `Projet #${projectId}`} • ${phaseLabel}`;
    }

    qs('#project-export-rounds-compare').checked = false;
    qs('#project-export-lot-analysis').checked = false;
    qs('#project-export-question-sheets').checked = false;
    toggleProjectExportFields();

    const projectData = await api(`/projects/${projectId}`);

    const requestedScope = context?.scopeLevel === 'lot' ? 'lot' : 'project';
    const requestedScopeLotId = Number(context?.scopeLotId);

    currentProjectExport = {
      projectId,
      projectName: projectData?.project?.name || projectName,
      lots: projectData?.lots || [],
      scopeLevel: requestedScope,
      scopeLotId: Number.isFinite(requestedScopeLotId) ? requestedScopeLotId : null
    };

    if (currentProjectExport.lots.length === 0) {
      throw new Error('Aucun lot disponible pour ce projet');
    }

    if (currentProjectExport.scopeLevel === 'lot' && currentProjectExport.scopeLotId) {
      const lotExistsInProject = currentProjectExport.lots.some(l => Number(l.id) === currentProjectExport.scopeLotId);
      if (!lotExistsInProject) {
        throw new Error('Le lot sélectionné n\'appartient pas au projet courant');
      }
    }

    applyProjectExportScopeUI();
    populateProjectExportSelects();
    show('#project-export-modal');
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
}

async function confirmProjectExport() {
  const projectId = currentProjectExport.projectId;
  if (!projectId) {
    showNotify({ title: 'Validation', message: 'Aucun projet sélectionné', type: 'info' });
    return;
  }

  const selections = {
    roundsCompare: !!qs('#project-export-rounds-compare')?.checked,
    lotAnalysis: !!qs('#project-export-lot-analysis')?.checked,
    questionSheets: !!qs('#project-export-question-sheets')?.checked,
  };

  if (!Object.values(selections).some(Boolean)) {
    showNotify({ title: 'Validation', message: 'Sélectionnez au moins un export', type: 'info' });
    return;
  }

  const currentRoundId = currentRound?.id;
  const questionLotId = qs('#project-export-question-lot')?.value || '';
  const questionLotIds = currentProjectExport.scopeLevel === 'lot' && Number.isFinite(currentProjectExport.scopeLotId)
    ? [currentProjectExport.scopeLotId]
    : [];

  if ((selections.lotAnalysis || selections.questionSheets) && !currentRoundId) {
    showNotify({ title: 'Validation', message: 'Sélectionnez d\'abord une phase', type: 'info' });
    return;
  }
  if (selections.questionSheets && !questionLotId && questionLotIds.length === 0) {
    showNotify({ title: 'Validation', message: 'Sélectionnez un lot pour les fiches questions', type: 'info' });
    return;
  }

  try {
    const { exportParams = {} } = getRoundsComparisonExportParams() || {};
    await downloadFromApi(`${API_BASE}/exports/project-bundle-zip`, {
      method: 'POST',
      body: {
        projectId,
        currentRoundId,
        questionLotId,
        questionLotIds,
        selections,
        roundsComparisonParams: {
          roundFrom: exportParams.roundFrom,
          roundTo: exportParams.roundTo,
          simulations: exportParams.simulations || [],
          simulationRoundId: exportParams.simulationRoundId,
          selectedOptions: exportParams.selectedOptions || []
        }
      },
      filenameFallback: `Exports_Projet_${projectId}.zip`
    });
    closeProjectExportModal();
    showNotify({ title: 'Succès', message: 'Export(s) lancé(s) avec succès', type: 'success' });
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
}

async function exportFullProjectBundleFromRound(round) {
  if (!currentProject?.id) {
    showNotify({ title: 'Validation', message: 'Sélectionnez un projet', type: 'info' });
    return;
  }

  const targetRound = round || currentRound;

  try {
    let lots = Array.isArray(currentProjectLots)
      ? currentProjectLots.filter(l => Number.isFinite(Number(l?.id)))
      : [];

    if (lots.length === 0) {
      const projectData = await api(`/projects/${currentProject.id}`);
      lots = Array.isArray(projectData?.lots)
        ? projectData.lots.filter(l => Number.isFinite(Number(l?.id)))
        : [];
      currentProjectLots = lots;
    }

    const lotIds = lots.map(l => Number(l.id)).filter(Number.isFinite);
    if (lotIds.length === 0) {
      showNotify({ title: 'Validation', message: 'Aucun lot disponible pour cet export', type: 'info' });
      return;
    }

    const roundsComparisonParams = (() => {
      try {
        const { exportParams = {} } = getRoundsComparisonExportParams() || {};
        return {
          roundFrom: exportParams.roundFrom,
          roundTo: exportParams.roundTo,
          simulations: exportParams.simulations || [],
          simulationRoundId: exportParams.simulationRoundId,
          selectedOptions: exportParams.selectedOptions || []
        };
      } catch (_) {
        return {};
      }
    })();

    await downloadFromApi(`${API_BASE}/exports/project-bundle-zip`, {
      method: 'POST',
      body: {
        projectId: currentProject.id,
        currentRoundId: targetRound?.id || null,
        questionLotIds: lotIds,
        selections: {
          rao: true,
          roundsCompare: true,
          lotAnalysis: true,
          questionSheets: true
        },
        roundsComparisonParams
      },
      filenameFallback: `Exports_Affaire_${currentProject.id}.zip`
    });

    showNotify({ title: 'Succès', message: 'Export ZIP de l\'affaire généré', type: 'success' });
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
}

async function refreshProjects(){ const list = await api('/projects'); renderProjects(list); }

async function openProject(id){
  const { project, lots } = await api('/projects/'+id);
  currentProject = project;
  currentRound = null; // Réinitialiser le tour
  currentLot = null;
  selectedRoundOptions = new Set();
  
  enableTab('tab-rounds', true);
  activateTab('tab-rounds');
  setText('#project-title-nav', `Projet #${project.id} — ${project.name}`);
  
  // Charger les tours/phases
  await loadRounds();
  
  // Charger la config des questions uniquement pour admin/responsable
  if (!isEntreprise() && !isVisionneur()) {
    await loadProjectQuestionConfig();
  }
}

async function loadRounds(){
  try {
    // Utilise l'endpoint agrégé pour éviter N+1 requêtes de stats
    const rounds = await api(`/rounds/project/${currentProject.id}/with-stats`);

    const container = qs('#rounds-list');
    container.innerHTML = '';

    for (const round of rounds){
      const stats = round.stats || { total_items:0, companies_count:0, pending_questions:0 };
      const card = document.createElement('div');
      card.className = 'round-card';
      if (!isVisionneur()) {
        card.setAttribute('draggable', 'true');
      }
      card.dataset.roundId = round.id;
      const actionsHTML = isVisionneur() ? '' : `
        <button class="export-round-bundle" title="Exporter tous les documents de l'affaire (ZIP)">ZIP</button>
        <button class="edit-round" title="Modifier">${icon('edit','icon-only')}</button>
        <button class="duplicate-round" title="Dupliquer">${icon('copy','icon-only')}</button>
        <button class="delete-round" title="Supprimer">${icon('trash','icon-only')}</button>
          `;
      card.innerHTML = `
        <div class="round-card-header">
          <span class="round-number" style="cursor:grab">${round.round_number}</span>
          <div class="round-actions">${actionsHTML}</div>
        </div>
        <div class="round-name" contenteditable="false">${round.name}</div>
        <div class="round-stats">
          <span>${stats.total_items || 0} items</span>
          <span>${stats.companies_count || 0} entreprises</span>
          <span>${stats.pending_questions || 0} questions</span>
        </div>`;

      card.addEventListener('click', (e) => {
        if (!e.target.classList.contains('round-name') || e.target.getAttribute('contenteditable') === 'false') {
          selectRound(round, card);
        }
      });

      const tab = document.createElement('button');


      const nameEl = card.querySelector('.round-name');
      if (!isVisionneur()) {
        nameEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          nameEl.setAttribute('contenteditable','true');
          nameEl.focus();
          const range = document.createRange();
          range.selectNodeContents(nameEl);
          const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        });
        nameEl.addEventListener('blur', async () => {
          nameEl.setAttribute('contenteditable','false');
          const newName = nameEl.textContent.trim();
          if (newName && newName !== round.name) {
            try {
              await api(`/rounds/${round.id}`, { method:'PUT', body:{ name:newName, description:round.description, status:round.status } });
              round.name = newName;
            } catch (err) {
              showNotify({ title:'Erreur', message:err.message, type:'error' });
              nameEl.textContent = round.name;
            }
          }
        });
        nameEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
          else if (e.key === 'Escape') { nameEl.textContent = round.name; nameEl.blur(); }
        });
        const exportBundleBtn = card.querySelector('.export-round-bundle');
        exportBundleBtn?.addEventListener('click', async (e) => {
          e.stopPropagation();
          await exportFullProjectBundleFromRound(round);
        });
        const editBtn = card.querySelector('.edit-round');
        editBtn?.addEventListener('click', (e) => { e.stopPropagation(); openRoundEditModal(round); });
        const duplicateBtn = card.querySelector('.duplicate-round');
        duplicateBtn?.addEventListener('click', (e) => { e.stopPropagation(); duplicateRound(round.id); });
        const deleteBtn = card.querySelector('.delete-round');
        deleteBtn?.addEventListener('click', (e) => { e.stopPropagation(); deleteRound(round.id); });
      }
      container.appendChild(card);
    }

    // init drag & drop ordering for rounds
    if (!isVisionneur()) {
      if (typeof initRoundsDragAndDrop === 'function') {
        initRoundsDragAndDrop(container);
      } else if (typeof window !== 'undefined' && typeof window.initRoundsDragAndDrop === 'function') {
        window.initRoundsDragAndDrop(container);
      } else {
        console.warn('Drag & drop init manquant: initRoundsDragAndDrop');
      }
    }
  } catch (err) {
    console.error('Erreur chargement tours:', err);
    showNotify({ title:'Erreur', message:'Chargement tours: ' + err.message, type:'error' });
  }
}

async function selectRound(round, cardElement = null){
  currentRound = round;
  
  // Mettre à jour les cartes actives
  qsa('.round-card').forEach(c => c.classList.remove('active'));
  if (cardElement) {
    cardElement.classList.add('active');
  } else {
    const card = qs(`.round-card[data-round-id="${round.id}"]`);
    if (card) card.classList.add('active');
  }
  
  // Mettre à jour les onglets de la sous-navigation
  qsa('#rounds-tabs button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.roundId === String(round.id));
  });
  
  // Afficher le contenu du tour avec les sous-onglets
  activateTab('round-content');
  const tourConfigBtn = qs('[data-tour-tab="tour-config"]');
  const tourQuestionsBtn = qs('[data-tour-tab="tour-questions"]');
  if (tourConfigBtn) tourConfigBtn.style.display = isEntreprise() ? 'none' : '';
  if (tourQuestionsBtn) tourQuestionsBtn.style.display = isEntreprise() ? 'none' : '';
  activateTourTab('tour-lots');
  setText('#current-round-name', `${round.name}`);
  
  // Désactiver Config Questions et Fiches Questions jusqu'à la sélection d'un lot
  if (isVisionneur() || isEntreprise()) {
    disableTourTabs(['tour-config', 'tour-questions']);
  } else {
    enableTourTabs(['tour-config']);
    disableTourTabs(['tour-questions']);
  }
  
  // Charger les lots pour ce tour
  await loadLotsForRound();
}

async function loadLotsForRound(){
  if (!currentRound) return;
  
  const { project, lots } = await api('/projects/'+currentProject.id);
  currentProjectLots = Array.isArray(lots) ? lots : [];
  const tbody = qs('#lots-table tbody');
  if (!tbody) {
    console.warn('lots-table manquant dans le DOM; chargement des lots ignoré');
    return;
  }
  tbody.innerHTML='';
  
  // enable drag-n-drop
  tbody.dataset.dragEnabled = 'true';

  lots.forEach((l, index) => {
    const tr = document.createElement('tr');
    tr.setAttribute('draggable', 'true');
    tr.dataset.lotId = String(l.id);
    tr.innerHTML = `
      <td class="drag-handle" style="cursor:grab">⋮⋮</td>
      <td class="lot-display-id">${index + 1}</td>
      <td>${escapeHtml(l.code || '')}</td>
      <td>
        <div class="lot-name-macro-inline">
          <span class="lot-name-inline-text">${escapeHtml(l.name || '')}</span>
          ${l.macro_lot ? `<span class="macro-lot-chip">Macrolot: ${escapeHtml(l.macro_lot)}</span>` : ''}
        </div>
      </td>
      <td style="display:flex;gap:8px;align-items:center">
        <button class="btn">${isVisionneur() ? `${icon('eye')}Voir` : 'Ouvrir'}</button>
        ${isVisionneur() ? '' : `<button class="btn ghost btn-edit-lot">${icon('edit')}Modifier</button>`}
      </td>`;
    tr.querySelector('button.btn').addEventListener('click', () => openLot(l.id, l));
    const editBtn = tr.querySelector('.btn-edit-lot');
    if (editBtn) editBtn.addEventListener('click', () => openLotEditModal(l));
    tbody.appendChild(tr);
  });

  if (typeof initLotsDragAndDrop === 'function') {
    initLotsDragAndDrop(tbody);
  } else if (typeof window !== 'undefined' && typeof window.initLotsDragAndDrop === 'function') {
    window.initLotsDragAndDrop(tbody);
  } else {
    console.warn('Drag & drop init manquant: initLotsDragAndDrop');
  }
}

function resolveRoundsComparisonTargets(rounds, selectedRoundId) {
  const sortedRounds = [...rounds].sort((a, b) => {
    const aNum = Number(a.round_number);
    const bNum = Number(b.round_number);
    const aHasNum = Number.isFinite(aNum);
    const bHasNum = Number.isFinite(bNum);
    if (aHasNum && bHasNum) return aNum - bNum;
    if (aHasNum) return -1;
    if (bHasNum) return 1;
    return (a.id || 0) - (b.id || 0);
  });

  const openingRound = sortedRounds.find(r => Number(r.round_number) === 0)
    || sortedRounds.find(r => (r.name || '').toLowerCase().includes('ouverture'))
    || sortedRounds[0]
    || null;
  const selectedRound = sortedRounds.find(r => r.id === selectedRoundId) || null;
  let previousRound = null;
  if (selectedRound) {
    const idx = sortedRounds.findIndex(r => r.id === selectedRound.id);
    if (idx > 0) previousRound = sortedRounds[idx - 1];
  }

  return { sortedRounds, openingRound, previousRound, selectedRound };
}

function normalizeMacroLot(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function getProjectMacroLots(extraMacroLot = null) {
  const values = (currentProjectLots || [])
    .map(l => normalizeMacroLot(l.macro_lot))
    .filter(Boolean);
  const extra = normalizeMacroLot(extraMacroLot);
  if (extra) values.push(extra);
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'fr'));
}

function toggleMacroLotNewInput() {
  const select = qs('#lot-macro-group');
  const wrapper = qs('#lot-macro-new-wrapper');
  const input = qs('#lot-macro-new');
  if (!select || !wrapper || !input) return;
  const isNew = select.value === '__new__';
  wrapper.classList.toggle('hidden', !isNew);
  if (!isNew) input.value = '';
}

function populateMacroLotSelect(selectedMacroLot = null) {
  const select = qs('#lot-macro-group');
  if (!select) return;

  const selected = normalizeMacroLot(selectedMacroLot);
  const macroLots = getProjectMacroLots(selected);
  let html = '<option value="">Aucun macrolot</option>';
  for (const macro of macroLots) {
    html += `<option value="${escapeHtml(macro)}">${escapeHtml(macro)}</option>`;
  }
  html += '<option value="__new__">+ Nouveau macrolot...</option>';
  select.innerHTML = html;
  select.value = selected || '';
  toggleMacroLotNewInput();
}

function getMacroLotFromModal() {
  const select = qs('#lot-macro-group');
  const customInput = qs('#lot-macro-new');
  if (!select) return null;
  if (select.value === '__new__') return normalizeMacroLot(customInput?.value || '');
  return normalizeMacroLot(select.value);
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash);
}

function loadMacroLotColorsByProject() {
  try {
    const raw = localStorage.getItem(MACRO_LOT_COLORS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveMacroLotColorsByProject(state) {
  try {
    localStorage.setItem(MACRO_LOT_COLORS_STORAGE_KEY, JSON.stringify(state || {}));
  } catch (_) {}
}

function getCurrentProjectMacroLotColorMap() {
  if (!currentProject?.id) return {};
  const all = loadMacroLotColorsByProject();
  const map = all[String(currentProject.id)];
  return map && typeof map === 'object' ? map : {};
}

function setCurrentProjectMacroLotColor(macroLot, color) {
  if (!currentProject?.id || !macroLot) return;
  const key = String(currentProject.id);
  const all = loadMacroLotColorsByProject();
  const projectMap = all[key] && typeof all[key] === 'object' ? all[key] : {};
  projectMap[macroLot] = color;
  all[key] = projectMap;
  saveMacroLotColorsByProject(all);
}

function renderRoundsMacroLotColorControls(lots) {
  const wrap = qs('#rounds-macro-lot-colors');
  if (!wrap) return;

  const macroLots = [...new Set((lots || [])
    .map(l => normalizeMacroLot(l.macro_lot))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'fr'));

  if (macroLots.length === 0) {
    wrap.classList.add('hidden');
    wrap.innerHTML = '';
    return;
  }

  const colorMap = getCurrentProjectMacroLotColorMap();
  wrap.classList.remove('hidden');
  wrap.innerHTML = `<span class="muted" style="font-size:12px">Couleurs des macrolots:</span>`;

  for (const macro of macroLots) {
    const chip = document.createElement('span');
    chip.className = 'chip macro-lot-color-chip';
    const color = colorMap[macro] || getMacroLotColor(macro);
    chip.style.borderLeft = `4px solid ${color}`;
    chip.style.background = `${color}15`;
    chip.innerHTML = `<input type="color" value="${color}" title="Couleur du macrolot" style="width:18px;height:18px;border:none;cursor:pointer;padding:0;background:none;vertical-align:middle;margin-right:4px">${escapeHtml(macro)}`;
    chip.querySelector('input[type="color"]')?.addEventListener('change', (e) => {
      setCurrentProjectMacroLotColor(macro, e.target.value);
      loadRoundsComparison();
    });
    wrap.appendChild(chip);
  }
}

function getMacroLotColor(macroLot) {
  const m = normalizeMacroLot(macroLot);
  if (!m) return null;
  const custom = getCurrentProjectMacroLotColorMap()[m];
  if (custom) return custom;
  const hue = hashString(m) % 360;
  return `hsl(${hue}, 65%, 42%)`;
}

async function loadRoundsComparison(){
  if (!currentProject) return;
  
  try {
    const data = await api(`/rounds/project/${currentProject.id}/compare`);
    const { lots, rounds } = data;
    const entrepriseMode = isEntreprise();
    const sortedLots = [...lots].sort((a, b) => {
      const aOrder = Number(a.lot_order ?? a.sort_order);
      const bOrder = Number(b.lot_order ?? b.sort_order);
      if (Number.isFinite(aOrder) && Number.isFinite(bOrder) && aOrder !== bOrder) return aOrder - bOrder;
      if (Number.isFinite(aOrder)) return -1;
      if (Number.isFinite(bOrder)) return 1;
      return Number(a.lot_id ?? a.id) - Number(b.lot_id ?? b.id);
    });
    renderRoundsMacroLotColorControls(sortedLots);
    
    if (rounds.length === 0) {
      qs('#rounds-compare-table').innerHTML = '<tbody><tr><td colspan="10" style="text-align:center;padding:40px;color:var(--muted)">Aucun tour disponible</td></tr></tbody>';
      return;
    }
    
    // Peupler le selecteur de tour
    const selectRound = qs('#compare-round');
    const prevValue = selectRound?.value || '';
    selectRound.innerHTML = '<option value="">Sélectionner un tour...</option>';
    for (const round of rounds) {
      selectRound.innerHTML += `<option value="${round.id}">${round.name}</option>`;
    }

    const defaultId = prevValue
      || (currentRound?.id ? String(currentRound.id) : '')
      || (rounds[rounds.length - 1] ? String(rounds[rounds.length - 1].id) : '');
    if (defaultId) selectRound.value = defaultId;

    const companiesIndex = buildCompaniesIndex(sortedLots, rounds);
    const optionsData = await loadRoundsOptionsData(sortedLots, rounds);
    renderRoundsOptionsSelection(sortedLots, rounds, companiesIndex, optionsData);
    renderRoundsSimulation(sortedLots, rounds, optionsData);
    
    const table = qs('#rounds-compare-table');
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    const tfoot = table.querySelector('tfoot');
    
    // Récupérer le tour sélectionné + cibles d'analyse auto
    const selectedRoundId = selectRound.value ? parseInt(selectRound.value, 10) : null;
    const { openingRound, previousRound } = resolveRoundsComparisonTargets(rounds, selectedRoundId);
    const roundOpeningId = openingRound?.id || null;
    const roundPreviousId = previousRound?.id || null;
    const showOpeningAnalysis = selectedRoundId && roundOpeningId && roundOpeningId !== selectedRoundId;
    const showPreviousAnalysis = selectedRoundId && roundPreviousId && roundPreviousId !== selectedRoundId && roundPreviousId !== roundOpeningId;
    const compareView = qs('#rounds-compare-view');
    if (compareView) {
      compareView.dataset.compareSelected = selectedRoundId ? String(selectedRoundId) : '';
      compareView.dataset.compareOpening = roundOpeningId ? String(roundOpeningId) : '';
      compareView.dataset.comparePrevious = roundPreviousId ? String(roundPreviousId) : '';
    }
    
    // Construire les en-têtes fusionnés au format du récap (Lot/MOE + groupes par tour)
    thead.innerHTML = '';
    const headerRow1 = document.createElement('tr');
    const headerRow2 = document.createElement('tr');

    // Colonne Lot
    const lotTh = document.createElement('th');
    lotTh.rowSpan = 2;
    lotTh.className = 'sticky-col';
    lotTh.textContent = 'Lot';
    headerRow1.appendChild(lotTh);

    // Colonne MOE
    if (!entrepriseMode) {
      const moeTh = document.createElement('th');
      moeTh.rowSpan = 2;
      moeTh.className = 'sticky-col2 amount';
      moeTh.textContent = 'MOE (€)';
      headerRow1.appendChild(moeTh);
    }

    // Groupes par tour (Montant, Écart €, Écart %)
    for (const round of rounds) {
      const grpTh = document.createElement('th');
      grpTh.colSpan = entrepriseMode ? 1 : 3;
      grpTh.className = 'amount';
      grpTh.textContent = round.name;
      headerRow1.appendChild(grpTh);

      const thAmount = document.createElement('th'); thAmount.className = 'amount'; thAmount.textContent = 'Montant (€)';
      headerRow2.appendChild(thAmount);
      if (!entrepriseMode) {
        const thEcartEur = document.createElement('th'); thEcartEur.className = 'amount'; thEcartEur.textContent = 'Écart (€)';
        const thEcartPct = document.createElement('th'); thEcartPct.className = 'amount'; thEcartPct.textContent = 'Écart (%)';
        headerRow2.appendChild(thEcartEur);
        headerRow2.appendChild(thEcartPct);
      }
    }

    // Groupes Analyse
    if (showOpeningAnalysis) {
      const grpAna = document.createElement('th');
      grpAna.colSpan = 3;
      grpAna.className = 'amount';
      grpAna.style.cssText = 'background:rgba(255,140,66,0.1);border-left:2px solid var(--accent)';
      grpAna.innerHTML = `${icon('search')}Analyse vs ouverture`;
      headerRow1.appendChild(grpAna);

      const thDelta = document.createElement('th'); thDelta.className = 'amount'; thDelta.textContent = 'Δ Montant';
      const thDeltaPct = document.createElement('th'); thDeltaPct.className = 'amount'; thDeltaPct.textContent = 'Δ %';
      const thTrend = document.createElement('th'); thTrend.className = 'amount'; thTrend.textContent = 'Tendance';
      headerRow2.appendChild(thDelta);
      headerRow2.appendChild(thDeltaPct);
      headerRow2.appendChild(thTrend);
    }
    if (showPreviousAnalysis) {
      const grpAnaPrev = document.createElement('th');
      grpAnaPrev.colSpan = 3;
      grpAnaPrev.className = 'amount';
      grpAnaPrev.style.cssText = 'background:rgba(255,140,66,0.1);border-left:2px solid var(--accent)';
      grpAnaPrev.innerHTML = `${icon('search')}Analyse vs tour précédent`;
      headerRow1.appendChild(grpAnaPrev);

      const thDelta = document.createElement('th'); thDelta.className = 'amount'; thDelta.textContent = 'Δ Montant';
      const thDeltaPct = document.createElement('th'); thDeltaPct.className = 'amount'; thDeltaPct.textContent = 'Δ %';
      const thTrend = document.createElement('th'); thTrend.className = 'amount'; thTrend.textContent = 'Tendance';
      headerRow2.appendChild(thDelta);
      headerRow2.appendChild(thDeltaPct);
      headerRow2.appendChild(thTrend);
    }

    thead.appendChild(headerRow1);
    thead.appendChild(headerRow2);

    // Corps: une ligne d'en-tête par lot (MOE) + une ligne par entreprise
    tbody.innerHTML = '';
    let totalMoe = 0;
    const totalsByRound = {};
    rounds.forEach(r => totalsByRound[r.id] = 0);
    const bestPriceByLotRound = new Map();

    let lastMacroLot = null;
    for (const lot of sortedLots) {
      const lotId = lot.lot_id ?? lot.id;
      const macroLot = normalizeMacroLot(lot.macro_lot);
      const macroColor = getMacroLotColor(macroLot);

      if (macroLot && macroLot !== lastMacroLot) {
        const macroRow = document.createElement('tr');
        macroRow.className = 'macro-lot-separator-row';
        const macroCell = document.createElement('td');
        macroCell.colSpan = headerRow2.children.length + (entrepriseMode ? 1 : 2);
        macroCell.innerHTML = `<span class="macro-lot-badge" style="border-color:${macroColor};color:${macroColor}">Groupe macrolot: ${escapeHtml(macroLot)}</span>`;
        macroRow.appendChild(macroCell);
        tbody.appendChild(macroRow);
      }
      lastMacroLot = macroLot;

      // Ligne d'en-tête du lot
      const lotRow = document.createElement('tr');
      lotRow.className = 'lot-header-row';
      if (macroColor) {
        lotRow.style.borderLeftColor = macroColor;
      }

      const lotCell = document.createElement('td');
      lotCell.className = 'lot-name-cell sticky-col';
      const lotNumber = Number(lot.lot_order);
      const lotPrefix = Number.isFinite(lotNumber) ? `N\u00b0${lotNumber}` : `Lot ${escapeHtml(String(lotId))}`;
      const lotLabelHtml = lot.lot_code
        ? `<strong><span class="lot-code">${escapeHtml(lotPrefix)}</span> ${escapeHtml(lot.lot_code)} - ${escapeHtml(lot.lot_name || '')}</strong>`
        : `<strong><span class="lot-code">${escapeHtml(lotPrefix)}</span> ${escapeHtml(lot.lot_name || '')}</strong>`;
      lotCell.innerHTML = macroLot
        ? `${lotLabelHtml}<br><span class="macro-lot-badge" style="border-color:${macroColor};color:${macroColor}">Macrolot: ${escapeHtml(macroLot)}</span>`
        : lotLabelHtml;
      lotRow.appendChild(lotCell);

      if (!entrepriseMode) {
        const moeCell = document.createElement('td');
        moeCell.className = 'amount moe-amount sticky-col2';
        moeCell.innerHTML = `<strong>MOE</strong><br>${fmtEuro(lot.moe_total)}`;
        lotRow.appendChild(moeCell);
        totalMoe += lot.moe_total;
      }

      // Pour chaque tour, remplir des cellules avec le meilleur prix (pour ligne MOE)
      for (const round of rounds) {
        const companies = lot.companies_by_round?.[round.id] || [];
        const optionTotalsByCompany = getSelectedOptionTotals(optionsData, lotId, round.id);
        const adjustedCompanies = companies.map(c => ({
          ...c,
          total: (c.total || 0) + (optionTotalsByCompany[c.company_id] || 0)
        }));
        let bestPrice = null;
        let bestCompanyName = '';
        
        if (adjustedCompanies.length > 0) {
          const minTotal = Math.min(...adjustedCompanies.map(c => c.total));
          const bestCompany = adjustedCompanies.find(c => c.total === minTotal);
          bestPrice = minTotal;
          bestCompanyName = bestCompany?.company_name || '';
        }

        bestPriceByLotRound.set(`${lotId}:${round.id}`, bestPrice || 0);
        
        const tdAmount = document.createElement('td'); 
        tdAmount.className = 'amount'; 
        tdAmount.innerHTML = bestPrice !== null 
          ? `<strong>${fmtEuro(bestPrice)}</strong><br><small>(${bestCompanyName})</small>`
          : '—';
        lotRow.appendChild(tdAmount);
        if (!entrepriseMode) {
          const ecart = (bestPrice || 0) - (lot.moe_total || 0);
          const cls = ecart > 0 ? 'ecart-positive' : (ecart < 0 ? 'ecart-negative' : 'ecart-zero');
          const sign = ecart > 0 ? '+' : '';
          const tdEur = document.createElement('td'); tdEur.className = 'amount'; tdEur.innerHTML = bestPrice !== null ? `<span class="${cls}">${sign}${fmtEuro(Math.abs(ecart))}</span>` : '—';
          const pct = (lot.moe_total || 0) > 0 && bestPrice !== null ? (ecart / lot.moe_total) * 100 : 0;
          const clsPct = pct > 0 ? 'ecart-positive' : (pct < 0 ? 'ecart-negative' : 'ecart-zero');
          const signPct = pct > 0 ? '+' : '';
          const tdPct = document.createElement('td'); tdPct.className = 'amount'; tdPct.innerHTML = bestPrice !== null ? `<span class="${clsPct}">${signPct}${pct.toFixed(1)}%</span>` : '—';
          lotRow.appendChild(tdEur);
          lotRow.appendChild(tdPct);
        }
        totalsByRound[round.id] += bestPrice || 0;
      }

      const appendAnalysisCells = (row, fromTotal, toTotal, withBorder) => {
        const delta = toTotal - fromTotal;
        const deltaPct = fromTotal > 0 ? (delta / fromTotal) * 100 : 0;
        const tdDelta = document.createElement('td');
        tdDelta.className = 'amount';
        tdDelta.style.cssText = `background:rgba(255,140,66,0.05);${withBorder ? 'border-left:2px solid var(--accent);' : ''}font-weight:600`;
        tdDelta.style.color = delta < 0 ? 'var(--success)' : (delta > 0 ? 'var(--danger)' : 'var(--fg)');
        tdDelta.textContent = (delta > 0 ? '+' : '') + fmtEuro(delta);
        const tdPct = document.createElement('td'); tdPct.className = 'amount'; tdPct.style.cssText = 'background:rgba(255,140,66,0.05);font-weight:600'; tdPct.style.color = deltaPct < 0 ? 'var(--success)' : (deltaPct > 0 ? 'var(--danger)' : 'var(--fg)'); tdPct.textContent = (deltaPct > 0 ? '+' : '') + deltaPct.toFixed(1) + '%';
        const tdTrend = document.createElement('td'); tdTrend.className = 'amount'; tdTrend.style.cssText = 'background:rgba(255,140,66,0.05);font-size:20px'; tdTrend.textContent = delta < 0 ? '↓' : (delta > 0 ? '↑' : '↔'); tdTrend.style.color = delta < 0 ? 'var(--success)' : (delta > 0 ? 'var(--danger)' : 'var(--muted)');
        row.appendChild(tdDelta);
        row.appendChild(tdPct);
        row.appendChild(tdTrend);
      };

      // Analyse (totaux par lot)
      if (showOpeningAnalysis) {
        const fromTotal = bestPriceByLotRound.get(`${lotId}:${roundOpeningId}`) || 0;
        const toTotal = bestPriceByLotRound.get(`${lotId}:${selectedRoundId}`) || 0;
        appendAnalysisCells(lotRow, fromTotal, toTotal, true);
      }
      if (showPreviousAnalysis) {
        const fromTotal = bestPriceByLotRound.get(`${lotId}:${roundPreviousId}`) || 0;
        const toTotal = bestPriceByLotRound.get(`${lotId}:${selectedRoundId}`) || 0;
        appendAnalysisCells(lotRow, fromTotal, toTotal, true);
      }

      tbody.appendChild(lotRow);

      // Lignes entreprises pour ce lot
      // Construire la liste des entreprises présentes dans au moins un tour
      const companiesMap = new Map(); // company_id -> name
      for (const round of rounds) {
        const companies = lot.companies_by_round?.[round.id] || [];
        for (const c of companies) {
          companiesMap.set(c.company_id, c.company_name);
        }
      }

      for (const [companyId, companyName] of companiesMap.entries()) {
        const row = document.createElement('tr');
        row.className = 'company-row';

        const nameCell = document.createElement('td');
        nameCell.className = 'amount company-name-cell sticky-col';
        nameCell.textContent = companyName;
        row.appendChild(nameCell);

        if (!entrepriseMode) {
          // Colonne MOE vide pour les lignes entreprises (format récap)
          const emptyMoe = document.createElement('td'); 
          emptyMoe.className = 'amount empty-cell sticky-col2'; 
          emptyMoe.textContent = '—';
          row.appendChild(emptyMoe);
        }

        for (const round of rounds) {
          const companies = lot.companies_by_round?.[round.id] || [];
          const optionTotalsByCompany = getSelectedOptionTotals(optionsData, lotId, round.id);
          const found = companies.find(c => c.company_id === companyId);
          const baseAmount = found ? found.total : 0;
          const amount = baseAmount + (optionTotalsByCompany[companyId] || 0);

          const tdAmount = document.createElement('td');
          tdAmount.className = 'amount';
          tdAmount.textContent = fmtEuro(amount);
          row.appendChild(tdAmount);

          if (!entrepriseMode) {
            const ecart = amount - (lot.moe_total || 0);
            const cls = ecart > 0 ? 'ecart-positive' : (ecart < 0 ? 'ecart-negative' : 'ecart-zero');
            const sign = ecart > 0 ? '+' : '';
            const tdEur = document.createElement('td'); tdEur.className = 'amount'; tdEur.innerHTML = `<span class="${cls}">${sign}${fmtEuro(Math.abs(ecart))}</span>`;
            const pct = (lot.moe_total || 0) > 0 ? (ecart / lot.moe_total) * 100 : 0;
            const clsPct = pct > 0 ? 'ecart-positive' : (pct < 0 ? 'ecart-negative' : 'ecart-zero');
            const signPct = pct > 0 ? '+' : '';
            const tdPct = document.createElement('td'); tdPct.className = 'amount'; tdPct.innerHTML = `<span class="${clsPct}">${signPct}${pct.toFixed(1)}%</span>`;
            row.appendChild(tdEur);
            row.appendChild(tdPct);
          }
        }

        // Analyse par entreprise
        if (showOpeningAnalysis) {
          const fromCompanies = lot.companies_by_round?.[roundOpeningId] || [];
          const toCompanies = lot.companies_by_round?.[selectedRoundId] || [];
          const fromBase = (fromCompanies.find(c => c.company_id === companyId)?.total) || 0;
          const toBase = (toCompanies.find(c => c.company_id === companyId)?.total) || 0;
          const fromOptions = getSelectedOptionTotals(optionsData, lotId, roundOpeningId)[companyId] || 0;
          const toOptions = getSelectedOptionTotals(optionsData, lotId, selectedRoundId)[companyId] || 0;
          const fromTotal = fromBase + fromOptions;
          const toTotal = toBase + toOptions;
          appendAnalysisCells(row, fromTotal, toTotal, true);
        }
        if (showPreviousAnalysis) {
          const fromCompanies = lot.companies_by_round?.[roundPreviousId] || [];
          const toCompanies = lot.companies_by_round?.[selectedRoundId] || [];
          const fromBase = (fromCompanies.find(c => c.company_id === companyId)?.total) || 0;
          const toBase = (toCompanies.find(c => c.company_id === companyId)?.total) || 0;
          const fromOptions = getSelectedOptionTotals(optionsData, lotId, roundPreviousId)[companyId] || 0;
          const toOptions = getSelectedOptionTotals(optionsData, lotId, selectedRoundId)[companyId] || 0;
          const fromTotal = fromBase + fromOptions;
          const toTotal = toBase + toOptions;
          appendAnalysisCells(row, fromTotal, toTotal, true);
        }

        tbody.appendChild(row);
      }
    }

    // Pied: totaux par tour au format récap
    tfoot.innerHTML = '';
    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row lot-header-row';

    const totalLabelCell = document.createElement('th');
    totalLabelCell.className = 'sticky-col';
    totalLabelCell.textContent = 'TOTAL';
    totalRow.appendChild(totalLabelCell);

    if (!entrepriseMode) {
      const totalMoeCell = document.createElement('th');
      totalMoeCell.className = 'amount moe-total-cell sticky-col2';
      totalMoeCell.innerHTML = `<strong>${fmtEuro(totalMoe)}</strong>`;
      totalRow.appendChild(totalMoeCell);
    }

    for (const round of rounds) {
      const total = totalsByRound[round.id] || 0;
      const tdAmount = document.createElement('th'); tdAmount.className = 'amount'; tdAmount.innerHTML = `<strong>${fmtEuro(total)}</strong>`;
      totalRow.appendChild(tdAmount);
      if (!entrepriseMode) {
        const ecart = total - totalMoe;
        const cls = ecart > 0 ? 'ecart-positive' : (ecart < 0 ? 'ecart-negative' : 'ecart-zero');
        const sign = ecart > 0 ? '+' : '';
        const tdEur = document.createElement('th'); tdEur.className = 'amount'; tdEur.innerHTML = `<strong><span class="${cls}">${sign}${fmtEuro(Math.abs(ecart))}</span></strong>`;
        const pct = totalMoe > 0 ? (ecart / totalMoe) * 100 : 0;
        const clsPct = pct > 0 ? 'ecart-positive' : (pct < 0 ? 'ecart-negative' : 'ecart-zero');
        const signPct = pct > 0 ? '+' : '';
        const tdPct = document.createElement('th'); tdPct.className = 'amount'; tdPct.innerHTML = `<strong><span class="${clsPct}">${signPct}${pct.toFixed(1)}%</span></strong>`;
        totalRow.appendChild(tdEur);
        totalRow.appendChild(tdPct);
      }
    }

    // Totaux d'analyse
    if (showOpeningAnalysis) {
      const fromTotal = totalsByRound[roundOpeningId] || 0;
      const toTotal = totalsByRound[selectedRoundId] || 0;
      const delta = toTotal - fromTotal;
      const deltaPct = fromTotal > 0 ? (delta / fromTotal) * 100 : 0;
      const tdDelta = document.createElement('th'); tdDelta.className = 'amount'; tdDelta.style.cssText = 'background:rgba(255,140,66,0.05);border-left:2px solid var(--accent);font-weight:600'; tdDelta.style.color = delta < 0 ? 'var(--success)' : (delta > 0 ? 'var(--danger)' : 'var(--fg)'); tdDelta.innerHTML = `<strong>${(delta > 0 ? '+' : '') + fmtEuro(delta)}</strong>`;
      const tdPct = document.createElement('th'); tdPct.className = 'amount'; tdPct.style.cssText = 'background:rgba(255,140,66,0.05);font-weight:600'; tdPct.style.color = deltaPct < 0 ? 'var(--success)' : (deltaPct > 0 ? 'var(--danger)' : 'var(--fg)'); tdPct.innerHTML = `<strong>${(deltaPct > 0 ? '+' : '') + deltaPct.toFixed(1)}%</strong>`;
      const tdTrend = document.createElement('th'); tdTrend.className = 'amount'; tdTrend.style.cssText = 'background:rgba(255,140,66,0.05);font-size:20px'; tdTrend.textContent = delta < 0 ? '↓' : (delta > 0 ? '↑' : '↔'); tdTrend.style.color = delta < 0 ? 'var(--success)' : (delta > 0 ? 'var(--danger)' : 'var(--muted)');
      totalRow.appendChild(tdDelta);
      totalRow.appendChild(tdPct);
      totalRow.appendChild(tdTrend);
    }
    if (showPreviousAnalysis) {
      const fromTotal = totalsByRound[roundPreviousId] || 0;
      const toTotal = totalsByRound[selectedRoundId] || 0;
      const delta = toTotal - fromTotal;
      const deltaPct = fromTotal > 0 ? (delta / fromTotal) * 100 : 0;
      const tdDelta = document.createElement('th'); tdDelta.className = 'amount'; tdDelta.style.cssText = 'background:rgba(255,140,66,0.05);border-left:2px solid var(--accent);font-weight:600'; tdDelta.style.color = delta < 0 ? 'var(--success)' : (delta > 0 ? 'var(--danger)' : 'var(--fg)'); tdDelta.innerHTML = `<strong>${(delta > 0 ? '+' : '') + fmtEuro(delta)}</strong>`;
      const tdPct = document.createElement('th'); tdPct.className = 'amount'; tdPct.style.cssText = 'background:rgba(255,140,66,0.05);font-weight:600'; tdPct.style.color = deltaPct < 0 ? 'var(--success)' : (deltaPct > 0 ? 'var(--danger)' : 'var(--fg)'); tdPct.innerHTML = `<strong>${(deltaPct > 0 ? '+' : '') + deltaPct.toFixed(1)}%</strong>`;
      const tdTrend = document.createElement('th'); tdTrend.className = 'amount'; tdTrend.style.cssText = 'background:rgba(255,140,66,0.05);font-size:20px'; tdTrend.textContent = delta < 0 ? '↓' : (delta > 0 ? '↑' : '↔'); tdTrend.style.color = delta < 0 ? 'var(--success)' : (delta > 0 ? 'var(--danger)' : 'var(--muted)');
      totalRow.appendChild(tdDelta);
      totalRow.appendChild(tdPct);
      totalRow.appendChild(tdTrend);
    }

    tfoot.appendChild(totalRow);
    
  } catch (err) {
    console.error('Erreur chargement comparaison tours:', err);
    showNotify({ title:'Erreur', message:'Chargement comparaison: ' + err.message, type:'error' });
  }
}

function renderRoundsSimulation(lots, rounds, optionsData) {
  const table = qs('#rounds-simulation-table');
  if (!table) return;

  const compareSelected = qs('#compare-round')?.value;
  const roundId = compareSelected ? parseInt(compareSelected, 10) : null;
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  const tfoot = table.querySelector('tfoot');

  thead.innerHTML = '';
  tbody.innerHTML = '';
  tfoot.innerHTML = '';

  if (!roundId) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:40px;color:var(--muted)">Selectionnez un tour pour la simulation</td></tr>';
    return;
  }

  const entrepriseMode = isEntreprise();
  const sortedLots = [...lots].sort((a, b) => {
    const aMacro = normalizeMacroLot(a.macro_lot) || '';
    const bMacro = normalizeMacroLot(b.macro_lot) || '';
    if (aMacro !== bMacro) return aMacro.localeCompare(bMacro, 'fr');
    const aCode = String(a.lot_code || '');
    const bCode = String(b.lot_code || '');
    if (aCode !== bCode) return aCode.localeCompare(bCode, 'fr');
    return String(a.lot_name || '').localeCompare(String(b.lot_name || ''), 'fr');
  });

  const companiesMap = new Map();
  for (const lot of sortedLots) {
    const companies = lot.companies_by_round?.[roundId] || [];
    for (const c of companies) {
      const companyId = Number(c.company_id);
      if (Number.isFinite(companyId)) {
        companiesMap.set(companyId, c.company_name);
      }
    }
  }

  const companies = Array.from(companiesMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  if (companies.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:40px;color:var(--muted)">Aucune entreprise pour ce tour</td></tr>';
    return;
  }

  ensureRoundSimulations(companies, sortedLots, roundId, optionsData);

  if (roundsSimulations.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:40px;color:var(--muted)">Aucune simulation. Utilisez le bouton Ajouter simulation.</td></tr>';
    return;
  }

  const headerRow1 = document.createElement('tr');
  const headerRow2 = document.createElement('tr');
  const thLot = document.createElement('th'); thLot.className = 'sticky-col'; thLot.rowSpan = 2; thLot.textContent = 'Lot';
  headerRow1.appendChild(thLot);
  if (!entrepriseMode) {
    const thMoe = document.createElement('th'); thMoe.className = 'amount'; thMoe.rowSpan = 2; thMoe.textContent = 'MOE (€)';
    headerRow1.appendChild(thMoe);
  }

  for (const sim of roundsSimulations) {
    const thSim = document.createElement('th');
    thSim.colSpan = 2;
    thSim.className = 'amount simulation-header-cell';
    thSim.innerHTML = `
      <div class="simulation-header-content">
        <span>${escapeHtml(sim.name)}</span>
        <button class="btn ghost btn-delete-simulation" type="button" data-simulation-id="${sim.id}" title="Supprimer la simulation" aria-label="Supprimer la simulation">
          ${icon('trash', 'icon-only')}
        </button>
      </div>
    `;
    headerRow1.appendChild(thSim);

    const thAmount = document.createElement('th'); thAmount.className = 'amount'; thAmount.textContent = 'Montant (€)';
    const thCompany = document.createElement('th'); thCompany.textContent = 'Entreprise';
    headerRow2.appendChild(thAmount);
    headerRow2.appendChild(thCompany);
  }

  thead.appendChild(headerRow1);
  thead.appendChild(headerRow2);

  qsa('.btn-delete-simulation').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSimulation(Number(btn.dataset.simulationId));
      renderRoundsSimulation(sortedLots, rounds, optionsData);
    });
  });

  const totalBySim = new Map();
  const missingMoeBySim = new Map();
  roundsSimulations.forEach(sim => { totalBySim.set(sim.id, 0); missingMoeBySim.set(sim.id, false); });

  const rerender = () => renderRoundsSimulation(sortedLots, rounds, optionsData);

  let lastMacroLot = null;
  for (const lot of sortedLots) {
    const lotId = lot.lot_id ?? lot.id;
    const macroLot = normalizeMacroLot(lot.macro_lot);
    const macroColor = getMacroLotColor(macroLot);

    if (macroLot && macroLot !== lastMacroLot) {
      const macroRow = document.createElement('tr');
      macroRow.className = 'macro-lot-separator-row';
      const macroCell = document.createElement('td');
      macroCell.colSpan = 1 + (entrepriseMode ? 0 : 1) + (roundsSimulations.length * 2);
      macroCell.innerHTML = `<span class="macro-lot-badge" style="border-color:${macroColor};color:${macroColor}">Groupe macrolot: ${escapeHtml(macroLot)}</span>`;
      macroRow.appendChild(macroCell);
      tbody.appendChild(macroRow);
    }
    lastMacroLot = macroLot;

    const lotLabel = lot.lot_code
      ? `<strong><span class="lot-code">${escapeHtml(lot.lot_code)}</span> ${escapeHtml(lot.lot_name || '')}</strong>`
      : `<strong>${escapeHtml(lot.lot_name || '')}</strong>`;

    const lotRow = document.createElement('tr');
    lotRow.className = 'lot-header-row';
    if (macroColor) lotRow.style.borderLeftColor = macroColor;

    const tdLot = document.createElement('td');
    tdLot.className = 'sticky-col lot-name-cell';
    tdLot.innerHTML = macroLot
      ? `${lotLabel}<br><span class="macro-lot-badge" style="border-color:${macroColor};color:${macroColor}">Macrolot: ${escapeHtml(macroLot)}</span>`
      : lotLabel;
    lotRow.appendChild(tdLot);

    const hasMoe = Number.isFinite(lot.moe_total);
    const moeTotal = hasMoe ? Number(lot.moe_total) : 0;
    if (!entrepriseMode) {
      const tdMoe = document.createElement('td'); tdMoe.className = 'amount'; tdMoe.textContent = hasMoe ? fmtEuro(moeTotal) : '—';
      if (!hasMoe) {
        tdMoe.style.color = 'var(--danger)';
        tdMoe.style.fontWeight = '600';
      }
      lotRow.appendChild(tdMoe);
    }

    const companiesForLot = lot.companies_by_round?.[roundId] || [];
    const optionTotalsByCompany = getSelectedOptionTotals(optionsData, lotId, roundId);
    const totalsByCompany = new Map();
    for (const c of companiesForLot) {
      const companyId = Number(c.company_id);
      if (!Number.isFinite(companyId)) continue;
      totalsByCompany.set(companyId, (c.total || 0) + (optionTotalsByCompany[companyId] || 0));
    }

    for (const sim of roundsSimulations) {
      const hasExplicit = sim.selections.has(lotId);
      const selectedValue = hasExplicit ? sim.selections.get(lotId) : sim.defaultCompanyId;
      const selectedCompanyId = selectedValue === 0 ? null : (selectedValue ?? null);
      const hasOffer = selectedCompanyId ? totalsByCompany.has(selectedCompanyId) : false;
      let amount = null;
      let missingMoe = false;

      if (hasOffer) {
        amount = totalsByCompany.get(selectedCompanyId);
      } else if (hasMoe) {
        amount = moeTotal;
      } else {
        amount = null;
        missingMoe = true;
      }

      const tdAmount = document.createElement('td');
      tdAmount.className = 'amount';
      tdAmount.textContent = amount !== null ? fmtEuro(amount) : '—';
      if (missingMoe) {
        tdAmount.style.color = 'var(--danger)';
        tdAmount.style.fontWeight = '600';
        missingMoeBySim.set(sim.id, true);
      }
      lotRow.appendChild(tdAmount);

      const tdCompany = document.createElement('td');
      const select = document.createElement('select');
      select.style.width = '100%';
      const optNone = document.createElement('option');
      optNone.value = '';
      optNone.textContent = 'MOE';
      select.appendChild(optNone);
      // N'afficher que les entreprises ayant une offre réelle pour ce lot
      const companiesForDropdown = companies.filter(c => totalsByCompany.has(c.id));
      for (const c of companiesForDropdown) {
        const opt = document.createElement('option');
        opt.value = String(c.id);
        opt.textContent = c.name;
        select.appendChild(opt);
      }
      // Si l'entreprise sélectionnée n'a pas d'offre pour ce lot, remettre à MOE
      const validSelectedId = selectedCompanyId && totalsByCompany.has(selectedCompanyId) ? selectedCompanyId : null;
      if (validSelectedId !== selectedCompanyId && hasExplicit) {
        sim.selections.set(lotId, 0);
      }
      select.value = validSelectedId ? String(validSelectedId) : '';
      select.addEventListener('change', () => {
        const val = select.value ? parseInt(select.value, 10) : null;
        if (val) sim.selections.set(lotId, val);
        else sim.selections.set(lotId, 0);
        rerender();
      });
      tdCompany.appendChild(select);
      lotRow.appendChild(tdCompany);

      if (amount !== null) {
        totalBySim.set(sim.id, (totalBySim.get(sim.id) || 0) + amount);
      } else {
        missingMoeBySim.set(sim.id, true);
      }
    }

    tbody.appendChild(lotRow);
  }

  const totalRow = document.createElement('tr');
  totalRow.className = 'total-row lot-header-row';
  const tdTotalLabel = document.createElement('th'); tdTotalLabel.textContent = 'TOTAL';
  totalRow.appendChild(tdTotalLabel);
  if (!entrepriseMode) {
    const tdTotalMoe = document.createElement('th'); tdTotalMoe.textContent = '';
    totalRow.appendChild(tdTotalMoe);
  }

  for (const sim of roundsSimulations) {
    const tdTotalAmount = document.createElement('th');
    tdTotalAmount.className = 'amount';
    tdTotalAmount.innerHTML = `<strong>${fmtEuro(totalBySim.get(sim.id) || 0)}</strong>`;
    if (missingMoeBySim.get(sim.id)) {
      tdTotalAmount.style.color = 'var(--danger)';
    }
    const tdTotalCompany = document.createElement('th');
    tdTotalCompany.textContent = '';
    totalRow.appendChild(tdTotalAmount);
    totalRow.appendChild(tdTotalCompany);
  }

  tfoot.appendChild(totalRow);
}

function getLotTotalsByCompany(lot, roundId, optionsData) {
  const lotId = lot.lot_id ?? lot.id;
  const companiesForLot = lot.companies_by_round?.[roundId] || [];
  const optionTotalsByCompany = getSelectedOptionTotals(optionsData, lotId, roundId);
  const totalsByCompany = new Map();
  for (const c of companiesForLot) {
    const companyId = Number(c.company_id);
    if (!Number.isFinite(companyId)) continue;
    totalsByCompany.set(companyId, (c.total || 0) + (optionTotalsByCompany[companyId] || 0));
  }
  return totalsByCompany;
}

function ensureRoundSimulations(companies, lots = [], roundId = null, optionsData = null) {
  if (!roundsSimulationsInitialized && !roundsSimulations.length) {
    for (let i = 0; i < DEFAULT_SIMULATIONS; i++) {
      roundsSimulations.push({
        id: nextSimulationId++,
        name: `Simulation ${nextSimulationId - 1}`,
        selections: new Map(),
        defaultCompanyId: null
      });
    }
    roundsSimulationsInitialized = true;
  }

  roundsSimulations.forEach((sim, idx) => {
    if (!sim.defaultCompanyId || !companies.find(c => c.id === sim.defaultCompanyId)) {
      sim.defaultCompanyId = companies[idx]?.id || companies[0]?.id || null;
    }
  });

  if (!roundId || !optionsData || !Array.isArray(lots) || lots.length === 0) return;

  const lotsByMacro = new Map();
  for (const lot of lots) {
    const lotId = lot.lot_id ?? lot.id;
    const macro = normalizeMacroLot(lot.macro_lot);
    if (!macro || !lotId) continue;
    if (!lotsByMacro.has(macro)) lotsByMacro.set(macro, []);
    lotsByMacro.get(macro).push(lot);
  }

  const candidatesByMacro = new Map();
  for (const [macro, macroLots] of lotsByMacro.entries()) {
    let candidateSet = null;
    for (const lot of macroLots) {
      const totalsByCompany = getLotTotalsByCompany(lot, roundId, optionsData);
      const lotCompanies = new Set(Array.from(totalsByCompany.keys()));
      if (candidateSet === null) {
        candidateSet = lotCompanies;
      } else {
        candidateSet = new Set([...candidateSet].filter(cid => lotCompanies.has(cid)));
      }
      if (!candidateSet.size) break;
    }
    const ordered = [...(candidateSet || [])].filter(cid => companies.some(c => c.id === cid));
    candidatesByMacro.set(macro, ordered);
  }

  roundsSimulations.forEach((sim, simIndex) => {
    for (const [macro, macroLots] of lotsByMacro.entries()) {
      const candidates = candidatesByMacro.get(macro) || [];
      if (!candidates.length) continue;
      const chosenCompanyId = candidates[simIndex % candidates.length];
      for (const lot of macroLots) {
        const lotId = lot.lot_id ?? lot.id;
        if (!lotId) continue;
        if (!sim.selections.has(lotId)) {
          sim.selections.set(lotId, chosenCompanyId);
        }
      }
    }
  });
}

function addSimulation() {
  roundsSimulations.push({
    id: nextSimulationId++,
    name: `Simulation ${nextSimulationId - 1}`,
    selections: new Map(),
    defaultCompanyId: null
  });
  roundsSimulationsInitialized = true;
}

function deleteSimulation(simulationId) {
  const id = Number(simulationId);
  if (!Number.isFinite(id)) return;
  roundsSimulations = roundsSimulations.filter(sim => Number(sim.id) !== id);
  roundsSimulationsInitialized = true;
}

function buildCompaniesIndex(lots, rounds) {
  const map = new Map();
  for (const lot of lots) {
    for (const round of rounds) {
      const companies = lot.companies_by_round?.[round.id] || [];
      for (const c of companies) {
        if (!map.has(c.company_id)) map.set(c.company_id, c.company_name);
      }
    }
  }
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
}

async function loadRoundsOptionsData(lots, rounds) {
  const optionsByLotRound = new Map();
  const optionIndex = new Map();

  const requests = [];
  for (const lot of lots) {
    const lotId = lot.lot_id ?? lot.id;
    if (!lotId) continue;
    for (const round of rounds) {
      requests.push(
        api(`/options/lot/${lotId}?round_id=${round.id}`)
          .then(options => ({ lotId, roundId: round.id, options }))
          .catch(() => ({ lotId, roundId: round.id, options: [] }))
      );
    }
  }

  const results = await Promise.all(requests);
  for (const result of results) {
    const key = `${result.lotId}:${result.roundId}`;
    optionsByLotRound.set(key, result.options);
    for (const opt of result.options) {
      const totalsByCompany = {};
      for (const item of (opt.items || [])) {
        for (const offer of (item.offers || [])) {
          const qty = parseNum(offer.qty);
          const pu = parseNum(offer.unit_price);
          const mt = (Number.isFinite(qty) ? qty : 0) * (Number.isFinite(pu) ? pu : 0);
          totalsByCompany[offer.company_id] = (totalsByCompany[offer.company_id] || 0) + mt;
        }
      }
      optionIndex.set(opt.id, {
        option: opt,
        lotId: result.lotId,
        roundId: result.roundId,
        totalsByCompany
      });
    }
  }

  return { optionsByLotRound, optionIndex };
}

function getSelectedOptionTotals(optionsData, lotId, roundId) {
  const totals = {};
  for (const optionId of selectedRoundOptions) {
    const meta = optionsData.optionIndex.get(optionId);
    if (!meta || meta.lotId !== lotId || meta.roundId !== roundId) continue;
    for (const [companyId, amount] of Object.entries(meta.totalsByCompany)) {
      totals[companyId] = (totals[companyId] || 0) + amount;
    }
  }
  return totals;
}

function renderRoundsOptionsSelection(lots, rounds, companiesIndex, optionsData) {
  const head = qs('#rounds-options-head');
  const body = qs('#rounds-options-body');
  if (!head || !body) return;

  head.innerHTML = '';
  body.innerHTML = '';

  const headerRow = document.createElement('tr');
  const thSelect = document.createElement('th'); thSelect.textContent = '';
  const thRound = document.createElement('th'); thRound.textContent = 'Tour';
  const thLot = document.createElement('th'); thLot.textContent = 'Lot';
  const thOption = document.createElement('th'); thOption.textContent = 'Option';
  headerRow.appendChild(thSelect);
  headerRow.appendChild(thRound);
  headerRow.appendChild(thLot);
  headerRow.appendChild(thOption);
  for (const c of companiesIndex) {
    const th = document.createElement('th');
    th.className = 'amount';
    th.textContent = c.name;
    headerRow.appendChild(th);
  }
  head.appendChild(headerRow);

  let hasRows = false;
  for (const round of rounds) {
    for (const lot of lots) {
      const lotId = lot.lot_id ?? lot.id;
      if (!lotId) continue;
      const key = `${lotId}:${round.id}`;
      const options = optionsData.optionsByLotRound.get(key) || [];
      for (const opt of options) {
        hasRows = true;
        const meta = optionsData.optionIndex.get(opt.id);
        const tr = document.createElement('tr');

        const tdCheck = document.createElement('td');
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = selectedRoundOptions.has(opt.id);
        chk.addEventListener('change', () => {
          if (chk.checked) selectedRoundOptions.add(opt.id);
          else selectedRoundOptions.delete(opt.id);
          loadRoundsComparison();
        });
        tdCheck.appendChild(chk);
        tr.appendChild(tdCheck);

        const tdRound = document.createElement('td');
        tdRound.textContent = round.name;
        tr.appendChild(tdRound);

        const tdLot = document.createElement('td');
        tdLot.textContent = lot.lot_code ? `${lot.lot_code} ${lot.lot_name}` : lot.lot_name;
        tr.appendChild(tdLot);

        const tdOption = document.createElement('td');
        tdOption.textContent = opt.designation;
        tr.appendChild(tdOption);

        for (const c of companiesIndex) {
          const td = document.createElement('td');
          td.className = 'amount';
          const amount = meta?.totalsByCompany?.[c.id] || 0;
          td.textContent = amount ? fmtEuro(amount) : '—';
          tr.appendChild(td);
        }

        body.appendChild(tr);
      }
    }
  }

  if (!hasRows) {
    body.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:24px;color:var(--muted)">Aucune option disponible</td></tr>';
  }
}

async function createRound(){
  console.log('createRound called, currentProject:', currentProject);
  if (!currentProject) {
    showNotify({ title: 'Validation', message: 'Veuillez d\'abord ouvrir un projet', type: 'info' });
    return;
  }
  try {
    // Déterminer le nom automatique
    const rounds = await api(`/rounds/project/${currentProject.id}`);
    const nextNumber = rounds.length;
    const name = nextNumber === 0 ? 'Ouverture des offres' : `${nextNumber}${nextNumber === 1 ? 'er' : 'ème'} tour`;
    
    const newRound = await api(`/rounds/project/${currentProject.id}`, {
      method: 'POST',
      body: { name, description: '' }
    });
    
    // Recharger la liste des tours
    await loadRounds();
    
    // Sélectionner automatiquement le nouveau tour
    setTimeout(() => {
      const newCard = Array.from(qsa('.round-card')).find(card => 
        card.querySelector('.round-name').textContent === name
      );
      if (newCard) {
        selectRound(newRound, newCard);
      }
    }, 100);
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
}

async function duplicateRound(roundId){
  const newName = prompt('Nom du nouveau tour:');
  if (!newName) return;
  
  try {
    await api(`/rounds/${roundId}/duplicate`, {
      method: 'POST',
      body: { newName }
    });
    await loadRounds();
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
}

async function deleteRound(roundId){
  showDeleteConfirmation({
    title: 'Supprimer un tour',
    message: 'Êtes-vous sûr de vouloir supprimer ce tour et toutes ses données ?',
    extra: '<strong>⚠️ Attention:</strong> Cette action supprimera tous les articles, offres et réponses associés à ce tour. Cette action ne peut pas être annulée.',
    onConfirm: async () => {
      try {
        await api(`/rounds/${roundId}`, { method: 'DELETE' });
        
        // Supprimer la carte du DOM
        const card = qs(`.round-card[data-round-id="${roundId}"]`);
        if (card) {
          card.remove();
        }
        
        // Supprimer l'onglet de la sous-navigation
        const tab = qs(`#rounds-tabs button[data-round-id="${roundId}"]`);
        if (tab) {
          tab.remove();
        }
        
        // Si c'était le tour actuel, revenir à la liste
        if (currentRound && currentRound.id === roundId) {
          currentRound = null;
          activateTab('tab-rounds');
        }
        showNotify({ title: 'Succès', message: 'Tour supprimé avec succès', type: 'success' });
      } catch (err) {
        showNotify({ title: 'Erreur', message: err.message, type: 'error' });
      }
    }
  });
}

async function openLot(id, lotMeta){
  currentLot = { id, ...lotMeta };
  
  // Si l'utilisateur est entreprise mais n'a pas de company_id, rafraîchir le token
  if (isEntreprise() && !currentUser?.company_id) {
    await refreshCurrentUserToken();
  }
  
  // Afficher l'onglet lot (il n'est pas dans la nav principale)
  qsa('.tabpanel').forEach(p => p.classList.add('hidden'));
  show('#tab-lot');
  
  activateSubtab('subtab-data'); // Activer le sous-onglet "Données" par défaut
  setText('#lot-title', `Lot #${id} — ${lotMeta.name}`);

  // Données combinées (inclut déjà les entreprises) via l'endpoint existant
  const roundParam = currentRound ? `?round_id=${currentRound.id}` : '';
  const raw = await api(`/lots/${id}${roundParam}`); // { lot, items, moe, companies, offers }
  lotCompanies = raw.companies || [];
  buildSheetModel(raw);
  
  // Charger les options du lot
  await loadLotOptions();

  // Afficher comparatif par défaut
  await refreshCompare();
  hide('#sheet-view'); hide('#sheet-actions'); show('#compare-view');
  hide('#options-sheet-view'); show('#options-compare-view');
  qs('#mode-compare').classList.add('active-mode'); qs('#mode-edit').classList.remove('active-mode');
  
  // Visionneurs et Entreprises: masquer édition et Config Questions
  if (isVisionneur() || isEntreprise()) {
    const modeEditBtn = qs('#mode-edit');
    if (modeEditBtn) modeEditBtn.style.display = 'none';
    // Masquer complètement le panneau de configuration des seuils
    const configDetails = qs('.config-details');
    if (configDetails) configDetails.style.display = 'none';
    // Masquer le sous-onglet Config Questions
    const subtabCfgBtn = qs('[data-subtab="subtab-config"]');
    if (subtabCfgBtn) subtabCfgBtn.style.display = 'none';
  } else {
    const modeEditBtn = qs('#mode-edit');
    if (modeEditBtn) modeEditBtn.style.display = '';
    const configDetails = qs('.config-details');
    if (configDetails) configDetails.style.display = '';
    const subtabCfgBtn = qs('[data-subtab="subtab-config"]');
    if (subtabCfgBtn) subtabCfgBtn.style.display = '';
  }

  // Chips entreprises
  renderLotCompanies();
  
  // Activer l'onglet lot
  enableTab('tab-lot-questions', true);
  
  // Masquer les onglets de tour (config/questions) quand un lot est selectionne
  const tourConfigBtn = qs('[data-tour-tab="tour-config"]');
  const tourQuestionsBtn = qs('[data-tour-tab="tour-questions"]');
  if (tourConfigBtn) tourConfigBtn.style.display = 'none';
  if (tourQuestionsBtn) tourQuestionsBtn.style.display = 'none';
  const tourConfigPanel = qs('#tour-config');
  const tourQuestionsPanel = qs('#tour-questions');
  if (tourConfigPanel) tourConfigPanel.classList.add('hidden');
  if (tourQuestionsPanel) tourQuestionsPanel.classList.add('hidden');
  
  // Charger les seuils et questions
  if (!isEntreprise() && !isVisionneur()) {
    await loadLotThresholds();
    await loadProjectQuestionConfig();
  }
  populateCompanyFilter();
}

/* ================= Options (Additifs cochables) ================= */
async function loadLotOptions(){
  if (!currentLot || !currentRound) return;
  try {
    const options = await api(`/options/lot/${currentLot.id}?round_id=${currentRound.id}`);
    lotOptions = options.map(opt => ({ ...opt }));
    const optSheet = qs('#options-sheet-view');
    if (optSheet && !optSheet.classList.contains('hidden')) {
      renderOptionsSheetTable();
      setupOptionsSheetControls();
    }
  } catch (err) {
    console.error('Erreur chargement options:', err);
  }
}

function setupOptionsSheetControls(){
  const sel = qs('#options-add-select');
  const btn = qs('#options-add-btn');
  const createBtn = qs('#options-create-btn');
  if (!sel || !btn) return;
  sel.innerHTML = '';
  for (const opt of lotOptions){
    const o = document.createElement('option');
    o.value = String(opt.id); o.textContent = opt.designation;
    sel.appendChild(o);
  }
  if (createBtn) {
    createBtn.onclick = async () => {
      if (isVisionneur()) return;
      if (!currentRound?.id) {
        showNotify({ title: 'Erreur', message: 'Sélectionnez un tour avant de créer une option.', type: 'error' });
        return;
      }
      const design = prompt('Désignation de l\'option:');
      if (!design) return;
      try {
        await api(`/options/lot/${currentLot.id}`, {
          method: 'POST', body: { round_id: currentRound.id, designation: design }
        });
        await loadLotOptions();
        await refreshCompare();
      } catch (err) {
        showNotify({ title: 'Erreur', message: err.message, type: 'error' });
      }
    };
  }
  if (isVisionneur()) {
    btn.disabled = true;
    if (createBtn) createBtn.style.display = 'none';
  }
  const addOptionItem = async () => {
    if (isVisionneur()) return;
    const optionId = Number(sel.value);
    if (!optionId) return;
    try {
      const res = await api(`/options/${optionId}/items`, { method:'POST', body:{ num:'', designation:'', unit:'', moe_qty:null, moe_unit_price:null } });
      const opt = lotOptions.find(o => Number(o.id) === optionId);
      if (opt) opt.items = [...(opt.items||[]), { id: res.id, num:'', designation:'', unit:'', moe_qty:null, moe_unit_price:null, offers:[] }];
      // Add to model and DOM directly
      const newRow = { item_id: res.id, option_id: optionId, option_designation: opt?.designation||'', num:'', designation:'', unit:'', moe:{qty:'',pu:''}, offers:{} };
      for (const c of lotCompanies) newRow.offers[c.id] = { u:'', qty:'', pu:'', mt:'' };
      optionsSheetRows.push(newRow);
      // Remove "aucune option" placeholder if present
      const body = qs('#options-sheet-body');
      if (body && optionsSheetRows.length === 1) { renderOptionsSheetTable(); }
      else { appendOptionsRowDOM(optionsSheetRows.length - 1, newRow); }
      showNotify({ title:'Option', message:'Article ajouté', type:'success' });
    } catch (err) {
      showNotify({ title:'Erreur', message: err.message, type:'error' });
    }
  };
  btn.onclick = addOptionItem;
  sel.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addOptionItem();
    }
  };
}

function formatOptionNum(num) {
  const s = String(num ?? '').trim();
  return s ? `O${s}` : '';
}

function parseOptionNum(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  return s.replace(/^O\s*/i, '').trim();
}

/* ================= Autosave avec debounce ================= */
const autosaveTimers = {};
const autosaveHandlers = {
  thresholds: () => debounceAutoSave('thresholds', autoSaveLotThresholds),
  projectQuestions: () => debounceAutoSave('project-questions', autoSaveProjectQuestionConfig),
  globalThresholds: () => debounceAutoSave('global-thresholds', saveGlobalLotThresholds, 700)
};

function debounceAutoSave(key, fn, delay = 600) {
  if (autosaveTimers[key]) clearTimeout(autosaveTimers[key]);
  autosaveTimers[key] = setTimeout(fn, delay);
}

function showSaveStatus(elementId, status) {
  const btn = qs(elementId);
  if (!btn) return;
  btn.style.opacity = '0.6';
  btn.style.cursor = 'default';
  btn.style.pointerEvents = 'none';
  
  if (status === 'saving') {
    btn.innerHTML = `${icon('loader', 'spinner')}En cours...`;
  } else if (status === 'saved') {
    btn.innerHTML = `${icon('check-circle')}Sauvegardé`;
    setTimeout(() => {
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      btn.style.pointerEvents = 'auto';
    }, 2000);
  } else if (status === 'error') {
    btn.innerHTML = `${icon('x-circle')}Erreur`;
  }
}

function resetSaveButton(elementId) {
  const btn = qs(elementId);
  if (btn) {
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
    btn.style.pointerEvents = 'auto';
  }
}

/* ================= Sauvegarde auto des seuils ================= */
async function autoSaveLotThresholds() {
  if (isVisionneur() || isEntreprise() || !currentLot) return;
  
  showSaveStatus('#save-thresholds', 'saving');
  try {
    const body = {
      qty_very_low_threshold: parseFloat(qs('#threshold-qty-very-low').value),
      qty_low_threshold: parseFloat(qs('#threshold-qty-low').value),
      qty_high_threshold: parseFloat(qs('#threshold-qty-high').value),
      qty_very_high_threshold: parseFloat(qs('#threshold-qty-very-high').value),
      price_very_low_threshold: parseFloat(qs('#threshold-price-very-low').value),
      price_low_threshold: parseFloat(qs('#threshold-price-low').value),
      price_high_threshold: parseFloat(qs('#threshold-price-high').value),
      price_very_high_threshold: parseFloat(qs('#threshold-price-very-high').value),
      amount_very_low_threshold: parseFloat(qs('#threshold-amount-very-low').value),
      amount_low_threshold: parseFloat(qs('#threshold-amount-low').value),
      amount_high_threshold: parseFloat(qs('#threshold-amount-high').value),
      amount_very_high_threshold: parseFloat(qs('#threshold-amount-very-high').value)
    };
    await api(`/question-config/lot/${currentLot.id}/thresholds`, { method: 'PUT', body });
    updateQuestionsLegend(body);
    showSaveStatus('#save-thresholds', 'saved');
  } catch (err) {
    console.error('Erreur autosave seuils:', err);
    showSaveStatus('#save-thresholds', 'error');
    resetSaveButton('#save-thresholds');
  }
}

/* ================= Sauvegarde auto des questions du projet ================= */
async function autoSaveProjectQuestionConfig() {
  if (!currentProject) return;
  
  showSaveStatus('#save-thresholds', 'saving');
  try {
    const body = {
      question_qty_very_low: qs('#q-qty-very-low').value.trim(),
      question_qty_low: qs('#q-qty-low').value.trim(),
      question_qty_high: qs('#q-qty-high').value.trim(),
      question_qty_very_high: qs('#q-qty-very-high').value.trim(),
      question_price_very_low: qs('#q-price-very-low').value.trim(),
      question_price_low: qs('#q-price-low').value.trim(),
      question_price_high: qs('#q-price-high').value.trim(),
      question_price_very_high: qs('#q-price-very-high').value.trim(),
      question_amount_very_low: qs('#q-amount-very-low').value.trim(),
      question_amount_low: qs('#q-amount-low').value.trim(),
      question_amount_high: qs('#q-amount-high').value.trim(),
      question_amount_very_high: qs('#q-amount-very-high').value.trim(),
      unanswered_comment: (qs('#q-unanswered-comment')?.value || '').trim(),
      unanswered_color: qs('#q-unanswered-color')?.value || '#fff3cd',
      offer_amount_mismatch_comment: (qs('#q-offer-amount-mismatch-comment')?.value || '').trim(),
      question_unit_mismatch: (qs('#q-unit-mismatch')?.value || '').trim()
    };
    const url = currentLot
      ? `/question-config/lot/${currentLot.id}/question-config`
      : `/question-config/project/${currentProject.id}`;
    await api(url, { method: 'PUT', body });
    unansweredConfig.comment = body.unanswered_comment;
    unansweredConfig.color = body.unanswered_color;
    // Re-render the sheet to apply updated unanswered styles
    for (let r = 0; r < sheetRows.length; r++) recalcRowAmountsRow(r);
    showSaveStatus('#save-thresholds', 'saved');
  } catch (err) {
    console.error('Erreur autosave config questions projet:', err);
    showSaveStatus('#save-thresholds', 'error');
    resetSaveButton('#save-thresholds');
  }
}

/* ================= Configuration Questions (Projet) ================= */
async function loadProjectQuestionConfig(){
  if (!currentProject) return;
  try {
    const config = currentLot
      ? await api(`/question-config/lot/${currentLot.id}/question-config`)
      : await api(`/question-config/project/${currentProject.id}`);
    qs('#q-qty-very-low').value = config.question_qty_very_low || '';
    qs('#q-qty-low').value = config.question_qty_low || '';
    qs('#q-qty-high').value = config.question_qty_high || '';
    qs('#q-qty-very-high').value = config.question_qty_very_high || '';
    qs('#q-price-very-low').value = config.question_price_very_low || '';
    qs('#q-price-low').value = config.question_price_low || '';
    qs('#q-price-high').value = config.question_price_high || '';
    qs('#q-price-very-high').value = config.question_price_very_high || '';
    qs('#q-amount-very-low').value = config.question_amount_very_low || '';
    qs('#q-amount-low').value = config.question_amount_low || '';
    qs('#q-amount-high').value = config.question_amount_high || '';
    qs('#q-amount-very-high').value = config.question_amount_very_high || '';
    qs('#q-unanswered-comment').value = config.unanswered_comment || 'Article sans réponse';
    qs('#q-unanswered-color').value = config.unanswered_color || '#fff3cd';
    qs('#q-offer-amount-mismatch-comment').value = config.offer_amount_mismatch_comment || 'Montant incohérent dans la DPGF : le montant importé est conservé.';
    if (qs('#q-unit-mismatch')) qs('#q-unit-mismatch').value = config.question_unit_mismatch || 'Pourquoi l\'unité de chiffrage est-elle différente de l\'unité MOE ({unit}) ?';
    unansweredConfig.comment = config.unanswered_comment || 'Article sans réponse';
    unansweredConfig.color = config.unanswered_color || '#fff3cd';
    attachProjectQuestionsListeners();
  } catch (err) {
    console.error('Erreur chargement config questions:', err);
  }
}

function updateQuestionsLegend(thresholds) {
  // Mettre à jour les valeurs de seuils dans la légende
  // Les écarts sont exprimés en %, et les seuils sont symétriques (négatifs et positifs)
  const qtyVeryLow = parseFloat(thresholds?.qty_very_low_threshold) || 25;
  const qtyLow = parseFloat(thresholds?.qty_low_threshold) || 10;
  const qtyHigh = parseFloat(thresholds?.qty_high_threshold) || 10;
  const qtyVeryHigh = parseFloat(thresholds?.qty_very_high_threshold) || 25;
  
  // Très bas: < -qtyVeryLow
  if (qs('#legend-qty-very-low-val')) {
    qs('#legend-qty-very-low-val').textContent = qtyVeryLow;
  }
  
  // Bas: -qtyVeryLow à -qtyLow
  if (qs('#legend-qty-very-low-val2')) {
    qs('#legend-qty-very-low-val2').textContent = qtyVeryLow;
  }
  if (qs('#legend-qty-low-val')) {
    qs('#legend-qty-low-val').textContent = qtyLow;
  }
  
  // Haut: +qtyHigh à +qtyVeryHigh
  if (qs('#legend-qty-high-val')) {
    qs('#legend-qty-high-val').textContent = qtyHigh;
  }
  if (qs('#legend-qty-high-val2')) {
    qs('#legend-qty-high-val2').textContent = qtyVeryHigh;
  }
  
  // Très haut: > +qtyVeryHigh
  if (qs('#legend-qty-very-high-val')) {
    qs('#legend-qty-very-high-val').textContent = qtyVeryHigh;
  }

  // Réponses Oubliées: mettre à jour le swatch et le commentaire
  const swatch = qs('#legend-unanswered-swatch');
  if (swatch) {
    const c = unansweredConfig.color || '#ffc107';
    swatch.style.borderLeft = `3px solid ${c}`;
    swatch.style.background = hexToRgba(c, 0.15);
  }
  const commentEl = qs('#legend-unanswered-comment');
  if (commentEl) {
    commentEl.textContent = unansweredConfig.comment || 'Article sans réponse';
  }

  updateSheetLegend();
}

async function saveProjectQuestionConfig(){
  if (!currentProject) return;
  try {
    const body = {
      question_qty_very_low: qs('#q-qty-very-low').value.trim(),
      question_qty_low: qs('#q-qty-low').value.trim(),
      question_qty_high: qs('#q-qty-high').value.trim(),
      question_qty_very_high: qs('#q-qty-very-high').value.trim(),
      question_price_very_low: qs('#q-price-very-low').value.trim(),
      question_price_low: qs('#q-price-low').value.trim(),
      question_price_high: qs('#q-price-high').value.trim(),
      question_price_very_high: qs('#q-price-very-high').value.trim(),
      question_amount_very_low: qs('#q-amount-very-low').value.trim(),
      question_amount_low: qs('#q-amount-low').value.trim(),
      question_amount_high: qs('#q-amount-high').value.trim(),
      question_amount_very_high: qs('#q-amount-very-high').value.trim(),
      unanswered_comment: (qs('#q-unanswered-comment')?.value || '').trim(),
      unanswered_color: qs('#q-unanswered-color')?.value || '#fff3cd',
      offer_amount_mismatch_comment: (qs('#q-offer-amount-mismatch-comment')?.value || '').trim(),
      question_unit_mismatch: (qs('#q-unit-mismatch')?.value || '').trim()
    };
    const url = currentLot
      ? `/question-config/lot/${currentLot.id}/question-config`
      : `/question-config/project/${currentProject.id}`;
    await api(url, { method: 'PUT', body, showLoader: false });
    unansweredConfig.comment = body.unanswered_comment;
    unansweredConfig.color = body.unanswered_color;
    for (let r = 0; r < sheetRows.length; r++) recalcRowAmountsRow(r);
    showNotify({ title: 'Succès', message: 'Configuration sauvegardée', type: 'success' });
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
}

/* ================= Fiches Questions (Lot) ================= */
async function loadLotThresholds(){
  if (!currentLot) return;
  try {
    const thresholds = await api(`/question-config/lot/${currentLot.id}/thresholds`);
    qs('#threshold-qty-very-low').value = thresholds.qty_very_low_threshold || 25;
    qs('#threshold-qty-low').value = thresholds.qty_low_threshold || 10;
    qs('#threshold-qty-high').value = thresholds.qty_high_threshold || 10;
    qs('#threshold-qty-very-high').value = thresholds.qty_very_high_threshold || 25;
    qs('#threshold-price-very-low').value = thresholds.price_very_low_threshold || 25;
    qs('#threshold-price-low').value = thresholds.price_low_threshold || 10;
    qs('#threshold-price-high').value = thresholds.price_high_threshold || 10;
    qs('#threshold-price-very-high').value = thresholds.price_very_high_threshold || 25;
    qs('#threshold-amount-very-low').value = thresholds.amount_very_low_threshold || 25;
    qs('#threshold-amount-low').value = thresholds.amount_low_threshold || 10;
    qs('#threshold-amount-high').value = thresholds.amount_high_threshold || 10;
    qs('#threshold-amount-very-high').value = thresholds.amount_very_high_threshold || 25;
    updateQuestionsLegend(thresholds);
    attachThresholdListeners();
  } catch (err) {
    console.error('Erreur chargement seuils:', err);
  }
}

function attachThresholdListeners(){
  const thresholdIds = [
    'threshold-qty-very-low', 'threshold-qty-low', 'threshold-qty-high', 'threshold-qty-very-high',
    'threshold-price-very-low', 'threshold-price-low', 'threshold-price-high', 'threshold-price-very-high',
    'threshold-amount-very-low', 'threshold-amount-low', 'threshold-amount-high', 'threshold-amount-very-high'
  ];
  const qtyThresholdIds = ['threshold-qty-very-low', 'threshold-qty-low', 'threshold-qty-high', 'threshold-qty-very-high'];

  thresholdIds.forEach(id => {
    const el = qs(`#${id}`);
    if (el) {
      el.removeEventListener('input', autosaveHandlers.thresholds);
      el.addEventListener('input', autosaveHandlers.thresholds);
      if (qtyThresholdIds.includes(id)) {
        el.removeEventListener('input', updateLegendFromInputs);
        el.addEventListener('input', updateLegendFromInputs);
      }
    }
  });
}

function updateLegendFromInputs(){
  // Récupérer les valeurs actuelles des inputs
  const thresholds = {
    qty_very_low_threshold: parseFloat(qs('#threshold-qty-very-low').value) || 25,
    qty_low_threshold: parseFloat(qs('#threshold-qty-low').value) || 10,
    qty_high_threshold: parseFloat(qs('#threshold-qty-high').value) || 10,
    qty_very_high_threshold: parseFloat(qs('#threshold-qty-very-high').value) || 25
  };
  updateQuestionsLegend(thresholds);
}

function attachProjectQuestionsListeners(){
  const questionFieldIds = ['q-qty-very-low', 'q-qty-low', 'q-qty-high', 'q-qty-very-high',
                           'q-price-very-low', 'q-price-low', 'q-price-high', 'q-price-very-high',
                           'q-amount-very-low', 'q-amount-low', 'q-amount-high', 'q-amount-very-high',
                           'q-unanswered-comment', 'q-unanswered-color', 'q-offer-amount-mismatch-comment'];
  questionFieldIds.forEach(id => {
    const el = qs(`#${id}`);
    if (el) {
      if (el.type === 'color') {
        el.removeEventListener('change', autosaveHandlers.projectQuestions);
        el.addEventListener('change', autosaveHandlers.projectQuestions);
      } else {
        el.removeEventListener('input', autosaveHandlers.projectQuestions);
        el.addEventListener('input', autosaveHandlers.projectQuestions);
      }
    }
  });
}


async function saveLotThresholds(){
  if (isVisionneur() || isEntreprise()) { showNotify({ title:'Accès refusé', message:'Vous ne pouvez pas modifier les seuils.', type:'error' }); return; }
  if (!currentLot) return;
  try {
    const body = {
      qty_very_low_threshold: parseFloat(qs('#threshold-qty-very-low').value),
      qty_low_threshold: parseFloat(qs('#threshold-qty-low').value),
      qty_high_threshold: parseFloat(qs('#threshold-qty-high').value),
      qty_very_high_threshold: parseFloat(qs('#threshold-qty-very-high').value),
      price_very_low_threshold: parseFloat(qs('#threshold-price-very-low').value),
      price_low_threshold: parseFloat(qs('#threshold-price-low').value),
      price_high_threshold: parseFloat(qs('#threshold-price-high').value),
      price_very_high_threshold: parseFloat(qs('#threshold-price-very-high').value),
      amount_very_low_threshold: parseFloat(qs('#threshold-amount-very-low').value),
      amount_low_threshold: parseFloat(qs('#threshold-amount-low').value),
      amount_high_threshold: parseFloat(qs('#threshold-amount-high').value),
      amount_very_high_threshold: parseFloat(qs('#threshold-amount-very-high').value)
    };
    await api(`/question-config/lot/${currentLot.id}/thresholds`, { method: 'PUT', body });
    updateQuestionsLegend(body);
    showNotify({ title: 'Succès', message: 'Seuils sauvegardés', type: 'success' });
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
}

function formatThresholdValue(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(fallback);
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 100) / 100);
}

function readGlobalThresholdRowsFromDom() {
  return LOT_THRESHOLD_FIELDS.reduce((data, field) => {
    const input = qs(`#global-thresholds-body .global-threshold-input[data-field="${field}"]`);
    const value = Number(input?.value);
    data[field] = Number.isFinite(value) ? Math.max(0, value) : LOT_THRESHOLD_DEFAULTS[field];
    return data;
  }, {});
}

function readGlobalQuestionConfigFromDom() {
  return Object.values(QUESTION_CONFIG_FIELDS).reduce((data, field) => {
    data[field] = (qs(`#global-thresholds-body [data-question-field="${field}"]`)?.value || '').trim();
    return data;
  }, {});
}

function renderGlobalLotThresholds(rows = []) {
  const container = qs('#global-thresholds-body');
  if (!container) return;

  const globalThresholds = globalLotThresholds?.global_thresholds || {};
  const questionConfig = globalLotThresholds?.question_config || {};
  const sections = GLOBAL_THRESHOLD_GROUPS.map(group => `
    <section class="global-threshold-section">
      <h4><svg class="icon" aria-hidden="true"><use href="./assets/icons.svg#icon-${group.icon}"></use></svg>${group.title}</h4>
      <div class="global-threshold-grid">
        ${group.fields.map(field => `
          <div class="global-threshold-card" style="--threshold-color:${field.color};--threshold-bg:${hexToRgba(field.color, 0.08)}">
            <div class="global-threshold-card-title">
              <span></span>
              <strong>${field.label}</strong>
            </div>
            <div class="global-threshold-lot-list">
              <label class="global-threshold-lot-row global-threshold-single-row">
                <span>Seuil (%)</span>
                <input class="global-threshold-input" type="number" min="0" max="100" step="1"
                  data-field="${field.key}"
                  value="${formatThresholdValue(globalThresholds[field.key], LOT_THRESHOLD_DEFAULTS[field.key])}" />
              </label>
              <label class="global-threshold-question-row">
                <span>Question</span>
                <textarea rows="3" data-question-field="${QUESTION_CONFIG_FIELDS[field.key]}">${escapeHtml(questionConfig[QUESTION_CONFIG_FIELDS[field.key]] || '')}</textarea>
              </label>
            </div>
          </div>
        `).join('')}
      </div>
    </section>
  `).join('');

  container.innerHTML = sections;

  qsa('.global-threshold-input, [data-question-field]').forEach(input => {
    input.removeEventListener('input', autosaveHandlers.globalThresholds);
    input.addEventListener('input', autosaveHandlers.globalThresholds);
  });
}

async function loadGlobalLotThresholds() {
  if (!currentProject || isVisionneur() || isEntreprise()) return;
  try {
    globalLotThresholds = await api(`/question-config/project/${currentProject.id}/lot-thresholds`);
    renderGlobalLotThresholds(globalLotThresholds.lots || []);
  } catch (err) {
    console.error('Erreur chargement seuils globaux:', err);
  }
}

async function saveGlobalLotThresholds() {
  if (!currentProject || isVisionneur() || isEntreprise()) return;
  const global_thresholds = readGlobalThresholdRowsFromDom();
  const question_config = readGlobalQuestionConfigFromDom();

  showSaveStatus('#save-global-thresholds', 'saving');
  try {
    await api(`/question-config/project/${currentProject.id}/lot-thresholds`, {
      method: 'PUT',
      body: { global_thresholds, question_config },
      showLoader: false
    });
    globalLotThresholds = { ...(globalLotThresholds || {}), global_thresholds, question_config };
    showSaveStatus('#save-global-thresholds', 'saved');
  } catch (err) {
    console.error('Erreur sauvegarde seuils globaux:', err);
    showSaveStatus('#save-global-thresholds', 'error');
    resetSaveButton('#save-global-thresholds');
  }
}

async function generateQuestions(){
  if (isVisionneur() || isEntreprise()) { showNotify({ title:'Accès refusé', message:'Vous ne pouvez pas générer de fiches questions.', type:'error' }); return; }
  if (!currentLot || !currentRound) return;
  try {
    const result = await api(`/question-config/lot/${currentLot.id}/generate`, {
      method: 'POST',
      body: { round_id: currentRound.id }
    });
    showNotify({ title: 'Succès', message: `${result.generated} fiche(s) question générée(s)`, type: 'success' });
    await refreshQuestions();
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
}

async function generateAllLotsQuestions() {
  if (isVisionneur() || isEntreprise()) {
    showNotify({ title: 'Accès refusé', message: 'Vous ne pouvez pas générer de fiches questions.', type: 'error' });
    return;
  }
  if (!currentRound) {
    showNotify({ title: 'Erreur', message: 'Aucun tour sélectionné.', type: 'error' });
    return;
  }
  const lots = globalLotThresholds?.lots || [];
  if (lots.length === 0) {
    showNotify({ title: 'Aucun lot', message: 'Ce projet ne contient aucun lot.', type: 'error' });
    return;
  }

  const roundLabel = currentRound.name || `Tour ${currentRound.id}`;
  const confirmed = window.confirm(
    `Générer les fiches questions pour les ${lots.length} lot(s) du tour « ${roundLabel} » ?\n\nLes fiches existantes seront recalculées (sauf celles modifiées manuellement).`
  );
  if (!confirmed) return;

  const btn = qs('#generate-all-lots-questions');
  const originalHTML = btn?.innerHTML || '';
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner-small"></span> Génération…`; }

  let totalGenerated = 0;
  let errors = 0;
  try {
    for (const lot of lots) {
      try {
        const result = await api(`/question-config/lot/${lot.lot_id}/generate`, {
          method: 'POST',
          body: { round_id: currentRound.id },
          showLoader: false
        });
        totalGenerated += Number(result.generated || 0);
      } catch (e) {
        errors++;
        console.warn(`[generate-all] Erreur lot ${lot.lot_id}:`, e);
      }
    }
    if (errors === 0) {
      showNotify({ title: 'Succès', message: `${totalGenerated} fiche(s) question générée(s) sur ${lots.length} lot(s).`, type: 'success' });
    } else {
      showNotify({ title: 'Terminé avec erreurs', message: `${totalGenerated} fiche(s) générée(s). ${errors} lot(s) en erreur.`, type: 'warning' });
    }
    await refreshQuestions();
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = originalHTML; }
  }
}

function openQuestionsEditorModal(){
  show('#questions-editor-modal');
  setText('#questions-editor-modal-msg', '');
}

async function deleteAllQuestions(){
  if (isVisionneur() || isEntreprise()) { showNotify({ title:'Accès refusé', message:'Vous ne pouvez pas supprimer les fiches questions.', type:'error' }); return; }
  if (!currentLot || !currentRound) return;
  
  showDeleteConfirmation({
    title: 'Supprimer toutes les fiches questions',
    message: 'Êtes-vous sûr de vouloir supprimer toutes les fiches questions pour ce lot et ce tour ?',
    extra: '<strong>⚠️ Attention:</strong> Cette action supprimera toutes les fiches questions générées. Les réponses des entreprises seront perdues. Cette action ne peut pas être annulée.',
    onConfirm: async () => {
      try {
        qsa('.question-text-editor').forEach(textarea => {
          if (textarea.dataset.itemId) suppressedQuestionSaveItemIds.add(String(textarea.dataset.itemId));
        });
        pendingQuestionSaves.clear();
        hasUnsavedQuestionChanges = false;
        await waitForQuestionSaveIdle();
        const result = await api(`/question-config/lot/${currentLot.id}?round_id=${currentRound.id}`, {
          method: 'DELETE',
          showLoader: false
        });
        showNotify({ title: 'Succès', message: `${result.deleted || 0} fiche(s) supprimée(s)`, type: 'success' });
        await loadQuestionsEditor({ force: true, silent: true });
        refreshQuestionsInBackground();
      } catch (err) {
        showNotify({ title:'Erreur', message: err.message, type:'error' });
      }
    }
  });
}

function populateCompanyFilter(){
  const select = qs('#filter-company');
  if (!select) return;
  select.innerHTML = '<option value="">Toutes les entreprises</option>';
  for (const c of lotCompanies) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  }
}

async function exportQuestionsExcel(){
  if (!currentLot || !currentRound) return;
  try {
    const companyId = qs('#filter-company')?.value || '';
    const status = qs('#filter-status')?.value || '';
    
    let url = `/exports/questions-by-company/${currentLot.id}?round_id=${currentRound.id}`;
    if (companyId) url += `&company_id=${companyId}`;
    if (status) url += `&status=${status}`;
    
    // Télécharger avec cookie HttpOnly (credentials)
    const response = await fetch(API_BASE + url, {
      credentials: 'include'
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Erreur serveur' }));
      throw new Error(error.error || 'Erreur lors de l\'export');
    }
    
    // Créer un blob et télécharger le fichier
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `Fiches_Questions_Lot_${currentLot.id}_Par_Entreprise_${new Date().toISOString().split('T')[0]}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);
  } catch (err) {
    showNotify({ title:'Erreur', message: err.message, type:'error' });
  }
}

/* ====== Suivi des envois de fiches questions ====== */

let questionsSendData = []; // cache des données de suivi pour le modal courant

async function openQuestionsSendModal() {
  if (!currentLot || !currentRound) {
    showNotify({ title:'Validation', message:'Sélectionnez un lot et un tour', type:'info' });
    return;
  }

  // Pré-remplir l'objet du mail
  const subjectEl = qs('#qs-send-subject');
  const messageEl = qs('#qs-send-message');
  if (subjectEl) subjectEl.value = `Fiches Questions - ${currentLot.name || 'Lot ' + currentLot.id} - Tour ${currentRound.round_number}`;
  if (messageEl) messageEl.value = 'Bonjour,\n\nVeuillez trouver en pièce jointe les fiches questions associées à votre offre.\n\nCordialement';

  // Libellé lot/tour
  const labelEl = qs('#qs-send-lot-label');
  if (labelEl) labelEl.textContent = `Lot : ${currentLot.code ? currentLot.code + ' — ' : ''}${currentLot.name || currentLot.id}  |  Tour ${currentRound.round_number}${currentRound.name ? ' — ' + currentRound.name : ''}`;

  show('#questions-send-modal');
  await refreshQuestionsSendTable();
}

function closeQuestionsSendModal() {
  hide('#questions-send-modal');
  questionsSendData = [];
}

async function refreshQuestionsSendTable() {
  if (!currentLot || !currentRound) return;
  const body = qs('#qs-send-table-body');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--muted)">Chargement…</td></tr>';
  try {
    const data = await api(`/exports/questions-send-status?lotId=${currentLot.id}&roundId=${currentRound.id}`);
    questionsSendData = data;
    renderQuestionsSendTable(data);
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--danger)">${err.message}</td></tr>`;
  }
}

function renderQuestionsSendTable(companies) {
  const body = qs('#qs-send-table-body');
  if (!body) return;
  if (!companies || companies.length === 0) {
    body.innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--muted)">Aucune entreprise associée à ce lot.</td></tr>';
    return;
  }

  body.innerHTML = companies.map(c => {
    const hasSent = !!c.last_sent_at;
    const sentDate = hasSent ? new Date(c.last_sent_at).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
    const sentCount = Number(c.send_count) || 0;
    const colorBar = c.color ? `border-left: 4px solid ${c.color};` : '';

    const statusBadge = hasSent
      ? `<span style="display:inline-flex;align-items:center;gap:5px;color:#198754;font-weight:600;font-size:0.85em"><svg class="icon" style="width:14px;height:14px" aria-hidden="true"><use href="./assets/icons.svg#icon-check-circle"></use></svg>Envoyé</span>`
      : `<span style="display:inline-flex;align-items:center;gap:5px;color:var(--muted);font-size:0.85em"><svg class="icon" style="width:14px;height:14px" aria-hidden="true"><use href="./assets/icons.svg#icon-clock"></use></svg>Non envoyé</span>`;

    const sentInfo = hasSent
      ? `<div style="font-size:0.82em;color:var(--fg);font-weight:600">${sentDate}</div><div style="font-size:0.78em;color:var(--muted)">${c.last_sent_to_email}${c.sent_by_email ? ' · par ' + c.sent_by_email : ''}</div>`
      : `<span style="color:var(--muted);font-size:0.82em">—</span>`;

    return `<tr style="${colorBar}" data-company-id="${c.id}">
      <td style="padding:10px 14px;font-weight:600;border-bottom:1px solid var(--border)">${c.name}</td>
      <td style="padding:10px 14px;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:6px">
          <input type="email"
            class="qs-email-input"
            data-company-id="${c.id}"
            value="${c.email ? c.email.replace(/"/g,'&quot;') : ''}"
            placeholder="email@entreprise.fr"
            style="padding:5px 8px;border-radius:5px;border:1px solid var(--border);background:var(--input-bg);color:var(--fg);font-size:0.88em;width:200px;min-width:0"
          />
          <button class="btn ghost qs-save-email-btn" data-company-id="${c.id}" title="Sauvegarder l'email" style="padding:4px 8px;font-size:0.8em">
            <svg class="icon" style="width:14px;height:14px" aria-hidden="true"><use href="./assets/icons.svg#icon-check"></use></svg>
          </button>
        </div>
      </td>
      <td style="padding:10px 14px;text-align:center;border-bottom:1px solid var(--border)">${statusBadge}</td>
      <td style="padding:10px 14px;border-bottom:1px solid var(--border)">${sentInfo}</td>
      <td style="padding:10px 14px;text-align:center;border-bottom:1px solid var(--border)">
        ${sentCount > 0 ? `<span style="font-weight:600;color:var(--copper)">${sentCount}</span>` : '<span style="color:var(--muted)">0</span>'}
      </td>
      <td style="padding:10px 14px;text-align:center;border-bottom:1px solid var(--border)">
        <button class="btn ghost qs-send-one-btn" data-company-id="${c.id}" title="Envoyer à cette entreprise" ${!c.email ? 'disabled title="Aucun email renseigné"' : ''} style="padding:5px 10px;font-size:0.85em">
          <svg class="icon" style="width:14px;height:14px" aria-hidden="true"><use href="./assets/icons.svg#icon-mail"></use></svg>Envoyer
        </button>
      </td>
    </tr>`;
  }).join('');

  // Attacher les événements
  body.querySelectorAll('.qs-save-email-btn').forEach(btn => {
    btn.addEventListener('click', () => saveCompanyEmail(Number(btn.dataset.companyId)));
  });
  body.querySelectorAll('.qs-email-input').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveCompanyEmail(Number(input.dataset.companyId));
    });
  });
  body.querySelectorAll('.qs-send-one-btn').forEach(btn => {
    btn.addEventListener('click', () => sendQuestionsToCompany(Number(btn.dataset.companyId)));
  });
}

async function saveCompanyEmail(companyId) {
  const input = qs(`input.qs-email-input[data-company-id="${companyId}"]`);
  if (!input) return;
  const email = input.value.trim();
  try {
    await api(`/lots/companies/${companyId}/email`, { method: 'PATCH', body: { email } });
    // Mettre à jour le cache local
    const entry = questionsSendData.find(c => Number(c.id) === Number(companyId));
    if (entry) entry.email = email || null;
    // Mettre à jour le bouton d'envoi de la ligne
    const sendBtn = qs(`.qs-send-one-btn[data-company-id="${companyId}"]`);
    if (sendBtn) sendBtn.disabled = !email;
    showNotify({ title: 'Succès', message: `Email sauvegardé pour ${entry?.name || 'l\'entreprise'}`, type: 'success' });
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
}

async function sendQuestionsToCompany(companyId) {
  const company = questionsSendData.find(c => Number(c.id) === Number(companyId));
  if (!company) return;

  const emailInput = qs(`input.qs-email-input[data-company-id="${companyId}"]`);
  const email = emailInput?.value.trim() || company.email;
  if (!email) {
    showNotify({ title: 'Validation', message: `Renseignez l'email de ${company.name}`, type: 'info' });
    return;
  }

  const subject = qs('#qs-send-subject')?.value.trim() || `Fiches Questions - Lot ${currentLot.id}`;
  const message = qs('#qs-send-message')?.value.trim() || '';

  const sendBtn = qs(`.qs-send-one-btn[data-company-id="${companyId}"]`);
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '…'; }

  try {
    await api('/exports/send-questions-to-company', {
      method: 'POST',
      body: { lotId: currentLot.id, roundId: currentRound.id, companyId, email, subject, message }
    });
    showNotify({ title: 'Envoyé', message: `Fiches questions envoyées à ${company.name} (${email})`, type: 'success' });
    await refreshQuestionsSendTable();
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
    if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = '<svg class="icon" style="width:14px;height:14px" aria-hidden="true"><use href="./assets/icons.svg#icon-mail"></use></svg>Envoyer'; }
  }
}

async function sendQuestionsToAll(onlyUnsent = false) {
  const targets = questionsSendData.filter(c => {
    // Récupérer l'email depuis le champ (peut avoir été modifié)
    const inputEl = qs(`input.qs-email-input[data-company-id="${c.id}"]`);
    const email = inputEl?.value.trim() || c.email;
    if (!email) return false;
    if (onlyUnsent && c.last_sent_at) return false;
    return true;
  });

  if (targets.length === 0) {
    const msg = onlyUnsent ? 'Toutes les entreprises ont déjà reçu les fiches (ou n\'ont pas d\'email).' : 'Aucune entreprise avec un email valide trouvée.';
    showNotify({ title: 'Info', message: msg, type: 'info' });
    return;
  }

  const subject = qs('#qs-send-subject')?.value.trim() || `Fiches Questions - Lot ${currentLot.id}`;
  const message = qs('#qs-send-message')?.value.trim() || '';

  const allBtn = qs('#qs-send-all-btn');
  const unsentBtn = qs('#qs-send-unsent-btn');
  if (allBtn) allBtn.disabled = true;
  if (unsentBtn) unsentBtn.disabled = true;

  let successCount = 0;
  let failCount = 0;
  for (const c of targets) {
    const inputEl = qs(`input.qs-email-input[data-company-id="${c.id}"]`);
    const email = inputEl?.value.trim() || c.email;
    try {
      await api('/exports/send-questions-to-company', {
        method: 'POST',
        body: { lotId: currentLot.id, roundId: currentRound.id, companyId: c.id, email, subject, message }
      });
      successCount++;
    } catch {
      failCount++;
    }
  }

  if (allBtn) allBtn.disabled = false;
  if (unsentBtn) unsentBtn.disabled = false;

  const msg = `${successCount} envoi(s) réussi(s)${failCount > 0 ? `, ${failCount} échec(s)` : ''}`;
  showNotify({ title: successCount > 0 ? 'Envois terminés' : 'Erreur', message: msg, type: successCount > 0 ? 'success' : 'error' });
  await refreshQuestionsSendTable();
}

async function exportRAO(){
  if (!currentProject) return;
  try {
    await downloadFromApi(`${API_BASE}/exports/rao/${currentProject.id}`, {
      filenameFallback: `RAO_${currentProject.name}_${new Date().toISOString().split('T')[0]}.docx`
    });
    showNotify({ title: 'Succès', message: 'RAO généré avec succès', type: 'success' });
  } catch (err) {
    showNotify({ title:'Erreur', message: err.message, type:'error' });
  }
}

function openRaoExportModal() {
  if (!currentProject) {
    showNotify({ title: 'Validation', message: 'Sélectionnez un projet', type: 'info' });
    return;
  }
  const formatEl = qs('#rao-export-format');
  const toEl = qs('#rao-export-email-to');
  const subjectEl = qs('#rao-export-email-subject');
  const messageEl = qs('#rao-export-email-message');
  if (formatEl) formatEl.value = 'rao';
  if (toEl) toEl.value = '';
  if (subjectEl) subjectEl.value = `RAO - ${currentProject?.name || ''}`;
  if (messageEl) messageEl.value = 'Bonjour,\nVeuillez trouver en pièce jointe le RAO Word.';
  const emailFields = qs('#rao-export-email-fields');
  if (emailFields) emailFields.classList.add('hidden');
  show('#rao-export-modal');
}

function closeRaoExportModal() {
  hide('#rao-export-modal');
}

function toggleRaoExportEmailFields() {
  const format = qs('#rao-export-format')?.value || 'download';
  const emailFields = qs('#rao-export-email-fields');
  if (!emailFields) return;
  if (format === 'email') emailFields.classList.remove('hidden');
  else emailFields.classList.add('hidden');
}

async function confirmRaoExport() {
  const format = qs('#rao-export-format')?.value || 'rao';
  if (format === 'rao') {
    closeRaoExportModal();
    await exportRAO();
    return;
  }
  if (format === 'zip') {
    closeRaoExportModal();
    await exportFullProjectBundleFromRound(currentRound);
    return;
  }
  if (format === 'email') {
    const to = qs('#rao-export-email-to')?.value?.trim() || '';
    const subject = qs('#rao-export-email-subject')?.value?.trim() || '';
    const message = qs('#rao-export-email-message')?.value?.trim() || '';
    if (!to) {
      showNotify({ title: 'Validation', message: 'Veuillez saisir au moins un destinataire', type: 'info' });
      return;
    }
    if (!subject) {
      showNotify({ title: 'Validation', message: 'Veuillez saisir un objet', type: 'info' });
      return;
    }
    try {
      await api('/exports/send-email', {
        method: 'POST',
        body: {
          to,
          subject,
          message,
          exportType: 'rao',
          exportParams: { projectId: currentProject.id }
        }
      });
      closeRaoExportModal();
      showNotify({ title: 'Succès', message: 'Email envoyé avec la pièce jointe Word', type: 'success' });
    } catch (err) {
      showNotify({ title: 'Erreur', message: err.message, type: 'error' });
    }
  }
}

function openExportEmailModal(config) {
  pendingEmailExport = config;
  const subjectInput = qs('#export-email-subject');
  const toInput = qs('#export-email-to');
  const messageInput = qs('#export-email-message');
  if (subjectInput) subjectInput.value = config.subject || '';
  if (toInput) toInput.value = '';
  if (messageInput) messageInput.value = 'Bonjour,\nVeuillez trouver en pièce jointe l\'export Excel.';
  show('#export-email-modal');
}

function closeExportEmailModal() {
  hide('#export-email-modal');
  pendingEmailExport = null;
}

async function sendExportByEmail() {
  if (!pendingEmailExport) return;
  const to = qs('#export-email-to')?.value?.trim() || '';
  const subject = qs('#export-email-subject')?.value?.trim() || '';
  const message = qs('#export-email-message')?.value?.trim() || '';

  if (!to) {
    showNotify({ title: 'Validation', message: 'Veuillez saisir au moins un destinataire', type: 'info' });
    return;
  }
  if (!subject) {
    showNotify({ title: 'Validation', message: 'Veuillez saisir un objet', type: 'info' });
    return;
  }

  try {
    await api('/exports/send-email', {
      method: 'POST',
      body: {
        to,
        subject,
        message,
        exportType: pendingEmailExport.exportType,
        exportParams: pendingEmailExport.exportParams
      }
    });
    closeExportEmailModal();
    showNotify({ title: 'Succès', message: 'Email envoyé avec la pièce jointe Excel', type: 'success' });
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
}

function getRoundsComparisonExportParams() {
  const compareView = qs('#rounds-compare-view');
  const roundSelected = compareView?.dataset.compareSelected || '';
  const roundPrevious = compareView?.dataset.comparePrevious || '';
  const roundOpening = compareView?.dataset.compareOpening || '';
  const roundFrom = roundPrevious || roundOpening;
  const roundTo = roundSelected;
  const params = new URLSearchParams();
  if (roundFrom) params.set('round_from', roundFrom);
  if (roundTo) params.set('round_to', roundTo);

  const simulations = roundsSimulations.map(sim => ({
    name: sim.name,
    defaultCompanyId: sim.defaultCompanyId,
    selections: Object.fromEntries(sim.selections)
  }));

  return {
    queryParams: params,
    exportParams: {
      projectId: currentProject?.id,
      roundFrom,
      roundTo,
      simulations,
      simulationRoundId: qs('#compare-round')?.value || '',
      selectedOptions: Array.from(selectedRoundOptions)
    }
  };
}

function exportRoundsComparisonPDF() {
  const title = `Comparaison des Tours - ${currentProject?.name || ''}`.trim();
  exportTableToPDF('#rounds-compare-table', title || 'Comparaison des Tours');
}

async function exportRoundsComparisonExcel() {
  if (!currentProject) {
    showNotify({ title:'Validation', message:'Sélectionnez un projet', type:'info' });
    return;
  }
  try {
    const { queryParams, exportParams } = getRoundsComparisonExportParams();
    const requestUrl = `${API_BASE}/exports/rounds-comparison/${currentProject.id}${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    await downloadFromApi(requestUrl, {
      method: 'POST',
      filenameFallback: `ComparaisonTours_${currentProject?.name || 'Projet'}.xlsx`,
      body: {
        simulations: exportParams.simulations,
        simulationRoundId: exportParams.simulationRoundId,
        selectedOptions: exportParams.selectedOptions
      }
    });
  } catch (err) {
    showNotify({ title:'Erreur', message:'Export: ' + err.message, type:'error' });
  }
}

function openRoundsExportModal() {
  if (!currentProject) {
    showNotify({ title:'Validation', message:'Sélectionnez un projet', type:'info' });
    return;
  }
  const formatEl = qs('#rounds-export-format');
  const toEl = qs('#rounds-export-email-to');
  const subjectEl = qs('#rounds-export-email-subject');
  const messageEl = qs('#rounds-export-email-message');

  if (formatEl) formatEl.value = 'excel';
  if (toEl) toEl.value = '';
  if (subjectEl) subjectEl.value = `Comparaison des Tours - ${currentProject?.name || ''}`;
  if (messageEl) messageEl.value = 'Bonjour,\nVeuillez trouver en pièce jointe l\'export Excel.';

  const emailFields = qs('#rounds-export-email-fields');
  if (emailFields) emailFields.classList.add('hidden');
  show('#rounds-export-modal');
}

function closeRoundsExportModal() {
  hide('#rounds-export-modal');
}

function toggleRoundsExportEmailFields() {
  const format = qs('#rounds-export-format')?.value || 'excel';
  const emailFields = qs('#rounds-export-email-fields');
  if (!emailFields) return;
  if (format === 'email') emailFields.classList.remove('hidden');
  else emailFields.classList.add('hidden');
}

async function confirmRoundsExport() {
  const format = qs('#rounds-export-format')?.value || 'excel';

  if (format === 'pdf') {
    closeRoundsExportModal();
    exportRoundsComparisonPDF();
    return;
  }

  if (format === 'excel') {
    closeRoundsExportModal();
    await exportRoundsComparisonExcel();
    return;
  }

  if (format === 'email') {
    const to = qs('#rounds-export-email-to')?.value?.trim() || '';
    const subject = qs('#rounds-export-email-subject')?.value?.trim() || '';
    const message = qs('#rounds-export-email-message')?.value?.trim() || '';

    if (!to) {
      showNotify({ title: 'Validation', message: 'Veuillez saisir au moins un destinataire', type: 'info' });
      return;
    }
    if (!subject) {
      showNotify({ title: 'Validation', message: 'Veuillez saisir un objet', type: 'info' });
      return;
    }

    try {
      const { exportParams } = getRoundsComparisonExportParams();
      await api('/exports/send-email', {
        method: 'POST',
        body: {
          to,
          subject,
          message,
          exportType: 'rounds-comparison',
          exportParams
        }
      });
      closeRoundsExportModal();
      showNotify({ title: 'Succès', message: 'Email envoyé avec la pièce jointe Excel', type: 'success' });
    } catch (err) {
      showNotify({ title: 'Erreur', message: err.message, type: 'error' });
    }
  }
}

function exportCurrentDataPDF() {
  const isCompareContext = dataExportContext === 'lot-compare';
  const selector = isCompareContext ? '#compare-table' : '#sheet-table';
  const title = isCompareContext
    ? `Comparatif Lot - ${currentProject?.name || ''} ${currentRound ? `(Tour ${currentRound.round_number} - ${currentRound.name})` : ''}`.trim()
    : `Données Lot - ${currentProject?.name || ''} ${currentRound ? `(Tour ${currentRound.round_number} - ${currentRound.name})` : ''}`.trim();
  exportTableToPDF(selector, title || 'Données Lot');
}

async function exportCurrentDataExcel() {
  if (!currentRound) {
    showNotify({ title:'Validation', message:'Sélectionnez un tour', type:'info' });
    return;
  }
  const isCompareContext = dataExportContext === 'lot-compare';
  if (isCompareContext && !currentLot) {
    showNotify({ title:'Validation', message:'Sélectionnez un lot', type:'info' });
    return;
  }
  try {
    const exportUrl = isCompareContext
      ? `${API_BASE}/exports/lot-comparison/${currentLot.id}?round_id=${currentRound.id}`
      : `${API_BASE}/exports/summary/${currentRound.id}`;
    const res = await fetch(exportUrl, {
      credentials: 'include'
    });
    if (!res.ok) throw new Error('Erreur export');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isCompareContext
      ? `Comparatif_${currentLot?.code || currentLot?.id}_${currentLot?.name || ''}_Tour${currentRound.round_number}.xlsx`
      : `Recap_${currentProject?.name}_Tour${currentRound.round_number}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    showNotify({ title:'Erreur', message:'Export: ' + err.message, type:'error' });
  }
}

function openDataExportModal() {
  if (!currentRound) {
    showNotify({ title:'Validation', message:'Sélectionnez un tour', type:'info' });
    return;
  }
  dataExportContext = 'data-sheet';
  const formatEl = qs('#data-export-format');
  const toEl = qs('#data-export-email-to');
  const subjectEl = qs('#data-export-email-subject');
  const messageEl = qs('#data-export-email-message');

  if (formatEl) formatEl.value = 'excel';
  if (toEl) toEl.value = '';
  if (subjectEl) subjectEl.value = `Export Données Lot - ${currentProject?.name || ''}`;
  if (messageEl) messageEl.value = 'Bonjour,\nVeuillez trouver en pièce jointe l\'export Excel.';

  const emailFields = qs('#data-export-email-fields');
  if (emailFields) emailFields.classList.add('hidden');
  show('#data-export-modal');
}

function openLotCompareExportModal() {
  if (!currentRound) {
    showNotify({ title:'Validation', message:'Sélectionnez un tour', type:'info' });
    return;
  }
  dataExportContext = 'lot-compare';
  const formatEl = qs('#data-export-format');
  const toEl = qs('#data-export-email-to');
  const subjectEl = qs('#data-export-email-subject');
  const messageEl = qs('#data-export-email-message');

  if (formatEl) formatEl.value = 'pdf';
  if (toEl) toEl.value = '';
  if (subjectEl) subjectEl.value = `Comparatif Lot - ${currentProject?.name || ''}`;
  if (messageEl) messageEl.value = 'Bonjour,\nVeuillez trouver en pièce jointe l\'export Excel.';

  const emailFields = qs('#data-export-email-fields');
  if (emailFields) emailFields.classList.add('hidden');
  show('#data-export-modal');
}

function closeDataExportModal() {
  hide('#data-export-modal');
}

function toggleDataExportEmailFields() {
  const format = qs('#data-export-format')?.value || 'excel';
  const emailFields = qs('#data-export-email-fields');
  if (!emailFields) return;
  if (format === 'email') emailFields.classList.remove('hidden');
  else emailFields.classList.add('hidden');
}

async function confirmDataExport() {
  const format = qs('#data-export-format')?.value || 'excel';

  if (format === 'pdf') {
    closeDataExportModal();
    exportCurrentDataPDF();
    return;
  }

  if (format === 'excel') {
    closeDataExportModal();
    await exportCurrentDataExcel();
    return;
  }

  if (format === 'email') {
    const to = qs('#data-export-email-to')?.value?.trim() || '';
    const subject = qs('#data-export-email-subject')?.value?.trim() || '';
    const message = qs('#data-export-email-message')?.value?.trim() || '';

    if (!to) {
      showNotify({ title: 'Validation', message: 'Veuillez saisir au moins un destinataire', type: 'info' });
      return;
    }
    if (!subject) {
      showNotify({ title: 'Validation', message: 'Veuillez saisir un objet', type: 'info' });
      return;
    }
    if (!currentRound) {
      showNotify({ title:'Validation', message:'Sélectionnez un tour', type:'info' });
      return;
    }

    try {
      await api('/exports/send-email', {
        method: 'POST',
        body: {
          to,
          subject,
          message,
          exportType: dataExportContext === 'lot-compare' ? 'lot-comparison' : 'summary',
          exportParams: dataExportContext === 'lot-compare'
            ? { lotId: currentLot?.id, roundId: currentRound.id }
            : { roundId: currentRound.id }
        }
      });
      closeDataExportModal();
      showNotify({ title: 'Succès', message: 'Email envoyé avec la pièce jointe Excel', type: 'success' });
    } catch (err) {
      showNotify({ title: 'Erreur', message: err.message, type: 'error' });
    }
  }
}

async function refreshQuestions({ silent = false } = {}){
  if (!currentLot || !currentRound) return;
  try {
    const companyId = qs('#filter-company')?.value || '';
    const status = qs('#filter-status')?.value || '';
    
    let url = `/question-config/lot/${currentLot.id}?round_id=${currentRound.id}`;
    if (companyId) url += `&company_id=${companyId}`;
    if (status) url += `&status=${status}`;
    
    let questions = await api(url, { showLoader: !silent });
    const lotData = await api(`/lots/${currentLot.id}?round_id=${currentRound.id}`, { showLoader: false });

    const companiesById = new Map((lotData?.companies || []).map(c => [Number(c.id), c]));
    const sourceCompanyByItemId = new Map((lotData?.items || []).map(item => [Number(item.id), Number(item.source_company_id)]));
    const offerByItemCompany = new Map();
    for (const offer of (lotData?.offers || [])) {
      const key = `${Number(offer.item_id)}_${Number(offer.company_id)}`;
      offerByItemCompany.set(key, offer);
    }
    // Filtrage combiné avancé
    const type = qs('#filter-type')?.value;
    const deviation = parseFloat(qs('#filter-deviation')?.value);
    const price = parseFloat(qs('#filter-price')?.value);
    const questionText = qs('#filter-question')?.value?.toLowerCase() || '';
    if (companyId) {
      questions = questions.filter(q => String(q.company_id) === String(companyId));
    }
    if (status) {
      questions = questions.filter(q => String(q.status) === String(status));
    }
    if (type) {
      questions = questions.filter(q => String(q.question_type) === String(type));
    }
    if (!isNaN(deviation)) {
      questions = questions.filter(q => parseFloat(q.deviation_pct) >= deviation);
    }
    if (!isNaN(price)) {
      questions = questions.filter(q => parseFloat(q.offer_value) <= price);
    }
    if (questionText) {
      questions = questions.filter(q => (q.question_text || '').toLowerCase().includes(questionText));
    }
    
    const listDiv = qs('#questions-list');
    // Le tableau questions-list a été supprimé, les données sont affichées dans questions-editor-table
    if (!listDiv) return;
    
    if (questions.length === 0) {
      listDiv.innerHTML = '<p class="muted" style="padding:20px;text-align:center">Aucune fiche question trouvée</p>';
      return;
    }
    
    let html = `<table><thead><tr>
      <th data-sort="company_name">Entreprise</th>
      <th data-sort="num">Article</th>
      <th data-sort="question_type">Type</th>
      <th data-sort="question_text">Question</th>
      <th data-sort="deviation_pct">Écart</th>
      <th data-sort="moe_value">MOE</th>
      <th data-sort="offer_value">Offre</th>
      <th>Réponse</th>
      <th data-sort="status">Statut</th>
      <th>Actions</th>
    </tr></thead><tbody>`;
        // Gestion du tri
        let currentSort = window.questionsSort || { key: null, asc: true };
        function sortQuestions(arr, key, asc) {
          return arr.slice().sort((a, b) => {
            let va = a[key], vb = b[key];
            if (va == null) va = '';
            if (vb == null) vb = '';
            if (typeof va === 'string') va = va.toLowerCase();
            if (typeof vb === 'string') vb = vb.toLowerCase();
            if (!isNaN(parseFloat(va)) && !isNaN(parseFloat(vb))) {
              va = parseFloat(va); vb = parseFloat(vb);
            }
            if (va < vb) return asc ? -1 : 1;
            if (va > vb) return asc ? 1 : -1;
            return 0;
          });
        }
        if (currentSort.key) {
          questions = sortQuestions(questions, currentSort.key, currentSort.asc);
        }
    
    for (const q of questions) {
      const typeLabel = {
        'unanswered': `<span style="color:#b45309;font-weight:600">${icon('alert-triangle')}Réponse oubliée</span>`,
        'unit_mismatch': `<span style="color:#6f42c1;font-weight:600">${icon('alert-triangle')}Unité à vérifier</span>`,
        'qty_very_low': `<span style="color:#0d6efd;font-weight:600">${icon('trending-down')}Qté Très Basse</span>`,
        'qty_low': `<span style="color:#0dcaf0;font-weight:600">${icon('trending-down')}Qté Basse</span>`,
        'qty_high': `<span style="color:#fd7e14;font-weight:600">${icon('trending-up')}Qté Haute</span>`,
        'qty_very_high': `<span style="color:#dc3545;font-weight:600">${icon('trending-up')}Qté Très Haute</span>`,
        'price_very_low': `<span style="color:#0d6efd;font-weight:600">${icon('dollar-sign')}Prix Très Bas</span>`,
        'price_low': `<span style="color:#0dcaf0;font-weight:600">${icon('dollar-sign')}Prix Bas</span>`,
        'price_high': `<span style="color:#fd7e14;font-weight:600">${icon('dollar-sign')}Prix Haut</span>`,
        'price_very_high': `<span style="color:#dc3545;font-weight:600">${icon('dollar-sign')}Prix Très Haut</span>`,
        'amount_very_low': `<span style="color:#0d6efd;font-weight:600">${icon('dollar-sign')}Montant Très Bas</span>`,
        'amount_low': `<span style="color:#0dcaf0;font-weight:600">${icon('dollar-sign')}Montant Bas</span>`,
        'amount_high': `<span style="color:#fd7e14;font-weight:600">${icon('dollar-sign')}Montant Haut</span>`,
        'amount_very_high': `<span style="color:#dc3545;font-weight:600">${icon('dollar-sign')}Montant Très Haut</span>`
      }[q.question_type] || q.question_type;
      
      const statusValue = q.status || 'pending';
      const statusBadge = {
        'pending': `${icon('clock')}En attente`,
        'answered': `${icon('check-circle')}Répondue`,
        'validated': `${icon('check-circle')}Validée`,
        'dismissed': `${icon('x-circle')}Ignorée`
      }[statusValue] || statusValue;
      
      const deviationPct = q.deviation_pct != null ? Number(q.deviation_pct).toFixed(1) + '%' : '';
      const moeVal = q.moe_value != null ? fmtNum(q.moe_value) : '';
      const offerVal = q.offer_value != null ? fmtNum(q.offer_value) : '';

      const sourceCompanyId = sourceCompanyByItemId.get(Number(q.item_id));
      const sourceCompany = Number.isFinite(sourceCompanyId) ? companiesById.get(Number(sourceCompanyId)) : null;
      const sourceBadge = sourceCompany
        ? `<span style="display:inline-flex;align-items:center;font-size:0.75em;padding:2px 6px;border-radius:4px;${sourceCompany.color ? `background:${sourceCompany.color};color:#fff;` : 'background:var(--warning);color:#fff;'}margin-right:6px" title="Poste ajouté par ${escapeHtml(sourceCompany.name || '')}">${escapeHtml(sourceCompany.name || '')}</span>`
        : '';

      const offerKey = `${Number(q.item_id)}_${Number(q.company_id)}`;
      const offerComment = offerByItemCompany.get(offerKey)?.comment || null;
      const companyColor = companiesById.get(Number(q.company_id))?.color || null;
      const offerValWithBadge = `${offerVal}${offerCommentBadgeHtml(offerComment, companyColor, q.company_name)}`;

      const itemLabel = q.num ? `${q.num} - ${q.designation || ''}` : (q.designation || '');
      html += `
        <tr data-qid="${q.id}">
          <td>${q.company_name}</td>
          <td>${sourceBadge}${itemLabel}</td>
          <td>${typeLabel}</td>
          <td style="max-width:300px">${q.question_text}</td>
          <td>${deviationPct}</td>
          <td>${moeVal}</td>
          <td>${offerValWithBadge}</td>
          <td>
            <textarea id="comment-${q.id}" name="comment-${q.id}" data-qid="${q.id}" style="width:200px;height:60px;padding:4px" placeholder="Commentaire..." autocomplete="off" ${isEntreprise() ? 'disabled' : ''}>${q.comment || ''}</textarea>
          </td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn-edit-question" data-qid="${q.id}" style="padding:4px 8px;font-size:12px" aria-label="Modifier question ${q.id}">${icon('edit','icon-only')}</button>
            <button class="btn-delete-question" data-qid="${q.id}" style="padding:4px 8px;font-size:12px" aria-label="Supprimer question ${q.id}">${icon('trash','icon-only')}</button>
          </td>
        </tr>
      `;
    }
    
    html += '</tbody></table>';
    listDiv.innerHTML = html;
        // Ajout listeners de tri sur les th
        qsa('#questions-list th[data-sort]').forEach(th => {
          th.style.cursor = 'pointer';
          th.addEventListener('click', () => {
            const key = th.getAttribute('data-sort');
            if (window.questionsSort && window.questionsSort.key === key) {
              window.questionsSort.asc = !window.questionsSort.asc;
            } else {
              window.questionsSort = { key, asc: true };
            }
            refreshQuestions();
          });
          // Indicateur visuel
          if (window.questionsSort && window.questionsSort.key === th.getAttribute('data-sort')) {
            th.textContent += window.questionsSort.asc ? ' ▲' : ' ▼';
          }
        });
    
    // Visionneurs: rendre les textareas en lecture seule
    if (isVisionneur() || isEntreprise()) {
      qsa('textarea[data-qid]').forEach(ta => {
        ta.disabled = true;
        ta.style.backgroundColor = 'var(--input-bg)';
        ta.style.opacity = '0.7';
      });
    } else {
      // Modification commentaire en direct (responsable/admin)
      qsa('textarea[id^="comment-"]').forEach(ta => {
        ta.addEventListener('blur', async (e) => {
          const qid = ta.dataset.qid;
          const newComment = ta.value.trim();
          try {
            await api(`/question-config/question/${qid}`, {
              method: 'PUT',
              body: { comment: newComment }
            });
            // Optionnel : refreshQuestions();
          } catch (err) {
            showNotify({ title:'Erreur', message: err.message, type:'error' });
          }
        });
      });
      // Bouton édition question
      qsa('.btn-edit-question').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const qid = e.target.dataset.qid;
          const row = qs(`tr[data-qid="${qid}"]`);
          const questionCell = row.querySelector('td:nth-child(4)');
          const currentText = questionCell.textContent;
          const input = document.createElement('input');
          input.type = 'text';
          input.value = currentText;
          input.style.width = '280px';
          questionCell.innerHTML = '';
          questionCell.appendChild(input);
          input.focus();
          input.addEventListener('blur', async () => {
            const newText = input.value.trim();
            if (newText && newText !== currentText) {
              try {
                await api(`/question-config/question/${qid}`, {
                  method: 'PUT',
                  body: { question_text: newText }
                });
                await refreshQuestions();
              } catch (err) {
                showNotify({ title:'Erreur', message: err.message, type:'error' });
              }
            } else {
              questionCell.textContent = currentText;
            }
          });
        });
      });
      // Bouton suppression question
      qsa('.btn-delete-question').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const qid = e.target.dataset.qid;
          showDeleteConfirmation({
            title: 'Supprimer une fiche question',
            message: 'Êtes-vous sûr de vouloir supprimer cette fiche question ?',
            extra: '<strong>⚠️ Attention:</strong> Les réponses des entreprises seront perdues. Cette action ne peut pas être annulée.',
            onConfirm: async () => {
              try {
                await api(`/question-config/question/${qid}`, {
                  method: 'DELETE'
                });
                await refreshQuestions();
                showNotify({ title: 'Succès', message: 'Fiche question supprimée', type: 'success' });
              } catch (err) {
                showNotify({ title:'Erreur', message: err.message, type:'error' });
              }
            }
          });
        });
      });
    } // close else
    // Ajout question manuelle
    qs('#add-question-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = qs('#add-question-text').value.trim();
      const type = qs('#add-question-type').value;
      if (!text || !type) return;
      try {
        await api('/question-config/question', {
          method: 'POST',
          body: {
            question_text: text,
            question_type: type,
            lot_id: currentLot?.id,
            round_id: currentRound?.id
          }
        });
        qs('#add-question-text').value = '';
        await refreshQuestions();
      } catch (err) {
        showNotify({ title:'Erreur', message: err.message, type:'error' });
      }
    });
  } catch (err) {
    showNotify({ title:'Erreur', message: err.message, type:'error' });
  }
}

/* ================= Éditeur de Questions ================= */
let questionsDesigCollapsed = false;
let hasUnsavedQuestionChanges = false;
let isQuestionSaving = false;
let activeQuestionSavePromise = null;
const pendingQuestionSaves = new Map();
const suppressedQuestionSaveItemIds = new Set();

// Démarrer l'auto-actualisation de l'éditeur de questions (chaque 10 secondes)
function startQuestionsEditorAutoRefresh() {
  // Arrêter tout intervalle existant
  stopQuestionsEditorAutoRefresh();
  
  // Démarrer le nouvel intervalle (10 secondes)
  questionsEditorAutoRefreshInterval = setInterval(() => {
    const activeElement = document.activeElement;
    const isEditingQuestion = activeElement?.classList?.contains('question-text-editor');
    if (hasUnsavedQuestionChanges || isQuestionSaving || activeQuestionSavePromise || isEditingQuestion) return;
    loadQuestionsEditor({ silent: true });
  }, 10000);
}

// Arrêter l'auto-actualisation
function stopQuestionsEditorAutoRefresh() {
  if (questionsEditorAutoRefreshInterval) {
    clearInterval(questionsEditorAutoRefreshInterval);
    questionsEditorAutoRefreshInterval = null;
  }
}

async function loadQuestionsEditor({ silent = false, force = false } = {}){
  if (!currentLot || !currentRound) return;
  if (!force && (hasUnsavedQuestionChanges || isQuestionSaving || activeQuestionSavePromise)) return;
  
  try {
    // Sauvegarder la sélection actuelle d'entreprise ciblée
    const targetCompanySelect = qs('#questions-target-company');
    const previousSelection = targetCompanySelect?.value || '';
    
    // Charger les données du lot et les questions
    const roundParam = `?round_id=${currentRound.id}`;
    const lotData = await api(`/lots/${currentLot.id}${roundParam}`, { showLoader: !silent });
    const questionsData = await api(`/question-config/lot/${currentLot.id}${roundParam}`, { showLoader: !silent });

    // Calcul du statut de validation par entreprise (toutes les fiches du tour validées)
    const companyValidation = new Map();
    for (const q of questionsData || []) {
      const companyId = Number(q.company_id);
      if (!Number.isFinite(companyId)) continue;
      const stats = companyValidation.get(companyId) || { total: 0, validated: 0 };
      stats.total += 1;
      if (q.status === 'validated') stats.validated += 1;
      companyValidation.set(companyId, stats);
    }

    const formatCompanyLabel = (company) => {
      const stats = companyValidation.get(Number(company.id));
      const allValidated = Boolean(stats && stats.total > 0 && stats.validated === stats.total);
      return allValidated ? `${company.name} ✅` : company.name;
    };
    
    // Peupler le sélecteur d'entreprise ciblée (header)
    const targetCompany = qs('#questions-target-company');
    targetCompany.innerHTML = '<option value="">→ Sélectionner une entreprise...</option>';
    for (const c of lotData.companies || []) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = formatCompanyLabel(c);
      targetCompany.appendChild(opt);
    }
    
    // Restaurer la sélection précédente si elle existe toujours
    if (previousSelection && targetCompany.querySelector(`option[value="${previousSelection}"]`)) {
      targetCompany.value = previousSelection;
    }
    
    // Peupler le sélecteur dans le modal
    const modalTargetCompany = qs('#modal-target-company-select');
    modalTargetCompany.innerHTML = '<option value="">→ Sélectionner une entreprise...</option>';
    for (const c of lotData.companies || []) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = formatCompanyLabel(c);
      modalTargetCompany.appendChild(opt);
    }
    
    // Construire le tableau
    renderQuestionsEditorTable(lotData, questionsData);
    
    // Démarrer l'auto-actualisation si ce n'est pas déjà fait
    if (!questionsEditorAutoRefreshInterval) {
      startQuestionsEditorAutoRefresh();
    }
    
  } catch (err) {
    console.error('Erreur chargement éditeur questions:', err);
    showNotify({ title:'Erreur', message: err.message, type:'error' });
  }
}

function renderQuestionsEditorTable(lotData, questionsData) {
  const viewFilter = qs('#questions-view-filter').value;
  const analysisMode = qs('#questions-analysis-mode')?.dataset?.value || 'company';
  const isComparisonMode = analysisMode === 'comparison';
  const targetCompany = qs('#questions-target-company').value;
  const amountFilter = qs('#questions-amount-filter')?.value || 'all';
  const thead = qs('#questions-editor-head');
  const tbody = qs('#questions-editor-body');

  attachOfferDesigPillDelegates(tbody);

  const thresholds = {
    qty: {
      veryLow: parseFloat(qs('#threshold-qty-very-low')?.value) || 25,
      low: parseFloat(qs('#threshold-qty-low')?.value) || 10,
      high: parseFloat(qs('#threshold-qty-high')?.value) || 10,
      veryHigh: parseFloat(qs('#threshold-qty-very-high')?.value) || 25
    },
    price: {
      veryLow: parseFloat(qs('#threshold-price-very-low')?.value) || 25,
      low: parseFloat(qs('#threshold-price-low')?.value) || 10,
      high: parseFloat(qs('#threshold-price-high')?.value) || 10,
      veryHigh: parseFloat(qs('#threshold-price-very-high')?.value) || 25
    },
    amount: {
      veryLow: parseFloat(qs('#threshold-amount-very-low')?.value) || 25,
      low: parseFloat(qs('#threshold-amount-low')?.value) || 10,
      high: parseFloat(qs('#threshold-amount-high')?.value) || 10,
      veryHigh: parseFloat(qs('#threshold-amount-very-high')?.value) || 25
    }
  };

  const getDeviationClass = (deviation, config) => {
    if (deviation < -Math.abs(config.veryLow)) return 'ecart-very-low';
    if (deviation < -Math.abs(config.low)) return 'ecart-low';
    if (deviation > Math.abs(config.veryHigh)) return 'ecart-very-high';
    if (deviation > Math.abs(config.high)) return 'ecart-high';
    return '';
  };
  
  if (!lotData.items || lotData.items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="20" style="text-align:center;padding:40px;color:var(--muted)">Aucune donnée disponible</td></tr>';
    return;
  }
  
  // Afficher toutes les entreprises dans les colonnes de comparaison
  let companies = lotData.companies || [];
  const companiesById = new Map(companies.map(c => [Number(c.id), c]));

  // Pré-calcul des offres par item + montant de référence pour filtrage/tri
  const offersByItemId = new Map();
  const amountByItemId = new Map();
  for (const item of lotData.items || []) {
    const itemOffers = companies.map(company => {
      const offer = (lotData.offers || []).find(o =>
        Number(o.item_id) === Number(item.id) && Number(o.company_id) === Number(company.id)
      );
      const qty = parseNum(offer?.qty);
      const pu = parseNum(offer?.unit_price);
      const safeQty = Number.isFinite(qty) ? qty : null;
      const safePu = Number.isFinite(pu) ? pu : null;
      const total = parseNum(offer?.amount);
      const safeTotal = Number.isFinite(total)
        ? total
        : (Number.isFinite(safeQty) && Number.isFinite(safePu) ? (safeQty * safePu) : null);
      return {
        company_id: company.id,
        name: company.name,
        color: company.color || null,
        unit: offer?.unit || '',
        quantity: safeQty,
        unit_price: safePu,
        total: safeTotal,
        offer_designation: offer?.offer_designation || null,
        comment: offer?.comment || null
      };
    });

    offersByItemId.set(Number(item.id), itemOffers);

    let referenceAmount = 0;
    if (targetCompany) {
      const targetOffer = itemOffers.find(o => Number(o.company_id) === Number(targetCompany));
      referenceAmount = Number(targetOffer?.total || 0);
    } else {
      referenceAmount = itemOffers.reduce((max, offer) => Math.max(max, Number(offer.total || 0)), 0);
    }
    amountByItemId.set(Number(item.id), Number.isFinite(referenceAmount) ? referenceAmount : 0);
  }

  const itemsToRender = [...(lotData.items || [])];
  if (amountFilter === 'highest') {
    itemsToRender.sort((a, b) => (amountByItemId.get(Number(b.id)) || 0) - (amountByItemId.get(Number(a.id)) || 0));
  } else if (amountFilter === 'lowest') {
    itemsToRender.sort((a, b) => (amountByItemId.get(Number(a.id)) || 0) - (amountByItemId.get(Number(b.id)) || 0));
  }
  
  // Créer une map des données MOE par item_id
  const moeByItem = new Map();
  for (const moe of lotData.moe || []) {
    moeByItem.set(moe.item_id, moe);
  }
  
  // Créer une map des questions par item_id + company_id (plusieurs questions possibles)
  const questionsMap = new Map();
  for (const q of questionsData || []) {
    const key = `${q.item_id}_${q.company_id}`;
    if (!questionsMap.has(key)) questionsMap.set(key, []);
    questionsMap.get(key).push(q);
  }
  const showQuantities = viewFilter === 'all' || viewFilter === 'quantities';
  const showUnitPrices = viewFilter === 'all' || viewFilter === 'unit_prices';
  const showTotals = viewFilter === 'all' || viewFilter === 'totals';
  const showCompanyUnits = companies.length > 0;
  const selectedCompanyId = Number(targetCompany || 0);
  const selectedCompanyName = targetCompany
    ? (companiesById.get(selectedCompanyId)?.name || 'Entreprise ciblée')
    : 'Entreprise ciblée';
  const metricsColCount =
    (showCompanyUnits ? (isComparisonMode ? 1 : companies.length) : 0) +
    (showQuantities ? (isComparisonMode ? 3 : (1 + companies.length)) : 0) +
    (showUnitPrices ? (isComparisonMode ? 3 : (1 + companies.length)) : 0) +
    (showTotals ? (isComparisonMode ? 3 : (1 + companies.length)) : 0);
  const emptyColspan = 5 + metricsColCount;

  const formatDeltaPct = (referenceValue, comparedValue) => {
    const reference = parseNum(referenceValue);
    const compared = parseNum(comparedValue);
    if (!Number.isFinite(reference) || !Number.isFinite(compared) || reference === 0) {
      return null;
    }
    return ((compared - reference) / reference) * 100;
  };

  const deltaCellHtml = (deviation, metricThresholds, highlightClass = '') => {
    if (!Number.isFinite(deviation)) {
      return `<td class="${highlightClass}">—</td>`;
    }
    const deviationClass = getDeviationClass(deviation, metricThresholds);
    const sign = deviation > 0 ? '+' : '';
    return `<td class="${deviationClass}${highlightClass}">${sign}${deviation.toFixed(1)}%</td>`;
  };

  let headerTop = '<tr class="head-row-1">';
  headerTop += '<th rowspan="2" class="sticky-col question-num-col">Num</th>';
  headerTop += '<th rowspan="2" class="sticky-actions question-actions-col">Actions</th>';
  headerTop += '<th rowspan="2" class="sticky-col2 question-designation-col"><button class="desig-toggle-btn" id="questions-desig-toggle" title="Afficher / masquer la désignation"></button><span class="desig-toggle-label">Désignation</span></th>';
  headerTop += '<th rowspan="2" class="sticky-question questions-group-start question-text-col">Question<span id="questions-question-resize" class="question-column-resize-handle" title="Redimensionner la colonne Question"></span></th>';
  headerTop += '<th rowspan="2" class="question-unit-col">Unité</th>';

  if (showCompanyUnits) headerTop += `<th colspan="${isComparisonMode ? 1 : companies.length}" class="company-unit-group">Unités entreprise</th>`;
  if (showQuantities) headerTop += `<th colspan="${isComparisonMode ? 3 : (1 + companies.length)}" class="moe-col">Quantités</th>`;
  if (showUnitPrices) headerTop += `<th colspan="${isComparisonMode ? 3 : (1 + companies.length)}" class="company-col">Prix Unitaires</th>`;
  if (showTotals) headerTop += `<th colspan="${isComparisonMode ? 3 : (1 + companies.length)}" class="company-col">Montants</th>`;

  headerTop += '</tr>';

  let headerSub = '<tr class="head-row-2">';
  if (isComparisonMode) {
    if (showCompanyUnits) {
      headerSub += `<th class="questions-group-start target-company-highlight question-company-unit-col">Unité ${escapeHtml(selectedCompanyName)}</th>`;
    }
    if (showQuantities) {
      headerSub += `<th class="${showCompanyUnits ? '' : 'questions-group-start '}moe-border moe-highlight">Qté MOE</th>`;
      headerSub += `<th class="target-company-highlight">Qté ${escapeHtml(selectedCompanyName)}</th>`;
      headerSub += '<th>Δ Qté</th>';
    }
    if (showUnitPrices) {
      headerSub += '<th class="questions-group-start moe-highlight">PU MOE</th>';
      headerSub += `<th class="target-company-highlight">PU ${escapeHtml(selectedCompanyName)}</th>`;
      headerSub += '<th>Δ PU</th>';
    }
    if (showTotals) {
      headerSub += '<th class="questions-group-start moe-highlight">Montant MOE</th>';
      headerSub += `<th class="target-company-highlight">Montant ${escapeHtml(selectedCompanyName)}</th>`;
      headerSub += '<th>Δ Montant</th>';
    }
  } else {
    if (showCompanyUnits) {
      for (const c of companies) {
        const highlightClass = targetCompany && c.id == targetCompany ? ' target-company-highlight' : '';
        headerSub += `<th class="questions-group-start question-company-unit-col${highlightClass}">Unité ${c.name}</th>`;
      }
    }
    if (showQuantities) {
      headerSub += `<th class="${showCompanyUnits ? '' : 'questions-group-start '}moe-border moe-highlight">Qté MOE</th>`;
      for (const c of companies) {
        const highlightClass = targetCompany && c.id == targetCompany ? ' target-company-highlight' : '';
        headerSub += `<th class="${highlightClass}">Qté ${c.name}</th>`;
      }
    }
    if (showUnitPrices) {
      headerSub += '<th class="questions-group-start moe-highlight">PU MOE</th>';
      for (const c of companies) {
        const highlightClass = targetCompany && c.id == targetCompany ? ' target-company-highlight' : '';
        headerSub += `<th class="${highlightClass}">PU ${c.name}</th>`;
      }
    }
    if (showTotals) {
      headerSub += '<th class="questions-group-start moe-highlight">Montant MOE</th>';
      for (const c of companies) {
        const highlightClass = targetCompany && c.id == targetCompany ? ' target-company-highlight' : '';
        headerSub += `<th class="${highlightClass}">Montant ${c.name}</th>`;
      }
    }
  }
  headerSub += '</tr>';

  thead.innerHTML = headerTop + headerSub;
  initQuestionColumnResize();
  recalcQuestionsHeaderOffsets();
  // Restaurer l'état rétracté et lier le bouton toggle
  qs('#questions-editor-table')?.classList.toggle('desig-collapsed', questionsDesigCollapsed);
  qs('#questions-desig-toggle')?.addEventListener('click', () => {
    questionsDesigCollapsed = !questionsDesigCollapsed;
    qs('#questions-editor-table')?.classList.toggle('desig-collapsed', questionsDesigCollapsed);
    recalcQuestionsHeaderOffsets();
  });

  let html = '';
  
  // Pour chaque ligne du lot (une ligne par item, pas par entreprise)
  for (const item of itemsToRender) {
    // Récupérer les données MOE pour cet item
    const moe = moeByItem.get(item.id) || {};
    const parsedMoeQty = parseNum(moe.qty);
    const parsedMoePU = parseNum(moe.unit_price);
    const parsedMoeAmount = parseNum(moe.amount);
    const moeQty = Number.isFinite(parsedMoeQty) ? parsedMoeQty : null;
    const moePU = Number.isFinite(parsedMoePU) ? parsedMoePU : null;
    const moeTotal = Number.isFinite(parsedMoeAmount) ? parsedMoeAmount : null;
    const moeHasTotal = moeTotal > 0;
    
    // Collecter les offres de toutes les entreprises pour cet item
    const itemOffers = (offersByItemId.get(Number(item.id)) || []).map(offer => {
      return {
        ...offer,
        isUnanswered: moeHasTotal && isOfferUnanswered(offer.quantity, offer.unit_price),
        unitMismatchInfo: getUnitMismatchInfo(item.unit, offer.unit, offer.total)
      };
    });
    
    // Trouver les questions pour cette entreprise ciblée
    let existingQuestions = [];
    let selectedOfferForQuestion = null;
    if (targetCompany) {
      const questionKey = `${item.id}_${targetCompany}`;
      existingQuestions = questionsMap.get(questionKey) || [];
      selectedOfferForQuestion = itemOffers.find(o => Number(o.company_id) === selectedCompanyId) || null;
    }

    // Cas métier:
    // - Par défaut: afficher toutes les questions du poste
    // - Exception "unité incohérente": n'afficher que la question d'unité
    // - Exception "réponse oubliée": n'afficher que la première question (si présente)
    let displayQuestions = existingQuestions.slice();
    if (displayQuestions.length > 1 && selectedOfferForQuestion?.unitMismatchInfo?.hasMismatch) {
      const mismatchOnly = displayQuestions.filter(q => q.question_type === 'unit_mismatch');
      if (mismatchOnly.length > 0) displayQuestions = mismatchOnly;
    }
    if (displayQuestions.length > 1 && selectedOfferForQuestion?.isUnanswered) {
      displayQuestions = [displayQuestions[0]];
    }

    const existingQuestion = displayQuestions[0] || null;
    
    const questionId = existingQuestion?.id || '';
    const questionText = displayQuestions.map(q => q.question_text || '').filter(Boolean).join('\n• ');
    const questionIdsData = encodeURIComponent(JSON.stringify(displayQuestions.map(q => q.id).filter(Boolean)));
    const questionLinesData = encodeURIComponent(JSON.stringify(displayQuestions.map(q => q.question_text || '')));
    const questionStatus = existingQuestion?.status || 'pending';
    const questionCompanyId = existingQuestion?.company_id || '';
    const sourceCompany = Number.isFinite(Number(item.source_company_id))
      ? companiesById.get(Number(item.source_company_id))
      : null;
    const sourceCompanyBadge = sourceCompany
      ? `<span style="display:inline-flex;align-items:center;font-size:0.75em;padding:2px 6px;border-radius:4px;${sourceCompany.color ? `background:${sourceCompany.color};color:#fff;` : 'background:var(--warning);color:#fff;'}margin-right:6px" title="Poste ajouté par ${escapeHtml(sourceCompany.name || '')}">${escapeHtml(sourceCompany.name || '')}</span>`
      : '';
    
    const isValidated = questionStatus === 'validated';
    const validateTitle = isValidated
      ? 'Désactiver la validation'
      : 'Valider';
    const hierarchyClass = getQuestionHierarchyClass(item.num);
    const desigPills = offerDesigPillsHtml(itemOffers);

    html += `<tr data-item-id="${item.id}" data-question-id="${questionId}" data-question-company-id="${questionCompanyId}">`;
    html += `<td class="sticky-col question-hierarchy ${hierarchyClass}">${item.num || ''}</td>`;
    // Actions (déplacées à gauche)
    html += '<td class="sticky-actions">';
    if (questionId) {
      html += `<button class="btn-validate-editor-question" data-question-id="${questionId}" data-item-id="${item.id}" data-is-validated="${isValidated ? '1' : '0'}" title="${validateTitle}">${isValidated ? icon('x-circle','icon-only') : icon('check-circle','icon-only')}</button>`;
      html += `<button class="btn-delete-editor-question" data-question-id="${questionId}" data-item-id="${item.id}" title="Supprimer">${icon('trash','icon-only')}</button>`;
    }
    html += '</td>';
    html += `<td class="sticky-col2 question-hierarchy ${hierarchyClass}"><span class="desig-text">${sourceCompanyBadge}${item.designation || ''}${desigPills}</span></td>`;
    // Question (figée, après Désignation)
    html += '<td class="sticky-question questions-group-start">';
    html += `<textarea id="question-${item.id}" name="question-${item.id}" class="question-text-editor" data-item-id="${item.id}" data-question-id="${questionId}" data-question-ids="${questionIdsData}" data-question-lines="${questionLinesData}" rows="${displayQuestions.length > 1 ? 3 : 1}" style="width:100%;padding:4px 6px;border-radius:4px;border:1px solid var(--border);background:var(--input-bg);color:var(--fg)" placeholder="Saisir une question..." ${isVisionneur() || isEntreprise() ? 'disabled' : ''}>${questionText}</textarea>`;
    if (displayQuestions.length > 1) {
      html += `<div style="font-size:11px;color:var(--muted);margin-top:4px">${displayQuestions.length} questions affichées</div>`;
    }
    html += `<div class="save-status" data-item-id="${item.id}" style="position:absolute;top:4px;right:6px;font-size:14px;display:none">${icon('save','icon-only')}</div>`;
    html += '</td>';
    html += `<td>${item.unit || ''}</td>`;
    
    if (isComparisonMode) {
      const selectedOffer = targetCompany
        ? itemOffers.find(o => Number(o.company_id) === selectedCompanyId)
        : null;
      const targetHighlightClass = targetCompany ? ' target-company-highlight' : '';
      const isValidatedTarget = isValidated && targetCompany;
      const unansweredStyle = unansweredStyleStr(unansweredConfig.color);
      const unansweredTitle = unansweredConfig.comment ? ` title="${escapeHtml(unansweredConfig.comment)}"` : '';
      const selectedCommentBadge = selectedOffer
        ? offerCommentBadgeHtml(selectedOffer.comment, selectedOffer.color, selectedOffer.name)
        : '';

      if (showCompanyUnits) {
        const unitCellClass = selectedOffer?.unitMismatchInfo?.hasMismatch
          ? `unit-mismatch-cell questions-group-start${targetHighlightClass}`
          : `questions-group-start question-company-unit-cell${targetHighlightClass}`;
        html += `<td class="${unitCellClass}">${escapeHtml(selectedOffer?.unit || '') || '—'}${selectedCommentBadge}</td>`;
      }

      if (showQuantities) {
        html += `<td class="moe-cell ${showCompanyUnits ? '' : 'questions-group-start '}moe-border">${fmtNum(moeQty)}</td>`;
        if (selectedOffer?.unitMismatchInfo?.hasMismatch) {
          html += `<td class="unit-mismatch-cell${targetHighlightClass}">${fmtNum(selectedOffer?.quantity)}${selectedCommentBadge}</td>`;
          html += '<td class="unit-mismatch-cell">—</td>';
        } else if (isValidatedTarget) {
          html += `<td class="validated-question-cell${targetHighlightClass}">${fmtNum(selectedOffer?.quantity)}${selectedCommentBadge}</td>`;
        } else if (selectedOffer?.isUnanswered) {
          html += `<td class="ecart-unanswered${targetHighlightClass}" style="${unansweredStyle}"${unansweredTitle}>${fmtNum(selectedOffer?.quantity)}${selectedCommentBadge}</td>`;
        } else {
          const qtyDeviation = formatDeltaPct(moeQty, selectedOffer?.quantity);
          const qtyDeviationClass = Number.isFinite(qtyDeviation) ? getDeviationClass(qtyDeviation, thresholds.qty) : '';
          html += `<td class="${qtyDeviationClass}${targetHighlightClass}">${fmtNum(selectedOffer?.quantity)}${selectedCommentBadge}</td>`;
        }
        html += deltaCellHtml(formatDeltaPct(moeQty, selectedOffer?.quantity), thresholds.qty);
      }

      if (showUnitPrices) {
        html += `<td class="moe-cell questions-group-start">${fmtEuro(moePU)}</td>`;
        if (selectedOffer?.unitMismatchInfo?.hasMismatch) {
          html += `<td class="unit-mismatch-cell${targetHighlightClass}">${fmtEuro(selectedOffer?.unit_price)}${selectedCommentBadge}</td>`;
          html += '<td class="unit-mismatch-cell">—</td>';
        } else if (isValidatedTarget) {
          html += `<td class="validated-question-cell${targetHighlightClass}">${fmtEuro(selectedOffer?.unit_price)}${selectedCommentBadge}</td>`;
        } else if (selectedOffer?.isUnanswered) {
          html += `<td class="ecart-unanswered${targetHighlightClass}" style="${unansweredStyle}"${unansweredTitle}>${fmtEuro(selectedOffer?.unit_price)}${selectedCommentBadge}</td>`;
        } else {
          const puDeviation = formatDeltaPct(moePU, selectedOffer?.unit_price);
          const puDeviationClass = Number.isFinite(puDeviation) ? getDeviationClass(puDeviation, thresholds.price) : '';
          html += `<td class="${puDeviationClass}${targetHighlightClass}">${fmtEuro(selectedOffer?.unit_price)}${selectedCommentBadge}</td>`;
        }
        html += deltaCellHtml(formatDeltaPct(moePU, selectedOffer?.unit_price), thresholds.price);
      }

      if (showTotals) {
        html += `<td class="moe-cell questions-group-start">${fmtEuro(moeTotal)}</td>`;
        if (isValidatedTarget) {
          html += `<td class="validated-question-cell${targetHighlightClass}">${fmtEuro(selectedOffer?.total)}${selectedCommentBadge}</td>`;
        } else if (selectedOffer?.isUnanswered) {
          html += `<td class="ecart-unanswered${targetHighlightClass}" style="${unansweredStyle}"${unansweredTitle}>${fmtEuro(selectedOffer?.total)}${selectedCommentBadge}</td>`;
        } else {
          const amountDeviation = formatDeltaPct(moeTotal, selectedOffer?.total);
          const amountDeviationClass = Number.isFinite(amountDeviation) ? getDeviationClass(amountDeviation, thresholds.amount) : '';
          html += `<td class="${amountDeviationClass}${targetHighlightClass}">${fmtEuro(selectedOffer?.total)}${selectedCommentBadge}</td>`;
        }
        html += deltaCellHtml(formatDeltaPct(moeTotal, selectedOffer?.total), thresholds.amount);
      }
    } else {
      if (showCompanyUnits) {
        for (const offer of itemOffers) {
          const commentBadge = offerCommentBadgeHtml(offer.comment, offer.color, offer.name);
          const highlightClass = targetCompany && offer.company_id == targetCompany ? ' target-company-highlight' : '';
          const unitCellClass = offer.unitMismatchInfo?.hasMismatch
            ? `unit-mismatch-cell questions-group-start${highlightClass}`
            : `questions-group-start question-company-unit-cell${highlightClass}`;
          html += `<td class="${unitCellClass}">${escapeHtml(offer.unit || '') || '—'}${commentBadge}</td>`;
        }
      }

      // Colonnes quantités
      if (showQuantities) {
        html += `<td class="moe-cell ${showCompanyUnits ? '' : 'questions-group-start '}moe-border">${fmtNum(moeQty)}</td>`;
        for (const offer of itemOffers) {
          const commentBadge = offerCommentBadgeHtml(offer.comment, offer.color, offer.name);
          const highlightClass = targetCompany && offer.company_id == targetCompany ? ' target-company-highlight' : '';
          const isValidatedOfferTarget = isValidated && targetCompany && Number(offer.company_id) === Number(targetCompany);
          if (offer.unitMismatchInfo?.hasMismatch) {
            html += `<td class="unit-mismatch-cell${highlightClass}">${fmtNum(offer.quantity)}${commentBadge}</td>`;
          } else if (isValidatedOfferTarget) {
            html += `<td class="validated-question-cell${highlightClass}">${fmtNum(offer.quantity)}${commentBadge}</td>`;
          } else if (offer.isUnanswered) {
            const sty = unansweredStyleStr(unansweredConfig.color);
            const titleA = unansweredConfig.comment ? ` title="${escapeHtml(unansweredConfig.comment)}"` : '';
            html += `<td class="ecart-unanswered${highlightClass}" style="${sty}"${titleA}>${fmtNum(offer.quantity)}${commentBadge}</td>`;
          } else {
            const deviation = moeQty > 0 ? ((offer.quantity - moeQty) / moeQty) * 100 : 0;
            const deviationClass = getDeviationClass(deviation, thresholds.qty);
            html += `<td class="${deviationClass}${highlightClass}">${fmtNum(offer.quantity)}${commentBadge}</td>`;
          }
        }
      }

      // Colonnes prix unitaires
      if (showUnitPrices) {
        html += `<td class="moe-cell questions-group-start">${fmtEuro(moePU)}</td>`;
        for (const offer of itemOffers) {
          const commentBadge = offerCommentBadgeHtml(offer.comment, offer.color, offer.name);
          const highlightClass = targetCompany && offer.company_id == targetCompany ? ' target-company-highlight' : '';
          const isValidatedOfferTarget = isValidated && targetCompany && Number(offer.company_id) === Number(targetCompany);
          if (offer.unitMismatchInfo?.hasMismatch) {
            html += `<td class="unit-mismatch-cell${highlightClass}">${fmtEuro(offer.unit_price)}${commentBadge}</td>`;
          } else if (isValidatedOfferTarget) {
            html += `<td class="validated-question-cell${highlightClass}">${fmtEuro(offer.unit_price)}${commentBadge}</td>`;
          } else if (offer.isUnanswered) {
            const sty = unansweredStyleStr(unansweredConfig.color);
            const titleA = unansweredConfig.comment ? ` title="${escapeHtml(unansweredConfig.comment)}"` : '';
            html += `<td class="ecart-unanswered${highlightClass}" style="${sty}"${titleA}>${fmtEuro(offer.unit_price)}${commentBadge}</td>`;
          } else {
            const deviation = moePU > 0 ? ((offer.unit_price - moePU) / moePU) * 100 : 0;
            const deviationClass = getDeviationClass(deviation, thresholds.price);
            html += `<td class="${deviationClass}${highlightClass}">${fmtEuro(offer.unit_price)}${commentBadge}</td>`;
          }
        }
      }

      // Colonnes totaux
      if (showTotals) {
        html += `<td class="moe-cell questions-group-start">${fmtEuro(moeTotal)}</td>`;
        for (const offer of itemOffers) {
          const commentBadge = offerCommentBadgeHtml(offer.comment, offer.color, offer.name);
          const highlightClass = targetCompany && offer.company_id == targetCompany ? ' target-company-highlight' : '';
          const isValidatedOfferTarget = isValidated && targetCompany && Number(offer.company_id) === Number(targetCompany);
          if (isValidatedOfferTarget) {
            html += `<td class="validated-question-cell${highlightClass}">${fmtEuro(offer.total)}${commentBadge}</td>`;
          } else if (offer.isUnanswered) {
            const sty = unansweredStyleStr(unansweredConfig.color);
            const titleA = unansweredConfig.comment ? ` title="${escapeHtml(unansweredConfig.comment)}"` : '';
            html += `<td class="ecart-unanswered${highlightClass}" style="${sty}"${titleA}>${fmtEuro(offer.total)}${commentBadge}</td>`;
          } else {
            const deviation = moeTotal > 0 ? ((offer.total - moeTotal) / moeTotal) * 100 : 0;
            const deviationClass = getDeviationClass(deviation, thresholds.amount);
            html += `<td class="${deviationClass}${highlightClass}">${fmtEuro(offer.total)}${commentBadge}</td>`;
          }
        }
      }
    }
    
    
    html += '</tr>';
  }
  
  tbody.innerHTML = html || `<tr><td colspan="${emptyColspan}" style="text-align:center;padding:40px;color:var(--muted)">Aucune ligne correspondante</td></tr>`;
  
  // Bind events
  if (!isVisionneur() && !isEntreprise()) {
    bindQuestionsEditorEvents();
  }
}

function getQuestionHierarchyClass(itemNum) {
  const raw = String(itemNum || '').trim();
  if (!raw) return 'qitem-level-3';

  const exactNumeric = raw.match(/^(\d+(?:\.\d+)*)$/);
  const extractedNumeric = exactNumeric || raw.match(/(\d+(?:\.\d+)*)/);
  if (!extractedNumeric) return 'qitem-level-0';

  const depth = Math.max(0, extractedNumeric[1].split('.').length - 1);
  if (depth === 0) return 'qitem-level-0';
  if (depth === 1) return 'qitem-level-1';
  if (depth === 2) return 'qitem-level-2';
  return 'qitem-level-3';
}

function recalcQuestionsHeaderOffsets() {
  const head = qs('#questions-editor-head');
  if (!head) return;
  const row1 = head.querySelector('tr.head-row-1');
  const row2 = head.querySelector('tr.head-row-2');
  if (!row1 || !row2) return;

  head.querySelectorAll('tr.head-row-2 th').forEach(th => { th.style.top = '0px'; });

  const setFromMeasure = () => {
    const headRect = head.getBoundingClientRect();
    const row2Rect = row2.getBoundingClientRect();
    const offset = Math.max(0, Math.round(row2Rect.top - headRect.top) - 1);
    head.style.setProperty('--questions-head-row1-height', `${offset}px`);
    head.querySelectorAll('tr.head-row-2 th').forEach(th => { th.style.top = `${offset}px`; });
  };

  setFromMeasure();
  if (window.requestAnimationFrame) requestAnimationFrame(setFromMeasure);
}

async function handleValidateEditorQuestionButton(currentBtn) {
  let questionId = currentBtn.dataset.questionId ? Number(currentBtn.dataset.questionId) : null;
  const isValidated = currentBtn.dataset.isValidated === '1';
  try {
    if (isValidated) {
      if (!questionId) {
        showNotify({ title:'Validation', message:'Aucune fiche Ã  dÃ©valider', type:'info' });
        return;
      }
      await api(`/question-config/question/${questionId}`, {
        method: 'PUT',
        body: { status: 'pending' },
        showLoader: false
      });
      currentBtn.dataset.isValidated = '0';
      currentBtn.title = 'Valider';
      currentBtn.innerHTML = icon('check-circle','icon-only');
      refreshQuestionsInBackground();
      return;
    }

    if (!questionId) {
      showNotify({ title:'Validation', message:'Sauvegardez la fiche avant de la valider', type:'info' });
      return;
    }

    await api(`/question-config/question/${questionId}/validate`, { method: 'PUT', showLoader: false });
    currentBtn.dataset.isValidated = '1';
    currentBtn.title = 'Desactiver la validation';
    currentBtn.innerHTML = icon('x-circle','icon-only');
    refreshQuestionsInBackground();
  } catch (err) {
    showNotify({ title:'Erreur', message: err.message, type:'error' });
  }
}

async function handleDeleteEditorQuestionButton(currentBtn) {
  const questionId = currentBtn.dataset.questionId;
  const itemId = currentBtn.dataset.itemId;

  showDeleteConfirmation({
    title: 'Supprimer une fiche question',
    message: 'Confirmer la suppression de cette fiche question ?',
    extra: '<strong>Attention:</strong> Les reponses des entreprises seront perdues. Cette action ne peut pas etre annulee.',
    onConfirm: async () => {
      try {
        if (itemId) {
          suppressedQuestionSaveItemIds.add(String(itemId));
          pendingQuestionSaves.delete(String(itemId));
          hasUnsavedQuestionChanges = pendingQuestionSaves.size > 0;
        }
        await waitForQuestionSaveIdle();
        await api(`/question-config/question/${questionId}`, {
          method: 'DELETE',
          showLoader: false
        });

        const row = itemId ? qs(`#questions-editor-body tr[data-item-id="${itemId}"]`) : null;
        const textarea = itemId ? qs(`.question-text-editor[data-item-id="${itemId}"]`) : null;
        if (row) {
          row.dataset.questionId = '';
          row.dataset.questionCompanyId = '';
          const actionsCell = row.querySelector('.sticky-actions');
          if (actionsCell) actionsCell.innerHTML = '';
        }
        if (textarea) {
          textarea.value = '';
          textarea.dataset.questionId = '';
        }

        showNotify({ title:'Succes', message:'Question supprimee', type:'success' });
        refreshQuestionsInBackground();
      } catch (err) {
        showNotify({ title:'Erreur', message: err.message, type:'error' });
      }
    }
  });
}

function ensureQuestionEditorActionButtons(row, itemId, questionId, isValidated = false) {
  if (!row || !questionId) return;
  const actionsCell = row.querySelector('.sticky-actions');
  if (!actionsCell || actionsCell.querySelector('.btn-validate-editor-question')) return;

  const validateTitle = isValidated ? 'Desactiver la validation' : 'Valider';
  actionsCell.innerHTML =
    `<button class="btn-validate-editor-question" data-question-id="${questionId}" data-item-id="${itemId}" data-is-validated="${isValidated ? '1' : '0'}" title="${validateTitle}">${isValidated ? icon('x-circle','icon-only') : icon('check-circle','icon-only')}</button>` +
    `<button class="btn-delete-editor-question" data-question-id="${questionId}" data-item-id="${itemId}" title="Supprimer">${icon('trash','icon-only')}</button>`;

  actionsCell.querySelector('.btn-validate-editor-question')
    ?.addEventListener('click', (e) => handleValidateEditorQuestionButton(e.currentTarget));
  actionsCell.querySelector('.btn-delete-editor-question')
    ?.addEventListener('click', (e) => handleDeleteEditorQuestionButton(e.currentTarget));
}

function parseQuestionTextareaLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[•\-\*]|â€¢)\s*/, '').trim())
    .filter(Boolean);
}

function normalizeQuestionLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function parseQuestionTextareaMetadata(textarea) {
  try {
    const ids = JSON.parse(decodeURIComponent(textarea.dataset.questionIds || '[]'));
    const lines = JSON.parse(decodeURIComponent(textarea.dataset.questionLines || '[]'));
    return ids.map((id, index) => ({
      id: Number(id),
      text: String(lines[index] || '')
    })).filter(question => Number.isFinite(question.id));
  } catch {
    return [];
  }
}

function detectDismissedQuestionIds(originalQuestions, currentText) {
  if (originalQuestions.length <= 1) return [];
  const currentLines = parseQuestionTextareaLines(currentText);
  if (currentLines.length === 0 || currentLines.length >= originalQuestions.length) return [];

  const usedLineIndexes = new Set();
  const dismissedIds = [];

  for (const original of originalQuestions) {
    const originalText = normalizeQuestionLine(original.text);
    const matchIndex = currentLines.findIndex((line, index) =>
      !usedLineIndexes.has(index) && normalizeQuestionLine(line) === originalText
    );
    if (matchIndex >= 0) {
      usedLineIndexes.add(matchIndex);
    } else {
      dismissedIds.push(original.id);
    }
  }

  return dismissedIds;
}

function bindQuestionsEditorEvents() {
  // Auto-save avec le même pattern que la grille d'édition:
  // - état "modifié"
  // - debounce centralise
  // - garde anti-sauvegardes simultanees
  qsa('.question-text-editor').forEach(textarea => {
    textarea.addEventListener('input', () => {
      const itemId = textarea.dataset.itemId;
      const questionId = textarea.dataset.questionId;
      const questionText = textarea.value.trim();
      const statusIndicator = qs(`.save-status[data-item-id="${itemId}"]`);
      suppressedQuestionSaveItemIds.delete(String(itemId));

      if (!statusIndicator) return;

      // Si le champ est vidé, traiter cela comme une suppression utilisateur.
      if (!questionText) {
        if (questionId) {
          statusIndicator.style.display = 'block';
          statusIndicator.innerHTML = icon('clock', 'icon-only');
          statusIndicator.style.color = 'var(--muted)';
          markQuestionAsChanged({
            itemId: String(itemId),
            questionId: Number(questionId),
            deleteQuestion: true,
          });
        } else {
          statusIndicator.style.display = 'none';
          pendingQuestionSaves.delete(String(itemId));
        }
        return;
      }

      const originalQuestions = parseQuestionTextareaMetadata(textarea);
      const dismissQuestionIds = detectDismissedQuestionIds(originalQuestions, questionText);
      if (dismissQuestionIds.length > 0) {
        statusIndicator.style.display = 'block';
        statusIndicator.innerHTML = icon('clock', 'icon-only');
        statusIndicator.style.color = 'var(--muted)';
        markQuestionAsChanged({
          itemId: String(itemId),
          questionId: questionId ? Number(questionId) : null,
          dismissQuestionIds,
          questionText,
        });
        return;
      }

      const companyId = qs('#questions-target-company')?.value;
      if (!companyId) {
        showCompanySelectModal(itemId, questionId, questionText);
        statusIndicator.style.display = 'block';
        statusIndicator.innerHTML = icon('alert-triangle', 'icon-only');
        statusIndicator.style.color = 'var(--copper)';
        return;
      }

      statusIndicator.style.display = 'block';
      statusIndicator.innerHTML = icon('clock', 'icon-only');
      statusIndicator.style.color = 'var(--muted)';

      markQuestionAsChanged({
        itemId: String(itemId),
        questionId: questionId ? Number(questionId) : null,
        companyId: Number(companyId),
        questionText,
      });
    });
  });
  
  // Valider une question
  qsa('.btn-validate-editor-question').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const currentBtn = e.currentTarget;
      const itemId = Number(currentBtn.dataset.itemId);
      let questionId = currentBtn.dataset.questionId ? Number(currentBtn.dataset.questionId) : null;
      const isValidated = currentBtn.dataset.isValidated === '1';
      try {
        if (isValidated) {
          if (!questionId) {
            showNotify({ title:'Validation', message:'Aucune fiche à dévalider', type:'info' });
            return;
          }
          await api(`/question-config/question/${questionId}`, {
            method: 'PUT',
            body: { status: 'pending' },
            showLoader: false
          });
          currentBtn.dataset.isValidated = '0';
          currentBtn.title = 'Valider';
          currentBtn.innerHTML = icon('check-circle','icon-only');
          refreshQuestionsInBackground();
          return;
        }

        if (!questionId) {
          showNotify({ title:'Validation', message:'Sauvegardez la fiche avant de la valider', type:'info' });
          return;
        }

        await api(`/question-config/question/${questionId}/validate`, { method: 'PUT', showLoader: false });
        currentBtn.dataset.isValidated = '1';
        currentBtn.title = 'Désactiver la validation';
        currentBtn.innerHTML = icon('x-circle','icon-only');
        refreshQuestionsInBackground();
      } catch (err) {
        showNotify({ title:'Erreur', message: err.message, type:'error' });
      }
    });
  });

  // Supprimer une question
  qsa('.btn-delete-editor-question').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const currentBtn = e.currentTarget;
      const questionId = currentBtn.dataset.questionId;
      const itemId = currentBtn.dataset.itemId;
      
      showDeleteConfirmation({
        title: 'Supprimer une fiche question',
        message: 'Êtes-vous sûr de vouloir supprimer cette fiche question ?',
        extra: '<strong>⚠️ Attention:</strong> Les réponses des entreprises seront perdues. Cette action ne peut pas être annulée.',
        onConfirm: async () => {
          try {
            if (itemId) {
              suppressedQuestionSaveItemIds.add(String(itemId));
              pendingQuestionSaves.delete(String(itemId));
              hasUnsavedQuestionChanges = pendingQuestionSaves.size > 0;
            }
            await waitForQuestionSaveIdle();
            await api(`/question-config/question/${questionId}`, {
              method: 'DELETE',
              showLoader: false
            });

            const row = itemId ? qs(`#questions-editor-body tr[data-item-id="${itemId}"]`) : null;
            const textarea = itemId ? qs(`.question-text-editor[data-item-id="${itemId}"]`) : null;
            if (row) {
              row.dataset.questionId = '';
              row.dataset.questionCompanyId = '';
              const actionsCell = row.querySelector('.sticky-actions');
              if (actionsCell) actionsCell.innerHTML = '';
            }
            if (textarea) {
              textarea.value = '';
              textarea.dataset.questionId = '';
            }
            
            showNotify({ title:'Succès', message:'Question supprimée', type:'success' });
            refreshQuestionsInBackground();
            
          } catch (err) {
            showNotify({ title:'Erreur', message: err.message, type:'error' });
          }
        }
      });
    });
  });
}

function refreshQuestionsInBackground() {
  refreshQuestions({ silent: true }).catch(err => {
    console.warn('Erreur rafraichissement questions:', err);
  });
}

async function validateAllQuestionsEditor() {
  if (isVisionneur() || isEntreprise()) {
    showNotify({ title:'Accès refusé', message:'Vous ne pouvez pas valider les fiches questions.', type:'error' });
    return;
  }
  if (!currentLot || !currentRound) return;
  if (hasUnsavedQuestionChanges || isQuestionSaving || activeQuestionSavePromise) {
    showNotify({ title:'Enregistrement', message:'Une question est encore en cours de sauvegarde.', type:'info' });
    return;
  }

  const selectedCompanyId = qs('#questions-target-company')?.value || '';
  const selectedCompanyName = selectedCompanyId
    ? (qs('#questions-target-company')?.selectedOptions?.[0]?.textContent || 'Entreprise ciblée')
    : null;

  try {
    const params = new URLSearchParams({ round_id: String(currentRound.id) });
    if (selectedCompanyId) params.set('company_id', selectedCompanyId);
    await api(`/question-config/lot/${currentLot.id}/validate?${params.toString()}`, { method: 'PUT', showLoader: false });
    await loadQuestionsEditor({ force: true, silent: true });
    refreshQuestionsInBackground();
  } catch (err) {
    showNotify({ title:'Erreur', message: err.message, type:'error' });
  }
}

function markQuestionAsChanged(change) {
  hasUnsavedQuestionChanges = true;
  pendingQuestionSaves.set(String(change.itemId), change);
  debounceAutoSave('questions-editor', autoSaveQuestionsEditor, 350);
}

async function autoSaveQuestionsEditor() {
  if (activeQuestionSavePromise || pendingQuestionSaves.size === 0) return;
  if (!currentLot || !currentRound) return;

  activeQuestionSavePromise = runQuestionsAutoSaveBatch();
  try {
    await activeQuestionSavePromise;
  } finally {
    activeQuestionSavePromise = null;
    if (pendingQuestionSaves.size > 0) {
      debounceAutoSave('questions-editor', autoSaveQuestionsEditor, 120);
    }
  }
}

async function waitForQuestionSaveIdle() {
  if (!activeQuestionSavePromise) return;
  try {
    await activeQuestionSavePromise;
  } catch {}
}

async function runQuestionsAutoSaveBatch() {
  isQuestionSaving = true;
  let hasSavedAtLeastOne = false;

  try {
    const changes = Array.from(pendingQuestionSaves.values());
    const results = await Promise.all(changes.map(async (change) => {
      const key = String(change.itemId);
      if (pendingQuestionSaves.get(key) !== change || suppressedQuestionSaveItemIds.has(key)) {
        return false;
      }

      const textarea = qs(`.question-text-editor[data-item-id="${change.itemId}"]`);
      const statusIndicator = qs(`.save-status[data-item-id="${change.itemId}"]`);
      if (!textarea || !statusIndicator) {
        if (pendingQuestionSaves.get(key) === change) {
          pendingQuestionSaves.delete(key);
        }
        return false;
      }

      const questionId = textarea.dataset.questionId ? Number(textarea.dataset.questionId) : null;
      const dismissQuestionIds = Array.isArray(change.dismissQuestionIds)
        ? change.dismissQuestionIds.map(Number).filter(Number.isFinite)
        : [];
      if (dismissQuestionIds.length > 0) {
        try {
          await Promise.all(dismissQuestionIds.map(id => api(`/question-config/question/${id}`, {
            method: 'DELETE',
            showLoader: false
          })));

          if (pendingQuestionSaves.get(key) === change) pendingQuestionSaves.delete(key);

          const remainingQuestions = parseQuestionTextareaMetadata(textarea)
            .filter(question => !dismissQuestionIds.includes(Number(question.id)));
          textarea.dataset.questionIds = encodeURIComponent(JSON.stringify(remainingQuestions.map(q => q.id)));
          textarea.dataset.questionLines = encodeURIComponent(JSON.stringify(remainingQuestions.map(q => q.text)));

          const newPrimaryId = remainingQuestions[0]?.id || '';
          textarea.dataset.questionId = newPrimaryId ? String(newPrimaryId) : '';
          const row = qs(`#questions-editor-body tr[data-item-id="${change.itemId}"]`);
          if (row) {
            row.dataset.questionId = newPrimaryId ? String(newPrimaryId) : '';
            const validateBtn = row.querySelector('.btn-validate-editor-question');
            const deleteBtn = row.querySelector('.btn-delete-editor-question');
            if (newPrimaryId) {
              if (validateBtn) validateBtn.dataset.questionId = String(newPrimaryId);
              if (deleteBtn) deleteBtn.dataset.questionId = String(newPrimaryId);
            } else {
              const actionsCell = row.querySelector('.sticky-actions');
              if (actionsCell) actionsCell.innerHTML = '';
            }
          }

          statusIndicator.style.display = 'block';
          statusIndicator.innerHTML = icon('check', 'icon-only');
          statusIndicator.style.color = 'var(--success)';
          setTimeout(() => {
            statusIndicator.style.display = 'none';
          }, 1200);
          return true;
        } catch (err) {
          console.error('Erreur suppression question retiree:', err);
          statusIndicator.style.display = 'block';
          statusIndicator.innerHTML = icon('alert-triangle', 'icon-only');
          statusIndicator.style.color = 'var(--copper)';
          return false;
        }
      }

      if (change.deleteQuestion) {
        const deleteQuestionId = Number(change.questionId || questionId);
        if (!deleteQuestionId) {
          if (pendingQuestionSaves.get(key) === change) pendingQuestionSaves.delete(key);
          statusIndicator.style.display = 'none';
          return false;
        }

        try {
          suppressedQuestionSaveItemIds.add(key);
          await api(`/question-config/question/${deleteQuestionId}`, {
            method: 'DELETE',
            showLoader: false
          });

          if (pendingQuestionSaves.get(key) === change) pendingQuestionSaves.delete(key);
          textarea.dataset.questionId = '';
          const row = qs(`#questions-editor-body tr[data-item-id="${change.itemId}"]`);
          if (row) {
            row.dataset.questionId = '';
            row.dataset.questionCompanyId = '';
            const actionsCell = row.querySelector('.sticky-actions');
            if (actionsCell) actionsCell.innerHTML = '';
          }
          statusIndicator.style.display = 'block';
          statusIndicator.innerHTML = icon('check', 'icon-only');
          statusIndicator.style.color = 'var(--success)';
          setTimeout(() => {
            statusIndicator.style.display = 'none';
          }, 1200);
          return true;
        } catch (err) {
          console.error('Erreur suppression question vide:', err);
          suppressedQuestionSaveItemIds.delete(key);
          statusIndicator.style.display = 'block';
          statusIndicator.innerHTML = icon('alert-triangle', 'icon-only');
          statusIndicator.style.color = 'var(--copper)';
          return false;
        }
      }

      const currentQuestionText = textarea.value.trim();
      if (!currentQuestionText) {
        if (pendingQuestionSaves.get(key) === change) {
          pendingQuestionSaves.delete(key);
        }
        statusIndicator.style.display = 'none';
        return false;
      }

      const companyId = qs('#questions-target-company')?.value || String(change.companyId || '');
      if (!companyId) {
        statusIndicator.style.display = 'block';
        statusIndicator.innerHTML = icon('alert-triangle', 'icon-only');
        statusIndicator.style.color = 'var(--copper)';
        return false;
      }

      try {
        const result = await saveQuestionWithCompany(
          change.itemId,
          questionId,
          Number(companyId),
          currentQuestionText,
          { refreshList: false, silentError: true, showLoader: false }
        );

        if (!result) return false;

        if (pendingQuestionSaves.get(key) === change) {
          pendingQuestionSaves.delete(key);
        }

        statusIndicator.style.display = 'block';
        statusIndicator.innerHTML = icon('check', 'icon-only');
        statusIndicator.style.color = 'var(--success)';
        setTimeout(() => {
          statusIndicator.style.display = 'none';
        }, 1200);
        return true;
      } catch (err) {
        console.error('Erreur autosave question:', err);
        statusIndicator.style.display = 'block';
        statusIndicator.innerHTML = icon('alert-triangle', 'icon-only');
        statusIndicator.style.color = 'var(--copper)';
        return false;
      }
    }));

    hasSavedAtLeastOne = results.some(Boolean);
    hasUnsavedQuestionChanges = pendingQuestionSaves.size > 0;
    if (hasSavedAtLeastOne) {
      refreshQuestionsInBackground();
    }
  } catch (err) {
    console.error('Erreur autosave éditeur questions:', err);
  } finally {
    isQuestionSaving = false;
  }
}

// Fonction pour afficher le modal de sélection d'entreprise
function showCompanySelectModal(itemId, questionId, questionText) {
  const modal = qs('#company-select-modal');
  const modalSelect = qs('#modal-target-company-select');
  const headerSelect = qs('#questions-target-company');
  if (!modal || !modalSelect || !headerSelect) return;
  modal.dataset.itemId = String(itemId || '');
  modal.dataset.questionId = questionId ? String(questionId) : '';
  modal.dataset.questionText = String(questionText || '');
  
  // Synchroniser le modal avec la sélection du header
  modalSelect.value = headerSelect.value;
  
  // Afficher le modal
  modal.classList.remove('hidden');
  
  // Gestionnaire pour le bouton Annuler
  const cancelBtn = qs('#cancel-company-modal');
  const cancelHandler = () => {
    modal.classList.add('hidden');
    cancelBtn.onclick = null;
    confirmBtn.onclick = null;
  };
  
  // Gestionnaire pour le bouton Confirmer
  const confirmBtn = qs('#confirm-company-modal');
  if (!cancelBtn || !confirmBtn) return;
  const confirmHandler = async () => {
    const companyId = modalSelect.value;
    
    if (!companyId) {
      showNotify({ title:'Validation', message:'Veuillez sélectionner une entreprise', type:'info' });
      return;
    }
    
    // Synchroniser avec le header
    headerSelect.value = companyId;
    
    // Masquer le modal
    modal.classList.add('hidden');
    cancelBtn.onclick = null;
    confirmBtn.onclick = null;
    
    // Sauvegarder la question
    const modalItemId = modal.dataset.itemId;
    const modalQuestionId = modal.dataset.questionId ? Number(modal.dataset.questionId) : null;
    const modalQuestionText = modal.dataset.questionText || '';
    await saveQuestionWithCompany(modalItemId, modalQuestionId, companyId, modalQuestionText);
  };
  
  cancelBtn.onclick = cancelHandler;
  confirmBtn.onclick = confirmHandler;
}

// Fonction pour sauvegarder une question avec l'entreprise
async function saveQuestionWithCompany(itemId, questionId, companyId, questionText, options = {}) {
  const { refreshList = true, silentError = false, showLoader = true } = options;

  if (!currentLot || !currentRound) return null;

  const safeItemId = Number(itemId);
  const safeCompanyId = Number(companyId);
  if (!Number.isFinite(safeItemId) || !Number.isFinite(safeCompanyId)) {
    throw new Error('Paramètres invalides pour la sauvegarde de question');
  }

  if (suppressedQuestionSaveItemIds.has(String(safeItemId))) return null;

  let result;
  if (questionId) {
    result = await api(`/question-config/question/${questionId}`, {
      method: 'PUT',
      body: {
        question_text: String(questionText || '').trim(),
        company_id: safeCompanyId,
      },
      showLoader,
    });
  } else {
    result = await api('/question-config/question', {
      method: 'POST',
      body: {
        lot_id: currentLot.id,
        round_id: currentRound.id,
        item_id: safeItemId,
        company_id: safeCompanyId,
        question_text: String(questionText || '').trim(),
        question_type: 'manual',
        status: 'pending',
      },
      showLoader,
    });
  }

  const row = qs(`#questions-editor-body tr[data-item-id="${safeItemId}"]`);
  const textarea = qs(`.question-text-editor[data-item-id="${safeItemId}"]`);
  if (result?.id && row && textarea) {
    row.dataset.questionId = result.id;
    row.dataset.questionCompanyId = safeCompanyId;
    textarea.dataset.questionId = result.id;
    ensureQuestionEditorActionButtons(row, safeItemId, result.id, result.status === 'validated');
  }

  if (refreshList) {
    await refreshQuestions();
  }

  return result;
}

/* ================= Comparatif (lecture) ================= */
function fmtPct(p){ if (p==null || isNaN(p)) return ''; const cls = p>0?'delta-neg':(p<0?'delta-pos':''); const s=(p>0?'+':'')+p.toFixed(1)+'%'; return `<span class="${cls}">${s}</span>`; }
function fmtNum(v){ 
  if (v == null || v === '') return ''; 
  const n = parseNum(v); 
  return Number.isFinite(n) ? formatNum(n) : ''; 
}
function fmtEuro(v){ 
  if (v == null || v === '') return ''; 
  const n = parseNum(v); 
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function refreshCompare({ silent = false } = {}){
  try {
    if (!currentLot) return;
    const roundParam = currentRound ? `?round_id=${currentRound.id}` : '';
    
    const data = await api('/lots/'+currentLot.id+'/table'+roundParam, { showLoader: !silent });
    const entrepriseMode = isEntreprise();
    
    // Vérifier si l'utilisateur entreprise a des données
    if (entrepriseMode && (!data.companies || data.companies.length === 0)) {
      const head = qs('#compare-head'), body = qs('#compare-body');
      head.innerHTML = '';
      body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--muted)">Aucune entreprise attribuée ou aucune donnée disponible pour ce lot.</td></tr>';
      return;
    }
    
    const head = qs('#compare-head'), body = qs('#compare-body'); head.innerHTML=''; body.innerHTML='';

  attachOfferDesigPillDelegates(body);

  // En-tête ligne 1
  let h1 = `<tr class="head-row-1"><th rowspan="2" class="sticky-col">Num</th><th rowspan="2" class="sticky-col2">Désignation</th><th rowspan="2">Unité</th>`;
  if (!entrepriseMode) {
    h1 += `<th colspan="3" class="moe-col">MOE</th>`;
  }
  for (const c of data.companies) {
    h1 += `<th colspan="${entrepriseMode ? '4' : '6'}" class="company-col">${c.name}</th>`;
  }
  h1 += '</tr>';
  
  // En-tête ligne 2
  let h2 = `<tr class="head-row-2">`;
  if (!entrepriseMode) {
    h2 += `<th class="moe-border">Qté</th><th>PU</th><th>Mt</th>`;
  }
  for (let i=0; i<data.companies.length; i++) {
    if (entrepriseMode) {
      // Sans les colonnes ΔQté et ΔPU
      h2 += '<th class="company-border">Unité</th><th>Qté</th><th>PU</th><th>Mt</th>';
    } else {
      h2 += '<th class="company-border">Unité</th><th>Qté</th><th>ΔQté</th><th>PU</th><th>Mt</th><th>ΔPU</th>';
    }
  }
  h2 += '</tr>';
  head.innerHTML = h1 + h2;
  recalcCompareHeaderOffsets();
  
  // Calculer les totaux
  let totalMoe = 0;
  const totalsByCompany = {};
  data.companies.forEach(c => totalsByCompany[c.id] = 0);
  
  // Construire un index de couleurs par company_id
  const companyColors = {};
  data.companies.forEach(c => { companyColors[c.id] = c.color || null; });

  // Séparer les items normaux (DPGF) des items ajoutés par les entreprises
  const dpgfRows = data.rows.filter(r => !r.source_company_id);
  const addedRows = data.rows.filter(r => r.source_company_id);
  
  for (const r of dpgfRows){
    const desigPills = offerDesigPillsHtml(r.companies);
    let tr = `<tr><td class="sticky-col">${r.num||''}</td><td class="sticky-col2">${r.designation||''}${desigPills}</td><td>${r.unit||''}</td>`;
    
    // Colonnes MOE (seulement si pas entreprise)
    if (!entrepriseMode) {
      tr += `<td class="moe-border">${fmtNum(r.moe.qty)}</td><td>${fmtEuro(r.moe.pu)}</td><td>${fmtEuro(r.moe.mt)}</td>`;
      // Accumuler le total MOE
      if (r.moe.mt != null) totalMoe += parseNum(r.moe.mt);
    }
    
    for (const c of r.companies){
      if (entrepriseMode) {
        // Sans les colonnes ΔQté et ΔPU
        const commentBadge = offerCommentBadgeHtml(c.comment, c.color, c.name);
        tr += `<td class="company-border">${c.u||''}</td><td>${fmtNum(c.qty)}</td><td>${fmtEuro(c.pu)}</td><td>${fmtEuro(c.mt)}${commentBadge}</td>`;
      } else {
        // Calculer delta quantité (MOE - Offre)
        const moeQty = parseNum(r.moe.qty);
        const offerQty = parseNum(c.qty);
        const deltaQty = (moeQty !== null && offerQty !== null) ? moeQty - offerQty : null;
        const deltaQtyClass = deltaQty !== null ? (deltaQty > 0 ? 'delta-positive' : deltaQty < 0 ? 'delta-negative' : '') : '';
        
        const commentBadge = offerCommentBadgeHtml(c.comment, c.color, c.name);
        tr += `<td class="company-border">${c.u||''}</td><td>${fmtNum(c.qty)}</td><td class="${deltaQtyClass}">${deltaQty !== null ? fmtNum(deltaQty) : ''}</td><td>${fmtEuro(c.pu)}</td><td>${fmtEuro(c.mt)}${commentBadge}</td><td>${fmtPct(c.delta_pu_pct)}</td>`;
      }
      
      // Accumuler le total par entreprise
      if (c.mt != null) totalsByCompany[c.company_id] = (totalsByCompany[c.company_id] || 0) + parseNum(c.mt);
    }
    tr += '</tr>'; body.insertAdjacentHTML('beforeend', tr);
  }
  
  // Ajouter la ligne de totaux DPGF
  const totalColCount = 3 + (!entrepriseMode ? 3 : 0) + data.companies.length * (entrepriseMode ? 4 : 6);
  let totalRow = `<tr class="total-row"><td class="sticky-col"><strong>TOTAL DPGF</strong></td><td class="sticky-col2"></td><td></td>`;
  if (!entrepriseMode) {
    totalRow += `<td class="moe-border"></td><td></td><td><strong>${fmtEuro(totalMoe)}</strong></td>`;
  }
  for (const c of data.companies) {
    const companyTotal = totalsByCompany[c.id] || 0;
    if (entrepriseMode) {
      totalRow += `<td class="company-border"></td><td></td><td></td><td><strong>${fmtEuro(companyTotal)}</strong></td>`;
    } else {
      totalRow += `<td class="company-border"></td><td></td><td></td><td></td><td><strong>${fmtEuro(companyTotal)}</strong></td><td></td>`;
    }
  }
  totalRow += '</tr>';
  body.insertAdjacentHTML('beforeend', totalRow);

  // --- Postes ajoutés par les entreprises ---
  if (addedRows.length > 0) {
    // Ligne séparateur
    body.insertAdjacentHTML('beforeend',
      `<tr class="added-posts-separator"><td colspan="${totalColCount}" style="padding:10px 16px;background:var(--warning, #f59e0b);color:#fff;font-weight:700;font-size:0.9em;text-align:center">
        📋 Postes ajoutés par les entreprises (${addedRows.length})
      </td></tr>`
    );

    // Totaux postes ajoutés par entreprise
    const addedTotals = {};
    data.companies.forEach(c => addedTotals[c.id] = 0);

    for (const r of addedRows) {
      // Trouver la couleur de l'entreprise qui a ajouté ce poste
      const sourceColor = companyColors[r.source_company_id] || null;
      const sourceName = data.companies.find(c => c.id === r.source_company_id)?.name || '';
      const bgStyle = sourceColor ? `background-color: ${sourceColor}20;` : ''; // 20 = opacity ~12%
      const borderStyle = sourceColor ? `border-left: 4px solid ${sourceColor};` : '';
      const parentLabel = r.parent_item_id
        ? `<div class="muted" style="font-size:0.75em;margin-top:3px">Sous ${r.parent_num ? escapeHtml(String(r.parent_num)) + ' - ' : ''}${escapeHtml(String(r.parent_designation || 'parent DPGF'))}</div>`
        : '';

      let tr = `<tr style="${bgStyle}${borderStyle}" title="Poste ajouté par ${sourceName}">`;
      tr += `<td class="sticky-col">${r.num||''}</td>`;
      tr += `<td class="sticky-col2"><span style="font-size:0.75em;padding:2px 6px;border-radius:4px;${sourceColor ? 'background:'+sourceColor+';color:#fff;' : 'background:var(--warning);color:#fff;'}margin-right:6px">${sourceName}</span>${r.designation||''}${parentLabel}</td>`;
      tr += `<td>${r.unit||''}</td>`;

      if (!entrepriseMode) {
        tr += `<td class="moe-border"></td><td></td><td></td>`; // Pas de MOE pour les postes ajoutés
      }

      for (const c of r.companies) {
        if (entrepriseMode) {
          tr += `<td class="company-border">${c.u||''}</td><td>${fmtNum(c.qty)}</td><td>${fmtEuro(c.pu)}</td><td>${fmtEuro(c.mt)}</td>`;
        } else {
          tr += `<td class="company-border">${c.u||''}</td><td>${fmtNum(c.qty)}</td><td></td><td>${fmtEuro(c.pu)}</td><td>${fmtEuro(c.mt)}</td><td></td>`;
        }
        if (c.mt != null) addedTotals[c.company_id] = (addedTotals[c.company_id] || 0) + parseNum(c.mt);
      }
      tr += '</tr>';
      body.insertAdjacentHTML('beforeend', tr);
    }

    // Total des postes ajoutés
    let addedTotalRow = `<tr class="total-row" style="background:var(--warning-bg, #fef3c7)"><td class="sticky-col"><strong>TOTAL Ajoutés</strong></td><td class="sticky-col2"></td><td></td>`;
    if (!entrepriseMode) {
      addedTotalRow += `<td class="moe-border"></td><td></td><td></td>`;
    }
    for (const c of data.companies) {
      const at = addedTotals[c.id] || 0;
      if (entrepriseMode) {
        addedTotalRow += `<td class="company-border"></td><td></td><td></td><td><strong>${at ? fmtEuro(at) : ''}</strong></td>`;
      } else {
        addedTotalRow += `<td class="company-border"></td><td></td><td></td><td></td><td><strong>${at ? fmtEuro(at) : ''}</strong></td><td></td>`;
      }
    }
    addedTotalRow += '</tr>';
    body.insertAdjacentHTML('beforeend', addedTotalRow);

    // Grand total (DPGF + postes ajoutés)
    let grandTotalRow = `<tr class="total-row" style="border-top:3px double var(--border)"><td class="sticky-col"><strong>GRAND TOTAL</strong></td><td class="sticky-col2"></td><td></td>`;
    if (!entrepriseMode) {
      grandTotalRow += `<td class="moe-border"></td><td></td><td><strong>${fmtEuro(totalMoe)}</strong></td>`;
    }
    for (const c of data.companies) {
      const grand = (totalsByCompany[c.id] || 0) + (addedTotals[c.id] || 0);
      if (entrepriseMode) {
        grandTotalRow += `<td class="company-border"></td><td></td><td></td><td><strong>${fmtEuro(grand)}</strong></td>`;
      } else {
        grandTotalRow += `<td class="company-border"></td><td></td><td></td><td></td><td><strong>${fmtEuro(grand)}</strong></td><td></td>`;
      }
    }
    grandTotalRow += '</tr>';
    body.insertAdjacentHTML('beforeend', grandTotalRow);
  }

  // Rendre le tableau des options séparé (sous le total)
  renderOptionsCompareTable(data.companies, entrepriseMode);
  } catch (err) {
    console.error('[refreshCompare] Erreur:', err);
    const head = qs('#compare-head'), body = qs('#compare-body');
    head.innerHTML = '';
    body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--error)">Erreur lors du chargement du comparatif : ' + err.message + '</td></tr>';
  }
}

function recalcCompareHeaderOffsets(){
  const head = qs('#compare-head');
  if (!head) return;
  const row1 = head.querySelector('tr.head-row-1');
  const row2 = head.querySelector('tr.head-row-2');
  if (!row1 || !row2) return;
  // Reset top to measure natural layout
  head.querySelectorAll('tr.head-row-2 th').forEach(th => { th.style.top = '0px'; });
  const setFromMeasure = () => {
    const headRect = head.getBoundingClientRect();
    const row2Rect = row2.getBoundingClientRect();
    // Remonter la 2e ligne d'1px pour coller visuellement
    const offset = Math.max(0, Math.round(row2Rect.top - headRect.top) - 1);
    head.style.setProperty('--head-row1-height', offset + 'px');
    head.querySelectorAll('tr.head-row-2 th').forEach(th => { th.style.top = offset + 'px'; });
  };
  setFromMeasure();
  // Re-mesure au frame suivant pour tenir compte des polices/zoom
  if (window.requestAnimationFrame) requestAnimationFrame(setFromMeasure);
}

window.addEventListener('resize', () => {
  // Recalcule l'offset en cas de changement de taille/zoom
  recalcCompareHeaderOffsets();
  recalcQuestionsHeaderOffsets();
});
window.addEventListener('load', () => {
  recalcCompareHeaderOffsets();
  recalcQuestionsHeaderOffsets();
});

/* ================= Tableur (édition) ================= */
/** Rendu du comparatif des options sous le tableau principal */
function renderOptionsCompareTable(companies, entrepriseMode){
  const head = qs('#options-compare-head');
  const body = qs('#options-compare-body');
  if (!head || !body) return;
  head.innerHTML = '';
  body.innerHTML = '';

  // Construire une liste d'items pour toutes les options
  const items = [];
  for (const opt of lotOptions){
    for (const item of (opt.items || [])){
      items.push({ option: opt, item });
    }
  }
  if (items.length === 0){
    head.innerHTML = '';
    body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:16px;color:var(--muted)">Aucune option</td></tr>';
    return;
  }

  // En-tête ligne 1
  let h1 = `<tr class="head-row-1"><th rowspan="2" class="sticky-col">Num</th><th rowspan="2" class="sticky-col2">Désignation</th><th rowspan="2">Unité</th>`;
  if (!entrepriseMode) h1 += `<th colspan="3" class="moe-col">MOE</th>`;
  for (const c of companies) h1 += `<th colspan="${entrepriseMode ? '4' : '6'}" class="company-col">${c.name}</th>`;
  h1 += '</tr>';
  
  // En-tête ligne 2
  let h2 = `<tr class="head-row-2">`;
  if (!entrepriseMode) h2 += `<th class="moe-border">Qté</th><th>PU</th><th>Mt</th>`;
  for (let i=0;i<companies.length;i++){
    if (entrepriseMode) {
      h2 += '<th class="company-border">Unité</th><th>Qté</th><th>PU</th><th>Mt</th>';
    } else {
      h2 += '<th class="company-border">Unité</th><th>Qté</th><th>ΔQté</th><th>PU</th><th>Mt</th><th>ΔPU</th>';
    }
  }
  h2 += '</tr>';
  head.innerHTML = h1 + h2;

  // Totaux options
  let totalMoe = 0;
  const totalsByCompany = {}; companies.forEach(c => totalsByCompany[c.id] = 0);

  for (const { option: opt, item } of items){
    const numLabel = formatOptionNum(item.num);
    let tr = `<tr><td class="sticky-col">${numLabel}</td><td class="sticky-col2"><span class="muted">${opt.designation}</span> — ${item.designation||''}</td><td>${item.unit||''}</td>`;
    if (!entrepriseMode){
      const moeQty = parseNum(item.moe_qty); const moePu = parseNum(item.moe_unit_price);
      const moeMt = (moeQty !== null && moePu !== null) ? moeQty * moePu : null;
      tr += `<td class="moe-border">${fmtNum(moeQty)}</td><td>${fmtEuro(moePu)}</td><td>${fmtEuro(moeMt)}</td>`;
      if (moeMt != null) totalMoe += moeMt;
    }
    for (const c of companies){
      const off = (item.offers||[]).find(o => Number(o.company_id) === Number(c.id));
      const qty = off?.qty || 0; const pu = off?.unit_price || 0; const mt = (parseNum(qty)||0) * (parseNum(pu)||0);
      if (entrepriseMode){
        tr += `<td class="company-border"></td><td>${fmtNum(qty)}</td><td>${fmtEuro(pu)}</td><td>${fmtEuro(mt)}</td>`;
      } else {
        const moeQty = parseNum(item.moe_qty);
        const moePu = parseNum(item.moe_unit_price);
        const deltaQty = (Number.isFinite(moeQty) && Number.isFinite(parseNum(qty))) ? (moeQty - parseNum(qty)) : null;
        const deltaQtyClass = deltaQty !== null ? (deltaQty > 0 ? 'delta-positive' : deltaQty < 0 ? 'delta-negative' : '') : '';
        const deltaPuPct = (Number.isFinite(moePu) && moePu !== 0 && Number.isFinite(parseNum(pu)))
          ? ((parseNum(pu) - moePu) / moePu) * 100
          : null;
        tr += `<td class="company-border"></td><td>${fmtNum(qty)}</td><td class="${deltaQtyClass}">${deltaQty !== null ? fmtNum(deltaQty) : ''}</td><td>${fmtEuro(pu)}</td><td>${fmtEuro(mt)}</td><td>${fmtPct(deltaPuPct)}</td>`;
      }
      if (mt) totalsByCompany[c.id] = (totalsByCompany[c.id] || 0) + mt;
    }
    tr += '</tr>';
    body.insertAdjacentHTML('beforeend', tr);
  }

  // Ligne totaux options
  let totalRow = `<tr class="total-row"><td class="sticky-col"><strong>TOTAL OPTIONS</strong></td><td class="sticky-col2"></td><td></td>`;
  if (!entrepriseMode) totalRow += `<td class="moe-border"></td><td></td><td><strong>${fmtEuro(totalMoe)}</strong></td>`;
  for (const c of companies){
    const t = totalsByCompany[c.id] || 0;
    if (entrepriseMode) totalRow += `<td class="company-border"></td><td></td><td></td><td><strong>${fmtEuro(t)}</strong></td>`;
    else totalRow += `<td class="company-border"></td><td></td><td></td><td></td><td><strong>${fmtEuro(t)}</strong></td><td></td>`;
  }
  totalRow += '</tr>';
  body.insertAdjacentHTML('beforeend', totalRow);
}

  /** ======= Options Sheet — Model-based (like main table) ======= */
  let optionsColModel = [];
  let optionsSheetRows = [];
  let optionsSheetDelegatesAttached = false;
  let hasUnsavedOptionsChanges = false;
  let isSavingOptions = false;
  let _optionsChangeGen = 0;

  function buildOptionsColModel(){
    const entrepriseMode = isEntreprise();
    optionsColModel = [
      { key:'num',        editable:true },
      { key:'designation',editable:true, wide:true },
      { key:'unit',       editable:true }
    ];
    if (!entrepriseMode){
      optionsColModel.push(
        { key:'moe.qty', editable:true,  cls:'moe-col' },
        { key:'moe.pu',  editable:true,  cls:'moe-col' },
        { key:'moe.mt',  editable:false, cls:'moe-col' }
      );
    }
    for (const c of lotCompanies){
      optionsColModel.push({ key:`c.${c.id}.u`,   editable:true  });
      optionsColModel.push({ key:`c.${c.id}.qty`, editable:true  });
      optionsColModel.push({ key:`c.${c.id}.pu`,  editable:true  });
      optionsColModel.push({ key:`c.${c.id}.mt`,  editable:false });
    }
  }

  function buildOptionsSheetModel(){
    optionsSheetRows = [];
    for (const opt of lotOptions){
      for (const item of (opt.items || [])){
        const row = {
          item_id: Number(item.id),
          option_id: Number(opt.id),
          option_designation: opt.designation || '',
          num: item.num || '',
          designation: item.designation || '',
          unit: item.unit || '',
          moe: {
            qty: item.moe_qty != null ? String(item.moe_qty) : '',
            pu: item.moe_unit_price != null ? String(item.moe_unit_price) : ''
          },
          offers: {}
        };
        for (const c of lotCompanies){
          const off = (item.offers || []).find(o => Number(o.company_id) === Number(c.id)) || {};
          row.offers[c.id] = {
            u: off.unit != null ? String(off.unit) : '',
            qty: off.qty != null ? String(off.qty) : '',
            pu: off.unit_price != null ? String(off.unit_price) : ''
          };
        }
        optionsSheetRows.push(row);
      }
    }
  }

  function optionsValueForCell(row, key){
    if (!row) return '';
    if (key === 'num') return formatOptionNum(row.num);
    if (key === 'designation') return `${row.option_designation} — ${row.designation}`;
    if (key === 'unit') return row.unit ?? '';
    if (key === 'moe.qty') return row.moe?.qty ?? '';
    if (key === 'moe.pu')  return row.moe?.pu  ?? '';
    if (key === 'moe.mt')  return amountOf(row.moe?.qty, row.moe?.pu);
    if (key.startsWith('c.')){
      const [, cid, sub] = key.split('.');
      const o = row.offers?.[cid] || {};
      if (sub === 'mt') return amountOf(o.qty, o.pu);
      return o[sub] ?? '';
    }
    return '';
  }

  function getOptionsCell(r, c){
    const rowEl = qsa('#options-sheet-body tr')[r];
    if (!rowEl) return null;
    return rowEl.querySelector(`td[data-c="${c}"]`) || rowEl.children[c] || null;
  }

  function setOptionsCell(r, c, text, updateDOM = true){
    const td = getOptionsCell(r, c); if (!td) return;
    if (updateDOM) td.textContent = text ?? '';
    const key = optionsColModel[c]?.key;
    const row = optionsSheetRows[r]; if (!row) return;
    if (key === 'num') row.num = parseOptionNum(text);
    else if (key === 'designation'){
      let d = text || '';
      const sep = '—';
      if (d.includes(sep)) d = d.split(sep).slice(1).join(sep).trim();
      row.designation = d;
    }
    else if (key === 'unit') row.unit = text;
    else if (key === 'moe.qty') row.moe.qty = text;
    else if (key === 'moe.pu')  row.moe.pu  = text;
    else if (key.startsWith('c.')){
      const [, cid, sub] = key.split('.');
      row.offers[cid] = row.offers[cid] || { u:'', qty:'', pu:'' };
      if (sub !== 'mt') row.offers[cid][sub] = text;
    }
  }

  function recalcOptionsAmountsRow(r){
    const cQty = optionsColModel.findIndex(c => c.key === 'moe.qty');
    const cPu  = optionsColModel.findIndex(c => c.key === 'moe.pu');
    const cMt  = optionsColModel.findIndex(c => c.key === 'moe.mt');
    if (cQty>=0 && cPu>=0 && cMt>=0){
      const mt = getOptionsCell(r, cMt);
      if (mt) mt.textContent = amountOf(getOptionsCell(r,cQty)?.textContent.trim(), getOptionsCell(r,cPu)?.textContent.trim());
    }
    for (const c of lotCompanies){
      const base = `c.${c.id}.`;
      const ciQty = optionsColModel.findIndex(x => x.key === base+'qty');
      const ciPu  = optionsColModel.findIndex(x => x.key === base+'pu');
      const ciMt  = optionsColModel.findIndex(x => x.key === base+'mt');
      if (ciQty>=0 && ciPu>=0 && ciMt>=0){
        const mt = getOptionsCell(r, ciMt);
        if (mt) mt.textContent = amountOf(getOptionsCell(r,ciQty)?.textContent.trim(), getOptionsCell(r,ciPu)?.textContent.trim());
      }
    }
  }

  function appendOptionsRowDOM(rIndex, data){
    const tr = document.createElement('tr');
    for (let c=0; c<optionsColModel.length; c++){
      const col = optionsColModel[c];
      const td = document.createElement('td');
      td.dataset.r = String(rIndex);
      td.dataset.c = String(c);
      if (col.editable) td.contentEditable = 'true'; else td.classList.add('cell-readonly');
      if (col.wide) td.style.minWidth = '320px';
      if (col.key.startsWith('c.') && col.key.endsWith('.u')) {
        const [, cid] = col.key.split('.');
        applyCompanyColumnStyle(td, cid);
      }
      td.textContent = optionsValueForCell(data, col.key);
      tr.appendChild(td);
    }
    qs('#options-sheet-body').appendChild(tr);
  }

  function ensureOptionsRows(n){
    while (qsa('#options-sheet-body tr').length < n){
      const lastRow = optionsSheetRows[optionsSheetRows.length - 1];
      const optionId = lastRow?.option_id || lotOptions[0]?.id;
      if (!optionId) break;
      const blank = { item_id:null, option_id:optionId, option_designation: lotOptions.find(o=>o.id===optionId)?.designation||'', num:'', designation:'', unit:'', moe:{qty:'', pu:''}, offers:{} };
      for (const c of lotCompanies) blank.offers[c.id] = { u:'', qty:'', pu:'', mt:'' };
      optionsSheetRows.push(blank);
      const rIndex = optionsSheetRows.length - 1;
      appendOptionsRowDOM(rIndex, blank);
    }
  }

  function focusOptionsCell(r, c){
    if (r < 0) r = 0;
    if (c < 0) c = 0;
    ensureOptionsRows(r+1);
    if (c >= optionsColModel.length) c = optionsColModel.length - 1;
    let guard = 0;
    while (!optionsColModel[c]?.editable && guard++ < 100) c++;
    if (c >= optionsColModel.length) c = optionsColModel.findIndex(x => x.editable);
    const td = getOptionsCell(r, c);
    if (td){
      td.focus();
      const range = document.createRange(); range.selectNodeContents(td); range.collapse(false);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    }
  }

  function markOptionsChanged(){
    hasUnsavedOptionsChanges = true;
    _optionsChangeGen++;
    debounceAutoSave('options-grid', autoSaveOptionsGrid, 800);
  }

  async function autoSaveOptionsGrid(){
    if (!currentLot || isSavingOptions || !hasUnsavedOptionsChanges) return;
    isSavingOptions = true;
    let genAtSaveStart = _optionsChangeGen;
    try {
      const rows = [];
      for (let r=0; r<optionsSheetRows.length; r++){
        const data = optionsSheetRows[r];
        // Read current DOM values to ensure freshness
        const getByKey = (key) => {
          const c = optionsColModel.findIndex(x => x.key === key);
          return c >= 0 ? (getOptionsCell(r, c)?.textContent.trim() ?? '') : '';
        };
        const num = parseOptionNum(getByKey('num'));
        let designation = getByKey('designation');
        const sep = '—';
        if (designation.includes(sep)) designation = designation.split(sep).slice(1).join(sep).trim();
        const unit = getByKey('unit');

        const row = {
          item_id: data.item_id || null,
          option_id: data.option_id,
          num, designation, unit,
          moe: { qty: getByKey('moe.qty'), pu: getByKey('moe.pu') },
          offers: {}
        };
        for (const c of lotCompanies){
          const base = `c.${c.id}.`;
          row.offers[c.id] = {
            qty: getByKey(base+'qty'),
            pu:  getByKey(base+'pu')
          };
        }
        rows.push(row);
      }

      const result = await api(`/options/lot/${currentLot.id}/save-grid`, {
        method:'POST',
        body:{ rows, round_id: currentRound?.id },
        showLoader: false
      });

      // Sync item IDs for newly created rows
      if (result?.items) {
        for (let i=0; i<Math.min(result.items.length, optionsSheetRows.length); i++){
          if (result.items[i]?.id) optionsSheetRows[i].item_id = result.items[i].id;
        }
      }

      if (_optionsChangeGen === genAtSaveStart) {
        hasUnsavedOptionsChanges = false;
      }
      await refreshCompare({ silent: true });
      console.log('Autosave options réussi');
    } catch (err) {
      console.error('Erreur autosave options:', err);
    } finally {
      isSavingOptions = false;
      if (_optionsChangeGen !== genAtSaveStart) {
        debounceAutoSave('options-grid', autoSaveOptionsGrid, 100);
      }
    }
  }

  function attachOptionsSheetDelegates(){
    if (optionsSheetDelegatesAttached) return;
    const body = qs('#options-sheet-body');
    if (!body) return;

    body.addEventListener('focusin', (e) => {
      const td = e.target.closest('td'); if (!td) return;
      td.dataset.prev = td.textContent;
    });

    body.addEventListener('input', (e) => {
      const td = e.target.closest('td'); if (!td) return;
      const r = Number(td.dataset.r), c = Number(td.dataset.c);
      setOptionsCell(r, c, td.textContent.trim(), false);
      recalcOptionsAmountsRow(r);
      markOptionsChanged();
    });

    body.addEventListener('blur', (e) => {
      const td = e.target.closest('td'); if (!td) return;
      const prev = td.dataset.prev ?? '';
      const now = td.textContent;
      if (prev !== now) markOptionsChanged();
    }, true);

    body.addEventListener('keydown', async (e) => {
      const td = e.target.closest('td'); if (!td) return;
      const r = Number(td.dataset.r), c = Number(td.dataset.c);

      const navKeys = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter','Tab'];
      if (!navKeys.includes(e.key)) return;

      let nr = r, nc = c;
      if (e.key === 'ArrowLeft')  nc = Math.max(0, c - 1);
      if (e.key === 'ArrowRight') nc = c + 1;
      if (e.key === 'ArrowUp')    nr = Math.max(0, r - 1);
      if (e.key === 'ArrowDown')  nr = r + 1;
      if (e.key === 'Tab')        nc = c + (e.shiftKey ? -1 : 1);

      if (e.key === 'Enter'){
        e.preventDefault();
        nr = r + 1;
        // If last row, create a new option item
        if (nr >= optionsSheetRows.length){
          if (isVisionneur()) return;
          const optionId = optionsSheetRows[r]?.option_id;
          if (!optionId) return;
          try {
            const res = await api(`/options/${optionId}/items`, {
              method:'POST',
              body:{ num:'', designation:'', unit:'', moe_qty:null, moe_unit_price:null }
            });
            const newItem = { item_id: res.id, option_id: optionId, option_designation: optionsSheetRows[r]?.option_designation||'', num:'', designation:'', unit:'', moe:{qty:'',pu:''}, offers:{} };
            for (const co of lotCompanies) newItem.offers[co.id] = { u:'', qty:'', pu:'', mt:'' };
            optionsSheetRows.push(newItem);
            appendOptionsRowDOM(optionsSheetRows.length - 1, newItem);
            // Update lotOptions model
            const opt = lotOptions.find(o => Number(o.id) === Number(optionId));
            if (opt) opt.items = [...(opt.items||[]), { id: res.id, num:'', designation:'', unit:'', moe_qty:null, moe_unit_price:null, offers:[] }];
            setupOptionsSheetControls();
          } catch (err) {
            showNotify({ title:'Erreur', message: err.message, type:'error' });
            return;
          }
        }
        focusOptionsCell(nr, c);
        return;
      }

      if (navKeys.includes(e.key)){
        e.preventDefault();
        focusOptionsCell(nr, nc);
      }
    }, true);

    // Paste support
    body.addEventListener('paste', (e) => {
      const td = e.target.closest('td'); if (!td) return;
      e.preventDefault();
      const startR = Number(td.dataset.r), startC = Number(td.dataset.c);
      const text = e.clipboardData.getData('text/plain') || '';
      const delim = detectDelimiter(text);
      const lines = text.replace(/\r/g,'').split('\n');
      const grid = lines.map(l => l.split(delim));
      ensureOptionsRows(startR + grid.length);
      for (let i=0; i<grid.length; i++){
        let col = startC;
        for (let j=0; j<grid[i].length; j++){
          let guard = 0;
          while (col < optionsColModel.length && !optionsColModel[col].editable && guard++ < 100) col++;
          if (col >= optionsColModel.length) break;
          let val = String(grid[i][j]).trim();
          const colKey = optionsColModel[col]?.key || '';
          const isNum = colKey.includes('qty') || colKey.includes('pu');
          if (isNum && val !== ''){ const p = parseNum(val); if (Number.isFinite(p)) val = String(p); }
          setOptionsCell(startR+i, col, val, true);
          col++;
        }
        recalcOptionsAmountsRow(startR + i);
      }
      markOptionsChanged();
    }, true);

    optionsSheetDelegatesAttached = true;
  }

  function renderOptionsSheetTable(){
    const head = qs('#options-sheet-head');
    const body = qs('#options-sheet-body');
    if (!head || !body) return;

    buildOptionsColModel();
    buildOptionsSheetModel();

    head.innerHTML = '';
    body.innerHTML = '';

    if (optionsSheetRows.length === 0){
      body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:16px;color:var(--muted)">Aucune option disponible</td></tr>';
      return;
    }

    // Header row 1: base cols (rowSpan=2) + company groups
    const tr1 = document.createElement('tr');
    const baseCount = optionsColModel.findIndex(col => col.key.startsWith('c.'));
    const actualBaseCount = baseCount === -1 ? optionsColModel.length : baseCount;
    for (let i=0; i<actualBaseCount; i++){
      const col = optionsColModel[i];
      const th = document.createElement('th');
      th.textContent = headerLabelFor(col.key);
      th.rowSpan = 2;
      if (col.cls) th.classList.add(col.cls);
      tr1.appendChild(th);
    }
    for (let i=actualBaseCount; i<optionsColModel.length; i+=4){
      const [, cid] = optionsColModel[i].key.split('.');
      const th = document.createElement('th');
      th.textContent = companyNameFor(cid);
      th.colSpan = 4;
      th.classList.add('company-col');
      applyCompanyColumnStyle(th, cid, true);
      tr1.appendChild(th);
    }
    head.appendChild(tr1);

    // Header row 2: sub-columns per company
    const tr2 = document.createElement('tr');
    for (let i=actualBaseCount; i<optionsColModel.length; i++){
      const th = document.createElement('th');
      th.textContent = headerLabelFor(optionsColModel[i].key);
      if ((i - actualBaseCount) % 4 === 0) {
        th.classList.add('company-border');
        const [, cid] = optionsColModel[i].key.split('.');
        applyCompanyColumnStyle(th, cid);
      }
      tr2.appendChild(th);
    }
    head.appendChild(tr2);

    // Body rows
    for (let r=0; r<optionsSheetRows.length; r++){
      appendOptionsRowDOM(r, optionsSheetRows[r]);
    }

    attachOptionsSheetDelegates();
    for (let r=0; r<optionsSheetRows.length; r++) recalcOptionsAmountsRow(r);
  }
/** 1) Construire le modèle (données + colonnes) puis rendu initial */
function buildSheetModel(raw){
  const moeByItem = new Map(raw.moe.map(m => [Number(m.item_id), m]));
  const offersByItem = new Map();
  for (const o of raw.offers) {
    if (!offersByItem.has(o.item_id)) offersByItem.set(o.item_id, new Map());
    offersByItem.get(o.item_id).set(o.company_id, o);
  }

  sheetRows = raw.items.map((it) => {
    const itemId = Number(it.id);
    const moe = moeByItem.get(itemId) || {};
    const row = {
      item_id: itemId,
      num: it.num || '',
      designation: it.designation || '',
      unit: it.unit || '',
      source_company_id: it.source_company_id || null,
      parent_item_id: it.parent_item_id || null,
      parent_num: it.parent_num || null,
      parent_designation: it.parent_designation || null,
      moe: { 
        qty: moe.qty != null ? String(moe.qty) : '', 
        pu: moe.unit_price != null ? String(moe.unit_price) : '',
        mt: moe.amount != null ? String(moe.amount) : ''
      },
      offers: {}
    };
    for (const c of lotCompanies) {
      const companyId = Number(c.id);
      const o = offersByItem.get(itemId)?.get(companyId) || {};
      row.offers[companyId] = { 
        u: o.unit ?? '', 
        qty: o.qty != null ? String(o.qty) : '', 
        pu: o.unit_price != null ? String(o.unit_price) : '',
        mt: o.amount != null ? String(o.amount) : '',
        comment: o.comment ?? ''
      };
    }
    return row;
  });

  if (sheetRows.length === 0) {
    const blank = { item_id:null, num:'', designation:'', unit:'', moe:{qty:'', pu:''}, offers:{} };
    for (const c of lotCompanies) blank.offers[c.id] = { u:'', qty:'', pu:'', mt:'' };
    sheetRows.push(blank);
  }

  buildColModel();
  renderSheetInitial();
  updateSheetLegend();
}

function buildColModel(){
  const entrepriseMode = isEntreprise();
  
  // base colonnes (sans MOE si entreprise)
  colModel = [
    { key:'num',        editable:true },
    { key:'designation',editable:true,  wide:true },
    { key:'unit',       editable:true }
  ];
  
  // Ajouter les colonnes MOE seulement si pas entreprise
  if (!entrepriseMode) {
    colModel.push(
      { key:'moe.qty',    editable:true,  cls:'moe-col' },
      { key:'moe.pu',     editable:true,  cls:'moe-col' },
      { key:'moe.mt',     editable:false, cls:'moe-col' }
    );
  }
  
  // groupes par entreprise : 4 colonnes
  for (const c of lotCompanies){
    colModel.push({ key:`c.${c.id}.u`,   editable:true  });
    colModel.push({ key:`c.${c.id}.qty`, editable:true  });
    colModel.push({ key:`c.${c.id}.pu`,  editable:true  });
    colModel.push({ key:`c.${c.id}.mt`,  editable:false });
  }
}

function headerLabelFor(key){
  if (key === 'num') return 'Num';
  if (key === 'designation') return 'Désignation';
  if (key === 'unit') return 'Unité';
  if (key === 'moe.qty') return 'Quantité MOE';
  if (key === 'moe.pu')  return 'PU MOE';
  if (key === 'moe.mt')  return 'Mt MOE';
  if (key.startsWith('c.')){
    const [, cid, sub] = key.split('.');
    if (sub === 'u')  return 'Unité';
    if (sub === 'qty')return 'Qté';
    if (sub === 'pu') return 'PU';
    if (sub === 'mt') return 'Mt';
  }
  return key;
}
function companyNameFor(cid){
  const c = lotCompanies.find(x => String(x.id) === String(cid));
  return c ? c.name : `C${cid}`;
}

function createBlankSheetRow(){
  const blank = { item_id:null, num:'', designation:'', unit:'', moe:{qty:'', pu:''}, offers:{} };
  for (const c of lotCompanies) blank.offers[c.id] = { u:'', qty:'', pu:'', mt:'' };
  return blank;
}

/** Rendu initial sans réutiliser pendant les collages */
function renderSheetInitial(){
  const head = qs('#sheet-head');
  const body = qs('#sheet-body');
  head.innerHTML = ''; body.innerHTML = '';
  clearSheetSelection();

  // top header: base (rowSpan=2) + groupes
  const tr1 = document.createElement('tr');
  
  // En-tête pour la colonne de suppression
  const thDelete = document.createElement('th');
  thDelete.textContent = '';
  thDelete.rowSpan = 2;
  thDelete.style.cssText = 'text-align:center;width:40px';
  tr1.appendChild(thDelete);
  
  // Trouver le nombre de colonnes de base (avant les colonnes entreprises)
  // Colonnes de base : num, designation, unit, [moe.qty, moe.pu, moe.mt si pas entreprise]
  const baseCount = colModel.findIndex(col => col.key.startsWith('c.'));
  const actualBaseCount = baseCount === -1 ? colModel.length : baseCount;
  
  // Colonnes de base en rowSpan=2
  for (let i=0; i<actualBaseCount; i++){
    const col = colModel[i];
    const th = document.createElement('th');
    th.textContent = headerLabelFor(col.key);
    th.rowSpan = 2;
    if (col.cls) th.classList.add(col.cls);
    tr1.appendChild(th);
  }
  
  // groupes par entreprise (4 colonnes)
  for (let i=actualBaseCount; i<colModel.length; i+=4){
    const col = colModel[i];
    const [, cid] = col.key.split('.');
    const th = document.createElement('th');
    th.textContent = companyNameFor(cid);
    th.colSpan = 4;
    th.classList.add('company-col');
    applyCompanyColumnStyle(th, cid, true);
    tr1.appendChild(th);
  }
  head.appendChild(tr1);

  // bottom header: libellés des 4 colonnes par entreprise
  const tr2 = document.createElement('tr');
  for (let i=actualBaseCount; i<colModel.length; i++){
    const th = document.createElement('th');
    th.textContent = headerLabelFor(colModel[i].key);
    if ((i - actualBaseCount) % 4 === 0) {
      th.classList.add('company-border');
      const [, cid] = colModel[i].key.split('.');
      applyCompanyColumnStyle(th, cid);
    }
    tr2.appendChild(th);
  }
  head.appendChild(tr2);

  // lignes existantes
  for (let r=0; r<sheetRows.length; r++){
    appendRowDOM(r, sheetRows[r]);
  }

  // délégation d’événements (une seule fois)
  attachSheetDelegates();
  // recalcul initial
  for (let r=0; r<sheetRows.length; r++) recalcRowAmountsRow(r);
}

/** appendRowDOM : ne rerend PAS tout */
function appendRowDOM(rIndex, data){
  const tr = document.createElement('tr');
  
  // Colonne de suppression (première colonne)
  const tdDelete = document.createElement('td');
  tdDelete.style.cssText = 'text-align:center;padding:4px 8px;width:40px;flex-shrink:0';
  tdDelete.classList.add('cell-readonly');
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn ghost btn-delete-row';
  deleteBtn.style.cssText = 'padding:4px 6px;font-size:0.9rem';
  deleteBtn.innerHTML = `<svg class="icon" aria-hidden="true" style="width:16px;height:16px"><use href="./assets/icons.svg#icon-trash"></use></svg>`;
  deleteBtn.title = 'Supprimer cette ligne';
  tdDelete.appendChild(deleteBtn);
  tr.appendChild(tdDelete);
  
  for (let c=0;c<colModel.length;c++){
    const col = colModel[c];
    const td = document.createElement('td');
    td.dataset.r = String(rIndex);
    td.dataset.c = String(c);
    if (col.editable) td.contentEditable = 'true'; else td.classList.add('cell-readonly');
    if (col.wide) td.style.minWidth = '320px';
    if (col.key.startsWith('c.')) {
      const [, cid, sub] = col.key.split('.');
      if (sub === 'u') applyCompanyColumnStyle(td, cid);
    }
    if (col.key.startsWith('c.') && col.key.endsWith('.mt')) {
      const [, cid] = col.key.split('.');
      const o = data.offers?.[cid] || {};
      const moeHasTotal = parseNum(data.moe?.qty) > 0 && parseNum(data.moe?.pu) > 0;
      const isUnanswered = moeHasTotal && isOfferUnanswered(o.qty, o.pu, o.mt);
      const isUnexpected = isOfferUnexpected(moeHasTotal, o.qty, o.pu);
      const cellComment = isUnanswered && unansweredConfig.comment ? unansweredConfig.comment : (o.comment || '');
      td.innerHTML = amountCellHtml(o.qty, o.pu, cellComment, o.mt);
      if (isUnanswered) {
        applyUnansweredStyle(td, unansweredConfig.color);
        if (unansweredConfig.comment) td.title = unansweredConfig.comment;
      } else if (isUnexpected) {
        applyUnansweredStyle(td, unexpectedAnswerMarker.color);
        td.title = unexpectedAnswerMarker.label;
      }
    } else if (col.key.startsWith('c.')) {
      const [, cid] = col.key.split('.');
      const o = data.offers?.[cid] || {};
      const moeHasTotal = parseNum(data.moe?.qty) > 0 && parseNum(data.moe?.pu) > 0;
      const isUnanswered = moeHasTotal && isOfferUnanswered(o.qty, o.pu, o.mt);
      const isUnexpected = isOfferUnexpected(moeHasTotal, o.qty, o.pu);
      td.textContent = valueForCell(data, col.key);
      if (isUnanswered) {
        applyUnansweredStyle(td, unansweredConfig.color);
        if (unansweredConfig.comment) td.title = unansweredConfig.comment;
      } else if (isUnexpected) {
        applyUnansweredStyle(td, unexpectedAnswerMarker.color);
        td.title = unexpectedAnswerMarker.label;
      }
    } else {
      td.textContent = valueForCell(data, col.key);
    }
    tr.appendChild(td);
  }
  qs('#sheet-body').appendChild(tr);
}
function valueForCell(row, key){
  if (!row) return '';
  if (key === 'num') return row.num ?? '';
  if (key === 'designation') return row.designation ?? '';
  if (key === 'unit') return row.unit ?? '';
  if (key === 'moe.qty') return row.moe?.qty ?? '';
  if (key === 'moe.pu')  return row.moe?.pu  ?? '';
  if (key === 'moe.mt')  return row.moe?.mt ?? '';
  if (key.startsWith('c.')){
    const [, cid, sub] = key.split('.');
    const o = row.offers?.[cid] || {};
    if (sub === 'mt') return amountOf(o.qty, o.pu) || (o.mt ?? '');
    return o[sub] ?? '';
  }
  return '';
}

/** ====== Mutations incrémentales ====== */
function ensureRows(n){
  // compléter sheetRows + DOM jusqu’à n lignes
  while (qsa('#sheet-body tr').length < n) {
    const blank = { item_id:null, num:'', designation:'', unit:'', moe:{qty:'', pu:''}, offers:{} };
    for (const c of lotCompanies) blank.offers[c.id] = { u:'', qty:'', pu:'', mt:'' };
    sheetRows.push(blank);
    const rIndex = sheetRows.length - 1;
    appendRowDOM(rIndex, blank);
    // recalcul (vide au départ, mais garde la logique)
    recalcRowAmountsRow(rIndex);
  }
}
function getCell(r, c){
  const rowEl = qsa('#sheet-body tr')[r];
  if (!rowEl) return null;
  return rowEl.querySelector(`td[data-c="${c}"]`) || rowEl.children[c] || null;
}
function setCell(r, c, text, updateDOM = true){
  const td = getCell(r, c); if (!td) return;
  
  // Ne mettre à jour le DOM que si demandé (pas pendant la saisie)
  if (updateDOM) {
    td.textContent = text ?? '';
  }
  
  // mettre à jour le modèle
  const key = colModel[c].key;
  const row = sheetRows[r] || (sheetRows[r] = { item_id:null, num:'', designation:'', unit:'', moe:{qty:'', pu:''}, offers:{} });
  if (key === 'num') row.num = text;
  else if (key === 'designation') row.designation = text;
  else if (key === 'unit') row.unit = text;
  else if (key === 'moe.qty') { row.moe.qty = text; }
  else if (key === 'moe.pu')  { row.moe.pu  = text; }
  else if (key.startsWith('c.')){
    const [, cid, sub] = key.split('.');
    row.offers[cid] = row.offers[cid] || { u:'', qty:'', pu:'' };
    if (sub !== 'mt') row.offers[cid][sub] = text;
  }
}

/** recalcul par ligne (MOE + chaque entreprise) */
function recalcRowAmountsRow(r){
  const rowEl = qsa('#sheet-body tr')[r]; if (!rowEl) return;
  // MOE
  const cQty = colModel.findIndex(c => c.key === 'moe.qty');
  const cPu  = colModel.findIndex(c => c.key === 'moe.pu');
  const cMt  = colModel.findIndex(c => c.key === 'moe.mt');
  // MOE values for unanswered check
  const moeQtyVal = getCell(r,cQty)?.textContent.trim();
  const moePuVal  = getCell(r,cPu )?.textContent.trim();
  const moeHasTotal = parseNum(moeQtyVal) > 0 && parseNum(moePuVal) > 0;
  if (cQty>=0 && cPu>=0 && cMt>=0){
    const qty = moeQtyVal;
    const pu  = moePuVal;
    const mt  = getCell(r,cMt );
    if (mt) mt.textContent = sheetRows[r]?.moe?.mt ?? '';
  }
  // Entreprises
  for (const c of lotCompanies){
    const base = `c.${c.id}.`;
    const ciQty = colModel.findIndex(x => x.key === base+'qty');
    const ciPu  = colModel.findIndex(x => x.key === base+'pu');
    const ciMt  = colModel.findIndex(x => x.key === base+'mt');
    const ciU   = colModel.findIndex(x => x.key === base+'u');
    if (ciQty>=0 && ciPu>=0 && ciMt>=0){
      const qty = getCell(r,ciQty)?.textContent.trim();
      const pu  = getCell(r,ciPu )?.textContent.trim();
      const mt  = getCell(r,ciMt );
      if (mt) {
        const existingComment = sheetRows[r]?.offers?.[c.id]?.comment || '';
        const existingAmount = sheetRows[r]?.offers?.[c.id]?.mt || '';
        const isUnanswered = moeHasTotal && isOfferUnanswered(qty, pu, existingAmount);
        const isUnexpected = isOfferUnexpected(moeHasTotal, qty, pu);
        const cellComment = isUnanswered && unansweredConfig.comment ? unansweredConfig.comment : existingComment;
        mt.innerHTML = amountCellHtml(qty, pu, cellComment, existingAmount);
        if (isUnanswered) {
          applyUnansweredStyle(mt, unansweredConfig.color);
          mt.title = unansweredConfig.comment || '';
        } else if (isUnexpected) {
          applyUnansweredStyle(mt, unexpectedAnswerMarker.color);
          mt.title = unexpectedAnswerMarker.label;
        } else {
          removeUnansweredStyle(mt);
          mt.title = '';
        }
        const qtyCell = getCell(r, ciQty);
        const puCell  = getCell(r, ciPu);
        if (qtyCell) {
          if (isUnanswered) { applyUnansweredStyle(qtyCell, unansweredConfig.color); qtyCell.title = unansweredConfig.comment || ''; }
          else if (isUnexpected) { applyUnansweredStyle(qtyCell, unexpectedAnswerMarker.color); qtyCell.title = unexpectedAnswerMarker.label; }
          else { removeUnansweredStyle(qtyCell); qtyCell.title = ''; }
        }
        if (puCell)  {
          if (isUnanswered) { applyUnansweredStyle(puCell, unansweredConfig.color); puCell.title = unansweredConfig.comment || ''; }
          else if (isUnexpected) { applyUnansweredStyle(puCell, unexpectedAnswerMarker.color); puCell.title = unexpectedAnswerMarker.label; }
          else { removeUnansweredStyle(puCell); puCell.title = ''; }
        }
        if (ciU >= 0) {
          const uCell = getCell(r, ciU);
          if (uCell) {
            if (isUnanswered) { applyUnansweredStyle(uCell, unansweredConfig.color); uCell.title = unansweredConfig.comment || ''; }
            else if (isUnexpected) { applyUnansweredStyle(uCell, unexpectedAnswerMarker.color); uCell.title = unexpectedAnswerMarker.label; }
            else { removeUnansweredStyle(uCell); applyCompanyColumnStyle(uCell, c.id); uCell.title = ''; }
          }
        }
      }
    }
  }
}

/** focus cellule (ajoute lignes si nécessaire), saute readonly */
function focusCell(r, c, options = {}){
  if (r < 0) r = 0;
  if (c < 0) c = 0;
  ensureRows(r+1);
  if (c >= colModel.length) c = colModel.length - 1;

  // sauter les colonnes non éditables
  let guard = 0;
  while (!colModel[c]?.editable && guard++ < 100) c++;
  if (c >= colModel.length) c = colModel.findIndex(x => x.editable);
  const td = getCell(r, c);
  if (td){
    td.focus();
    const range = document.createRange(); range.selectNodeContents(td); range.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    if (!options.keepSelection) {
      setSheetSelectionRange({ r, c }, { r, c }, false);
    }
  }
}

/* ====== Délégation d’événements (pas de listeners par cellule) ====== */
function pointFromSheetCell(td){
  if (!td || !td.matches?.('#sheet-body td[data-r][data-c]')) return null;
  const r = Number(td.dataset.r);
  const c = Number(td.dataset.c);
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  return { r, c };
}

function sameSheetPoint(a, b){
  return !!a && !!b && a.r === b.r && a.c === b.c;
}

function getSheetSelectionRange(){
  if (!sheetSelection.anchor || !sheetSelection.focus) return null;
  return {
    minR: Math.min(sheetSelection.anchor.r, sheetSelection.focus.r),
    maxR: Math.max(sheetSelection.anchor.r, sheetSelection.focus.r),
    minC: Math.min(sheetSelection.anchor.c, sheetSelection.focus.c),
    maxC: Math.max(sheetSelection.anchor.c, sheetSelection.focus.c)
  };
}

function sheetSelectionContainsPoint(point, range = getSheetSelectionRange()){
  if (!point || !range) return false;
  return point.r >= range.minR && point.r <= range.maxR && point.c >= range.minC && point.c <= range.maxC;
}

function sheetSelectionIsRange(){
  const range = getSheetSelectionRange();
  if (!range || !sheetSelection.explicit) return false;
  return range.minR !== range.maxR || range.minC !== range.maxC;
}

function clearSheetSelection(){
  qsa('#sheet-body td.sheet-cell-selected, #sheet-body td.sheet-cell-active').forEach(td => {
    td.classList.remove('sheet-cell-selected', 'sheet-cell-active');
  });
  qs('#sheet-table')?.classList.remove('is-selecting');
  sheetSelection = { anchor:null, focus:null, explicit:false, mouseDown:false, dragging:false };
}

function setSheetSelectionRange(anchor, focus, explicit = false){
  if (!anchor || !focus) {
    clearSheetSelection();
    return;
  }

  sheetSelection.anchor = { r: anchor.r, c: anchor.c };
  sheetSelection.focus = { r: focus.r, c: focus.c };
  sheetSelection.explicit = !!explicit;

  qsa('#sheet-body td.sheet-cell-selected, #sheet-body td.sheet-cell-active').forEach(td => {
    td.classList.remove('sheet-cell-selected', 'sheet-cell-active');
  });

  const range = getSheetSelectionRange();
  if (!range) return;
  for (let r = range.minR; r <= range.maxR; r++) {
    for (let c = range.minC; c <= range.maxC; c++) {
      const td = getCell(r, c);
      if (!td) continue;
      if (sheetSelection.explicit) td.classList.add('sheet-cell-selected');
      if (r === focus.r && c === focus.c) td.classList.add('sheet-cell-active');
    }
  }
}

function getSheetClipboardValue(r, c){
  const key = colModel[c]?.key;
  if (!key) return '';
  const row = sheetRows[r];
  if (key.endsWith('.mt') || key === 'moe.mt') return valueForCell(row, key);
  const td = getCell(r, c);
  return (td?.textContent ?? valueForCell(row, key) ?? '').replace(/\u00A0/g, ' ');
}

function sheetSelectionToClipboardText(range = getSheetSelectionRange()){
  if (!range) return '';
  const rows = [];
  for (let r = range.minR; r <= range.maxR; r++) {
    const cells = [];
    for (let c = range.minC; c <= range.maxC; c++) {
      cells.push(String(getSheetClipboardValue(r, c)).trim());
    }
    rows.push(cells.join('\t'));
  }
  return rows.join('\n');
}

function getActiveSheetPoint(){
  return pointFromSheetCell(document.activeElement?.closest?.('#sheet-body td[data-r][data-c]'));
}

function getEffectiveSheetRange(point = getActiveSheetPoint()){
  const range = getSheetSelectionRange();
  if (sheetSelection.explicit && range && (!point || sheetSelectionContainsPoint(point, range))) return range;
  if (point) return { minR: point.r, maxR: point.r, minC: point.c, maxC: point.c };
  return range;
}

async function copyTextToClipboard(text){
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

function normalizeSheetPastedValue(colKey, value){
  let val = String(value ?? '').trim();
  const isNumericCol = colKey.includes('qty') || colKey.includes('pu');
  if (isNumericCol && val !== '') {
    const parsed = parseNum(val);
    if (Number.isFinite(parsed)) val = String(parsed);
  }
  return val;
}

function applySheetClipboardGrid(startR, startC, grid){
  ensureRows(startR + grid.length);
  let wrote = false;
  let maxR = startR;
  let maxC = startC;

  for (let i = 0; i < grid.length; i++) {
    let col = startC;
    for (let j = 0; j < grid[i].length; j++) {
      let guard = 0;
      while (col < colModel.length && !colModel[col].editable && guard++ < 100) col++;
      if (col >= colModel.length) break;

      const cellTarget = getCell(startR + i, col);
      if (!cellTarget) break;
      const val = normalizeSheetPastedValue(colModel[col]?.key || '', grid[i][j]);
      const prev = cellTarget.textContent;

      setCell(startR + i, col, val, true);
      cellTarget.dataset.prev = val;
      if (prev !== val) {
        pushUndo({ r:startR + i, c:col, key: colModel[col].key, prev, next: val });
        redoStack.length = 0;
      }
      wrote = true;
      maxR = Math.max(maxR, startR + i);
      maxC = Math.max(maxC, col);
      col++;
    }
    recalcRowAmountsRow(startR + i);
  }

  if (wrote) {
    setSheetSelectionRange({ r:startR, c:startC }, { r:maxR, c:maxC }, true);
    markAsChanged();
  }
}

function clearSheetSelectionCells(range = getSheetSelectionRange()){
  if (!range) return;
  const touchedRows = new Set();

  for (let r = range.minR; r <= range.maxR; r++) {
    for (let c = range.minC; c <= range.maxC; c++) {
      if (!colModel[c]?.editable) continue;
      const td = getCell(r, c);
      if (!td) continue;
      const prev = td.textContent;
      if (prev === '') continue;
      setCell(r, c, '', true);
      td.dataset.prev = '';
      pushUndo({ r, c, key: colModel[c].key, prev, next: '' });
      redoStack.length = 0;
      touchedRows.add(r);
    }
  }

  touchedRows.forEach(r => recalcRowAmountsRow(r));
  if (touchedRows.size > 0) markAsChanged();
}

function writeSheetSelectionClipboard(e, cut = false){
  const range = getEffectiveSheetRange(pointFromSheetCell(e.target?.closest?.('#sheet-body td[data-r][data-c]')));
  if (!range) return false;
  const text = sheetSelectionToClipboardText(range);
  if (e.clipboardData) {
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  }
  if (cut) clearSheetSelectionCells(range);
  return true;
}

let delegatesAttached = false;
function attachSheetDelegates(){
  if (delegatesAttached) return;
  const body = qs('#sheet-body');

  body.addEventListener('focusin', (e) => {
    const td = e.target.closest('td'); if (!td) return;
    td.dataset.prev = td.textContent;
    const point = pointFromSheetCell(td);
    if (point && !sheetSelection.explicit && !sheetSelection.dragging) {
      setSheetSelectionRange(point, point, false);
    }
  });

  // commit & undo tracking à la sortie de cellule
  body.addEventListener('blur', (e) => {
    const td = e.target.closest('td'); if (!td) return;
    const r = Number(td.dataset.r), c = Number(td.dataset.c);
    const prev = td.dataset.prev ?? '';
    const now  = td.textContent;
    if (prev !== now) { pushUndo({ r, c, key: colModel[c].key, prev, next: now }); redoStack.length = 0; }
  }, true);

  // input = maj modèle + recalcul (sans toucher au DOM pour ne pas déplacer le curseur)
  body.addEventListener('input', (e) => {
    const td = e.target.closest('td'); if (!td) return;
    const r = Number(td.dataset.r), c = Number(td.dataset.c);
    setCell(r, c, td.textContent.trim(), false); // false = ne pas modifier le DOM
    recalcRowAmountsRow(r);
  });

  // navigation clavier
  body.addEventListener('keydown', async (e) => {
    const td = e.target.closest('td'); if (!td) return;
    const r = Number(td.dataset.r), c = Number(td.dataset.c);
    const ctrl = e.ctrlKey || e.metaKey;
    const point = { r, c };

    // Undo/Redo
    if (ctrl && (e.key==='z' || e.key==='Z') && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (ctrl && (e.key==='y' || (e.shiftKey && (e.key==='Z'||e.key==='z')))) { e.preventDefault(); redo(); return; }
    if (ctrl && (e.key==='c' || e.key==='C')) {
      e.preventDefault();
      const range = getEffectiveSheetRange(point);
      await copyTextToClipboard(sheetSelectionToClipboardText(range));
      return;
    }
    if (ctrl && (e.key==='x' || e.key==='X')) {
      e.preventDefault();
      const range = getEffectiveSheetRange(point);
      await copyTextToClipboard(sheetSelectionToClipboardText(range));
      clearSheetSelectionCells(range);
      return;
    }
    if (ctrl && (e.key==='a' || e.key==='A')) {
      e.preventDefault();
      const firstEditable = colModel.findIndex(col => col.editable);
      let lastEditable = colModel.length - 1;
      while (lastEditable >= 0 && !colModel[lastEditable]?.editable) lastEditable--;
      if (firstEditable >= 0 && lastEditable >= firstEditable) {
        setSheetSelectionRange({ r:0, c:firstEditable }, { r:Math.max(0, sheetRows.length - 1), c:lastEditable }, true);
      }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sheetSelection.explicit) {
      e.preventDefault();
      clearSheetSelectionCells(getEffectiveSheetRange(point));
      return;
    }
    if (e.key === 'Escape' && sheetSelection.explicit) {
      e.preventDefault();
      setSheetSelectionRange({ r, c }, { r, c }, false);
      return;
    }

    const navKeys = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter','Tab'];
    if (!navKeys.includes(e.key)) return;

    // commit avant navigation
    const prev = td.dataset.prev ?? '';
    const now  = td.textContent;
    if (prev !== now) { pushUndo({ r, c, key: colModel[c].key, prev, next: now }); redoStack.length = 0; td.dataset.prev = now; }

    let nr = r, nc = c;
    if (e.key === 'ArrowLeft')  nc = Math.max(0, c - 1);
    if (e.key === 'ArrowRight') nc = Math.min(colModel.length - 1, c + 1);
    if (e.key === 'ArrowUp')    nr = Math.max(0, r - 1);
    if (e.key === 'ArrowDown')  nr = r + 1;
    if (e.key === 'Enter')      nr = r + 1;
    if (e.key === 'Tab')        nc = c + (e.shiftKey ? -1 : 1);

    if (e.shiftKey && e.key.startsWith('Arrow')) {
      e.preventDefault();
      ensureRows(nr + 1);
      const anchor = sheetSelection.anchor || { r, c };
      setSheetSelectionRange(anchor, { r:nr, c:nc }, true);
      getCell(nr, nc)?.focus({ preventScroll:true });
      window.getSelection()?.removeAllRanges();
      return;
    }

    e.preventDefault();
    focusCell(nr, nc);
  }, true);

  body.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const td = e.target.closest('#sheet-body td[data-r][data-c]');
    const point = pointFromSheetCell(td);
    if (!point) return;

    if (e.shiftKey && sheetSelection.anchor) {
      e.preventDefault();
      setSheetSelectionRange(sheetSelection.anchor, point, true);
      td.focus({ preventScroll:true });
      window.getSelection()?.removeAllRanges();
      return;
    }

    sheetSelection.mouseDown = true;
    sheetSelection.dragging = false;
    setSheetSelectionRange(point, point, false);
  });

  body.addEventListener('mouseover', (e) => {
    if (!sheetSelection.mouseDown || e.buttons !== 1 || !sheetSelection.anchor) return;
    const td = e.target.closest('#sheet-body td[data-r][data-c]');
    const point = pointFromSheetCell(td);
    if (!point || sameSheetPoint(point, sheetSelection.focus)) return;

    e.preventDefault();
    sheetSelection.dragging = true;
    qs('#sheet-table')?.classList.add('is-selecting');
    setSheetSelectionRange(sheetSelection.anchor, point, true);
    window.getSelection()?.removeAllRanges();
  });

  body.addEventListener('selectstart', (e) => {
    if (sheetSelection.mouseDown && sheetSelection.dragging) e.preventDefault();
  });

  body.addEventListener('copy', (e) => {
    writeSheetSelectionClipboard(e, false);
  }, true);

  body.addEventListener('cut', (e) => {
    writeSheetSelectionClipboard(e, true);
  }, true);

  // collage multi-cellules (Excel / CSV ; ; , auto)
  body.addEventListener('paste', (e) => {
    const td = e.target.closest('td'); if (!td) return;
    e.preventDefault();

    const point = pointFromSheetCell(td);
    const selectedRange = getSheetSelectionRange();
    const useSelectionStart = sheetSelection.explicit && sheetSelectionContainsPoint(point, selectedRange);
    const startR = useSelectionStart ? selectedRange.minR : Number(td.dataset.r);
    const startC = useSelectionStart ? selectedRange.minC : Number(td.dataset.c);

    const text = e.clipboardData.getData('text/plain') || '';
    if (!text) return;
    const delim = detectDelimiter(text);
    // Garder toutes les lignes, même vides, pour préserver l'espacement DPGF
    const lines = text.replace(/\r/g,'').split('\n');
    if (!lines.length) return;
    const grid = lines.map(l => l.split(delim));
    applySheetClipboardGrid(startR, startC, grid);
    return;
    for (let i = 0; i < grid.length; i++) {
      let col = startC;
      for (let j = 0; j < grid[i].length; j++) {
        // sauter colonnes non éditables (ex: Mt)
        let guard = 0;
        while (col < colModel.length && !colModel[col].editable && guard++ < 100) col++;
        if (col >= colModel.length) break;

        let val = String(grid[i][j]).trim();
        const cellTarget = getCell(startR+i, col);
        if (!cellTarget) break;
        
        // Nettoyer automatiquement les valeurs numériques (colonnes qty, pu)
        const colKey = colModel[col]?.key || '';
        const isNumericCol = colKey.includes('qty') || colKey.includes('pu');
        
        if (isNumericCol && val !== '') {
          const parsed = parseNum(val);
          // Si la conversion réussit, utiliser le nombre formaté proprement
          if (Number.isFinite(parsed)) {
            val = String(parsed);
          }
          // Sinon, laisser la valeur telle quelle (sera validée à la sauvegarde)
        }
        
        const prev = cellTarget.textContent;

        setCell(startR+i, col, val, true); // updateDOM = true pour le collage
        if (prev !== val) { pushUndo({ r:startR+i, c:col, key: colModel[col].key, prev, next: val }); redoStack.length = 0; }
        col++;
      }
      recalcRowAmountsRow(startR + i);
    }
    
    // Marquer comme modifié après collage
    markAsChanged();
  }, true);

  // Suppression de lignes (boutons de suppression)
  body.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.btn-delete-row');
    if (!deleteBtn) return;
    
    // Calculer l'indice de la ligne dynamiquement
    const tr = deleteBtn.closest('tr');
    if (!tr) return;
    
    const rows = qsa('#sheet-body tr');
    const rIndex = Array.from(rows).indexOf(tr);
    if (rIndex === -1) return;
    
    deleteRow(rIndex);
  });

  document.addEventListener('mouseup', () => {
    sheetSelection.mouseDown = false;
    sheetSelection.dragging = false;
    qs('#sheet-table')?.classList.remove('is-selecting');
  });

  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('#sheet-table') || e.target.closest('#sheet-actions')) return;
    clearSheetSelection();
  }, true);

  delegatesAttached = true;
}

function detectDelimiter(sample){
  if (sample.includes('\t')) return '\t';
  const sc = (sample.split(';').length-1), cc = (sample.split(',').length-1);
  return sc >= cc ? ';' : ',';
}

/* ====== Indicateur changements non sauvegardés ====== */
let hasUnsavedChanges = false;
let isSaving = false;
let _gridChangeGen = 0;

function applySavedGridItemIds(result) {
  if (!result || !Array.isArray(result.items)) return;
  result.items.forEach((item, fallbackIndex) => {
    const rowIndex = Number.isInteger(item?.rowIndex) ? item.rowIndex : fallbackIndex;
    if (sheetRows[rowIndex] && item?.id) {
      sheetRows[rowIndex].item_id = item.id;
    }
  });
}

function waitForGridSaveCompletion(timeoutMs = 5000) {
  if (!isSaving) return Promise.resolve();
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (!isSaving || Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
  });
}

function markAsChanged() {
  hasUnsavedChanges = true;
  _gridChangeGen++;
  updateSaveButton();
  // Déclencher autosave avec debounce
  debounceAutoSave('grid', autoSaveGrid, 800);
}

function updateSaveButton() {
  const btn = qs('#save-grid');
  if (!btn) return;
  if (hasUnsavedChanges) {
    btn.innerHTML = `${icon('save')}Sauvegarder`;
    btn.classList.add('btn-unsaved');
  } else {
    btn.innerHTML = `${icon('check')}Sauvegardé`;
    btn.classList.remove('btn-unsaved');
  }
}

/* ====== Undo/Redo ====== */
function pushUndo(ch){ 
  undoStack.push(ch);
  markAsChanged();
}
function undo(){
  const ch = undoStack.pop(); if (!ch) return;
  redoStack.push(ch);
  setCell(ch.r, ch.c, ch.prev);
  const td = getCell(ch.r, ch.c); if (td) td.dataset.prev = td.textContent;
  recalcRowAmountsRow(ch.r);
  markAsChanged();
}
function redo(){
  const ch = redoStack.pop(); if (!ch) return;
  undoStack.push(ch);
  setCell(ch.r, ch.c, ch.next);
  const td = getCell(ch.r, ch.c); if (td) td.dataset.prev = td.textContent;
  recalcRowAmountsRow(ch.r);
  markAsChanged();
}

/* ====== Actions édition ====== */
function renderLotCompanies(){
  const wrap = qs('#lot-companies'); if (!wrap) return;
  wrap.innerHTML = '';
  for (const c of lotCompanies) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    // Appliquer la couleur de l'entreprise en bordure
    if (c.color) {
      chip.style.borderLeft = `4px solid ${c.color}`;
      chip.style.background = `${c.color}15`;
    }
    if (!isEntreprise()) {
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = c.color || '#6b7280';
      colorInput.title = 'Couleur';
      colorInput.style.cssText = 'width:18px;height:18px;border:none;cursor:pointer;padding:0;background:none;vertical-align:middle;margin-right:4px';
      chip.appendChild(colorInput);

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'company-chip-name-input';
      nameInput.value = c.name || '';
      nameInput.title = c.original_name && c.original_name !== c.name ? `Nom d'origine : ${c.original_name}` : 'Nom affiché';
      nameInput.dataset.originalValue = c.name || '';
      chip.appendChild(nameInput);

      const removeButton = document.createElement('button');
      removeButton.dataset.id = c.id;
      removeButton.title = 'Retirer';
      removeButton.textContent = '×';
      chip.appendChild(removeButton);
      // Color picker
      colorInput.addEventListener('change', async (e) => {
        const newColor = e.target.value;
        try {
          await api(`/lots/companies/${c.id}/color`, { method:'PATCH', body:{ color: newColor } });
          c.color = newColor;
          renderLotCompanies();
          refreshCompare();
        } catch (err) {
          showNotify({ title:'Erreur', message:'Couleur: ' + err.message, type:'error' });
        }
      });
      const saveDisplayName = async () => {
        const nextName = nameInput.value.trim();
        const previousName = nameInput.dataset.originalValue || '';
        if (!nextName) {
          nameInput.value = previousName;
          return;
        }
        if (nextName === previousName) return;

        nameInput.disabled = true;
        try {
          const previousId = c.id;
          const updated = await api(`/lots/${currentLot.id}/companies/${c.id}/display-name`, {
            method: 'PATCH',
            body: { name: nextName }
          });
          const nextCompany = {
            ...c,
            id: updated.id || c.id,
            name: updated.name || nextName,
            original_name: updated.original_name || updated.name || c.original_name || nextName,
            display_name: updated.display_name || null,
            color: updated.color || c.color || null,
            email: updated.email || c.email || null
          };

          const existingIndex = lotCompanies.findIndex(company => Number(company.id) === Number(nextCompany.id));
          const previousIndex = lotCompanies.findIndex(company => Number(company.id) === Number(previousId));
          if (existingIndex >= 0 && Number(nextCompany.id) !== Number(previousId)) {
            lotCompanies[existingIndex] = { ...lotCompanies[existingIndex], ...nextCompany };
            if (previousIndex >= 0) lotCompanies.splice(previousIndex, 1);
          } else if (previousIndex >= 0) {
            lotCompanies[previousIndex] = nextCompany;
          }

          for (const row of sheetRows) {
            if (Number(row?.source_company_id) === Number(previousId)) row.source_company_id = nextCompany.id;
            if (row?.offers && previousId !== nextCompany.id) {
              if (!row.offers[nextCompany.id] && row.offers[previousId]) row.offers[nextCompany.id] = row.offers[previousId];
              delete row.offers[previousId];
            }
          }

          nameInput.dataset.originalValue = nextCompany.name || '';
          nameInput.value = nextCompany.name || '';
          renderLotCompanies();
          buildColModel();
          renderSheetInitial();
          refreshCompare();
        } catch (err) {
          nameInput.value = previousName;
          showNotify({ title:'Erreur', message:'Nom entreprise: ' + err.message, type:'error' });
        } finally {
          nameInput.disabled = false;
        }
      };

      nameInput.addEventListener('blur', saveDisplayName);
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          nameInput.blur();
        } else if (e.key === 'Escape') {
          nameInput.value = nameInput.dataset.originalValue || '';
          nameInput.blur();
        }
      });

      removeButton.addEventListener('click', async () => {
        const companyName = c.name;
        const companyId = c.id;
        
        showDeleteConfirmation({
          title: 'Supprimer une entreprise',
          message: `Êtes-vous sûr de vouloir supprimer l'entreprise "${companyName}" ?`,
          extra: '<strong>⚠️ Attention:</strong> Toutes les offres et postes ajoutés par cette entreprise seront également supprimés. Cette action ne peut pas être annulée.',
          onConfirm: async () => {
            try {
              await api(`/lots/${currentLot.id}/companies/${companyId}`, { method:'DELETE' });
              lotCompanies = lotCompanies.filter(x => x.id !== companyId);
              const removedRowsCount = sheetRows.filter(r => Number(r?.source_company_id) === Number(companyId)).length;
              sheetRows = sheetRows.filter(r => Number(r?.source_company_id) !== Number(companyId));
              for (const r of sheetRows) delete r.offers[companyId];
              if (sheetRows.length === 0) {
                const blank = { item_id:null, num:'', designation:'', unit:'', moe:{qty:'', pu:''}, offers:{} };
                for (const lc of lotCompanies) blank.offers[lc.id] = { u:'', qty:'', pu:'', mt:'' };
                sheetRows.push(blank);
              }
              renderLotCompanies();
              buildColModel();
              renderSheetInitial();
              refreshCompare();
              const suffix = removedRowsCount > 0 ? ` (${removedRowsCount} article${removedRowsCount > 1 ? 's' : ''} supprimé${removedRowsCount > 1 ? 's' : ''})` : '';
              showNotify({ title: 'Succès', message: `Entreprise supprimée avec succès${suffix}`, type: 'success' });
            } catch (err) {
              showNotify({ title:'Erreur', message:'Suppression entreprise: ' + err.message, type:'error' });
            }
          }
        });
      });
    } else {
      chip.textContent = c.name;
    }
    wrap.appendChild(chip);
  }
}

function addRow(){
  const focus = sheetSelection?.focus;
  const insertIndex = focus && Number.isInteger(focus.r)
    ? Math.min(Math.max(focus.r + 1, 0), sheetRows.length)
    : sheetRows.length;
  sheetRows.splice(insertIndex, 0, createBlankSheetRow());
  renderSheetInitial();
  markAsChanged();
  const targetCol = focus && Number.isInteger(focus.c) && colModel[focus.c]?.editable
    ? focus.c
    : colModel.findIndex(c => c.editable);
  if (targetCol >= 0) focusCell(insertIndex, targetCol);
}

function deleteRow(rIndex){
  const designation = sheetRows[rIndex]?.designation || '(sans désignation)';
  
  showDeleteConfirmation({
    title: 'Supprimer cette ligne',
    message: `Êtes-vous sûr de vouloir supprimer la ligne "${escapeHtml(designation)}" ?`,
    extra: '<strong>⚠️ Attention:</strong> Cette ligne sera supprimée du lot. Cette action sera enregistrée lors de la sauvegarde.',
    onConfirm: async () => {
      try {
        // Supprimer du modèle
        sheetRows.splice(rIndex, 1);
        
        // Si plus de lignes, ajouter une ligne vide
        if (sheetRows.length === 0) {
          const blank = { item_id:null, num:'', designation:'', unit:'', moe:{qty:'', pu:''}, offers:{} };
          for (const c of lotCompanies) blank.offers[c.id] = { u:'', qty:'', pu:'', mt:'' };
          sheetRows.push(blank);
        }
        
        // Redessiner le tableau (met à jour les indices data-r)
        renderSheetInitial();
        
        markAsChanged();
        showNotify({ title: 'Succès', message: 'Ligne supprimée', type: 'success' });
      } catch (err) {
        showNotify({ title: 'Erreur', message: err.message, type: 'error' });
      }
    }
  });
}

async function autoSaveGrid(){
  // Version silencieuse et automatique de saveGrid()
  if (!currentLot || isSaving) return;
  let genAtSaveStart = _gridChangeGen;
  
  try {
    const rows = [];
    const totalRows = qsa('#sheet-body tr').length;

    for (let r=0; r<totalRows; r++){
      const getByKey = (key) => {
        const c = colModel.findIndex(x => x.key === key);
        return c >= 0 ? (getCell(r, c)?.textContent.trim() ?? '') : '';
      };

      const designation = getByKey('designation');
      const num = getByKey('num');
      const unit = getByKey('unit');
      const moeQty = getByKey('moe.qty');
      const moePu  = getByKey('moe.pu');
      const moeMt  = getByKey('moe.mt');

      // Validation et conversion PU MOE
      if (moePu !== '') {
        const parsedPu = parseNum(moePu);
        if (isNaN(parsedPu)) {
          console.warn('PU MOE invalide:', moePu);
          return;
        }
      }

      // Sauvegarder toutes les lignes, même vides
      const row = {
        item_id: sheetRows[r]?.item_id || null,
        num, designation, unit,
        moe: { qty: moeQty, pu: moePu, mt: moeMt },
        offers: {}
      };

      for (const c of lotCompanies){
        const base = `c.${c.id}.`;
        const offerPu = getByKey(base+'pu');
        
        // Validation et conversion PU offre
        if (offerPu !== '') {
          const parsedOfferPu = parseNum(offerPu);
          if (isNaN(parsedOfferPu)) {
            console.warn('PU offre invalide:', offerPu);
            return;
          }
        }
        
        row.offers[c.id] = {
          u:  getByKey(base+'u'),
          qty:getByKey(base+'qty'),
          pu: offerPu,
          mt: getByKey(base+'mt'),
        };
      }
      rows.push(row);
    }

    // Empêcher les sauvegardes multiples simultanées
    if (isSaving) return;

    isSaving = true;
    genAtSaveStart = _gridChangeGen;
    
    // Sauvegarde silencieuse en arrière-plan
    const result = await api(`/lots/${currentLot.id}/save-grid`, { 
      method:'POST', 
      body:{ rows, round_id: currentRound?.id },
      showLoader: false 
    });

    applySavedGridItemIds(result);
    
    // Rafraîchir sans bruit
    await refreshCompare({ silent: true });
    
    if (_gridChangeGen === genAtSaveStart) {
      hasUnsavedChanges = false;
    }
    updateSaveButton();
    
    console.log('Autosave grille réussi');
  } catch (err) {
    console.error('Erreur autosave grille:', err);
    // Garder les changements non sauvegardés visibles
  } finally {
    isSaving = false;
    if (_gridChangeGen !== genAtSaveStart) {
      debounceAutoSave('grid', autoSaveGrid, 100);
    }
  }
}

async function saveGrid(){
  // Reconstituer les rows depuis le DOM + colModel
  const rows = [];
  const totalRows = qsa('#sheet-body tr').length;

  for (let r=0; r<totalRows; r++){
    const getByKey = (key) => {
      const c = colModel.findIndex(x => x.key === key);
      return c >= 0 ? (getCell(r, c)?.textContent.trim() ?? '') : '';
    };

    const designation = getByKey('designation');
    const num = getByKey('num');
    const unit = getByKey('unit');
    const moeQty = getByKey('moe.qty');
    const moePu  = getByKey('moe.pu');
    const moeMt  = getByKey('moe.mt');

    // Validation et conversion PU MOE
    if (moePu !== '') {
      const parsedPu = parseNum(moePu);
      if (isNaN(parsedPu)) {
        showNotify({ title:'Validation', message:`PU MOE invalide sur "${designation || '(vide)'}" (valeur: "${moePu}")`, type:'error' });
        // Mettre en évidence la cellule problématique
        const puCol = colModel.findIndex(x => x.key === 'moe.pu');
        if (puCol >= 0) focusCell(r, puCol);
        return;
      }
    }

    // Sauvegarder toutes les lignes, même vides, pour préserver l'espacement DPGF
    const row = {
      item_id: sheetRows[r]?.item_id || null,
      num, designation, unit,
      moe: { qty: moeQty, pu: moePu, mt: moeMt },
      offers: {}
    };

    for (const c of lotCompanies){
      const base = `c.${c.id}.`;
      const offerPu = getByKey(base+'pu');
      
      // Validation et conversion PU offre
      if (offerPu !== '') {
        const parsedOfferPu = parseNum(offerPu);
        if (isNaN(parsedOfferPu)) {
          const companyName = lotCompanies.find(comp => comp.id === c.id)?.name || 'Entreprise';
          showNotify({ title:'Validation', message:`PU invalide (${companyName}) sur "${designation || '(vide)'}" (valeur: "${offerPu}")`, type:'error' });
          // Mettre en évidence la cellule problématique
          const puCol = colModel.findIndex(x => x.key === base+'pu');
          if (puCol >= 0) focusCell(r, puCol);
          return;
        }
      }
      
      row.offers[c.id] = {
        u:  getByKey(base+'u'),
        qty:getByKey(base+'qty'),
        pu: offerPu,
        mt: getByKey(base+'mt'),
      };
    }
    rows.push(row);
  }

  // Empêcher les sauvegardes multiples simultanées
  if (isSaving) {
    console.log('Sauvegarde déjà en cours, ignore...');
    return;
  }

  try {
    isSaving = true;
    const genAtSaveStart = _gridChangeGen;
    
    // Sauvegarde en arrière-plan sans loader
    const result = await api(`/lots/${currentLot.id}/save-grid`, { 
      method:'POST', 
      body:{ rows, round_id: currentRound?.id },
      showLoader: false 
    });

    // Le serveur retourne les items créés avec leurs IDs
    // Synchroniser uniquement les item_id sans toucher aux données affichées
    applySavedGridItemIds(result);
    
    // Rafraîchir uniquement le comparatif (vue lecture seule)
    await refreshCompare({ silent: true });
    
    // Le récapitulatif par tour a été supprimé; plus de rafraîchissement dédié
    
    // Rafraîchir la comparaison des tours si visible
    const compareView = qs('#rounds-compare-view');
    if (currentProject && compareView && !compareView.classList.contains('hidden')) {
      await loadRoundsComparison();
    }
    
    if (_gridChangeGen === genAtSaveStart) {
      hasUnsavedChanges = false;
    }
    updateSaveButton();
    
    console.log('Sauvegarde réussie');
  } catch (err) {
    console.error('Erreur sauvegarde:', err);
    showNotify({ title:'Erreur', message:'Sauvegarde grille: ' + err.message, type:'error' });
  } finally {
    isSaving = false;
    // Si de nouveaux changements sont arrivés pendant la sauvegarde, replanifier
    if (_gridChangeGen !== genAtSaveStart) {
      debounceAutoSave('grid', autoSaveGrid, 100);
    }
  }
}

/* ================= Bindings UI ================= */
function renderSheetBindings(){
  // boutons édition
  qs('#add-row')?.addEventListener('click', addRow);

  qs('#add-company')?.addEventListener('click', async () => {
    const name = qs('#company-input').value.trim();
    if (!name) return;
    const created = await api(`/lots/${currentLot.id}/companies`, { method:'POST', body:{ name }});
    if (!lotCompanies.find(c => c.id === created.id)) lotCompanies.push(created);

    // rebuild colonnes (changement de structure), et étendre les rows
    for (const r of sheetRows) r.offers[created.id] = r.offers[created.id] || { u:'', qty:'', pu:'' };
    buildColModel();
    renderSheetInitial();
    renderLotCompanies();
    qs('#company-input').value = '';
  });

  // Autosave activé - le bouton montre juste le statut
  // qs('#save-grid')?.addEventListener('click', saveGrid);
  qs('#undo')?.addEventListener('click', undo);
  qs('#redo')?.addEventListener('click', redo);

  // bascule modes
  qs('#mode-compare')?.addEventListener('click', async () => {
    if (isSaving) {
      await waitForGridSaveCompletion();
    }
    if (hasUnsavedChanges) {
      await autoSaveGrid();
    }
    if (isSaving) {
      await waitForGridSaveCompletion();
    }
    if (typeof hasUnsavedOptionsChanges !== 'undefined' && hasUnsavedOptionsChanges) {
      await autoSaveOptionsGrid();
    }
    await refreshCompare({ silent: true });
    clearSheetSelection();
    hide('#sheet-view'); hide('#sheet-actions'); show('#compare-view');
    hide('#options-sheet-view'); show('#options-compare-view');
    qs('#mode-compare').classList.add('active-mode'); qs('#mode-edit').classList.remove('active-mode');
  });
  qs('#mode-edit')?.addEventListener('click', () => {
    if (isVisionneur()) {
      showNotify({ title:'Accès refusé', message:'Mode édition non disponible en lecture seule.', type:'error' });
      return;
    }
    show('#sheet-view'); show('#sheet-actions'); hide('#compare-view');
    show('#options-sheet-view'); hide('#options-compare-view');
    qs('#mode-edit').classList.add('active-mode'); qs('#mode-compare').classList.remove('active-mode');
    renderOptionsSheetTable();
    setupOptionsSheetControls();
  });

  // Raccourcis globaux
  document.addEventListener('keydown', (e) => {
    // Échap → fermer le premier modal ouvert (sauf les modals d'importation)
    if (e.key === 'Escape') {
      const IMPORT_MODALS = new Set(['import-modal', 'import-dpgf-lots-modal']);
      const openModal = qsa('.modal').find(m => !m.classList.contains('hidden') && !IMPORT_MODALS.has(m.id));
      if (openModal) {
        hide('#' + openModal.id);
        return;
      }
    }

    // Ctrl+S → sauvegarder
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault(); 
      saveGrid();
      return;
    }
    
    // Ctrl+Z → undo (global, même hors cellule)
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && currentLot) {
      // Si on est pas dans une cellule, faire l'undo global
      if (!e.target.closest('#sheet-body td[contenteditable]')) {
        e.preventDefault();
        undo();
      }
      return;
    }
    
    // Ctrl+Shift+Z ou Ctrl+Y → redo (global)
    if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key === 'z') || e.key === 'y') && currentLot) {
      if (!e.target.closest('#sheet-body td[contenteditable]')) {
        e.preventDefault();
        redo();
      }
      return;
    }
  });

  // ======== Smart Import (DPGF / Offre) ========
  bindSmartImport();
  // ======== Import DPGF → Création automatique de lots ========
  bindImportDpgfLots();
}

/* ================== SMART IMPORT (DPGF / Offre) ================== */
let importState = {
  mode: 'dpgf',   // 'dpgf' | 'offer'
  file: null,
  files: [],
  fileConfigs: [],
  globalMapping: null,
  activeFileIndex: 0,
  preview: null,
  mapping: {},
  excludedRows: new Set(),
  autoExcludedRows: new Set(),
  fileId: null,
  selectedSheetsDpgf: [],
  sheetConfigsDpgf: {},
  dpgfBaseMapping: null,
  importOperation: 'replace',
};

function bindSmartImport() {
  const modal       = qs('#import-modal');
  const closeBtn    = qs('#import-modal-close');
  const openBtn     = qs('#open-import-modal');
  const modeDpgf    = qs('#import-mode-dpgf');
  const modeOffer   = qs('#import-mode-offer');
  const fileInput   = qs('#import-file-input');
  const step1       = qs('#import-step-1');
  const step2       = qs('#import-step-2');
  const step3       = qs('#import-step-3');
  const backBtn     = qs('#import-back-step1');
  const confirmBtn  = qs('#import-confirm');
  const cancelBtn   = qs('#import-cancel');
  const doneBtn     = qs('#import-done');
  const goStep2Btn  = qs('#import-go-step2');
  const toggleControlsBtn = qs('#import-toggle-controls');
  const sheetSelect = qs('#import-sheet-select');
  const headerRowInput = qs('#import-header-row');
  const dpgfSheetsToggle = qs('#import-dpgf-sheets-toggle');
  const dpgfSheetsDropdown = qs('#import-dpgf-sheets-dropdown');
  const dpgfSheetsSummary = qs('#import-dpgf-sheets-summary');
  const fileNavWrap = qs('#import-file-nav');
  const prevFileBtn = qs('#import-prev-file');
  const nextFileBtn = qs('#import-next-file');
  const currentFileLabel = qs('#import-current-file');

  if (!modal || !openBtn) return;

  let importControlsCollapsed = true;
  let previewRequestSeq = 0;
  let previewAbortController = null;
  let draftSaveTimer = null;

  const IMPORT_DRAFT_DB = 'tao-import-drafts';
  const IMPORT_DRAFT_STORE = 'smart-import-drafts';
  const IMPORT_DRAFT_VERSION = 1;

  function createEmptyImportState(mode = 'dpgf') {
    return {
      mode,
      file: null,
      files: [],
      fileConfigs: [],
      globalMapping: null,
      activeFileIndex: 0,
      preview: null,
      mapping: {},
      excludedRows: new Set(),
      autoExcludedRows: new Set(),
      fileId: null,
      selectedSheetsDpgf: [],
      sheetConfigsDpgf: {},
      dpgfBaseMapping: null,
      importOperation: 'replace',
    };
  }

  function getImportDraftKey() {
    return currentLot?.id ? `lot:${currentLot.id}` : null;
  }

  function openImportDraftDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB indisponible'));
        return;
      }
      const req = indexedDB.open(IMPORT_DRAFT_DB, IMPORT_DRAFT_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IMPORT_DRAFT_STORE)) {
          db.createObjectStore(IMPORT_DRAFT_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Impossible d\'ouvrir le cache d\'import'));
    });
  }

  async function withImportDraftStore(mode, callback) {
    const db = await openImportDraftDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(IMPORT_DRAFT_STORE, mode);
        const store = tx.objectStore(IMPORT_DRAFT_STORE);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('Erreur cache import'));
        tx.onabort = () => reject(tx.error || new Error('Cache import interrompu'));
        const request = callback(store);
        if (request && typeof request === 'object' && 'onsuccess' in request) {
          request.onsuccess = () => { result = request.result; };
          request.onerror = () => reject(request.error || new Error('Erreur cache import'));
        } else {
          result = request;
        }
      });
    } finally {
      db.close();
    }
  }

  function serializeFileConfig(cfg = {}) {
    return {
      mapping: cfg.mapping ? normalizeMappingShape(cfg.mapping) : null,
      excludedRows: Array.isArray(cfg.excludedRows) ? cfg.excludedRows.filter(v => typeof v === 'number') : [],
      headerRow: cfg.headerRow || null,
      sheetName: cfg.sheetName || null,
      fileId: null,
      companyId: cfg.companyId || null,
      companyName: cfg.companyName || '',
    };
  }

  async function saveImportDraftNow() {
    const key = getImportDraftKey();
    const files = getSelectedImportFiles();
    if (!key || files.length === 0) return;
    persistActiveFileConfig(false);

    const draft = {
      key,
      savedAt: Date.now(),
      projectId: currentProject?.id || null,
      lotId: currentLot?.id || null,
      roundId: currentRound?.id || null,
      mode: importState.mode,
      activeFileIndex: importState.activeFileIndex || 0,
      files: files.map(file => ({
        name: file.name,
        type: file.type || 'application/octet-stream',
        lastModified: file.lastModified || Date.now(),
        blob: file,
      })),
      fileConfigs: (importState.fileConfigs || []).map(serializeFileConfig),
      globalMapping: importState.globalMapping ? cloneMapping(importState.globalMapping) : null,
      preview: importState.preview || null,
      mapping: normalizeMappingShape(importState.mapping || {}),
      excludedRows: [...(importState.excludedRows instanceof Set ? importState.excludedRows : new Set())].filter(v => typeof v === 'number'),
      selectedSheetsDpgf: Array.isArray(importState.selectedSheetsDpgf) ? [...importState.selectedSheetsDpgf] : [],
      sheetConfigsDpgf: importState.sheetConfigsDpgf || {},
      dpgfBaseMapping: importState.dpgfBaseMapping ? cloneMapping(importState.dpgfBaseMapping) : null,
      importOperation: 'replace',
      companySelectValue: qs('#import-company-select')?.value || '',
      companyNewValue: qs('#import-company-new')?.value || '',
    };

    await withImportDraftStore('readwrite', (store) => store.put(draft));
  }

  function scheduleImportDraftSave() {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      saveImportDraftNow().catch((err) => {
        console.warn('Sauvegarde brouillon import impossible:', err);
      });
    }, 250);
  }

  async function loadImportDraft() {
    const key = getImportDraftKey();
    if (!key) return null;
    return withImportDraftStore('readonly', (store) => store.get(key));
  }

  async function clearImportDraft() {
    const key = getImportDraftKey();
    clearTimeout(draftSaveTimer);
    if (!key || !window.indexedDB) return;
    try {
      await withImportDraftStore('readwrite', (store) => store.delete(key));
    } catch (err) {
      console.warn('Nettoyage brouillon import impossible:', err);
    }
  }

  function restoreImportDraft(draft) {
    if (!draft || !Array.isArray(draft.files) || draft.files.length === 0) return false;

    const files = draft.files.map((entry) => {
      const blob = entry.blob instanceof Blob ? entry.blob : new Blob([entry.blob || ''], { type: entry.type || 'application/octet-stream' });
      return new File([blob], entry.name || 'import.xlsx', {
        type: entry.type || blob.type || '',
        lastModified: entry.lastModified || Date.now(),
      });
    });

    importState = createEmptyImportState(draft.mode || 'dpgf');
    importState.files = files;
    importState.activeFileIndex = Math.max(0, Math.min(Number(draft.activeFileIndex || 0), files.length - 1));
    importState.file = files[importState.activeFileIndex] || files[0] || null;
    importState.fileConfigs = Array.isArray(draft.fileConfigs) ? draft.fileConfigs.map(serializeFileConfig) : [];
    ensureFileConfigs();
    importState.globalMapping = draft.globalMapping ? cloneMapping(draft.globalMapping) : null;
    importState.preview = draft.preview || null;
    importState.mapping = normalizeMappingShape(draft.mapping || importState.fileConfigs[importState.activeFileIndex]?.mapping || {});
    importState.excludedRows = new Set((draft.excludedRows || []).filter(v => typeof v === 'number'));
    importState.autoExcludedRows = new Set();
    importState.fileId = null;
    importState.selectedSheetsDpgf = Array.isArray(draft.selectedSheetsDpgf) ? [...draft.selectedSheetsDpgf] : [];
    importState.sheetConfigsDpgf = draft.sheetConfigsDpgf || {};
    importState.dpgfBaseMapping = draft.dpgfBaseMapping ? cloneMapping(draft.dpgfBaseMapping) : null;
    importState.importOperation = 'replace';
    if (qs('#import-company-select')) qs('#import-company-select').value = draft.companySelectValue || '';
    if (qs('#import-company-new')) qs('#import-company-new').value = draft.companyNewValue || '';
    return true;
  }

  function cancelPreviewRequest() {
    previewRequestSeq += 1;
    if (previewAbortController) {
      previewAbortController.abort();
      previewAbortController = null;
    }
  }

  function setImportControlsCollapsed(collapsed) {
    importControlsCollapsed = !!collapsed;
    step2?.classList.toggle('is-collapsed-controls', importControlsCollapsed);
    if (toggleControlsBtn) {
      toggleControlsBtn.textContent = importControlsCollapsed ? '▸ Options' : '▾ Options';
      toggleControlsBtn.setAttribute('aria-expanded', importControlsCollapsed ? 'false' : 'true');
    }
  }

  function getSelectedImportFiles() {
    if (Array.isArray(importState.files) && importState.files.length > 0) return importState.files;
    return importState.file ? [importState.file] : [];
  }

  function getActiveImportFile() {
    const files = getSelectedImportFiles();
    if (!files.length) return null;
    const idx = Math.max(0, Math.min(importState.activeFileIndex || 0, files.length - 1));
    return files[idx] || null;
  }

  function isBatchOfferImport() {
    return importState.mode === 'offer' && getSelectedImportFiles().length > 1;
  }

  function canUseDpgfMultiSheets() {
    return false;
  }

  function hasUsableDpgfMapping(mapping) {
    const designation = mapping?.designation;
    if (Array.isArray(designation)) return designation.length > 0;
    return designation != null;
  }

  function setDpgfSheetsDropdownOpen(isOpen) {
    if (!dpgfSheetsDropdown) return;
    dpgfSheetsDropdown.classList.toggle('hidden', !isOpen);
  }

  function updateDpgfSheetsSummary(availableSheets = []) {
    if (!dpgfSheetsSummary) return;
    const selectedCount = Array.isArray(importState.selectedSheetsDpgf) ? importState.selectedSheetsDpgf.length : 0;
    const total = availableSheets.length;
    if (total <= 0) {
      dpgfSheetsSummary.textContent = 'Aucun onglet';
      return;
    }
    if (selectedCount <= 0) {
      dpgfSheetsSummary.textContent = 'Aucun onglet sélectionné';
      return;
    }
    if (selectedCount === total) {
      dpgfSheetsSummary.textContent = `Tous les onglets (${total})`;
      return;
    }
    dpgfSheetsSummary.textContent = `${selectedCount} onglet(s) sélectionné(s)`;
  }

  function saveDpgfSheetConfig(sheetName) {
    if (!sheetName) return;
    if (!importState.sheetConfigsDpgf || typeof importState.sheetConfigsDpgf !== 'object') {
      importState.sheetConfigsDpgf = {};
    }
    const mapping = normalizeMappingShape(importState.mapping);
    importState.sheetConfigsDpgf[sheetName] = {
      mapping,
      excludedRows: [...(importState.excludedRows instanceof Set ? importState.excludedRows : new Set())].filter(v => typeof v === 'number'),
    };
    // Le mapping de base vient du premier onglet réellement configuré, quel que soit son ordre.
    if (!importState.dpgfBaseMapping && hasUsableDpgfMapping(mapping)) {
      importState.dpgfBaseMapping = cloneMapping(mapping);
      const allSheets = Array.isArray(importState.preview?.sheets) ? importState.preview.sheets : [];
      for (const sheet of allSheets) {
        if (sheet !== sheetName && !importState.sheetConfigsDpgf[sheet]) {
          importState.sheetConfigsDpgf[sheet] = {
            mapping: cloneMapping(importState.dpgfBaseMapping),
            excludedRows: [],
          };
        }
      }
    }
  }

  function loadDpgfSheetConfig(sheetName, data) {
    const cfg = importState.sheetConfigsDpgf?.[sheetName];
    if (cfg) {
      importState.mapping = normalizeMappingShape(cfg.mapping || {});
      importState.excludedRows = new Set((cfg.excludedRows || []).filter(v => typeof v === 'number'));
    } else {
      // Utiliser le mapping du premier onglet configuré, ou le mapping suggéré si aucun n'existe encore.
      const fallback = importState.dpgfBaseMapping || data?.suggestedMapping || {};
      importState.mapping = normalizeMappingShape(fallback);
      importState.excludedRows = new Set();
    }
    importState.autoExcludedRows = new Set();
    applyAutoExcludeRowsBeforeFirstArticle();
  }

  function deriveCompanyNameFromFile(fileName) {
    return (fileName || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[_.-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Entreprise';
  }

  function cloneMapping(mapping) {
    const m = { ...(mapping || {}) };
    if (Array.isArray(m.num)) m.num = [...m.num];
    if (Array.isArray(m.designation)) m.designation = [...m.designation];
    return m;
  }

  function normalizeMappingShape(mapping) {
    const m = cloneMapping(mapping);
    if (m.num != null && !Array.isArray(m.num)) m.num = [m.num];
    if (m.designation != null && !Array.isArray(m.designation)) m.designation = [m.designation];
    return m;
  }

  function applyAutoExcludeRowsBeforeFirstArticle() {
    const previewRows = importState.preview?.previewRows;
    const excluded = importState.excludedRows instanceof Set ? importState.excludedRows : new Set();
    const previousAuto = importState.autoExcludedRows instanceof Set ? importState.autoExcludedRows : new Set();

    for (const rowNum of previousAuto) {
      excluded.delete(rowNum);
    }

    const rawNumMapping = importState.mapping?.num;
    const numCols = (Array.isArray(rawNumMapping) ? rawNumMapping : [rawNumMapping])
      .map(Number)
      .filter(Number.isFinite);

    if (!Array.isArray(previewRows) || previewRows.length === 0 || numCols.length === 0) {
      importState.autoExcludedRows = new Set();
      importState.excludedRows = excluded;
      return;
    }

    const firstArticle = previewRows.find((row) =>
      numCols.some((colIdx) => {
        const val = row?.[colIdx];
        return val != null && String(val).trim() !== '';
      })
    );

    const firstArticleRowNum = Number(firstArticle?._rowNum);
    if (!Number.isFinite(firstArticleRowNum)) {
      importState.autoExcludedRows = new Set();
      importState.excludedRows = excluded;
      return;
    }

    const nextAuto = new Set();
    for (const row of previewRows) {
      const rowNum = Number(row?._rowNum);
      if (!Number.isFinite(rowNum)) continue;
      if (rowNum < firstArticleRowNum) {
        excluded.add(rowNum);
        nextAuto.add(rowNum);
      }
    }

    importState.autoExcludedRows = nextAuto;
    importState.excludedRows = excluded;
  }

  function ensureFileConfigs() {
    const files = getSelectedImportFiles();
    while (importState.fileConfigs.length < files.length) {
      importState.fileConfigs.push({
        mapping: null,
        excludedRows: [],
        headerRow: null,
        sheetName: null,
        fileId: null,
        companyId: null,
        companyName: '',
      });
    }
    if (importState.fileConfigs.length > files.length) {
      importState.fileConfigs = importState.fileConfigs.slice(0, files.length);
    }
  }

  function getFileConfig(index = importState.activeFileIndex || 0) {
    ensureFileConfigs();
    return importState.fileConfigs[index] || null;
  }

  function persistActiveFileConfig(setGlobalIfMissing = true) {
    const idx = Math.max(0, importState.activeFileIndex || 0);
    const cfg = getFileConfig(idx);
    if (!cfg) return;

    cfg.mapping = normalizeMappingShape(importState.mapping || {});
    cfg.excludedRows = [...(importState.excludedRows || new Set())].filter(v => typeof v === 'number');
    cfg.headerRow = importState.preview?.headerRow || cfg.headerRow || null;
    cfg.sheetName = importState.preview?.selectedSheet || cfg.sheetName || null;
    cfg.fileId = importState.fileId || null;

    if (setGlobalIfMissing && !importState.globalMapping && Object.keys(cfg.mapping || {}).length > 0) {
      importState.globalMapping = cloneMapping(cfg.mapping);
      for (let i = 0; i < importState.fileConfigs.length; i += 1) {
        if (!importState.fileConfigs[i].mapping) {
          importState.fileConfigs[i].mapping = cloneMapping(importState.globalMapping);
        }
      }
    }
  }

  function removeFileFromImport(fileIndex) {
    if (importState.files.length > fileIndex) {
      persistActiveFileConfig(false);
      importState.files.splice(fileIndex, 1);
      if (importState.fileConfigs.length > fileIndex) {
        importState.fileConfigs.splice(fileIndex, 1);
      }
      if (importState.activeFileIndex >= importState.files.length) {
        importState.activeFileIndex = Math.max(0, importState.files.length - 1);
      }
      importState.file = importState.files[0] || null;
      importState.fileId = null;
      importState.preview = null;
      importState.mapping = {};
      importState.excludedRows = new Set();
      importState.autoExcludedRows = new Set();
      if (importState.files.length === 0) {
        importState.globalMapping = null;
      }
      updateImportFileSelectionUI();
      updateOfferImportUI();
      updateFileNavigatorUI();
      if (importState.files.length === 0) {
        clearImportDraft();
      } else {
        scheduleImportDraftSave();
      }
    }
  }

  function updateImportFileSelectionUI() {
    const files = getSelectedImportFiles();
    const label = qs('#import-file-label');
    const info = qs('#import-file-info');
    const list = qs('#import-selected-files');

    if (!label || !info) return;

    if (goStep2Btn) {
      goStep2Btn.disabled = files.length === 0;
    }

    if (files.length === 0) {
      label.textContent = importState.mode === 'offer'
        ? 'Cliquez pour sélectionner un ou plusieurs fichiers Excel (.xlsx, .xls, .xlsm)'
        : 'Cliquez pour sélectionner un fichier Excel (.xlsx, .xls, .xlsm)';
      info.classList.add('hidden');
      if (list) {
        list.classList.add('hidden');
        list.innerHTML = '';
      }
      return;
    }

    const totalSizeKb = files.reduce((sum, f) => sum + (f.size || 0), 0) / 1024;
    label.textContent = files.length === 1 ? files[0].name : `${files.length} fichiers sélectionnés`;
    info.textContent = files.length === 1
      ? `Taille : ${(files[0].size / 1024).toFixed(1)} Ko`
      : `Taille totale : ${totalSizeKb.toFixed(1)} Ko`;
    info.classList.remove('hidden');

    if (list) {
      let listHTML = '<div class="muted" style="font-size:0.82em;margin-bottom:8px">Entreprises / fichiers sélectionnés :</div><ul style="margin:0;padding:0;list-style:none;max-height:220px;overflow:auto;font-size:0.82em">';
      
      files.slice(0, 20).forEach((f, idx) => {
        const companyName = deriveCompanyNameFromFile(f.name);
        const sizeKb = (f.size / 1024).toFixed(1);
        const cfg = importState.fileConfigs[idx] || {};
        const companyValue = (cfg.companyName || '').replace(/"/g, '&quot;');
        const active = idx === (importState.activeFileIndex || 0);
        listHTML += `
          <li style="display:flex;align-items:flex-start;justify-content:space-between;padding:8px;border-bottom:1px solid var(--border);gap:8px;${active ? 'background:var(--card);border-radius:6px' : ''}">
            <span style="flex:1;min-width:0">
              <strong>${f.name}</strong>
              <span class="muted" style="display:block;font-size:0.85em;margin-top:2px">Fichier: ${sizeKb} Ko</span>
              <label style="display:block;font-size:0.76em;margin-top:6px;margin-bottom:2px;color:var(--muted)">Entreprise (obligatoire)</label>
              <input type="text" class="import-company-name-input" data-file-index="${idx}" value="${companyValue}" placeholder="Ex: ${companyName}" style="width:100%;max-width:320px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--input-bg);color:var(--fg);font-size:0.82em" />
            </span>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              <button type="button" class="btn-open-config btn ghost" data-file-index="${idx}" title="Configurer ce fichier" style="padding:4px 8px;font-size:0.8em">Configurer</button>
              <button type="button" class="btn-remove-file ghost" data-file-index="${idx}" 
                style="background:none;border:none;color:var(--danger, #f87171);cursor:pointer;font-size:1.2em;font-weight:700;padding:0;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:4px;transition:background 0.2s"
                title="Supprimer ce fichier">×</button>
            </div>
          </li>
        `;
      });
      
      if (files.length > 20) {
        listHTML += `<li style="padding:8px;color:var(--muted)">… et ${files.length - 20} autre(s)</li>`;
      }
      
      listHTML += '</ul>';
      list.innerHTML = listHTML;
      list.classList.remove('hidden');

      // Attacher les event listeners sur les boutons de suppression
      list.querySelectorAll('.btn-remove-file').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const fileIndex = Number(btn.dataset.fileIndex);
          removeFileFromImport(fileIndex);
        });
      });

      // Ouverture de la configuration uniquement au clic utilisateur
      list.querySelectorAll('.btn-open-config').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          const fileIndex = Number(btn.dataset.fileIndex);
          if (Number.isNaN(fileIndex)) return;
          persistActiveFileConfig(true);
          importState.activeFileIndex = fileIndex;
          updateImportFileSelectionUI();
          updateFileNavigatorUI();
          scheduleImportDraftSave();
          await doPreview(undefined, getActiveImportFile(), { keepExistingMapping: false, switchToStep2: true });
        });
      });

      // Mise à jour du nom d'entreprise par fichier
      list.querySelectorAll('.import-company-name-input').forEach(input => {
        input.addEventListener('input', () => {
          const fileIndex = Number(input.dataset.fileIndex);
          if (Number.isNaN(fileIndex)) return;
          ensureFileConfigs();
          importState.fileConfigs[fileIndex].companyName = input.value || '';
          importState.fileConfigs[fileIndex].companyId = null;
          scheduleImportDraftSave();
        });
      });
    }
  }

  function updateOfferImportUI() {
    const offerFields = qs('#import-offer-fields');
    const batchHint = qs('#import-batch-hint');
    const batchFilesList = qs('#import-batch-files-list');
    const confirmBtn = qs('#import-confirm');
    const confirmText = qs('#import-confirm-text');
    
    if (importState.mode !== 'offer') {
      offerFields?.classList.add('hidden');
      batchHint?.classList.add('hidden');
      return;
    }

    if (isBatchOfferImport()) {
      offerFields?.classList.add('hidden');
      batchHint?.classList.remove('hidden');
      
      // Afficher la liste des fichiers dans le batch hint
      if (batchFilesList) {
        const files = getSelectedImportFiles();
        let filesHTML = '';
        files.slice(0, 15).forEach((f, idx) => {
          const companyName = deriveCompanyNameFromFile(f.name);
          filesHTML += `
            <li>
              <strong>${f.name}</strong>
              <span class="company-name">→ ${companyName}</span>
            </li>
          `;
        });
        if (files.length > 15) {
          filesHTML += `<li style="opacity:0.6">… et ${files.length - 15} autre(s)</li>`;
        }
        batchFilesList.innerHTML = filesHTML;
      }
      
      // Adapter le texte du bouton
      if (confirmText) {
        const count = getSelectedImportFiles().length;
        confirmText.textContent = `Importer ${count} fichier${count > 1 ? 's' : ''}`;
      }
    } else {
      offerFields?.classList.remove('hidden');
      batchHint?.classList.add('hidden');
      
      // Reset du bouton
      if (confirmText) {
        confirmText.textContent = 'Lancer l\'import';
      }
    }
  }

  function updateFileNavigatorUI() {
    const files = getSelectedImportFiles();
    const isBatch = importState.mode === 'offer' && files.length > 1;
    if (!fileNavWrap || !prevFileBtn || !nextFileBtn || !currentFileLabel) return;

    if (!isBatch) {
      fileNavWrap.classList.add('hidden');
      return;
    }

    const idx = Math.max(0, Math.min(importState.activeFileIndex || 0, files.length - 1));
    importState.activeFileIndex = idx;
    prevFileBtn.disabled = idx === 0;
    nextFileBtn.disabled = idx >= files.length - 1;
    currentFileLabel.textContent = `Fichier ${idx + 1}/${files.length}: ${files[idx].name}`;
    fileNavWrap.classList.remove('hidden');
  }

  async function openModal() {
    cancelPreviewRequest();
    importState = createEmptyImportState('dpgf');
    setDpgfSheetsDropdownOpen(false);
    setImportControlsCollapsed(true);
    step1.classList.remove('hidden');
    step2.classList.add('hidden');
    step3.classList.add('hidden');
    fileInput.value = '';
    qs('#import-company-new').value = '';
    qs('#import-company-select').value = '';
    populateImportCompanies();

    let restored = false;
    try {
      const draft = await loadImportDraft();
      if (draft && Number(draft.lotId) === Number(currentLot?.id)) {
        setImportMode(draft.mode || 'dpgf');
        restored = restoreImportDraft(draft);
      }
    } catch (err) {
      console.warn('Restauration brouillon import impossible:', err);
    }

    if (restored) {
      updateImportFileSelectionUI();
      updateOfferImportUI();
      updateFileNavigatorUI();
      if (importState.preview) {
        step1.classList.add('hidden');
        step2.classList.remove('hidden');
        renderStep2();
      }
      showNotify({ title: 'Brouillon restauré', message: 'Votre progression d\'import a été retrouvée.', type: 'info' });
    } else {
      setImportMode('dpgf');
      updateImportFileSelectionUI();
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function closeModal() {
    cancelPreviewRequest();
    if (step3?.classList.contains('hidden') && getSelectedImportFiles().length > 0) {
      saveImportDraftNow().catch((err) => console.warn('Sauvegarde brouillon import impossible:', err));
    }
    setDpgfSheetsDropdownOpen(false);
    setImportControlsCollapsed(true);
    modal.classList.add('hidden');
    modal.style.display = 'none';
    importState = createEmptyImportState('dpgf');
  }

  openBtn.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  window.addEventListener('beforeunload', () => {
    if (!modal.classList.contains('hidden') && step3?.classList.contains('hidden') && getSelectedImportFiles().length > 0) {
      saveImportDraftNow().catch(() => {});
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && !modal.classList.contains('hidden') && step3?.classList.contains('hidden') && getSelectedImportFiles().length > 0) {
      saveImportDraftNow().catch(() => {});
    }
  });
  toggleControlsBtn?.addEventListener('click', () => {
    setImportControlsCollapsed(!importControlsCollapsed);
  });

  // Mode toggle
  modeDpgf?.addEventListener('click', () => setImportMode('dpgf'));
  modeOffer?.addEventListener('click', () => setImportMode('offer'));
  dpgfSheetsToggle?.addEventListener('click', (e) => {
    e.preventDefault();
    setDpgfSheetsDropdownOpen(dpgfSheetsDropdown?.classList.contains('hidden'));
  });
  document.addEventListener('click', (e) => {
    if (!dpgfSheetsDropdown || !dpgfSheetsToggle) return;
    if (dpgfSheetsDropdown.classList.contains('hidden')) return;
    const target = e.target;
    if (target && (dpgfSheetsDropdown.contains(target) || dpgfSheetsToggle.contains(target))) return;
    setDpgfSheetsDropdownOpen(false);
  });

  function setImportMode(mode) {
    importState.mode = mode;
    importState.importOperation = 'replace';
    if (fileInput) fileInput.multiple = mode === 'offer';

    // Réinitialiser l'état multi-onglets DPGF lors du changement de mode
    importState.selectedSheetsDpgf = [];
      importState.dpgfBaseMapping = null;
    importState.sheetConfigsDpgf = {};
    const dpgfMultiWrap = qs('#import-dpgf-multi-sheets');
    if (dpgfMultiWrap) dpgfMultiWrap.classList.add('hidden');
    if (dpgfSheetsDropdown) {
      dpgfSheetsDropdown.innerHTML = '';
      setDpgfSheetsDropdownOpen(false);
    }
    updateDpgfSheetsSummary([]);

    // En mode DPGF, garder seulement le premier fichier si plusieurs sont déjà sélectionnés
    if (mode === 'dpgf' && getSelectedImportFiles().length > 1) {
      importState.files = [getSelectedImportFiles()[0]];
      importState.fileConfigs = [importState.fileConfigs[0] || { mapping: null, excludedRows: [], headerRow: null, sheetName: null, fileId: null, companyId: null, companyName: '' }];
      importState.file = importState.files[0] || null;
      importState.activeFileIndex = 0;
      importState.fileId = null;
      updateImportFileSelectionUI();
    } else if (mode === 'offer') {
      ensureFileConfigs();
    }

    if (mode === 'dpgf') {
      modeDpgf.classList.add('active'); modeDpgf.classList.remove('ghost');
      modeOffer.classList.remove('active'); modeOffer.classList.add('ghost');
      qs('#import-mode-description').innerHTML = '<strong>DPGF (MOE) :</strong> Importe la structure du lot (articles, quantités, prix unitaires MOE). Crée ou met à jour les lignes du tableur.';
    } else {
      modeOffer.classList.add('active'); modeOffer.classList.remove('ghost');
      modeDpgf.classList.remove('active'); modeDpgf.classList.add('ghost');
      qs('#import-mode-description').innerHTML = '<strong>Offre Entreprise :</strong> Importe les données d\'une offre (quantités, prix unitaires) et les associe à une entreprise. Les articles sont matchés par numéro avec la DPGF existante.';
    }

    updateImportFileSelectionUI();
    updateOfferImportUI();
    updateFileNavigatorUI();
    scheduleImportDraftSave();
  }

  function populateImportCompanies() {
    const sel = qs('#import-company-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Sélectionner une entreprise existante --</option>';
    for (const c of (lotCompanies || [])) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    }
  }

  // Mutual exclusivity: typing a new name clears the select, and vice versa
  const companyNewInput = qs('#import-company-new');
  const companySelect = qs('#import-company-select');
  companyNewInput?.addEventListener('input', () => {
    if (companyNewInput.value.trim()) companySelect.value = '';
    scheduleImportDraftSave();
  });
  companySelect?.addEventListener('change', () => {
    if (companySelect.value) companyNewInput.value = '';
    scheduleImportDraftSave();
  });

  // File selection
  fileInput?.addEventListener('change', async () => {
    const selectedFiles = Array.from(fileInput.files || []);
    if (selectedFiles.length === 0) return;

    if (importState.mode === 'dpgf' && selectedFiles.length > 1) {
      showNotify({ title: 'Un seul fichier pour DPGF', message: 'Le mode DPGF utilise un seul fichier. Le premier fichier sélectionné sera utilisé.', type: 'info' });
    }

    if (importState.mode === 'dpgf') {
      importState.files = [selectedFiles[0]];
      importState.fileConfigs = [{ mapping: null, excludedRows: [], headerRow: null, sheetName: null, fileId: null, companyId: null, companyName: '' }];
      importState.activeFileIndex = 0;
      importState.globalMapping = null;
    } else {
      const existing = getSelectedImportFiles();
      const allFiles = [...existing];
      selectedFiles.forEach((f) => {
        const exists = allFiles.some((e) => e.name === f.name && e.size === f.size && e.lastModified === f.lastModified);
        if (!exists) allFiles.push(f);
      });
      importState.files = allFiles;
      ensureFileConfigs();
      if (importState.activeFileIndex >= importState.files.length) {
        importState.activeFileIndex = Math.max(0, importState.files.length - 1);
      }
    }
    importState.file = importState.files[importState.activeFileIndex] || null;
    importState.fileId = null;
    importState.preview = null;
    const cfg = getFileConfig(importState.activeFileIndex);
    importState.mapping = normalizeMappingShape(cfg?.mapping || {});
    importState.excludedRows = new Set();
    importState.autoExcludedRows = new Set();
    fileInput.value = '';
    updateImportFileSelectionUI();
    updateOfferImportUI();
    updateFileNavigatorUI();
    scheduleImportDraftSave();
  });

  goStep2Btn?.addEventListener('click', async () => {
    const file = getActiveImportFile();
    if (!file) return;
    persistActiveFileConfig(false);
    await doPreview(undefined, file, { keepExistingMapping: false, switchToStep2: true });
  });

  async function doPreview(sheetName, sourceFile = importState.file, options = {}) {
    const { keepExistingMapping = false, switchToStep2 = true } = options;
    if (!sourceFile || !currentLot) return;
    const lotId = currentLot.id;
    if (previewAbortController) {
      previewAbortController.abort();
    }
    const requestSeq = ++previewRequestSeq;
    const abortController = new AbortController();
    previewAbortController = abortController;
    const files = getSelectedImportFiles();
    const fileIdx = Math.max(0, files.indexOf(sourceFile));
    importState.activeFileIndex = fileIdx;
    const cfg = getFileConfig(fileIdx);
    const requestedSheet = sheetName || cfg?.sheetName || null;
    const requestedHeader = headerRowInput ? Number(headerRowInput.value) : 0;
    const effectiveHeader = requestedHeader >= 1 ? requestedHeader : (cfg?.headerRow || 0);

    const formData = new FormData();
    formData.append('file', sourceFile);
    if (requestedSheet) formData.append('sheetName', requestedSheet);
    // Envoyer la ligne d'en-tête si l'utilisateur l'a modifiée
    if (effectiveHeader >= 1) formData.append('headerRow', String(effectiveHeader));

    try {
      showLoader();
      const resp = await fetch(`${API_BASE}/lots/${lotId}/import-preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        credentials: 'include',
        signal: abortController.signal,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Erreur preview');
      if (requestSeq !== previewRequestSeq || !currentLot || Number(currentLot.id) !== Number(lotId)) return;

      importState.preview = data;
      importState.file = sourceFile;
      importState.fileId = data.fileId || null;
      if (keepExistingMapping && importState.mapping && Object.keys(importState.mapping).length > 0) {
        importState.mapping = normalizeMappingShape(importState.mapping);
      } else if (cfg?.mapping && Object.keys(cfg.mapping).length > 0) {
        importState.mapping = normalizeMappingShape(cfg.mapping);
      } else if (importState.globalMapping && Object.keys(importState.globalMapping).length > 0) {
        importState.mapping = normalizeMappingShape(importState.globalMapping);
        cfg.mapping = cloneMapping(importState.mapping);
      } else {
        importState.mapping = normalizeMappingShape(data.suggestedMapping || {});
      }
      importState.excludedRows = new Set((cfg?.excludedRows || []).filter(v => typeof v === 'number'));
      importState.autoExcludedRows = new Set();
      applyAutoExcludeRowsBeforeFirstArticle();
      cfg.sheetName = data.selectedSheet || cfg.sheetName || null;
      cfg.headerRow = data.headerRow || cfg.headerRow || null;
      cfg.fileId = data.fileId || null;
      // Mettre à jour l’input ligne d’en-tête
      if (headerRowInput) headerRowInput.value = data.headerRow || 1;
      renderStep2();
      updateOfferImportUI();
      updateFileNavigatorUI();
      scheduleImportDraftSave();
      if (switchToStep2) {
        step1.classList.add('hidden');
        step2.classList.remove('hidden');
        step3.classList.add('hidden');
        setImportControlsCollapsed(true);
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      showNotify({ title: 'Erreur', message: err.message, type: 'error' });
    } finally {
      if (requestSeq === previewRequestSeq) {
        if (previewAbortController === abortController) {
          previewAbortController = null;
        }
        hideLoader();
      }
    }
  }

  // Sheet selector change
  sheetSelect?.addEventListener('change', () => {
    if (canUseDpgfMultiSheets()) {
      saveDpgfSheetConfig(importState.preview?.selectedSheet);
    }
    persistActiveFileConfig(false);
    scheduleImportDraftSave();
    doPreview(sheetSelect.value, getActiveImportFile(), { keepExistingMapping: !canUseDpgfMultiSheets(), switchToStep2: false });
  });

  // Header row manual override
  let headerRowDebounce = null;
  headerRowInput?.addEventListener('change', () => {
    clearTimeout(headerRowDebounce);
    headerRowDebounce = setTimeout(() => {
      const val = Number(headerRowInput.value);
      if (val >= 1 && val <= 100 && importState.preview) {
        persistActiveFileConfig(false);
        importState.preview.headerRow = val;
        scheduleImportDraftSave();
        doPreview(sheetSelect.value, getActiveImportFile(), { keepExistingMapping: true, switchToStep2: false });
      }
    }, 400);
  });

  prevFileBtn?.addEventListener('click', async () => {
    const files = getSelectedImportFiles();
    if (importState.activeFileIndex <= 0 || files.length < 2) return;
    persistActiveFileConfig(true);
    importState.activeFileIndex -= 1;
    updateFileNavigatorUI();
    scheduleImportDraftSave();
    await doPreview(undefined, getActiveImportFile(), { keepExistingMapping: false, switchToStep2: false });
  });

  nextFileBtn?.addEventListener('click', async () => {
    const files = getSelectedImportFiles();
    if (importState.activeFileIndex >= files.length - 1 || files.length < 2) return;
    persistActiveFileConfig(true);
    importState.activeFileIndex += 1;
    updateFileNavigatorUI();
    scheduleImportDraftSave();
    await doPreview(undefined, getActiveImportFile(), { keepExistingMapping: false, switchToStep2: false });
  });

  function renderStep2() {
    const data = importState.preview;
    if (!data) return;

    updateOfferImportUI();

    // En mode DPGF multi-onglets : charger la config de l'onglet actif
    if (canUseDpgfMultiSheets() && data.selectedSheet) {
      loadDpgfSheetConfig(data.selectedSheet, data);
    }

    // Remplir le sélecteur d'onglets
    sheetSelect.innerHTML = '';
    for (const s of data.sheets) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      if (s === data.selectedSheet) opt.selected = true;
      sheetSelect.appendChild(opt);
    }

    // Multi-onglets DPGF : afficher les chips de sélection
    const dpgfMultiWrap = qs('#import-dpgf-multi-sheets');
    const dpgfSheetsList = qs('#import-dpgf-sheets-list');
    if (dpgfMultiWrap && dpgfSheetsList && dpgfSheetsDropdown) {
      if (canUseDpgfMultiSheets()) {
        dpgfMultiWrap.classList.remove('hidden');
        dpgfSheetsList.innerHTML = '';
        dpgfSheetsDropdown.innerHTML = '';
        const available = Array.isArray(data.sheets) ? data.sheets : [];
        if (!Array.isArray(importState.selectedSheetsDpgf) || importState.selectedSheetsDpgf.length === 0) {
          importState.selectedSheetsDpgf = [...available];
        } else {
          importState.selectedSheetsDpgf = importState.selectedSheetsDpgf.filter(s => available.includes(s));
          if (importState.selectedSheetsDpgf.length === 0) importState.selectedSheetsDpgf = [...available];
        }
        const selected = new Set(importState.selectedSheetsDpgf);
        updateDpgfSheetsSummary(available);
        for (const s of available) {
          const chip = document.createElement('label');
          chip.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:0.82em;user-select:none';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = s;
          cb.checked = selected.has(s);
          cb.addEventListener('change', () => {
            if (cb.checked) selected.add(s);
            else selected.delete(s);
            importState.selectedSheetsDpgf = [...selected];
            updateDpgfSheetsSummary(available);
            scheduleImportDraftSave();
          });
          const txt = document.createElement('span');
          txt.textContent = s;
          chip.appendChild(cb);
          chip.appendChild(txt);
          dpgfSheetsDropdown.appendChild(chip);
        }
      } else {
        dpgfMultiWrap.classList.add('hidden');
        dpgfSheetsList.innerHTML = '';
        dpgfSheetsDropdown.innerHTML = '';
        setDpgfSheetsDropdownOpen(false);
        updateDpgfSheetsSummary([]);
      }
    }

    // Total rows
    qs('#import-total-rows').textContent = data.totalRows;

    // Preview table (contient aussi les sélecteurs de mapping)
    renderPreviewTable();
  }

  function renderPreviewTable() {
    const data = importState.preview;
    if (!data) return;
    const mapping = importState.mapping;
    const excluded = importState.excludedRows;

    const head = qs('#import-preview-head');
    const body = qs('#import-preview-body');
    head.innerHTML = '';
    body.innerHTML = '';

    const fieldOptions = importState.mode === 'dpgf'
      ? [
          { key: '', label: '—' },
          { key: 'num', label: 'N° Article' },
          { key: 'designation', label: 'Désignation' },
          { key: 'unit', label: 'Unité' },
          { key: 'qty', label: 'Quantité MOE' },
          { key: 'unit_price', label: 'Prix Unit. MOE' },
          { key: 'amount', label: 'Montant MOE' },
        ]
      : [
          { key: '', label: '—' },
          { key: 'num', label: 'N° Article' },
          { key: 'designation', label: 'Désignation' },
          { key: 'unit', label: 'Unité' },
          { key: 'qty', label: 'Quantité' },
          { key: 'unit_price', label: 'Prix Unitaire' },
          { key: 'amount', label: 'Montant' },
        ];

    const colors = { num: '#6b8afd', designation: '#c4b5fd', unit: '#86efac', qty: '#fbbf24', unit_price: '#f87171', amount: '#38bdf8' };
    const multiMapFields = new Set(['num', 'designation']);

    // Construire un index inversé colIndex → field
    const colFieldMap = {};
    for (const [field, val] of Object.entries(mapping)) {
      if (val == null) continue;
      if (multiMapFields.has(field)) {
        const arr = Array.isArray(val) ? val : [val];
        arr.forEach(ci => { colFieldMap[ci] = field; });
      } else {
        colFieldMap[val] = field;
      }
    }

    // Mettre à jour le compteur (total - exclus)
    const activeCount = data.totalRows - excluded.size;
    qs('#import-total-rows').textContent = activeCount + ' / ' + data.totalRows;

    // Helper : bouton supprimer
    function makeDeleteBtn(rowNum) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = '×'; btn.title = 'Supprimer cette ligne';
      btn.style.cssText = 'background:none;border:none;color:var(--danger, #f87171);cursor:pointer;font-size:1.1em;font-weight:700;padding:0 4px;line-height:1';
      btn.addEventListener('click', () => { excluded.add(rowNum); persistActiveFileConfig(false); renderPreviewTable(); scheduleImportDraftSave(); });
      return btn;
    }
    function makeRestoreBtn(rowNum) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = '↩'; btn.title = 'Restaurer cette ligne';
      btn.style.cssText = 'background:none;border:none;color:var(--success, #10b981);cursor:pointer;font-size:1em;padding:0 4px;line-height:1';
      btn.addEventListener('click', () => { excluded.delete(rowNum); persistActiveFileConfig(false); renderPreviewTable(); scheduleImportDraftSave(); });
      return btn;
    }

    // === Ligne 1 des en-têtes : sélecteurs de mapping ===
    const trSel = document.createElement('tr');
    const thActSel = document.createElement('th');
    thActSel.style.cssText = 'width:32px;position:sticky;left:0;z-index:3;background:var(--card);vertical-align:middle';
    trSel.appendChild(thActSel);

    for (const h of data.headers) {
      const th = document.createElement('th');
      th.style.cssText = 'padding:4px;vertical-align:top;position:sticky;top:0;z-index:2;background:var(--card)';
      const currentField = colFieldMap[h.index] || '';
      const color = currentField ? (colors[currentField] || 'transparent') : 'transparent';

      const sel = document.createElement('select');
      sel.dataset.colIdx = h.index;
      sel.style.cssText = `width:100%;padding:4px 2px;border-radius:4px;border:2px solid ${color};background:${color}18;color:var(--fg);font-size:0.72em;font-weight:600;cursor:pointer`;

      for (const fo of fieldOptions) {
        const opt = document.createElement('option');
        opt.value = fo.key;
        opt.textContent = fo.label;
        if (fo.key === currentField) opt.selected = true;
        sel.appendChild(opt);
      }

      sel.addEventListener('change', () => {
        const colIdx = Number(sel.dataset.colIdx);
        const newField = sel.value;
        const oldField = colFieldMap[colIdx] || '';

        // Retirer l'ancien mapping de cette colonne
        if (oldField) {
          if (multiMapFields.has(oldField)) {
            const arr = Array.isArray(mapping[oldField]) ? mapping[oldField] : [];
            mapping[oldField] = arr.filter(c => c !== colIdx);
            if (mapping[oldField].length === 0) delete mapping[oldField];
          } else {
            delete mapping[oldField];
          }
        }

        // Ajouter le nouveau mapping
        if (newField) {
          if (multiMapFields.has(newField)) {
            const arr = Array.isArray(mapping[newField]) ? mapping[newField] : [];
            if (!arr.includes(colIdx)) arr.push(colIdx);
            arr.sort((a, b) => a - b);
            mapping[newField] = arr;
          } else {
            // Retirer toute ancienne colonne assignée à ce champ
            for (const [ci, fld] of Object.entries(colFieldMap)) {
              if (fld === newField && Number(ci) !== colIdx) {
                delete mapping[newField];
              }
            }
            mapping[newField] = colIdx;
          }
        }

        applyAutoExcludeRowsBeforeFirstArticle();
        persistActiveFileConfig(false);
        renderPreviewTable();
        scheduleImportDraftSave();
      });

      if (color !== 'transparent') {
        th.style.borderBottom = `3px solid ${color}`;
      }
      th.appendChild(sel);
      trSel.appendChild(th);
    }
    head.appendChild(trSel);

    // === Lignes de données ===
    for (const row of data.previewRows) {
      const rn = row._rowNum != null ? row._rowNum : ('idx_' + data.previewRows.indexOf(row));
      const isExcl = excluded.has(rn);
      const tr = document.createElement('tr');
      if (isExcl) tr.style.cssText = 'opacity:0.3;text-decoration:line-through';
      const tdA = document.createElement('td');
      tdA.style.cssText = 'text-align:center;padding:2px;position:sticky;left:0;background:var(--card);z-index:1';
      tdA.appendChild(isExcl ? makeRestoreBtn(rn) : makeDeleteBtn(rn));
      tr.appendChild(tdA);
      for (const h of data.headers) {
        const td = document.createElement('td');
        td.textContent = row[h.index] ?? '';
        const field = colFieldMap[h.index];
        if (field) {
          const c = colors[field];
          td.style.cssText = `background:${c}08;border-left:2px solid ${c}44`;
        }
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }

  // Back to step 1
  backBtn?.addEventListener('click', () => {
    persistActiveFileConfig(true);
    step1.classList.remove('hidden');
    step2.classList.add('hidden');
    step3.classList.add('hidden');
    updateImportFileSelectionUI();
  });

  cancelBtn?.addEventListener('click', closeModal);

  // Lancer l'import
  confirmBtn?.addEventListener('click', async () => {
    const selectedFiles = getSelectedImportFiles();
    if (!selectedFiles.length || !currentLot || !importState.preview) return;
    if (confirmBtn.disabled) return;
    persistActiveFileConfig(true);

    // Validation
    if (importState.mode === 'dpgf') {
      if (canUseDpgfMultiSheets()) {
        // Validation multi-onglets
        if (!Array.isArray(importState.selectedSheetsDpgf) || importState.selectedSheetsDpgf.length === 0) {
          showNotify({ title: 'Aucun onglet sélectionné', message: 'Sélectionnez au moins un onglet à importer.', type: 'error' });
          return;
        }
        if (!currentProject?.id) {
          showNotify({ title: 'Projet introuvable', message: 'Aucun projet sélectionné.', type: 'error' });
          return;
        }
        // Sauvegarder la config de l'onglet actif avant de valider tous les onglets
        saveDpgfSheetConfig(importState.preview?.selectedSheet);
        const invalidSheet = importState.selectedSheetsDpgf.find(sheet => {
          const cfg = importState.sheetConfigsDpgf?.[sheet];
          const d = cfg?.mapping?.designation;
          return !d || (Array.isArray(d) && d.length === 0);
        });
        if (invalidSheet) {
          showNotify({ title: 'Mapping incomplet', message: `L'onglet "${invalidSheet}" n'a pas de colonne Désignation mappée. Utilisez le sélecteur d'onglet pour configurer chaque onglet.`, type: 'error' });
          return;
        }
      } else {
        const desigArr = importState.mapping.designation;
        if (!desigArr || (Array.isArray(desigArr) && desigArr.length === 0)) {
          showNotify({ title: 'Mapping incomplet', message: 'Cochez au moins une colonne "Désignation" pour l\'import DPGF.', type: 'error' });
          return;
        }
      }
    }
    if (importState.mode === 'offer') {
      const batchMode = selectedFiles.length > 1;
      const compId = qs('#import-company-select')?.value;
      const compName = qs('#import-company-new')?.value?.trim();
      if (batchMode) {
        ensureFileConfigs();
        const missing = importState.fileConfigs
          .map((cfg, idx) => ({ idx, name: (cfg?.companyName || '').trim() }))
          .filter(x => !x.name);
        if (missing.length > 0) {
          const firstMissing = selectedFiles[missing[0].idx];
          showNotify({
            title: 'Entreprise manquante',
            message: `Renseignez une entreprise pour chaque fichier avant d'importer. Exemple manquant: ${firstMissing?.name || 'fichier #' + (missing[0].idx + 1)}.`,
            type: 'error'
          });
          step1.classList.remove('hidden');
          step2.classList.add('hidden');
          step3.classList.add('hidden');
          updateImportFileSelectionUI();
          return;
        }
      }
      if (!batchMode && !compId && !compName) {
        showNotify({ title: 'Entreprise requise', message: 'Sélectionnez une entreprise existante ou saisissez un nouveau nom.', type: 'error' });
        return;
      }
      if (!currentRound?.id) {
        showNotify({ title: 'Tour requis', message: 'Aucun tour sélectionné. Retournez à la liste des tours et sélectionnez un tour avant d\'importer une offre.', type: 'error' });
        return;
      }
      if (!importState.mapping.qty && !importState.mapping.unit_price && !importState.mapping.amount) {
        showNotify({ title: 'Mapping incomplet', message: 'Mappez au moins une colonne de données (Quantité, PU ou Montant).', type: 'error' });
        return;
      }
    }

    // Disable button & show loading state
    confirmBtn.disabled = true;
    const originalHTML = confirmBtn.innerHTML;
    confirmBtn.innerHTML = `<span class="spinner-small"></span> Import en cours…`;

    const params = {
      mode: importState.mode,
      sheetName: importState.preview.selectedSheet,
      headerRow: importState.preview.headerRow,
      mapping: importState.mapping,
      excludedRows: [...importState.excludedRows].filter(v => typeof v === 'number'),
      roundId: currentRound?.id || null,
      companyId: importState.mode === 'offer' ? (qs('#import-company-select')?.value || null) : null,
      companyName: importState.mode === 'offer' ? (qs('#import-company-new')?.value?.trim() || null) : null,
      fileId: importState.fileId || null,
      importOperation: 'replace',
    };

    try {
      showLoader();
      let finalResult;

      if (importState.mode === 'dpgf' && canUseDpgfMultiSheets()) {
        // Import DPGF multi-onglets : un lot créé par onglet
        const agg = { mode: 'dpgf-multi', lotsCreated: 0, itemsImported: 0, itemsUpdated: 0 };
        const file = selectedFiles[0];
        const selectedSheets = [...importState.selectedSheetsDpgf];
        for (let i = 0; i < selectedSheets.length; i++) {
          const sheetName = selectedSheets[i];
          const sheetCfg = importState.sheetConfigsDpgf?.[sheetName] || { mapping: normalizeMappingShape(importState.mapping), excludedRows: [] };
          confirmBtn.innerHTML = `<span class="spinner-small"></span> Import onglet ${i + 1}/${selectedSheets.length}…`;
          const sheetParams = {
            lotName: sheetName,
            lotCode: null,
            mapping: normalizeMappingShape(sheetCfg.mapping || {}),
            sheetName,
            headerRow: importState.preview.headerRow,
            excludedRows: Array.isArray(sheetCfg.excludedRows) ? sheetCfg.excludedRows.filter(v => typeof v === 'number') : [],
          };
          const formData = new FormData();
          formData.append('file', file);
          formData.append('params', JSON.stringify(sheetParams));
          const resp = await fetch(`${API_BASE}/projects/${currentProject.id}/import-dpgf`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
            credentials: 'include',
          });
          const result = await resp.json();
          if (!resp.ok) throw new Error(`Onglet "${sheetName}" : ${result.error || 'Erreur import'}`);
          agg.lotsCreated += 1;
          agg.itemsImported += Number(result.itemsImported || 0);
          agg.itemsUpdated += Number(result.itemsUpdated || 0);
        }
        finalResult = agg;
      } else if (importState.mode === 'offer' && selectedFiles.length > 1) {
        const aggregated = {
          mode: 'offer-batch',
          filesImported: 0,
          companiesCreated: 0,
          matched: 0,
          addedPostsCount: 0,
          skipped: 0,
          totalItems: 0,
          warnings: [],
        };

        for (let i = 0; i < selectedFiles.length; i += 1) {
          const file = selectedFiles[i];
          const cfg = importState.fileConfigs[i] || {};
          const mappingForFile = normalizeMappingShape(cfg.mapping || importState.globalMapping || importState.mapping || {});
          const excludedForFile = Array.isArray(cfg.excludedRows) ? cfg.excludedRows.filter(v => typeof v === 'number') : [];
          const perFileParams = {
            ...params,
            sheetName: cfg.sheetName || params.sheetName,
            headerRow: cfg.headerRow || params.headerRow,
            mapping: mappingForFile,
            excludedRows: excludedForFile,
            companyId: cfg.companyId || null,
            companyName: (cfg.companyName || '').trim(),
            fileId: null,
          };

          const formData = new FormData();
          formData.append('file', file);
          formData.append('params', JSON.stringify(perFileParams));

          confirmBtn.innerHTML = `<span class="spinner-small"></span> Import ${i + 1}/${selectedFiles.length}…`;

          const resp = await fetch(`${API_BASE}/lots/${currentLot.id}/import-apply`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
            credentials: 'include',
          });
          const result = await resp.json();
          if (!resp.ok) {
            throw new Error(`${file.name} : ${result.error || 'Erreur import'}`);
          }

          aggregated.filesImported += 1;
          aggregated.matched += Number(result.matched || 0);
          aggregated.addedPostsCount += Number(result.addedPostsCount || 0);
          aggregated.skipped += Number(result.skipped || 0);
          aggregated.totalItems = Math.max(aggregated.totalItems, Number(result.totalItems || 0));
          if (result.companyCreated) aggregated.companiesCreated += 1;
          if (Array.isArray(result.warnings) && result.warnings.length > 0) {
            aggregated.warnings.push(...result.warnings.map((w) => `${file.name}: ${w}`));
          }
        }

        finalResult = aggregated;
      } else {
        const formData = new FormData();
        // Envoyer le fichier uniquement si pas de fileId (fallback)
        if (!importState.fileId) formData.append('file', importState.file);
        formData.append('params', JSON.stringify(params));

        const resp = await fetch(`${API_BASE}/lots/${currentLot.id}/import-apply`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
          credentials: 'include',
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error || 'Erreur import');
        finalResult = result;
      }

      // Afficher résultat
      await clearImportDraft();
      renderStep3(finalResult);
      step1.classList.add('hidden');
      step2.classList.add('hidden');
      step3.classList.remove('hidden');
    } catch (err) {
      showNotify({ title: 'Erreur d\'import', message: err.message, type: 'error' });
    } finally {
      hideLoader();
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = originalHTML;
    }
  });

  function renderStep3(result) {
    const div = qs('#import-result');
    if (!div) return;

    if (result.mode === 'dpgf-multi') {
      div.innerHTML = `
        <div style="font-size:3em;margin-bottom:12px">${icon('check-circle')}</div>
        <h3 style="color:var(--success, #10b981);margin:0 0 12px 0">Import DPGF multi-onglets réussi</h3>
        <div style="display:flex;gap:24px;justify-content:center;flex-wrap:wrap">
          <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
            <div style="font-size:2em;font-weight:700">${result.lotsCreated || 0}</div>
            <div class="muted" style="font-size:0.85em">lots créés</div>
          </div>
          <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
            <div style="font-size:2em;font-weight:700">${result.itemsImported || 0}</div>
            <div class="muted" style="font-size:0.85em">articles créés</div>
          </div>
          <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
            <div style="font-size:2em;font-weight:700">${result.itemsUpdated || 0}</div>
            <div class="muted" style="font-size:0.85em">articles mis à jour</div>
          </div>
        </div>
      `;
    } else if (result.mode === 'dpgf') {
      div.innerHTML = `
        <div style="font-size:3em;margin-bottom:12px">${icon('check-circle')}</div>
        <h3 style="color:var(--success, #10b981);margin:0 0 12px 0">Import DPGF réussi</h3>
        <div style="display:flex;gap:24px;justify-content:center;flex-wrap:wrap">
          <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
            <div style="font-size:2em;font-weight:700">${result.itemsImported || 0}</div>
            <div class="muted" style="font-size:0.85em">articles créés</div>
          </div>
          <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
            <div style="font-size:2em;font-weight:700">${result.itemsUpdated || 0}</div>
            <div class="muted" style="font-size:0.85em">articles mis à jour</div>
          </div>
        </div>
      `;
    } else if (result.mode === 'offer-batch') {
      div.innerHTML = `
        <div style="font-size:3em;margin-bottom:12px">${icon('check-circle')}</div>
        <h3 style="color:var(--success, #10b981);margin:0 0 12px 0">Import multi-offres réussi</h3>
        <div style="display:flex;gap:24px;justify-content:center;flex-wrap:wrap">
          <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
            <div style="font-size:2em;font-weight:700">${result.filesImported || 0}</div>
            <div class="muted" style="font-size:0.85em">fichiers importés</div>
          </div>
          <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
            <div style="font-size:2em;font-weight:700">${result.matched || 0}</div>
            <div class="muted" style="font-size:0.85em">lignes importées</div>
          </div>
          <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
            <div style="font-size:2em;font-weight:700">${result.addedPostsCount || 0}</div>
            <div class="muted" style="font-size:0.85em">postes ajoutés</div>
          </div>
          <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
            <div style="font-size:2em;font-weight:700">${result.companiesCreated || 0}</div>
            <div class="muted" style="font-size:0.85em">entreprises créées</div>
          </div>
        </div>
        ${(result.warnings || []).length ? `
          <div style="margin-top:16px;padding:12px;background:var(--warning-bg, #fef3c7);border:1px solid var(--warning, #f59e0b);border-radius:8px;text-align:left;font-size:0.85em;color:var(--warning-fg, #3f2a00)">
            <strong style="color:var(--warning-strong, #7a4a00)">⚠ Attention :</strong>
            <ul style="margin:4px 0 0 16px;padding:0;max-height:180px;overflow:auto;color:var(--warning-fg, #3f2a00)">${(result.warnings || []).slice(0, 30).map(w => `<li>${w}</li>`).join('')}</ul>
          </div>
        ` : ''}
      `;
    } else {
      div.innerHTML = `
        <div style="font-size:3em;margin-bottom:12px">${icon('check-circle')}</div>
        <h3 style="color:var(--success, #10b981);margin:0 0 12px 0">Import Offre réussi</h3>
        <div style="display:flex;gap:24px;justify-content:center;flex-wrap:wrap">
          <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
            <div style="font-size:2em;font-weight:700">${result.matched || 0}</div>
            <div class="muted" style="font-size:0.85em">lignes importées</div>
          </div>
          <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
            <div style="font-size:2em;font-weight:700">${result.addedPostsCount || 0}</div>
            <div class="muted" style="font-size:0.85em">postes ajoutés</div>
          </div>
          <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
            <div style="font-size:2em;font-weight:700">${result.skipped || 0}</div>
            <div class="muted" style="font-size:0.85em">lignes vides ignorées</div>
          </div>
          <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
            <div style="font-size:2em;font-weight:700">${result.totalItems || 0}</div>
            <div class="muted" style="font-size:0.85em">articles DPGF</div>
          </div>
        </div>
        ${(result.warnings || []).length ? `
          <div style="margin-top:16px;padding:12px;background:var(--warning-bg, #fef3c7);border:1px solid var(--warning, #f59e0b);border-radius:8px;text-align:left;font-size:0.85em;color:var(--warning-fg, #3f2a00)">
            <strong style="color:var(--warning-strong, #7a4a00)">⚠ Attention :</strong>
            <ul style="margin:4px 0 0 16px;padding:0;color:var(--warning-fg, #3f2a00)">${(result.warnings || []).map(w => `<li>${w}</li>`).join('')}</ul>
          </div>
        ` : ''}
        ${result.addedPostsCount > 0 ? `
          <div style="margin-top:16px;text-align:left;border:2px solid var(--warning, #f59e0b);border-radius:8px;overflow:hidden">
            <div style="background:var(--warning, #f59e0b);color:#fff;padding:10px 16px;font-weight:700;font-size:0.9em;display:flex;align-items:center;gap:8px">
              <span style="font-size:1.2em">📋</span> Postes ajoutés par l'entreprise (${result.addedPostsCount})
            </div>
            <div style="padding:12px;font-size:0.8em;color:var(--muted);background:var(--warning-bg, #fef3c7)">
              Ces lignes de l'offre entreprise ne correspondent à aucun article de la DPGF MOE. L'entreprise a ajouté ces postes supplémentaires dans son offre.
            </div>
            <div style="max-height:350px;overflow-y:auto">
              <table style="font-size:0.8em;width:100%;border-collapse:collapse">
                <thead style="position:sticky;top:0;background:var(--card-bg)">
                  <tr>
                    <th style="padding:6px 8px;border-bottom:2px solid var(--border);text-align:left;white-space:nowrap">Ligne Excel</th>
                    <th style="padding:6px 8px;border-bottom:2px solid var(--border);text-align:left">N°</th>
                    <th style="padding:6px 8px;border-bottom:2px solid var(--border);text-align:left">Désignation entreprise</th>
                    <th style="padding:6px 8px;border-bottom:2px solid var(--border);text-align:right">Qté</th>
                    <th style="padding:6px 8px;border-bottom:2px solid var(--border);text-align:right">PU</th>
                    <th style="padding:6px 8px;border-bottom:2px solid var(--border);text-align:right">Montant</th>
                    <th style="padding:6px 8px;border-bottom:2px solid var(--border);text-align:left">Contexte DPGF</th>
                  </tr>
                </thead>
                <tbody>
                  ${(result.addedPosts || []).map(p => {
                    const ctx = p.context || {};
                    let ctxHtml = '';
                    if (ctx.afterDpgfDesignation) {
                      ctxHtml += `<div style="font-size:0.85em;color:var(--muted)">Après : <em>${ctx.afterDpgfNum ? ctx.afterDpgfNum + ' – ' : ''}${ctx.afterDpgfDesignation}</em></div>`;
                    }
                    if (ctx.expectedDpgfDesignation) {
                      ctxHtml += `<div style="font-size:0.85em;color:var(--muted)">Attendu : <em>${ctx.expectedDpgfNum ? ctx.expectedDpgfNum + ' – ' : ''}${ctx.expectedDpgfDesignation}</em></div>`;
                    }
                    if (p.parentItemId || p.parentNum || p.parentDesignation) {
                      ctxHtml += `<div style="font-size:0.85em;color:var(--muted)">Parent : <em>${p.parentNum ? p.parentNum + ' - ' : ''}${p.parentDesignation || 'parent DPGF'}</em></div>`;
                    }
                    const fmtNum = (v) => v != null ? Number(v).toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2}) : '-';
                    return `<tr style="border-bottom:1px solid var(--border)">
                      <td style="padding:6px 8px;white-space:nowrap">${p.row}</td>
                      <td style="padding:6px 8px">${p.num || '-'}</td>
                      <td style="padding:6px 8px;max-width:250px">${p.designation}</td>
                      <td style="padding:6px 8px;text-align:right">${fmtNum(p.qty)}</td>
                      <td style="padding:6px 8px;text-align:right">${fmtNum(p.unit_price)}</td>
                      <td style="padding:6px 8px;text-align:right">${fmtNum(p.amount)}</td>
                      <td style="padding:6px 8px">${ctxHtml || '<span class="muted">-</span>'}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        ${result.unmatchedDpgfCount > 0 ? `
          <details style="margin-top:12px;text-align:left">
            <summary style="cursor:pointer;font-weight:600;font-size:0.85em;color:var(--danger, #ef4444)">
              Articles DPGF non couverts par l'offre (${result.unmatchedDpgfCount})
            </summary>
            <table style="font-size:0.8em;margin-top:8px;width:100%">
              <thead><tr><th>Pos.</th><th>N°</th><th>Désignation</th></tr></thead>
              <tbody>
                ${(result.unmatchedDpgf || []).map(d => `<tr><td>${d.position ?? '-'}</td><td>${d.num || '-'}</td><td>${d.designation || '-'}</td></tr>`).join('')}
              </tbody>
            </table>
          </details>
        ` : ''}
        ${result.matchDetails?.length ? `
          <details style="margin-top:12px;text-align:left">
            <summary style="cursor:pointer;font-weight:600;font-size:0.85em">Détails du matching (${result.matchDetails.length} premières lignes)</summary>
            <table style="font-size:0.8em;margin-top:8px;width:100%">
              <thead><tr><th>Ligne</th><th>N° import</th><th>Désignation import</th><th>N° DPGF</th><th>Désignation DPGF</th><th>Match</th></tr></thead>
              <tbody>
                ${result.matchDetails.map(d => `<tr>
                  <td>${d.row}</td>
                  <td>${d.num || '-'}</td>
                  <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${d.importDesignation || '-'}</td>
                  <td>${d.dpgfNum || '-'}</td>
                  <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${d.dpgfDesignation || '-'}</td>
                  <td><span class="chip" style="font-size:0.75em">${d.matchMethod} (${d.matchScore}%)</span></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </details>
        ` : ''}
      `;
    }
  }

  // Fermer et recharger
  doneBtn?.addEventListener('click', async () => {
    closeModal();
    if (currentLot) {
      // Recharger le lot complet
      await openLot(currentLot.id, { name: currentLot.name, code: currentLot.code });
    }
  });
}

/* ================== IMPORT DPGF → CRÉATION DE LOTS ================== */
function bindImportDpgfLots() {
  const modal       = qs('#import-dpgf-lots-modal');
  if (!modal) return;
  const closeBtn    = qs('#idl-modal-close');
  const fileInput   = qs('#idl-file-input');
  const filesList   = qs('#idl-files-list');
  const cancelBtn   = qs('#idl-cancel');
  const goStep2Btn  = qs('#idl-go-step2');
  const step1       = qs('#idl-step-1');
  const step2       = qs('#idl-step-2');
  const step3       = qs('#idl-step-3');
  const backBtn     = qs('#idl-back-step1');
  const toggleControlsBtn = qs('#idl-toggle-controls');
  const headerRowInput = qs('#idl-header-row');
  const sheetSelect = qs('#idl-sheet-select');
  const fileNavWrap = qs('#idl-file-nav');
  const prevFileBtn = qs('#idl-prev-file');
  const nextFileBtn = qs('#idl-next-file');
  const currentFileLabel = qs('#idl-current-file');
  const multiSheetsWrap = qs('#idl-multi-sheets');
  const multiSheetsAll = qs('#idl-sheets-all');
  const multiSheetsList = qs('#idl-sheets-list');
  const confirmBtn  = qs('#idl-confirm');
  const cancelBtn2  = qs('#idl-cancel2');
  const doneBtn     = qs('#idl-done');
  const totalRowsSpan = qs('#idl-total-rows');

  let idlControlsCollapsed = true;

  function setIdlControlsCollapsed(collapsed) {
    idlControlsCollapsed = !!collapsed;
    step2?.classList.toggle('is-collapsed-controls', idlControlsCollapsed);
    if (toggleControlsBtn) {
      toggleControlsBtn.textContent = idlControlsCollapsed ? '▸ Options' : '▾ Options';
      toggleControlsBtn.setAttribute('aria-expanded', idlControlsCollapsed ? 'false' : 'true');
    }
  }

  let idlState = {
    files: [],
    lotNames: [],
    fileConfigs: [],
    activeFileIndex: 0,
    preview: null,
    mapping: {},
    sheetName: null,
    headerRow: 1,
    excludedRows: new Set(),
    selectedSheets: [],
    sheetConfigs: {},
    baseMapping: null,
    primarySheet: null,
  };

  function openModal() {
    idlState = {
      files: [],
      lotNames: [],
      fileConfigs: [],
      activeFileIndex: 0,
      preview: null,
      mapping: {},
      sheetName: null,
      headerRow: 1,
      excludedRows: new Set(),
      selectedSheets: [],
      sheetConfigs: {},
      baseMapping: null,
      primarySheet: null,
    };
    step1.classList.remove('hidden');
    step2.classList.add('hidden');
    step3.classList.add('hidden');
    fileInput.value = '';
    filesList.innerHTML = '';
    if (multiSheetsList) multiSheetsList.innerHTML = '';
    if (multiSheetsWrap) multiSheetsWrap.classList.add('hidden');
    if (fileNavWrap) fileNavWrap.classList.add('hidden');
    if (multiSheetsAll) multiSheetsAll.checked = true;
    goStep2Btn.disabled = true;
    setIdlControlsCollapsed(true);
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function closeModal() {
    const wasImported = !step3.classList.contains('hidden');
    modal.classList.add('hidden');
    modal.style.display = 'none';
    setIdlControlsCollapsed(true);
    if (wasImported) loadLotsForRound().catch(() => {});
  }

  function deriveLotName(filename) {
    return filename.replace(/\.(xlsx?|xlsm|pdf)$/i, '').replace(/[_-]+/g, ' ').trim();
  }

  function isExcelFile(file) {
    return !!file?.name && /\.(xlsx?|xlsm)$/i.test(file.name);
  }

  function canUseMultiSheets() {
    const activeFile = idlState.files[idlState.activeFileIndex] || idlState.files[0];
    return !!activeFile
      && isExcelFile(activeFile)
      && Array.isArray(idlState.preview?.sheets)
      && idlState.preview.sheets.length > 1;
  }

  function hasUsableIdlMapping(mapping) {
    const designation = mapping?.designation;
    if (Array.isArray(designation)) return designation.length > 0;
    return designation != null;
  }

  function cloneSheetConfig(cfg) {
    return {
      mapping: normIdlMapping(cfg?.mapping || {}),
      excludedRows: Array.isArray(cfg?.excludedRows) ? [...cfg.excludedRows].filter(v => typeof v === 'number') : [],
      mappingCustomized: !!cfg?.mappingCustomized,
    };
  }

  function createIdlFileConfig() {
    return {
      preview: null,
      mapping: null,
      sheetName: null,
      headerRow: 1,
      excludedRows: [],
      selectedSheets: [],
      sheetConfigs: {},
      baseMapping: null,
      primarySheet: null,
    };
  }

  function cloneIdlSheetConfigs(cfgs) {
    const result = {};
    Object.entries(cfgs || {}).forEach(([sheet, cfg]) => {
      result[sheet] = cloneSheetConfig(cfg);
    });
    return result;
  }

  function ensureIdlFileConfigs() {
    while (idlState.fileConfigs.length < idlState.files.length) {
      idlState.fileConfigs.push(createIdlFileConfig());
    }
    if (idlState.fileConfigs.length > idlState.files.length) {
      idlState.fileConfigs = idlState.fileConfigs.slice(0, idlState.files.length);
    }
  }

  function getIdlFileConfig(index = idlState.activeFileIndex || 0) {
    ensureIdlFileConfigs();
    return idlState.fileConfigs[index] || null;
  }

  function syncIdlStateToActiveFileConfig() {
    const cfg = getIdlFileConfig();
    if (!cfg) return;
    cfg.preview = idlState.preview;
    cfg.mapping = normIdlMapping(idlState.mapping);
    cfg.sheetName = idlState.sheetName;
    cfg.headerRow = idlState.headerRow;
    cfg.excludedRows = [...idlState.excludedRows].filter(v => typeof v === 'number');
    cfg.selectedSheets = Array.isArray(idlState.selectedSheets) ? [...idlState.selectedSheets] : [];
    cfg.sheetConfigs = cloneIdlSheetConfigs(idlState.sheetConfigs);
    cfg.baseMapping = idlState.baseMapping ? normIdlMapping(idlState.baseMapping) : null;
    cfg.primarySheet = idlState.primarySheet || null;
  }

  function loadIdlFileState(index) {
    const cfg = getIdlFileConfig(index);
    if (!cfg) return;
    idlState.activeFileIndex = index;
    idlState.preview = cfg.preview || null;
    idlState.mapping = normIdlMapping(cfg.mapping || {});
    idlState.sheetName = cfg.sheetName || null;
    idlState.headerRow = cfg.headerRow || 1;
    idlState.excludedRows = new Set((cfg.excludedRows || []).filter(v => typeof v === 'number'));
    idlState.selectedSheets = Array.isArray(cfg.selectedSheets) ? [...cfg.selectedSheets] : [];
    idlState.sheetConfigs = cloneIdlSheetConfigs(cfg.sheetConfigs);
    idlState.baseMapping = cfg.baseMapping ? normIdlMapping(cfg.baseMapping) : null;
    idlState.primarySheet = cfg.primarySheet || null;
  }

  function updateIdlFileNavigatorUI() {
    if (!fileNavWrap || !prevFileBtn || !nextFileBtn || !currentFileLabel) return;
    if (idlState.files.length <= 1) {
      fileNavWrap.classList.add('hidden');
      return;
    }
    const idx = Math.max(0, Math.min(idlState.activeFileIndex || 0, idlState.files.length - 1));
    idlState.activeFileIndex = idx;
    prevFileBtn.disabled = idx === 0;
    nextFileBtn.disabled = idx >= idlState.files.length - 1;
    currentFileLabel.textContent = `Fichier ${idx + 1}/${idlState.files.length}: ${idlState.files[idx]?.name || ''}`;
    fileNavWrap.classList.remove('hidden');
  }

  function ensureSheetConfigsFromPreview(data) {
    const sheets = Array.isArray(data?.sheets) ? data.sheets : [];
    if (!sheets.length) return;

    if (!idlState.sheetConfigs || typeof idlState.sheetConfigs !== 'object') {
      idlState.sheetConfigs = {};
    }

    for (const sheet of sheets) {
      if (!idlState.sheetConfigs[sheet]) {
        idlState.sheetConfigs[sheet] = cloneSheetConfig({
          mapping: idlState.baseMapping || data.suggestedMapping || {},
          excludedRows: [],
          mappingCustomized: false,
        });
      }
    }
  }

  function propagatePrimaryMapping() {
    if (!idlState.primarySheet || !idlState.sheetConfigs?.[idlState.primarySheet]) return;
    const primaryMapping = normIdlMapping(idlState.sheetConfigs[idlState.primarySheet].mapping);
    idlState.baseMapping = normIdlMapping(primaryMapping);
    Object.entries(idlState.sheetConfigs || {}).forEach(([sheet, cfg]) => {
      if (sheet === idlState.primarySheet) return;
      if (cfg?.mappingCustomized) return;
      idlState.sheetConfigs[sheet] = cloneSheetConfig({
        ...cfg,
        mapping: primaryMapping,
      });
    });
  }

  function saveActiveSheetConfig() {
    if (!idlState.sheetName) return;
    if (!idlState.sheetConfigs || typeof idlState.sheetConfigs !== 'object') idlState.sheetConfigs = {};
    idlState.sheetConfigs[idlState.sheetName] = cloneSheetConfig({
      mapping: normIdlMapping(idlState.mapping),
      excludedRows: [...idlState.excludedRows].filter(v => typeof v === 'number'),
      mappingCustomized: idlState.sheetConfigs?.[idlState.sheetName]?.mappingCustomized || false,
    });
    if (idlState.primarySheet && idlState.sheetName === idlState.primarySheet) {
      propagatePrimaryMapping();
    }
  }

  function loadSheetConfig(sheetName, data) {
    const cfg = idlState.sheetConfigs?.[sheetName] || cloneSheetConfig({ mapping: idlState.baseMapping || data?.suggestedMapping || {}, excludedRows: [] });
    idlState.mapping = normIdlMapping(cfg.mapping);
    idlState.excludedRows = new Set((cfg.excludedRows || []).filter(v => typeof v === 'number'));
  }

  function isSheetMappingCustomized(sheetName) {
    return !!idlState.sheetConfigs?.[sheetName]?.mappingCustomized;
  }

  function sheetLabelWithIndicator(sheetName) {
    return isSheetMappingCustomized(sheetName) ? `${sheetName} ✎` : sheetName;
  }

  function refreshSheetIndicators() {
    if (sheetSelect) {
      Array.from(sheetSelect.options || []).forEach((opt) => {
        const s = opt.value;
        opt.textContent = sheetLabelWithIndicator(s);
      });
    }

    if (multiSheetsList) {
      const chips = multiSheetsList.querySelectorAll('label[data-sheet-name]');
      chips.forEach((chip) => {
        const s = chip.dataset.sheetName;
        const txt = chip.querySelector('span');
        if (txt) txt.textContent = sheetLabelWithIndicator(s);
        chip.style.borderColor = isSheetMappingCustomized(s) ? 'var(--warning,#f59e0b)' : 'var(--border)';
      });
    }
  }

  // Normalize mapping: num & designation must be arrays
  function normIdlMapping(m) {
    const r = { ...(m || {}) };
    if (Array.isArray(r.num)) r.num = [...r.num];
    if (Array.isArray(r.designation)) r.designation = [...r.designation];
    if (r.num != null && !Array.isArray(r.num)) r.num = [r.num];
    if (r.designation != null && !Array.isArray(r.designation)) r.designation = [r.designation];
    return r;
  }

  function updateFilesList() {
    filesList.innerHTML = '';
    if (idlState.files.length === 0) return;
    const container = document.createElement('div');
    container.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    idlState.files.forEach((file, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 12px;background:var(--input-bg);border:1px solid var(--border);border-radius:8px;border-left:3px solid var(--primary,#6b8afd)';

      const nameLabel = document.createElement('span');
      nameLabel.style.cssText = 'flex:0 0 auto;font-size:0.8em;color:var(--muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      nameLabel.textContent = file.name;
      nameLabel.title = file.name;

      const codeInput = document.createElement('input');
      codeInput.type = 'text';
      codeInput.placeholder = 'Code (opt.)';
      codeInput.value = idlState.lotNames[idx]?.code || '';
      codeInput.style.cssText = 'width:90px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--fg);font-size:0.82em';
      codeInput.addEventListener('input', () => {
        if (!idlState.lotNames[idx]) idlState.lotNames[idx] = { name: '', code: '' };
        idlState.lotNames[idx].code = codeInput.value;
      });

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Nom du lot *';
      nameInput.value = idlState.lotNames[idx]?.name || deriveLotName(file.name);
      nameInput.style.cssText = 'flex:1;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--fg);font-size:0.82em';
      nameInput.addEventListener('input', () => {
        if (!idlState.lotNames[idx]) idlState.lotNames[idx] = { name: '', code: '' };
        idlState.lotNames[idx].name = nameInput.value;
        validateStep1();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.innerHTML = '×';
      removeBtn.title = 'Retirer ce fichier';
      removeBtn.style.cssText = 'flex:0 0 auto;background:none;border:none;color:var(--danger,#f87171);cursor:pointer;font-size:1.3em;font-weight:700;padding:0 4px;line-height:1';
      removeBtn.addEventListener('click', () => {
        idlState.files.splice(idx, 1);
        idlState.lotNames.splice(idx, 1);
        if (idlState.fileConfigs.length > idx) idlState.fileConfigs.splice(idx, 1);
        if (idlState.activeFileIndex >= idlState.files.length) {
          idlState.activeFileIndex = Math.max(0, idlState.files.length - 1);
        }
        updateFilesList();
        updateIdlFileNavigatorUI();
        validateStep1();
      });

      row.appendChild(nameLabel);
      row.appendChild(codeInput);
      row.appendChild(nameInput);
      row.appendChild(removeBtn);
      container.appendChild(row);
    });
    filesList.appendChild(container);
  }

  function validateStep1() {
    const ok = idlState.files.length > 0 && idlState.files.every((f, i) => {
      const name = (idlState.lotNames[i]?.name || deriveLotName(f.name)).trim();
      return name.length > 0;
    });
    goStep2Btn.disabled = !ok;
  }

  function syncNamesFromDOM() {
    const nameInputs = filesList.querySelectorAll('input[placeholder="Nom du lot *"]');
    const codeInputs = filesList.querySelectorAll('input[placeholder="Code (opt.)"]');
    idlState.files.forEach((f, i) => {
      if (!idlState.lotNames[i]) idlState.lotNames[i] = { name: '', code: '' };
      idlState.lotNames[i].name = (nameInputs[i]?.value || deriveLotName(f.name)).trim();
      idlState.lotNames[i].code = (codeInputs[i]?.value || '').trim();
    });
  }

  fileInput.addEventListener('change', () => {
    Array.from(fileInput.files || []).forEach(f => {
      const exists = idlState.files.some(e => e.name === f.name && e.size === f.size);
      if (!exists) {
        idlState.files.push(f);
        idlState.lotNames.push({ name: deriveLotName(f.name), code: '' });
      }
    });
    ensureIdlFileConfigs();
    fileInput.value = '';
    updateFilesList();
    updateIdlFileNavigatorUI();
    validateStep1();
  });

  closeBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  cancelBtn?.addEventListener('click', closeModal);
  cancelBtn2?.addEventListener('click', closeModal);

  goStep2Btn?.addEventListener('click', async () => {
    if (!idlState.files.length || !currentProject) return;
    syncNamesFromDOM();
    ensureIdlFileConfigs();
    idlState.activeFileIndex = 0;
    if (headerRowInput) headerRowInput.value = getIdlFileConfig(0)?.headerRow || 1;
    updateIdlFileNavigatorUI();
    await doIdlPreview(idlState.files[0]);
  });

  backBtn?.addEventListener('click', () => {
    saveActiveSheetConfig();
    syncIdlStateToActiveFileConfig();
    step1.classList.remove('hidden');
    step2.classList.add('hidden');
    step3.classList.add('hidden');
    setIdlControlsCollapsed(true);
  });

  toggleControlsBtn?.addEventListener('click', () => {
    setIdlControlsCollapsed(!idlControlsCollapsed);
  });

  prevFileBtn?.addEventListener('click', async () => {
    if (idlState.activeFileIndex <= 0 || idlState.files.length < 2) return;
    saveActiveSheetConfig();
    syncIdlStateToActiveFileConfig();
    idlState.activeFileIndex -= 1;
    if (headerRowInput) headerRowInput.value = getIdlFileConfig(idlState.activeFileIndex)?.headerRow || 1;
    updateIdlFileNavigatorUI();
    await doIdlPreview(idlState.files[idlState.activeFileIndex]);
  });

  nextFileBtn?.addEventListener('click', async () => {
    if (idlState.activeFileIndex >= idlState.files.length - 1 || idlState.files.length < 2) return;
    saveActiveSheetConfig();
    syncIdlStateToActiveFileConfig();
    idlState.activeFileIndex += 1;
    if (headerRowInput) headerRowInput.value = getIdlFileConfig(idlState.activeFileIndex)?.headerRow || 1;
    updateIdlFileNavigatorUI();
    await doIdlPreview(idlState.files[idlState.activeFileIndex]);
  });

  sheetSelect?.addEventListener('change', () => {
    // En mode multi-feuilles, on sauvegarde le mapping et exclusions de l'onglet actuel
    // puis on charge ceux du nouvel onglet (qui peut être différent si les colonnes varient)
    const activeFile = idlState.files[idlState.activeFileIndex] || idlState.files[0];
    if (canUseMultiSheets()) {
      saveActiveSheetConfig();
      doIdlPreviewDataOnly(sheetSelect.value);
    } else {
      saveActiveSheetConfig();
      if (activeFile) doIdlPreview(activeFile, sheetSelect.value);
    }
  });

  let headerDebounce = null;
  headerRowInput?.addEventListener('change', () => {
    clearTimeout(headerDebounce);
    headerDebounce = setTimeout(() => {
      const val = Number(headerRowInput.value);
      if (val >= 1 && val <= 100 && idlState.preview) {
        idlState.headerRow = val;
        const activeFile = idlState.files[idlState.activeFileIndex] || idlState.files[0];
        if (activeFile) doIdlPreview(activeFile, sheetSelect?.value || null);
      }
    }, 400);
  });

  async function doIdlPreview(file, sheetName = null) {
    if (!file || !currentProject) return;
    if (idlState.preview && idlState.sheetName) saveActiveSheetConfig();
    ensureIdlFileConfigs();
    const fileIdx = Math.max(0, idlState.files.indexOf(file));
    const cfg = getIdlFileConfig(fileIdx);
    idlState.activeFileIndex = fileIdx;
    idlState.selectedSheets = Array.isArray(cfg?.selectedSheets) ? [...cfg.selectedSheets] : [];
    idlState.sheetConfigs = cloneIdlSheetConfigs(cfg?.sheetConfigs);
    idlState.baseMapping = cfg?.baseMapping ? normIdlMapping(cfg.baseMapping) : null;
    idlState.primarySheet = cfg?.primarySheet || null;
    const requestedSheet = sheetName || cfg?.sheetName || null;
    const requestedHeader = Number(headerRowInput?.value) || 0;
    const headerRow = requestedHeader >= 1 ? requestedHeader : (cfg?.headerRow || 1);
    const formData = new FormData();
    formData.append('file', file);
    if (requestedSheet) formData.append('sheetName', requestedSheet);
    if (headerRow >= 1) formData.append('headerRow', String(headerRow));
    try {
      showLoader();
      const resp = await fetch(`${API_BASE}/projects/${currentProject.id}/import-dpgf-preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        credentials: 'include',
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Erreur preview');
      idlState.preview = data;
      if (headerRowInput) headerRowInput.value = data.headerRow || 1;
      idlState.headerRow = data.headerRow || 1;
      idlState.sheetName = data.selectedSheet || null;

      ensureSheetConfigsFromPreview(data);
      loadSheetConfig(idlState.sheetName, data);

      const availableSheets = Array.isArray(data.sheets) ? data.sheets : [];
      if (!Array.isArray(idlState.selectedSheets) || idlState.selectedSheets.length === 0) {
        idlState.selectedSheets = [...availableSheets];
      } else {
        idlState.selectedSheets = idlState.selectedSheets.filter(s => availableSheets.includes(s));
        if (idlState.selectedSheets.length === 0) idlState.selectedSheets = [...availableSheets];
      }

      syncIdlStateToActiveFileConfig();

      renderIdlStep2();
      updateIdlFileNavigatorUI();
      step1.classList.add('hidden');
      step2.classList.remove('hidden');
      step3.classList.add('hidden');
      setIdlControlsCollapsed(true);
    } catch (err) {
      showNotify({ title: 'Erreur', message: err.message, type: 'error' });
    } finally {
      hideLoader();
    }
  }

  async function doIdlPreviewDataOnly(sheetName = null) {
    // En mode multi-feuilles : recharge les données du nouvel onglet
    // Le mapping du premier onglet configuré s'applique par défaut à tous
    // Mais on peut le modifier au cas par cas si les colonnes sont différentes
    if (!idlState.files.length || !currentProject) return;
    const file = idlState.files[idlState.activeFileIndex] || idlState.files[0];
    const headerRow = Number(headerRowInput?.value) || 1;
    const formData = new FormData();
    formData.append('file', file);
    if (sheetName) formData.append('sheetName', sheetName);
    if (headerRow >= 1) formData.append('headerRow', String(headerRow));
    try {
      showLoader();
      const resp = await fetch(`${API_BASE}/projects/${currentProject.id}/import-dpgf-preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        credentials: 'include',
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Erreur preview');
      
      // Mettre à jour les données et le nom de l'onglet actuel
      idlState.preview = data;
      idlState.sheetName = data.selectedSheet || null;
      
      // Initialize ou récupérer la config de ce nouvel onglet
      if (idlState.sheetName && !idlState.sheetConfigs[idlState.sheetName]) {
        // Première visite : hériter du mapping de base s'il existe, sinon du mapping suggéré
        idlState.sheetConfigs[idlState.sheetName] = cloneSheetConfig({
          mapping: idlState.baseMapping || data.suggestedMapping || {},
          excludedRows: new Set(),
        });
      }
      
      // Charger le mapping et excludedRows de cet onglet
      loadSheetConfig(idlState.sheetName, data);
      syncIdlStateToActiveFileConfig();
      
      renderIdlPreviewTable();
    } catch (err) {
      showNotify({ title: 'Erreur', message: err.message, type: 'error' });
    } finally {
      hideLoader();
    }
  }

  function renderIdlStep2() {
    const data = idlState.preview;
    if (!data) return;
    updateIdlFileNavigatorUI();
    sheetSelect.innerHTML = '';
    for (const s of data.sheets) {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = sheetLabelWithIndicator(s);
      if (s === data.selectedSheet) opt.selected = true;
      sheetSelect.appendChild(opt);
    }

    if (multiSheetsWrap && multiSheetsList && multiSheetsAll) {
      if (canUseMultiSheets()) {
        multiSheetsWrap.classList.remove('hidden');
        // Ajouter un message explicatif
        let infoMsg = multiSheetsWrap.querySelector('.idl-multi-sheets-info');
        if (!infoMsg) {
          infoMsg = document.createElement('div');
          infoMsg.className = 'idl-multi-sheets-info';
          infoMsg.style.cssText = 'padding:8px 12px;margin-bottom:12px;background:var(--info,#dbeafe);border:1px solid var(--info-border,#93c5fd);border-radius:4px;font-size:0.85em;color:var(--text);line-height:1.4';
          infoMsg.innerHTML = '<strong>ℹ️ Info :</strong> Le mapping du premier onglet configuré s\'applique par défaut aux onglets non personnalisés. Vous pouvez visualiser et modifier le mapping et les exclusions pour chaque onglet si les colonnes varient.';
          multiSheetsWrap.insertBefore(infoMsg, multiSheetsWrap.firstChild);
        }
        multiSheetsList.innerHTML = '';
        const selected = new Set(idlState.selectedSheets || []);
        for (const s of data.sheets) {
          const chip = document.createElement('label');
          chip.dataset.sheetName = s;
          chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid var(--border);border-radius:999px;background:var(--card);font-size:0.8em;cursor:pointer';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = selected.has(s);
          cb.addEventListener('change', () => {
            if (cb.checked) selected.add(s);
            else selected.delete(s);
            idlState.selectedSheets = [...selected];
            multiSheetsAll.checked = idlState.selectedSheets.length === data.sheets.length;
          });
          const txt = document.createElement('span');
          txt.textContent = sheetLabelWithIndicator(s);
          chip.appendChild(cb);
          chip.appendChild(txt);
          multiSheetsList.appendChild(chip);
        }
        multiSheetsAll.checked = (idlState.selectedSheets || []).length === data.sheets.length;
      } else {
        multiSheetsWrap.classList.add('hidden');
        multiSheetsList.innerHTML = '';
      }
    }

    refreshSheetIndicators();
    totalRowsSpan.textContent = data.totalRows;
    renderIdlPreviewTable();
  }

  multiSheetsAll?.addEventListener('change', () => {
    const data = idlState.preview;
    if (!data || !canUseMultiSheets()) return;
    idlState.selectedSheets = multiSheetsAll.checked ? [...data.sheets] : [];
    syncIdlStateToActiveFileConfig();
    renderIdlStep2();
  });

  function renderIdlPreviewTable() {
    const data = idlState.preview;
    if (!data) return;
    const mapping = idlState.mapping;
    const excluded = idlState.excludedRows;
    const head = qs('#idl-preview-head');
    const body = qs('#idl-preview-body');
    head.innerHTML = '';
    body.innerHTML = '';

    const fieldOptions = [
      { key: '', label: '—' },
      { key: 'num', label: 'N° Article' },
      { key: 'designation', label: 'Désignation' },
      { key: 'unit', label: 'Unité' },
      { key: 'qty', label: 'Quantité MOE' },
      { key: 'unit_price', label: 'Prix Unit. MOE' },
      { key: 'amount', label: 'Montant MOE' },
    ];
    const colors = { num: '#6b8afd', designation: '#c4b5fd', unit: '#86efac', qty: '#fbbf24', unit_price: '#f87171', amount: '#38bdf8' };
    const multiFields = new Set(['num', 'designation']);

    const activeCount = data.totalRows - excluded.size;
    totalRowsSpan.textContent = `${activeCount} / ${data.totalRows}`;

    function makeDeleteBtn(rowNum) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '×';
      btn.title = 'Supprimer cette ligne';
      btn.style.cssText = 'background:none;border:none;color:var(--danger, #f87171);cursor:pointer;font-size:1.1em;font-weight:700;padding:0 4px;line-height:1';
      btn.addEventListener('click', () => {
        excluded.add(rowNum);
        syncIdlStateToActiveFileConfig();
        renderIdlPreviewTable();
      });
      return btn;
    }

    function makeRestoreBtn(rowNum) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '↩';
      btn.title = 'Restaurer cette ligne';
      btn.style.cssText = 'background:none;border:none;color:var(--success, #10b981);cursor:pointer;font-size:1em;padding:0 4px;line-height:1';
      btn.addEventListener('click', () => {
        excluded.delete(rowNum);
        syncIdlStateToActiveFileConfig();
        renderIdlPreviewTable();
      });
      return btn;
    }

    // Inverse map colIndex → field
    const colFieldMap = {};
    for (const [field, val] of Object.entries(mapping)) {
      if (val == null) continue;
      if (multiFields.has(field)) {
        (Array.isArray(val) ? val : [val]).forEach(ci => { colFieldMap[ci] = field; });
      } else {
        colFieldMap[val] = field;
      }
    }

    // Header row with selects
    const trSel = document.createElement('tr');
    const thAction = document.createElement('th');
    thAction.style.cssText = 'width:32px;position:sticky;left:0;z-index:3;background:var(--card)';
    trSel.appendChild(thAction);
    const thRowNum = document.createElement('th');
    thRowNum.style.cssText = 'width:46px;position:sticky;left:32px;z-index:3;background:var(--card);text-align:right;padding-right:8px';
    thRowNum.textContent = '#';
    trSel.appendChild(thRowNum);

    for (const h of data.headers) {
      const th = document.createElement('th');
      th.style.cssText = 'padding:4px;vertical-align:top;position:sticky;top:0;z-index:2;background:var(--card)';
      const curField = colFieldMap[h.index] || '';
      const color = curField ? (colors[curField] || 'transparent') : 'transparent';

      const sel = document.createElement('select');
      sel.dataset.colIdx = h.index;
      sel.style.cssText = `width:100%;padding:4px 2px;border-radius:4px;border:2px solid ${color};background:${color}18;color:var(--fg);font-size:0.72em;font-weight:600;cursor:pointer`;
      for (const fo of fieldOptions) {
        const opt = document.createElement('option');
        opt.value = fo.key; opt.textContent = fo.label;
        if (fo.key === curField) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => {
        const colIdx = Number(sel.dataset.colIdx);
        const newField = sel.value;
        const oldField = colFieldMap[colIdx] || '';
        if (oldField) {
          if (multiFields.has(oldField)) {
            const arr = Array.isArray(mapping[oldField]) ? mapping[oldField] : [];
            mapping[oldField] = arr.filter(c => c !== colIdx);
            if (mapping[oldField].length === 0) delete mapping[oldField];
          } else {
            delete mapping[oldField];
          }
        }
        if (newField) {
          if (multiFields.has(newField)) {
            if (!Array.isArray(mapping[newField])) mapping[newField] = [];
            if (!mapping[newField].includes(colIdx)) mapping[newField].push(colIdx);
          } else {
            Object.keys(mapping).forEach(f => { if (!multiFields.has(f) && mapping[f] === colIdx) delete mapping[f]; });
            mapping[newField] = colIdx;
          }
        }
        if (canUseMultiSheets() && idlState.sheetName) {
          if (!idlState.sheetConfigs || typeof idlState.sheetConfigs !== 'object') idlState.sheetConfigs = {};

          if (!idlState.primarySheet && hasUsableIdlMapping(mapping)) {
            idlState.primarySheet = idlState.sheetName;
          }

          const prevCfg = idlState.sheetConfigs[idlState.sheetName] || cloneSheetConfig({ mapping, excludedRows: [...excluded] });
          idlState.sheetConfigs[idlState.sheetName] = cloneSheetConfig({
            ...prevCfg,
            mapping,
            excludedRows: [...excluded].filter(v => typeof v === 'number'),
            mappingCustomized: !!idlState.primarySheet && idlState.sheetName !== idlState.primarySheet,
          });

          if (idlState.sheetName === idlState.primarySheet) {
            idlState.sheetConfigs[idlState.sheetName].mappingCustomized = false;
            propagatePrimaryMapping();
          }
          syncIdlStateToActiveFileConfig();
          refreshSheetIndicators();
        }
        renderIdlPreviewTable();
      });

      const nameDiv = document.createElement('div');
      nameDiv.style.cssText = 'font-size:0.68em;color:var(--muted);text-align:center;margin-top:2px;overflow:hidden;text-overflow:ellipsis;max-width:90px';
      nameDiv.title = h.name; nameDiv.textContent = h.name;
      th.appendChild(sel);
      th.appendChild(nameDiv);
      trSel.appendChild(th);
    }
    head.appendChild(trSel);

    // Preview rows (all)
    for (const row of data.previewRows) {
      const rowNum = row._rowNum != null ? row._rowNum : ('idx_' + data.previewRows.indexOf(row));
      const isExcluded = excluded.has(rowNum);
      const tr = document.createElement('tr');
      if (isExcluded) tr.style.cssText = 'opacity:0.35;text-decoration:line-through';

      const tdAction = document.createElement('td');
      tdAction.style.cssText = 'text-align:center;padding:2px;position:sticky;left:0;background:var(--card);z-index:1';
      tdAction.appendChild(isExcluded ? makeRestoreBtn(rowNum) : makeDeleteBtn(rowNum));
      tr.appendChild(tdAction);

      const tdNum = document.createElement('td');
      tdNum.style.cssText = 'color:var(--muted);font-size:0.7em;padding:2px 4px;position:sticky;left:32px;background:var(--card);text-align:right;z-index:1';
      tdNum.textContent = row._rowNum;
      tr.appendChild(tdNum);
      for (const h of data.headers) {
        const td = document.createElement('td');
        const field = colFieldMap[h.index] || '';
        const color = field ? (colors[field] || 'transparent') : 'transparent';
        td.style.cssText = `padding:3px 6px;border-bottom:1px solid var(--border);background:${color}10;max-width:200px;overflow:hidden;text-overflow:ellipsis`;
        const val = row[h.index];
        td.textContent = val !== null && val !== undefined ? String(val) : '';
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }

  confirmBtn?.addEventListener('click', async () => {
    if (!idlState.files.length || !idlState.preview || !currentProject) return;
    const useMultiSheets = idlState.files.length > 1 || canUseMultiSheets();
    saveActiveSheetConfig();
    syncIdlStateToActiveFileConfig();

    if (!useMultiSheets) {
      const desig = idlState.mapping.designation;
      if (!desig || (Array.isArray(desig) && desig.length === 0)) {
        showNotify({ title: 'Mapping incomplet', message: 'Assignez au moins une colonne "Désignation" avant de lancer l\'import.', type: 'error' });
        return;
      }
    }

    if (useMultiSheets && (!Array.isArray(idlState.selectedSheets) || idlState.selectedSheets.length === 0)) {
      showNotify({ title: 'Validation', message: 'Sélectionnez au moins un onglet à importer.', type: 'error' });
      return;
    }

    if (useMultiSheets) {
      const baseMapping = idlState.baseMapping || idlState.mapping;
      const baseDesignation = baseMapping?.designation;
      if (!baseDesignation || (Array.isArray(baseDesignation) && baseDesignation.length === 0)) {
        showNotify({ title: 'Mapping incomplet', message: 'Mappez au moins une colonne Désignation sur un fichier / onglet avant de lancer l\'import multiple.', type: 'error' });
        return;
      }

      for (let fileIndex = 0; fileIndex < idlState.files.length; fileIndex += 1) {
        const cfg = getIdlFileConfig(fileIndex);
        const selectedSheets = Array.isArray(cfg?.selectedSheets) && cfg.selectedSheets.length > 0 ? cfg.selectedSheets : null;
        if (!selectedSheets) continue;
        const invalidSheet = selectedSheets.find((sheet) => {
          const sheetCfg = cfg?.sheetConfigs?.[sheet];
          const d = sheetCfg?.mapping?.designation || cfg?.baseMapping?.designation || baseDesignation;
          return !d || (Array.isArray(d) && d.length === 0);
        });
        if (invalidSheet) {
          showNotify({ title: 'Mapping incomplet', message: `Le fichier "${idlState.files[fileIndex]?.name || ''}" contient un onglet sans colonne Désignation mappée : "${invalidSheet}".`, type: 'error' });
          return;
        }
      }
    }

    confirmBtn.disabled = true;
    const originalHTML = confirmBtn.innerHTML;
    const agg = { lotsCreated: 0, itemsImported: 0, itemsUpdated: 0, errors: [] };
    try {
      showLoader();
      if (useMultiSheets) {
        let importIndex = 0;
        for (let fileIndex = 0; fileIndex < idlState.files.length; fileIndex += 1) {
          const file = idlState.files[fileIndex];
          const fileCfg = getIdlFileConfig(fileIndex) || createIdlFileConfig();
          const baseLotName = (idlState.lotNames[fileIndex]?.name || deriveLotName(file.name)).trim();
          const baseLotCode = (idlState.lotNames[fileIndex]?.code || '').trim() || null;
          let availableSheets = Array.isArray(fileCfg.preview?.sheets) ? fileCfg.preview.sheets : null;
          if (!availableSheets || availableSheets.length === 0) {
            const previewData = await (async () => {
              const formData = new FormData();
              formData.append('file', file);
              const headerRow = Number(fileCfg.headerRow || 1) || 1;
              if (headerRow >= 1) formData.append('headerRow', String(headerRow));
              const resp = await fetch(`${API_BASE}/projects/${currentProject.id}/import-dpgf-preview`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
                credentials: 'include',
              });
              const result = await resp.json();
              if (!resp.ok) throw new Error(result.error || 'Erreur preview');
              return result;
            })();
            fileCfg.preview = previewData;
            availableSheets = Array.isArray(previewData.sheets) ? previewData.sheets : [];
            if (!Array.isArray(fileCfg.selectedSheets) || fileCfg.selectedSheets.length === 0) {
              fileCfg.selectedSheets = [...availableSheets];
            }
            if (!fileCfg.baseMapping && idlState.baseMapping) fileCfg.baseMapping = normIdlMapping(idlState.baseMapping);
            if (!fileCfg.sheetConfigs || typeof fileCfg.sheetConfigs !== 'object') fileCfg.sheetConfigs = {};
            availableSheets.forEach((sheetName) => {
              if (!fileCfg.sheetConfigs[sheetName]) {
                fileCfg.sheetConfigs[sheetName] = cloneSheetConfig({ mapping: fileCfg.baseMapping || idlState.baseMapping || idlState.mapping, excludedRows: [], mappingCustomized: false });
              }
            });
          }

          const selectedSheets = Array.isArray(fileCfg.selectedSheets) && fileCfg.selectedSheets.length > 0
            ? [...fileCfg.selectedSheets]
            : [...(availableSheets || [])];

          for (let sheetIndex = 0; sheetIndex < selectedSheets.length; sheetIndex += 1) {
            const sheetName = selectedSheets[sheetIndex];
            const sheetCfg = fileCfg.sheetConfigs?.[sheetName] || cloneSheetConfig({ mapping: fileCfg.baseMapping || idlState.baseMapping || idlState.mapping, excludedRows: [] });
            importIndex += 1;
            const lotName = selectedSheets.length > 1 ? sheetName : baseLotName;
            confirmBtn.innerHTML = `<span class="spinner-small"></span> Import ${importIndex}…`;
            const params = {
              lotName,
              lotCode: selectedSheets.length > 1 ? sheetName : baseLotCode,
              mapping: normIdlMapping(sheetCfg.mapping),
              sheetName,
              headerRow: fileCfg.headerRow || 1,
              excludedRows: Array.isArray(sheetCfg.excludedRows) ? sheetCfg.excludedRows.filter(v => typeof v === 'number') : [],
            };
            const formData = new FormData();
            formData.append('file', file);
            formData.append('params', JSON.stringify(params));
            const resp = await fetch(`${API_BASE}/projects/${currentProject.id}/import-dpgf`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
              body: formData,
              credentials: 'include',
            });
            const result = await resp.json();
            if (!resp.ok) {
              agg.errors.push({ file: `${file.name} / ${sheetName}`, error: result.error || 'Erreur inconnue' });
            } else {
              agg.lotsCreated += 1;
              agg.itemsImported += result.itemsImported || 0;
              agg.itemsUpdated += result.itemsUpdated || 0;
            }
          }
        }
      } else {
        for (let i = 0; i < idlState.files.length; i++) {
          const file = idlState.files[i];
          const lotName = (idlState.lotNames[i]?.name || deriveLotName(file.name)).trim();
          const lotCode = (idlState.lotNames[i]?.code || '').trim() || null;
          confirmBtn.innerHTML = `<span class="spinner-small"></span> Import ${i + 1}/${idlState.files.length}…`;
          const params = {
            lotName, lotCode,
            mapping: normIdlMapping(idlState.mapping),
            sheetName: idlState.sheetName,
            headerRow: idlState.headerRow,
            excludedRows: [...idlState.excludedRows].filter(v => typeof v === 'number'),
          };
          const formData = new FormData();
          formData.append('file', file);
          formData.append('params', JSON.stringify(params));
          const resp = await fetch(`${API_BASE}/projects/${currentProject.id}/import-dpgf`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
            credentials: 'include',
          });
          const result = await resp.json();
          if (!resp.ok) {
            agg.errors.push({ file: file.name, error: result.error || 'Erreur inconnue' });
          } else {
            agg.lotsCreated += 1;
            agg.itemsImported += result.itemsImported || 0;
            agg.itemsUpdated += result.itemsUpdated || 0;
          }
        }
      }
      step1.classList.add('hidden');
      step2.classList.add('hidden');
      step3.classList.remove('hidden');
      const resultDiv = qs('#idl-result');
      if (agg.errors.length === 0) {
        resultDiv.innerHTML = `
          <div style="font-size:3em;margin-bottom:12px">${icon('check-circle')}</div>
          <h3 style="color:var(--success,#10b981);margin:0 0 16px 0">Import réussi !</h3>
          <div style="display:flex;gap:24px;justify-content:center;flex-wrap:wrap">
            <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
              <div style="font-size:2em;font-weight:700">${agg.lotsCreated}</div>
              <div class="muted" style="font-size:0.85em">lots créés</div>
            </div>
            <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
              <div style="font-size:2em;font-weight:700">${agg.itemsImported}</div>
              <div class="muted" style="font-size:0.85em">articles créés</div>
            </div>
            ${agg.itemsUpdated > 0 ? `<div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
              <div style="font-size:2em;font-weight:700">${agg.itemsUpdated}</div>
              <div class="muted" style="font-size:0.85em">articles mis à jour</div>
            </div>` : ''}
          </div>`;
      } else {
        resultDiv.innerHTML = `
          <div style="font-size:3em;margin-bottom:12px">⚠️</div>
          <h3 style="color:var(--warning,#f59e0b);margin:0 0 16px 0">Import partiellement réussi</h3>
          <div style="display:flex;gap:24px;justify-content:center;flex-wrap:wrap;margin-bottom:16px">
            <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
              <div style="font-size:2em;font-weight:700">${agg.lotsCreated}</div>
              <div class="muted" style="font-size:0.85em">lots créés</div>
            </div>
            <div style="padding:16px;background:var(--input-bg);border-radius:8px;min-width:120px">
              <div style="font-size:2em;font-weight:700">${agg.itemsImported}</div>
              <div class="muted" style="font-size:0.85em">articles créés</div>
            </div>
            <div style="padding:16px;background:var(--input-bg);border:2px solid var(--danger,#f87171);border-radius:8px;min-width:120px">
              <div style="font-size:2em;font-weight:700;color:var(--danger,#f87171)">${agg.errors.length}</div>
              <div class="muted" style="font-size:0.85em">erreurs</div>
            </div>
          </div>
          <div style="text-align:left;border:1px solid var(--danger,#f87171);border-radius:8px;overflow:hidden">
            <div style="background:var(--danger,#f87171);color:#fff;padding:8px 12px;font-weight:700;font-size:0.85em">Erreurs détaillées</div>
            <ul style="padding:12px 16px;margin:0;font-size:0.82em">
              ${agg.errors.map(e => `<li><strong>${escapeHtml(e.file)}</strong> : ${escapeHtml(e.error)}</li>`).join('')}
            </ul>
          </div>`;
      }
    } catch (err) {
      showNotify({ title: 'Erreur', message: err.message, type: 'error' });
    } finally {
      hideLoader();
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = originalHTML;
    }
  });

  doneBtn?.addEventListener('click', async () => {
    closeModal();
    await loadLotsForRound();
  });

  qs('#import-dpgf-lots')?.addEventListener('click', () => {
    if (!currentProject) {
      showNotify({ title: 'Validation', message: 'Ouvrez un projet d\'abord', type: 'info' });
      return;
    }
    if (!currentRound) {
      showNotify({ title: 'Validation', message: 'Sélectionnez un tour d\'abord', type: 'info' });
      return;
    }
    openModal();
  });
}

/* ================== INIT ================== */
function showDashboard(){ 
  hide('#login-view'); 
  show('#dashboard'); 
  activateTab('tab-projects'); 
  refreshProjects();
  // Appeler updateUIForRole après un court délai pour s'assurer que le DOM est prêt
  setTimeout(() => {
    updateUIForRole();
  }, 100);
}

function updateUIForRole() {
  // Sections admin
  if (isAdmin()) {
    show('#admin-section');
    loadUsers();
  } else {
    hide('#admin-section');
  }
  
  // Section demandes d'accès (responsable/admin)
  if (isResponsableOrAdmin()) {
    show('#access-requests-section');
    loadAccessRequests();
  } else {
    hide('#access-requests-section');
  }
  
  // Section gestion des projets (responsable/admin)
  if (isResponsableOrAdmin()) {
    show('#projects-management-section');
    loadProjectsManagement();
  } else {
    hide('#projects-management-section');
  }
  
  // Section création de projet (responsable/admin)
  if (canCreateProject() && !isEntreprise()) {
    show('#create-project-section');
  } else {
    hide('#create-project-section');
  }
  
  // Masquer le bouton d'ajout de tour pour les visionneurs
  const addRoundBtn = qs('#add-round');
  if (addRoundBtn) {
    if (isVisionneur() || isEntreprise()) {
      addRoundBtn.style.display = 'none';
    } else {
      addRoundBtn.style.display = '';
    }
  }
  
  // Masquer le bouton d'ajout de lot et l'onglet lots pour les visionneurs
  const addLotBtn = qs('#add-lot');
  if (addLotBtn) {
    if (isVisionneur() || isEntreprise()) {
      addLotBtn.style.display = 'none';
    } else {
      addLotBtn.style.display = '';
    }
  }
  const importDpgfLotsBtn = qs('#import-dpgf-lots');
  if (importDpgfLotsBtn) {
    if (isVisionneur() || isEntreprise()) {
      importDpgfLotsBtn.style.display = 'none';
    } else {
      importDpgfLotsBtn.style.display = '';
    }
  }
  
  const tourLotsTab = qs('[data-tour-tab="tour-lots"]');
  if (tourLotsTab) {
    if (isVisionneur()) {
      tourLotsTab.style.display = 'none';
    } else {
      tourLotsTab.style.display = '';
    }
  }
  
  // Masquer l'onglet "Liste des Tours" pour les visionneurs
  const roundsListTab = qs('[data-rounds-tab="rounds-list-view"]');
  if (roundsListTab) {
    if (isVisionneur()) {
      roundsListTab.style.display = 'none';
      // Activer par défaut l'onglet comparaison pour les visionneurs
      const compareTab = qs('[data-rounds-tab="rounds-compare-view"]');
      if (compareTab) {
        compareTab.click();
      }
    } else {
      roundsListTab.style.display = '';
    }
  }
  
  // Bouton demande d'accès (visionneur uniquement)
  const accessBtn = qs('#open-access-request-modal');
  console.log('Access button:', accessBtn, 'isVisionneur:', isVisionneur(), 'user:', currentUser);
  if (accessBtn) {
    if (isVisionneur()) {
      console.log('Showing access request button');
      accessBtn.classList.remove('hidden');
    } else {
      console.log('Hiding access request button');
      accessBtn.classList.add('hidden');
    }
  } else {
    console.error('Access request button not found in DOM');
  }
}

let editingRoundId = null;
let editingLotId = null;

function openRoundEditModal(round){
  if (isVisionneur()) { return; }
  editingRoundId = round.id;
  const modal = qs('#round-modal');
  qs('#round-modal-title').textContent = 'Modifier le tour';
  qs('#round-name').value = round.name || '';
  qs('#round-description').value = round.description || '';
  qs('#round-modal-msg').textContent = '';
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

function openLotCreateModal(){
  editingLotId = null;
  const modal = qs('#lot-modal');
  qs('#lot-modal-title').textContent = 'Créer un lot';
  qs('#lot-modal-delete')?.classList.add('hidden');
  qs('#lot-code').value = '';
  qs('#lot-name').value = '';
  qs('#lot-macro-new').value = '';
  populateMacroLotSelect();
  qs('#lot-modal-msg').textContent = '';
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

function openLotEditModal(lot){
  editingLotId = lot.id;
  const modal = qs('#lot-modal');
  qs('#lot-modal-title').textContent = 'Modifier le lot';
  qs('#lot-modal-delete')?.classList.remove('hidden');
  qs('#lot-code').value = lot.code || '';
  qs('#lot-name').value = lot.name || '';
  qs('#lot-macro-new').value = '';
  populateMacroLotSelect(lot.macro_lot || '');
  qs('#lot-modal-msg').textContent = '';
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

function bindUI(){
  // Auth classique - Formulaire de connexion
  const loginForm = qs('#login-form');
  loginForm?.addEventListener('submit', async (e)=> {
    e.preventDefault();
    const msgEl = qs('#login-msg');
    setText('#login-msg',''); 
    const email = qs('#login-email').value.trim();
    const password = qs('#login-password').value;
    
    try{ 
      await login(email, password); 
      showDashboard(); 
    } catch(e){ 
      // Si email non vérifié, proposer de renvoyer
      if (e.emailNotVerified) {
        showVerifyEmailPopup(email);
        return;
      } else {
        setHtml('#login-msg', `${icon('x-circle')}${e.message}`); 
      }
    }
  });
  
  // Inscription publique - Formulaire d'inscription
  const registerForm = qs('#register-form');
  registerForm?.addEventListener('submit', async (e)=> {
    e.preventDefault();
    setText('#login-msg',''); 
    const email = qs('#register-email')?.value.trim();
    const password = qs('#register-password')?.value;
    const confirm = qs('#register-password-confirm')?.value;
    
    if (!email || !password) {
      setText('#login-msg', 'Email et mot de passe requis');
      return;
    }
    if (password.length < 8) {
      setText('#login-msg', 'Le mot de passe doit contenir au moins 8 caractères');
      return;
    }
    if (password !== confirm) {
      setText('#login-msg', 'Les mots de passe ne correspondent pas');
      return;
    }
    
    try{ 
      const data = await api('/auth/register', { method: 'POST', body: { email, password } });
      
      // Si email de vérification envoyé
      if (data.emailSent) {
        const msgEl = qs('#login-msg');
        msgEl.innerHTML = `
          <div style="background: #d4edda; padding: 1.5rem; border-radius: 8px; border: 2px solid #28a745; text-align: center;">
            <div style="margin-bottom: 0.5rem;">${icon('mail','icon-lg')}</div>
            <h3 style="color: #155724; margin: 0 0 0.5rem 0;">${icon('check-circle')}Compte créé avec succès!</h3>
            <p style="color: #155724; margin: 0;">
              Un email de vérification a été envoyé à <strong>${email}</strong>.<br>
              <strong>Consultez votre boîte mail</strong> et cliquez sur le lien pour activer votre compte.
            </p>
          </div>
        `;
        
        
        // Vider les champs
        if (qs('#register-email')) qs('#register-email').value = '';
        if (qs('#register-password')) qs('#register-password').value = '';
        if (qs('#register-password-confirm')) qs('#register-password-confirm').value = '';
      } else {
        // Admin auto-connecté
        token = data.token;
        localStorage.setItem('token', token);
        currentUser = data.user;
        showDashboard(); 
      }
    } catch(e){ 
      setHtml('#login-msg', `${icon('x-circle')}${e.message}`); 
    }
  });
  
  // Mot de passe oublié
  qs('#forgot-password-link')?.addEventListener('click', async (e)=> {
    e.preventDefault();
    const email = prompt('Entrez votre adresse email pour recevoir un lien de réinitialisation :');
    if (!email) return;
    
    setText('#login-msg', 'Envoi de l\'email...');
    try {
      const result = await api('/auth/forgot-password', { 
        method: 'POST',
        body: { email }
      });
      setHtml('#login-msg', `${icon('check-circle')}${result.message}`);
    } catch(e) {
      setHtml('#login-msg', `${icon('x-circle')}${e.message}`);
    }
  });
  
  qs('#logout').addEventListener('click', async ()=>{ 
    try {
      await fetch(API_BASE + '/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (_) {}
    try { localStorage.removeItem('token'); } catch(_) {}
    currentUser = null;
    window.location.href = '/login';
  });

  // Event listeners pour la modal de suppression
  qs('#delete-confirmation-close')?.addEventListener('click', hideDeleteConfirmation);
  qs('#delete-confirmation-cancel')?.addEventListener('click', hideDeleteConfirmation);
  qs('#delete-confirmation-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'delete-confirmation-modal') hideDeleteConfirmation();
  });
  qs('#delete-confirmation-confirm')?.addEventListener('click', async () => {
    if (deleteConfirmationCallback && typeof deleteConfirmationCallback === 'function') {
      const onConfirm = deleteConfirmationCallback;
      hideDeleteConfirmation();
      await onConfirm();
    }
  });

  // Navigation principale
  qsa('.nav-btn').forEach(b => b.addEventListener('click', () => !b.disabled && activateTab(b.dataset.tab)));

  // Sous-onglets dans l'inventaire des tours (liste/comparaison)
  qsa('#tab-rounds .tour-tab-btn').forEach(b => b.addEventListener('click', () => activateRoundsTab(b.dataset.roundsTab)));

  // Bouton de mise a jour de la comparaison des tours
  qs('#update-comparison')?.addEventListener('click', () => loadRoundsComparison());
  qs('#compare-round')?.addEventListener('change', () => loadRoundsComparison());

  qs('#rounds-compare-tab-compare')?.addEventListener('click', () => {
    show('#rounds-compare-table-wrapper');
    hide('#rounds-options-view');
    hide('#rounds-simulation-view');
    qs('#rounds-compare-tab-compare')?.classList.add('active');
    qs('#rounds-compare-tab-options')?.classList.remove('active');
    qs('#rounds-compare-tab-simulation')?.classList.remove('active');
  });

  qs('#rounds-compare-tab-options')?.addEventListener('click', async () => {
    hide('#rounds-compare-table-wrapper');
    show('#rounds-options-view');
    hide('#rounds-simulation-view');
    qs('#rounds-compare-tab-options')?.classList.add('active');
    qs('#rounds-compare-tab-compare')?.classList.remove('active');
    qs('#rounds-compare-tab-simulation')?.classList.remove('active');
    await loadRoundsComparison();
  });

  qs('#rounds-compare-tab-simulation')?.addEventListener('click', async () => {
    hide('#rounds-compare-table-wrapper');
    hide('#rounds-options-view');
    show('#rounds-simulation-view');
    qs('#rounds-compare-tab-simulation')?.classList.add('active');
    qs('#rounds-compare-tab-compare')?.classList.remove('active');
    qs('#rounds-compare-tab-options')?.classList.remove('active');
    await loadRoundsComparison();
  });

  qs('#add-simulation')?.addEventListener('click', () => {
    addSimulation();
    loadRoundsComparison();
  });

  // Sous-onglets d'un tour sélectionné (summary, lots, config, questions)
  qsa('#round-content .tour-tab-btn').forEach(b => b.addEventListener('click', () => activateTourTab(b.dataset.tourTab)));
  qs('#save-global-thresholds')?.addEventListener('click', saveGlobalLotThresholds);
  qs('#generate-all-lots-questions')?.addEventListener('click', generateAllLotsQuestions);

  // Sous-onglets des lots (données, config, questions)
  qsa('.subnav-tab').forEach(b => b.addEventListener('click', () => activateSubtab(b.dataset.subtab)));

  // Bouton de retour vers projets
  qs('#back-to-projects')?.addEventListener('click', () => {
    currentProject = null;
    currentRound = null;
    enableTab('tab-rounds', false);
    activateTab('tab-projects');
  });

  // Bouton de retour vers lots
  qs('#back-to-lots')?.addEventListener('click', () => {
    if (currentRound) {
      const tourConfigBtn = qs('[data-tour-tab="tour-config"]');
      const tourQuestionsBtn = qs('[data-tour-tab="tour-questions"]');
      if (tourConfigBtn) tourConfigBtn.style.display = isEntreprise() ? 'none' : '';
      if (tourQuestionsBtn) tourQuestionsBtn.style.display = isEntreprise() ? 'none' : '';
      activateTab('round-content');
      activateTourTab('tour-lots');
    }
  });

  // Bouton de retour vers phases (liste des tours)
  qs('#back-to-rounds')?.addEventListener('click', () => {
    currentRound = null;
    activateTab('tab-rounds');
    activateRoundsTab('rounds-list-view');
  });

  // projets / lots
  qs('#create-project')?.addEventListener('click', async ()=>{ try{
    const body={ name:qs('#proj-name').value.trim(), reference:qs('#proj-ref').value.trim(), client:qs('#proj-client').value.trim(), location:qs('#proj-location').value.trim() };
    if(!body.name){ showNotify({ title:'Validation', message:'Nom requis', type:'info' }); return; }
    await api('/projects',{method:'POST',body});
    qsa('#proj-name,#proj-ref,#proj-client,#proj-location').forEach(i=>i.value='');
    await refreshProjects();
  }catch(e){ showNotify({ title:'Erreur', message:e.message, type:'error' }); } });

  // Gestion des tours
  qs('#add-round')?.addEventListener('click', createRound);

  qs('#add-lot')?.addEventListener('click', async ()=>{ try{
    if (isVisionneur()){ showNotify({ title:'Accès refusé', message:'Vous ne pouvez pas ajouter de lots.', type:'error' }); return; }
    if(!currentProject){ showNotify({ title:'Validation', message:'Ouvrir un projet d\'abord', type:'info' }); return; }
    if(!currentRound){ showNotify({ title:'Validation', message:'Sélectionner un tour d\'abord', type:'info' }); return; }
    openLotCreateModal();
  }catch(e){ showNotify({ title:'Erreur', message:e.message, type:'error' }); } });
  // ===== Modals Round: edit =====
  qs('#round-modal-close')?.addEventListener('click', ()=>{ const m=qs('#round-modal'); m.classList.add('hidden'); m.style.display='none'; editingRoundId=null; });
  qs('#round-modal')?.addEventListener('click', (e)=>{ if (e.target.id==='round-modal'){ const m=qs('#round-modal'); m.classList.add('hidden'); m.style.display='none'; editingRoundId=null; } });
  qs('#round-modal-save')?.addEventListener('click', async ()=>{ try{
    if (!editingRoundId) return;
    const name = qs('#round-name').value.trim();
    const description = qs('#round-description').value.trim();
    if (!name) { qs('#round-modal-msg').textContent = 'Le nom du tour est requis'; return; }
    await api(`/rounds/${editingRoundId}`, { method:'PUT', body:{ name, description, status: 'active' } });
    const m=qs('#round-modal'); m.classList.add('hidden'); m.style.display='none'; editingRoundId=null;
    await loadRounds();
  }catch(e){ qs('#round-modal-msg').textContent = e.message; }});
// ===== Modals Lot: create/edit =====
qs('#lot-modal-close')?.addEventListener('click', ()=>{ const m=qs('#lot-modal'); m.classList.add('hidden'); m.style.display='none'; });
qs('#lot-modal')?.addEventListener('click', (e)=>{ if (e.target.id==='lot-modal'){ const m=qs('#lot-modal'); m.classList.add('hidden'); m.style.display='none'; } });
qs('#lot-macro-group')?.addEventListener('change', toggleMacroLotNewInput);
qs('#lot-modal-delete')?.addEventListener('click', async ()=>{
  if (!editingLotId) return;
  const lotName = qs('#lot-name')?.value?.trim() || 'ce lot';
  showDeleteConfirmation({
    title: 'Supprimer ce lot',
    message: `Êtes-vous sûr de vouloir supprimer le lot "${lotName}" ?`,
    extra: '<strong>⚠️ Attention:</strong> Cette action supprimera toutes les données liées à ce lot (articles, offres et réponses). Cette action ne peut pas être annulée.',
    onConfirm: async () => {
      try {
        await api(`/projects/lots/${editingLotId}`, { method:'DELETE' });
        if (currentLot?.id === editingLotId) {
          currentLot = null;
          if (isVisionneur() || isEntreprise()) {
            disableTourTabs(['tour-config', 'tour-questions']);
          } else {
            enableTourTabs(['tour-config']);
            disableTourTabs(['tour-questions']);
          }
        }
        const m = qs('#lot-modal');
        m.classList.add('hidden');
        m.style.display = 'none';
        editingLotId = null;
        await loadLotsForRound();
        showNotify({ title: 'Succès', message: 'Lot supprimé', type: 'success' });
      } catch (e) {
        showNotify({ title: 'Erreur', message: e.message, type: 'error' });
      }
    }
  });
});
qs('#lot-modal-save')?.addEventListener('click', async ()=>{ try{
  const code = qs('#lot-code').value.trim();
  const name = qs('#lot-name').value.trim();
  const macro_lot = getMacroLotFromModal();
  if (!name) { qs('#lot-modal-msg').textContent = 'Le nom du lot est requis'; return; }
  if (editingLotId){
    await api(`/projects/lots/${editingLotId}`, { method:'PUT', body:{ code, name, macro_lot } });
  } else {
    await api(`/projects/${currentProject.id}/lots`, { method:'POST', body:{ code, name, macro_lot } });
  }
  const m=qs('#lot-modal'); m.classList.add('hidden'); m.style.display='none';
  await loadLotsForRound();
}catch(e){ qs('#lot-modal-msg').textContent = e.message; }});

// ===== Drag & Drop lots order =====
function initLotsDragAndDrop(tbody){
  if (tbody.dataset.lotsDndBound === 'true') return;
  tbody.dataset.lotsDndBound = 'true';
  let dragSrcEl = null;

  function refreshLotDisplayIds() {
    Array.from(tbody.querySelectorAll('tr[data-lot-id]')).forEach((row, index) => {
      const cell = row.querySelector('.lot-display-id');
      if (cell) cell.textContent = String(index + 1);
    });
  }

  // Helper: find element after which to insert based on cursor Y
  function getDragAfterElement(container, y) {
    const rows = [...container.querySelectorAll('tr[draggable="true"]:not(.dragging)')];
    return rows.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
  }

  tbody.addEventListener('dragstart', (e)=>{
    const tr = e.target.closest('tr');
    if (!tr) return;
    dragSrcEl = tr;
    tr.classList.add('dragging');
    tr.style.opacity = '0.5';
    try { e.dataTransfer.setData('text/plain', tr.dataset.lotId || ''); } catch(_) {}
    e.dataTransfer.effectAllowed = 'move';
  });

  tbody.addEventListener('dragend', (e)=>{
    const tr = e.target.closest('tr');
    if (tr) { tr.style.opacity=''; tr.classList.remove('dragging'); }
  });

  tbody.addEventListener('dragover', (e)=>{
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragSrcEl) return;
    const afterElement = getDragAfterElement(tbody, e.clientY);
    if (afterElement == null) {
      tbody.appendChild(dragSrcEl);
    } else {
      tbody.insertBefore(dragSrcEl, afterElement);
    }
  });

  tbody.addEventListener('drop', async (e)=>{
    e.preventDefault();
    refreshLotDisplayIds();
    // Persist new order
    const order = Array
      .from(tbody.querySelectorAll('tr[data-lot-id], tr'))
      .map(r => parseInt(r.dataset.lotId, 10))
      .filter(Number.isFinite);
    try {
      await api(`/projects/${currentProject.id}/lots/order`, { method:'POST', body:{ order } });
      currentProjectLots = order
        .map(id => currentProjectLots.find(l => Number(l.id) === Number(id)))
        .filter(Boolean);
    } catch(err) {
      await loadLotsForRound();
      showNotify({ title:'Erreur', message:'Mise à jour de l\'ordre: '+err.message, type:'error' });
    }
  });
}

// Expose for safety in case of scoping differences
if (typeof window !== 'undefined') {
  window.initLotsDragAndDrop = initLotsDragAndDrop;
}

// ===== Drag & Drop rounds order =====
function initRoundsDragAndDrop(container){
  let dragSrcEl = null;

  function getAfterElement(container, y) {
    const cards = [...container.querySelectorAll('.round-card[draggable="true"]:not(.dragging)')];
    // Si on est au-dessus du premier élément, retourner le premier élément
    if (cards.length > 0) {
      const firstBox = cards[0].getBoundingClientRect();
      if (y < firstBox.top + firstBox.height / 2) {
        return cards[0]; // Place BEFORE the first element
      }
    }
    return cards.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
  }

  container.addEventListener('dragstart', (e)=>{
    const card = e.target.closest('.round-card');
    if (!card) return;
    dragSrcEl = card;
    card.classList.add('dragging');
    card.style.opacity = '0.6';
    try { e.dataTransfer.setData('text/plain', card.dataset.roundId || ''); } catch(_) {}
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragend', (e)=>{
    const card = e.target.closest('.round-card');
    if (card) { card.style.opacity=''; card.classList.remove('dragging'); }
  });

  container.addEventListener('dragover', (e)=>{
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragSrcEl) return;
    const afterElement = getAfterElement(container, e.clientY);
    if (afterElement == null) {
      container.appendChild(dragSrcEl);
    } else {
      container.insertBefore(dragSrcEl, afterElement);
    }
  });

  container.addEventListener('drop', async (e)=>{
    e.preventDefault();
    const order = Array
      .from(container.querySelectorAll('.round-card[data-round-id]'))
      .map(c => parseInt(c.dataset.roundId, 10))
      .filter(Number.isFinite);
    try {
      await api(`/rounds/project/${currentProject.id}/order`, { method:'POST', body:{ order } });
      // Refresh card numbers (round_number) after server update
      await loadRounds();
    } catch(err) {
      showNotify({ title:'Erreur', message:'Mise à jour de l\'ordre des tours: '+err.message, type:'error' });
    }
  });
}

if (typeof window !== 'undefined') {
  window.initRoundsDragAndDrop = initRoundsDragAndDrop;
}

  // Fiches questions (autosave activée)
  qs('#generate-questions')?.addEventListener('click', generateQuestions);
  qs('#export-questions-excel')?.addEventListener('click', exportQuestionsExcel);
  qs('#export-rao')?.addEventListener('click', openRaoExportModal);
    // Rôle entreprise : masquer génération et réglages des questions + ajout entreprise
    if (isEntreprise()) {
      const genBtn = qs('#generate-questions'); if (genBtn) genBtn.style.display = 'none';
      const editorBtn = qs('#questions-editor-options'); if (editorBtn) editorBtn.style.display = 'none';
      const saveThresh = qs('#save-thresholds'); if (saveThresh) saveThresh.style.display = 'none';
      const addCompanyBtn = qs('#add-company'); if (addCompanyBtn) addCompanyBtn.style.display = 'none';
    }
  qs('#filter-company')?.addEventListener('change', refreshQuestions);
  qs('#filter-status')?.addEventListener('change', refreshQuestions);
  qs('#filter-type')?.addEventListener('change', refreshQuestions);
  qs('#filter-deviation')?.addEventListener('input', refreshQuestions);
  qs('#filter-price')?.addEventListener('input', refreshQuestions);
  qs('#filter-question')?.addEventListener('input', refreshQuestions);

  // Éditeur de questions
  qs('#questions-view-filter')?.addEventListener('change', loadQuestionsEditor);
  qs('#questions-analysis-mode')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.ams-btn');
    if (!btn) return;
    const sw = qs('#questions-analysis-mode');
    const mode = btn.dataset.mode;
    if (sw && mode && sw.dataset.value !== mode) {
      sw.dataset.value = mode;
      loadQuestionsEditor();
    }
  });
  qs('#questions-target-company')?.addEventListener('change', loadQuestionsEditor);
  qs('#questions-amount-filter')?.addEventListener('change', loadQuestionsEditor);
  qs('#questions-editor-options')?.addEventListener('click', openQuestionsEditorModal);

  // Event listeners pour la modal d'édition des questions
  qs('#questions-editor-modal-close')?.addEventListener('click', () => hide('#questions-editor-modal'));
  qs('#questions-editor-modal-close-btn')?.addEventListener('click', () => hide('#questions-editor-modal'));
  qs('#questions-editor-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'questions-editor-modal') hide('#questions-editor-modal');
  });
  qs('#delete-all-questions-btn')?.addEventListener('click', deleteAllQuestions);
  qs('#validate-all-questions-btn')?.addEventListener('click', validateAllQuestionsEditor);

  // Gestion du thème
  initTheme();
  qsa('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      setTheme(theme);
    });
  });
  
  // Gestion du changement de mot de passe
  initPasswordSettings();

  // Exports PDF
  qs('#export-summary-pdf')?.addEventListener('click', () => {
    const title = `Récapitulatif - ${currentProject?.name || ''} ${currentRound ? `(Tour ${currentRound.round_number} - ${currentRound.name})` : ''}`.trim();
    exportTableToPDF('#summary-table', title || 'Récapitulatif');
  });

  // Export Excel formaté via API
  qs('#export-summary-excel')?.addEventListener('click', async () => {
    if (!currentRound) { showNotify({ title:'Validation', message:'Sélectionnez un tour', type:'info' }); return; }
    try {
      const res = await fetch(`${API_BASE}/exports/summary/${currentRound.id}`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Erreur export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Recap_${currentProject?.name}_Tour${currentRound.round_number}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      showNotify({ title:'Erreur', message:'Export: ' + err.message, type:'error' });
    }
  });

  qs('#export-rounds-compare-options')?.addEventListener('click', openRoundsExportModal);
  qs('#close-rounds-export-modal')?.addEventListener('click', closeRoundsExportModal);
  qs('#cancel-rounds-export')?.addEventListener('click', closeRoundsExportModal);
  qs('#confirm-rounds-export')?.addEventListener('click', confirmRoundsExport);
  qs('#rounds-export-format')?.addEventListener('change', toggleRoundsExportEmailFields);
  qs('#rounds-export-modal')?.addEventListener('click', (e) => {
    if (e.target?.id === 'rounds-export-modal') closeRoundsExportModal();
  });

  qs('#export-data-options')?.addEventListener('click', openDataExportModal);
  qs('#export-lot-compare-options')?.addEventListener('click', openLotCompareExportModal);
  qs('#close-data-export-modal')?.addEventListener('click', closeDataExportModal);
  qs('#cancel-data-export')?.addEventListener('click', closeDataExportModal);
  qs('#confirm-data-export')?.addEventListener('click', confirmDataExport);
  qs('#data-export-format')?.addEventListener('change', toggleDataExportEmailFields);
  qs('#data-export-modal')?.addEventListener('click', (e) => {
    if (e.target?.id === 'data-export-modal') closeDataExportModal();
  });

  qs('#close-rao-export-modal')?.addEventListener('click', closeRaoExportModal);
  qs('#cancel-rao-export')?.addEventListener('click', closeRaoExportModal);
  qs('#confirm-rao-export')?.addEventListener('click', confirmRaoExport);
  qs('#rao-export-format')?.addEventListener('change', toggleRaoExportEmailFields);
  qs('#rao-export-modal')?.addEventListener('click', (e) => {
    if (e.target?.id === 'rao-export-modal') closeRaoExportModal();
  });

  qs('#export-questions-email')?.addEventListener('click', () => openQuestionsSendModal());

  // Modal suivi des envois de fiches questions
  qs('#close-questions-send-modal')?.addEventListener('click', closeQuestionsSendModal);
  qs('#cancel-questions-send-modal')?.addEventListener('click', closeQuestionsSendModal);
  qs('#questions-send-modal')?.addEventListener('click', (e) => {
    if (e.target?.id === 'questions-send-modal') closeQuestionsSendModal();
  });
  qs('#qs-send-all-btn')?.addEventListener('click', () => sendQuestionsToAll(false));
  qs('#qs-send-unsent-btn')?.addEventListener('click', () => sendQuestionsToAll(true));

  qs('#close-export-email-modal')?.addEventListener('click', closeExportEmailModal);
  qs('#cancel-export-email')?.addEventListener('click', closeExportEmailModal);
  qs('#send-export-email')?.addEventListener('click', sendExportByEmail);
  qs('#export-email-modal')?.addEventListener('click', (e) => {
    if (e.target?.id === 'export-email-modal') closeExportEmailModal();
  });

  // Modal de partage
  qs('#close-share-modal')?.addEventListener('click', closeShareModal);
  qs('#share-project-btn')?.addEventListener('click', shareProject);
  qs('#share-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'share-modal') closeShareModal();
  });

  // Modal d'édition du projet
  qsa('.close-edit-project-modal').forEach(btn => btn.addEventListener('click', () => hide('#edit-project-modal')));
  qs('#save-edit-project')?.addEventListener('click', saveEditProject);
  qs('#edit-add-share-btn')?.addEventListener('click', addEditProjectShare);
  qs('#edit-project-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'edit-project-modal') hide('#edit-project-modal');
  });

  // Modal export projet (onglet Projets)
  qs('#open-phase-export-modal')?.addEventListener('click', () => {
    if (!currentProject) {
      showNotify({ title: 'Validation', message: 'Sélectionnez un projet', type: 'info' });
      return;
    }
    openProjectExportModal(currentProject.id, currentProject.name, { scopeLevel: 'project' });
  });
  qs('#close-project-export-modal')?.addEventListener('click', closeProjectExportModal);
  qs('#cancel-project-export')?.addEventListener('click', closeProjectExportModal);
  qs('#confirm-project-export')?.addEventListener('click', confirmProjectExport);
  qs('#project-export-question-sheets')?.addEventListener('change', toggleProjectExportFields);
  qs('#project-export-modal')?.addEventListener('click', (e) => {
    if (e.target?.id === 'project-export-modal') closeProjectExportModal();
  });

  // Modal demande d'accès (visionneur)
  qs('#open-access-request-modal')?.addEventListener('click', openAccessRequestModal);
  qs('#close-access-request-modal')?.addEventListener('click', closeAccessRequestModal);
  qs('#submit-access-request-btn')?.addEventListener('click', submitAccessRequest);
  qs('#access-request-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'access-request-modal') closeAccessRequestModal();
  });

  // Modal approbation d'accès (responsable/admin)
  const approveConfirmBtn = qs('#approve-confirm-btn');
  qs('#close-approve-access-modal')?.addEventListener('click', cancelApproveAccessModal);
  qs('#approve-cancel-btn')?.addEventListener('click', cancelApproveAccessModal);
  if (approveConfirmBtn) {
    approveConfirmBtn.addEventListener('click', confirmApproveAccess);
  }
  qs('#approve-search')?.addEventListener('input', (e) => filterApproveProjects(e.target.value));
  qs('#approve-access-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'approve-access-modal') cancelApproveAccessModal();
  });

  // Gestion demandes d'accès
  qs('#filter-access-requests-status')?.addEventListener('change', loadAccessRequests);

  // Attribution d'entreprise
  qs('#close-assign-company-modal')?.addEventListener('click', () => hide('#assign-company-modal'));
  qs('#assign-company-cancel-btn')?.addEventListener('click', () => hide('#assign-company-modal'));
  qs('#assign-company-confirm-btn')?.addEventListener('click', assignCompanyToUser);
  qs('#assign-company-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'assign-company-modal') hide('#assign-company-modal');
  });

  // Admin: Reset des cooldowns de connexion
  qs('#reset-cooldowns-btn')?.addEventListener('click', async () => {
    showDeleteConfirmation({
      title: 'Réinitialiser les cooldowns de connexion',
      message: 'Êtes-vous sûr de vouloir débloquer tous les comptes ? Cette action réinitialisera les compteurs de tentatives de connexion échouées.',
      extra: '<strong>ℹ️ Remarque:</strong> Cette action affectera tous les utilisateurs du système.',
      confirmLabel: 'Réinitialiser',
      confirmType: 'primary',
      onConfirm: async () => {
        try {
          const result = await api('/auth/reset-cooldowns', { method: 'POST' });
          showNotify({ title: 'Succès', message: result.message, type: 'success' });
        } catch (err) {
          console.error('Erreur reset cooldowns:', err);
        }
      }
    });
  });

  // Bouton actualiser liste des projets (paramètres)
  qs('#refresh-projects-list-btn')?.addEventListener('click', () => loadProjectsManagement());

  renderSheetBindings();
}

/* ================== PARAMÈTRES COMPTE ================== */
function initPasswordSettings() {
  const emailInput = qs('#settings-email');
  const newPasswordInput = qs('#settings-new-password');
  const form = qs('#change-password-form');
  
  // Afficher l'email de l'utilisateur
  if (emailInput && currentUser) {
    emailInput.value = currentUser.email || '';
  }
  
  // Validation en temps réel du mot de passe
  if (newPasswordInput) {
    newPasswordInput.addEventListener('input', () => {
      validatePasswordRequirements(newPasswordInput.value);
    });
  }
  
  // Soumettre le formulaire
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await changePassword();
    });
  }
}

/* ================== EXPORT PDF ================== */
function exportTableToPDF(tableSelector, title) {
  const table = qs(tableSelector);
  if (!table) {
    showNotify({ title:'Validation', message:'Tableau introuvable', type:'info' });
    return;
  }
  
  try {
    const now = new Date();
    const dateStr = now.toLocaleString('fr-FR');
    const style = `
      <style>
        @page { size: A4 landscape; margin: 12mm; }
        body { font-family: system-ui, Segoe UI, Roboto, Arial, sans-serif; color: #111; }
        h2 { margin: 0 0 6px 0; font-size: 18px; }
        .meta { color:#666; font-size: 12px; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 10px; }
        th, td { border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }
      thead th { background: #f4f6f8; position: static; }
      .sticky-col, .sticky-col2 { position: static; }
      /* Eviter les scroll wrappers en impression */
      .table-wrapper { overflow: visible !important; }
    </style>`;
    const html = `
    <html>
    <head><title>${escapeHtml(title)}</title>${style}</head>
    <body>
      <h2>${escapeHtml(title)}</h2>
      <div class="meta">Projet: ${escapeHtml(currentProject?.name || '-')}${currentRound ? ` · Tour ${currentRound.round_number} - ${escapeHtml(currentRound.name || '')}` : ''} · ${dateStr}</div>
      ${table.outerHTML}
    </body>
    </html>`;
    
    // Utiliser un iframe caché (plus fiable que window.open)
    let iframe = document.getElementById('print-iframe');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'print-iframe';
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
    }
    
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    
    // Attendre le rendu puis imprimer
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      showNotify({ title:'Impression', message:'Fenêtre d\'impression ouverte', type:'success' });
    }, 500);
    
  } catch (err) {
    console.error('Erreur lors de l\'export PDF:', err);
    showNotify({ title:'Erreur', message:'Erreur lors de la génération du PDF: ' + err.message, type:'error' });
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"]+/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function validatePasswordRequirements(password) {
  const lengthReq = qs('#pwd-length');
  const upperReq = qs('#pwd-upper');
  const numberReq = qs('#pwd-number');
  const specialReq = qs('#pwd-special');
  
  if (!lengthReq || !upperReq || !numberReq || !specialReq) return;
  
  // Au moins 8 caractères
  lengthReq.classList.toggle('valid', password.length >= 8);
  
  // Au moins une majuscule
  upperReq.classList.toggle('valid', /[A-Z]/.test(password));
  
  // Au moins un chiffre
  numberReq.classList.toggle('valid', /[0-9]/.test(password));
  
  // Au moins un caractère spécial
  specialReq.classList.toggle('valid', /[.!:?,]/.test(password));
}

async function changePassword() {
  const currentPassword = qs('#settings-current-password').value;
  const newPassword = qs('#settings-new-password').value;
  const confirmPassword = qs('#settings-confirm-password').value;
  
  try {
    // Validations
    if (!currentPassword) { showNotify({ title:'Validation', message:'Entrez votre mot de passe actuel', type:'info' }); return; }
    
    if (!newPassword) { showNotify({ title:'Validation', message:'Entrez un nouveau mot de passe', type:'info' }); return; }
    
    if (newPassword !== confirmPassword) { showNotify({ title:'Validation', message:'Les mots de passe ne correspondent pas', type:'error' }); return; }
    
    // Vérifier les critères
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || 
        !/[0-9]/.test(newPassword) || !/[.!:?,]/.test(newPassword)) { showNotify({ title:'Validation', message:'Mot de passe non conforme aux critères', type:'error' }); return; }
    
    // Appel API
    const response = await api('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword }
    });
    
    if (response.success) {
      showNotify({ title:'Succès', message:'Mot de passe modifié', type:'success' });
      // Réinitialiser le formulaire
      qs('#settings-current-password').value = '';
      qs('#settings-new-password').value = '';
      qs('#settings-confirm-password').value = '';
      validatePasswordRequirements(''); // Reset des indicateurs
    }
  } catch (err) {
    showNotify({ title:'Erreur', message:(err.message || 'Impossible de changer le mot de passe'), type:'error' });
  }
}

/* ================== THEME ================== */
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'auto';
  setTheme(savedTheme);
  
  // Écouter les changements de préférence système
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    const currentTheme = localStorage.getItem('theme') || 'auto';
    if (currentTheme === 'auto') {
      applyTheme(mediaQuery.matches ? 'dark' : 'light');
    }
  });
}

function setTheme(theme) {
  localStorage.setItem('theme', theme);
  
  // Appliquer le thème effectif
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  } else {
    applyTheme(theme);
  }
  
  // Mettre à jour les boutons
  qsa('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

/* ================== AIDE CONTEXTUELLE ================== */
const HELP_CONTEXTS = {
  'tab-projects': {
    title: 'Projets',
    items: [
      'Créer un projet via le formulaire si votre rôle le permet.',
      'Chaque projet contient des tours (phases) et leurs lots.',
      'Le partage permet d’accorder lecture ou édition à des visionneurs.'
    ]
  },
  'tab-rounds': {
    title: 'Tours',
    items: [
      'Un tour correspond à une étape d’appel d’offres.',
      'Dupliquez un tour pour conserver la structure tout en lançant une nouvelle phase.',
      'Les stats (items, entreprises, questions) sont agrégées pour réduire les requêtes.'
    ]
  },
  'round-content': {
    title: 'Tour Sélectionné',
    items: [
      'Accédez aux lots, récapitulatif, configuration et questions.',
      'Le récapitulatif calcule les totaux (MOE masqué pour rôle entreprise).',
      'Les lots permettent la saisie / comparaison des offres.'
    ]
  },
  'tab-lot': {
    title: 'Lot',
    items: [
      'Vue édition: saisie des quantités & prix par entreprise.',
      'Vue comparatif: lecture consolidée avec écarts & pourcentages.',
      'Rôle entreprise: seules ses colonnes sont éditables, MOE masqué côté serveur.'
    ]
  }
};

function initContextHelp(){
  window.__HELP_ACTIVE = false;
  // Ajouter data-help-key sur panneaux racine si absent
  Object.keys(HELP_CONTEXTS).forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.dataset.helpKey) el.dataset.helpKey = id;
  });
  // Survol tooltips dynamiques
  document.body.addEventListener('mouseover', e => {
    if (!window.__HELP_ACTIVE) return;
    const target = e.target.closest('[data-help]');
    if (target) showHelpTooltip(target);
  });
  document.body.addEventListener('mouseout', e => {
    const target = e.target.closest('[data-help]');
    if (target) hideHelpTooltip(target);
  });
}

function currentActiveTabKey(){
  // Cherche un panel actif (classe .tabpanel ou .tab-content selon markup)
  const active = document.querySelector('.tabpanel:not(.hidden), .tab-content.active');
  if (!active) return null;
  return active.dataset.helpKey || active.id || null;
}

function renderHelpOverlay(){
  const overlay = document.getElementById('help-overlay');
  if (!overlay) return;
  overlay.innerHTML = '';
  if (!window.__HELP_ACTIVE){
    overlay.style.display = 'none';
    return;
  }
  const key = currentActiveTabKey();
  const ctx = key && HELP_CONTEXTS[key] ? HELP_CONTEXTS[key] : null;
  if (!ctx){
    overlay.style.display = 'none';
    return;
  }
  const title = document.createElement('h4');
  title.textContent = 'Aide: ' + ctx.title;
  overlay.appendChild(title);
  ctx.items.forEach(txt => {
    const div = document.createElement('div');
    div.className = 'help-item';
    div.textContent = txt;
    overlay.appendChild(div);
  });
  overlay.style.display = 'flex';
}

function showHelpTooltip(el){
  hideHelpTooltip(el);
  const text = el.getAttribute('data-help');
  if (!text) return;
  const tip = document.createElement('div');
  tip.className = 'help-tooltip';
  tip.textContent = text;
  el.appendChild(tip);
  requestAnimationFrame(()=> tip.classList.add('show'));
}

function hideHelpTooltip(el){
  const tip = el.querySelector('.help-tooltip');
  if (tip){
    tip.classList.remove('show');
    setTimeout(()=> tip.remove(), 200);
  }
}

function setHelp(el, text){ if (el) el.setAttribute('data-help', text); }
function setDemoTip(el, text){ if (el) el.setAttribute('data-demo-tip', text); }

function isDemoTutorialHost(){
  const host = window.location.hostname || '';
  return host === 'demo.ao-link.fr'
    || host.startsWith('demo.')
    || new URLSearchParams(window.location.search).has('demoTips');
}

function initDemoTutorialBubbles(){
  if (!isDemoTutorialHost()) return;
  document.body.classList.add('demo-tutorial');

  const getTip = () => {
    let tip = document.getElementById('demo-tip-popover');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'demo-tip-popover';
      tip.setAttribute('role', 'tooltip');
      document.body.appendChild(tip);
    }
    return tip;
  };

  const positionTip = (target, tip) => {
    const rect = target.getBoundingClientRect();
    tip.style.maxWidth = `${Math.min(300, window.innerWidth - 24)}px`;
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.classList.add('is-visible');

    const tipRect = tip.getBoundingClientRect();
    const top = Math.min(window.innerHeight - tipRect.height - 12, rect.bottom + 10);
    const left = Math.min(window.innerWidth - tipRect.width - 12, Math.max(12, rect.left));

    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(12, top)}px`;
  };

  const showDemoTip = (target) => {
    const text = target?.getAttribute('data-demo-tip');
    if (!text) return;
    const tip = getTip();
    tip.textContent = text;
    positionTip(target, tip);
  };

  const hideDemoTip = () => {
    document.getElementById('demo-tip-popover')?.classList.remove('is-visible');
  };

  document.body.addEventListener('mouseover', (event) => {
    const target = event.target.closest?.('[data-demo-tip]');
    if (target) showDemoTip(target);
  });
  document.body.addEventListener('mouseout', (event) => {
    if (event.target.closest?.('[data-demo-tip]')) hideDemoTip();
  });
  document.body.addEventListener('focusin', (event) => {
    const target = event.target.closest?.('[data-demo-tip]');
    if (target) showDemoTip(target);
  });
  document.body.addEventListener('focusout', (event) => {
    if (event.target.closest?.('[data-demo-tip]')) hideDemoTip();
  });
  window.addEventListener('scroll', hideDemoTip, true);
  window.addEventListener('resize', hideDemoTip);
}

function annotateDynamicHelp(){
  setHelp(document.getElementById('create-project'), 'Créer un nouveau projet');
  setHelp(document.getElementById('add-round'), 'Ajouter un tour (phase) au projet');
  setHelp(document.getElementById('add-lot'), 'Créer un lot à l’intérieur du tour sélectionné');
  setHelp(document.getElementById('save-grid'), 'Les modifications sont sauvegardées automatiquement dans la grille');
  setHelp(document.getElementById('mode-edit'), 'Basculer en mode édition de la grille');
  setHelp(document.getElementById('mode-compare'), 'Afficher le comparatif consolidé des offres');
  setHelp(document.getElementById('generate-questions'), 'Générer automatiquement les fiches questions pour ce lot');
  setHelp(document.getElementById('export-summary-excel'), 'Exporter le récapitulatif en Excel formaté');
  setHelp(document.getElementById('export-rounds-compare-options'), 'Ouvrir les options d\'export de la comparaison des tours');
  setHelp(document.getElementById('export-data-options'), 'Ouvrir les options d\'export de la zone Données');
  setHelp(document.getElementById('export-lot-compare-options'), 'Ouvrir les options d\'export du tableau comparatif du lot');
  setHelp(document.getElementById('open-phase-export-modal'), 'Ouvrir les options d\'export du projet depuis la phase');

  setDemoTip(document.querySelector('[data-tab="tab-projects"]'), 'Point de départ: ouvrez le projet démo pour parcourir les fonctionnalités.');
  setDemoTip(document.querySelector('[data-tab="tab-rounds"]'), 'Les tours représentent les phases de consultation: ouverture, négociation, ajustements.');
  setDemoTip(document.getElementById('create-project'), 'Crée un projet d’essai. En démo, il reste isolé des vrais dossiers.');
  setDemoTip(document.getElementById('add-round'), 'Ajoute un nouveau tour pour simuler une phase de négociation.');
  setDemoTip(document.getElementById('export-rao'), 'Génère le rapport d’analyse d’offres pour présenter la décision.');
  setDemoTip(document.getElementById('compare-round'), 'Choisissez un tour pour comparer les montants avec les phases précédentes.');
  setDemoTip(document.getElementById('rounds-compare-tab-compare'), 'Vue synthèse: compare les montants par lot, entreprise et tour.');
  setDemoTip(document.getElementById('rounds-compare-tab-options'), 'Les options servent à tester des variantes hors base: PV, prestations complémentaires, variantes techniques.');
  setDemoTip(document.getElementById('rounds-compare-tab-simulation'), 'La simulation permet de retenir virtuellement des entreprises par lot avant décision.');
  setDemoTip(document.getElementById('add-simulation'), 'Ajoute un scénario pour comparer plusieurs choix d’attribution.');
  setDemoTip(document.getElementById('export-rounds-compare-options'), 'Exporte la comparaison des tours pour partage interne ou client.');
  setDemoTip(document.getElementById('add-lot'), 'Ajoute un lot de travaux dans la phase courante.');
  setDemoTip(document.getElementById('mode-edit'), 'Mode saisie: ajustez MOE et offres directement dans la grille.');
  setDemoTip(document.getElementById('mode-compare'), 'Mode comparatif: visualisez les écarts, totaux et anomalies.');
  setDemoTip(document.getElementById('options-create-btn'), 'Crée une option commerciale ou technique rattachée au lot courant.');
  setDemoTip(document.getElementById('options-add-btn'), 'Ajoute des lignes dans l’option sélectionnée, comme une mini-DPGF.');
  setDemoTip(document.getElementById('generate-questions'), 'Génère les questions entreprises à partir des écarts détectés.');
  setDemoTip(document.getElementById('export-summary-excel'), 'Exporte le récapitulatif du tour courant en Excel.');
  setDemoTip(document.getElementById('export-data-options'), 'Exporte les données du lot ou les transmet par email.');
  setDemoTip(document.getElementById('export-lot-compare-options'), 'Exporte le comparatif du lot ouvert.');
}

function bindHelpToggle(){
  const btn = document.getElementById('toggle-help');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const modal = qs('#notify-modal');
    const titleEl = qs('#notify-title');
    const msgEl = qs('#notify-message');
    const okBtn = qs('#notify-ok');
    const closeBtn = qs('#notify-close');
    if (!modal || !titleEl || !msgEl) return;
    
    titleEl.textContent = 'Contact & Assistance';
    msgEl.innerHTML = `
      <div style="text-align: center; padding: 1rem;">
        <p style="margin-bottom: 1.5rem;">Pour toute question ou assistance, contactez-nous :</p>
        
        <div style="background: var(--bg-secondary, #f5f5f5); padding: 1.5rem; border-radius: 8px; margin-bottom: 1rem;">
          <p style="font-size: 1.1em; margin-bottom: 0.5rem;">
            <strong>${icon('mail')}Email :</strong>
          </p>
          <p style="font-size: 1em; color: var(--primary, #0066cc);">
            <a href="mailto:alban.michaud65@gmail.com" style="color: inherit; text-decoration: none;">alban.michaud65@gmail.com</a>
          </p>
        </div>
        
        <div style="background: var(--bg-secondary, #f5f5f5); padding: 1.5rem; border-radius: 8px;">
          <p style="font-size: 1.1em; margin-bottom: 0.5rem;">
            <strong>${icon('phone')}Téléphone :</strong>
          </p>
          <p style="font-size: 1em; color: var(--primary, #0066cc);">
            <a href="tel:+33787756047" style="color: inherit; text-decoration: none;">07 87 75 60 47</a>
          </p>
        </div>
      </div>
    `;
    
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    modal.classList.remove('notify-success','notify-error','notify-info');
    modal.classList.add('notify-info');
    
    const close = () => { modal.classList.add('hidden'); modal.style.display='none'; };
    okBtn?.addEventListener('click', close, { once: true });
    closeBtn?.addEventListener('click', close, { once: true });
    modal.addEventListener('click', (e)=>{ if (e.target.id === 'notify-modal') close(); }, { once: true });
  });
}

document.addEventListener('DOMContentLoaded', () => { 
  updateCurrentUser(); // Charger le rôle depuis le token au démarrage
  bindUI(); 
  if (token) showDashboard(); 

  // Masquer les onglets de tour non utilisables des le chargement
  const tourConfigBtn = qs('[data-tour-tab="tour-config"]');
  const tourQuestionsBtn = qs('[data-tour-tab="tour-questions"]');
  if (tourConfigBtn) tourConfigBtn.style.display = 'none';
  if (tourQuestionsBtn) tourQuestionsBtn.style.display = 'none';
  const tourConfigPanel = qs('#tour-config');
  const tourQuestionsPanel = qs('#tour-questions');
  if (tourConfigPanel) tourConfigPanel.classList.add('hidden');
  if (tourQuestionsPanel) tourQuestionsPanel.classList.add('hidden');

  // Init aide contextuelle
  initContextHelp();
  initDemoTutorialBubbles();
  bindHelpToggle();
  setTimeout(annotateDynamicHelp, 1200); // léger délai pour laisser le DOM se peupler

  // Brancher les boutons d'export PDF (récap et comparaison)
  const summaryBtn = document.getElementById('export-summary-pdf');
  if (summaryBtn) {
    summaryBtn.addEventListener('click', () => {
      const title = `Récapitulatif - ${currentProject?.name || ''} ${currentRound ? `(Tour ${currentRound.round_number} - ${currentRound.name})` : ''}`.trim();
      exportTableToPDF('#summary-table', title || 'Récapitulatif');
    });
  }
  const compareBtn = document.getElementById('export-rounds-compare-options');
  if (compareBtn) {
    compareBtn.addEventListener('click', () => {
      openRoundsExportModal();
    });
  }
});
