// server/src/public/app.js
// Front monolithique (same-origin)
const API_ROOT = window.location.origin;
const API_BASE = API_ROOT + '/api';

/* ====== Auth ================= */
let token = localStorage.getItem('token') || null;
let currentProject = null;
let currentLot = null;

let lotCompanies = [];      // [{id,name}]
let sheetRows = [];         // [{ item_id, num, designation, unit, moe:{qty,pu}, offers:{[cid]:{u,qty,pu}} }]
let colModel = [];          // [{ key, editable, wide, cls }]
const undoStack = [];
const redoStack = [];

/* ====== Helpers DOM ====== */
const qs  = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const show = (sel) => qs(sel).classList.remove('hidden');
const hide = (sel) => qs(sel).classList.add('hidden');
const setText = (sel, t) => { const el = qs(sel); if (el) el.textContent = t; };

/* ====== Num parse/format (FR friendly) ====== */
function parseNum(v){
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  let s = String(v).trim();
  // enlever espaces (y compris insécables)
  s = s.replace(/[\u00A0\u202F\s]/g, '');
  // formats mixtes 1.234,56 / 1,234.56
  const lastComma = s.lastIndexOf(',');
  const lastDot   = s.lastIndexOf('.');
  if (lastComma > -1 || lastDot > -1) {
    const last = Math.max(lastComma, lastDot);
    const decSep = s[last];
    // supprimer tous les autres séparateurs de milliers
    s = s
      .replace(/[.,]/g, (m, idx) => (idx === last ? m : ''))
      .replace(decSep, '.');
  }
  // style (123) => -123
  if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
  // garder chiffres, ., -
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

/* ====== Loading Spinner ====== */
function showLoader() { qs('#global-loader')?.classList.remove('hidden'); }
function hideLoader() { qs('#global-loader')?.classList.add('hidden'); }

/* ====== API ====== */
async function api(path, opts = {}) {
  const url = API_BASE + path;
  const headers = opts.headers || {};
  
  // Mode accès direct : pas de token requis
  if (token && token !== 'direct-access-mode') {
    headers['Authorization'] = 'Bearer ' + token;
  }
  
  let body = opts.body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  
  // Afficher le loader sauf si désactivé explicitement
  const showLoading = opts.showLoader !== false;
  if (showLoading) showLoader();
  
  try {
    const res = await fetch(url, { ...opts, headers, body });
    const isJson = res.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await res.json().catch(()=> ({})) : await res.text();
    if (!res.ok) throw new Error((isJson && data?.error) ? data.error : (data || res.statusText));
    return data;
  } finally {
    if (showLoading) hideLoader();
  }
}

/* ================= Onglets ================= */
function activateTab(id){
  qsa('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  qsa('.tabpanel').forEach(p => p.id === id ? show('#'+id) : hide('#'+p.id));
}
function enableTab(id, enabled=true){
  const btn = qsa('.tab').find(b => b.dataset.tab === id);
  if (btn){ btn.disabled = !enabled; }
}

/* ================= Auth ================= */
async function login(email, password){
  const r = await fetch(API_BASE + '/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password })});
  const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Identifiants invalides');
  token = j.token; localStorage.setItem('token', token); return j.user;
}
async function registerFirst(email, password){
  const r = await fetch(API_BASE + '/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password, role:'admin' })});
  const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Création admin impossible');
  token = j.token; localStorage.setItem('token', token); return j.user;
}

/* ================= Projets / Lots ================= */
function renderProjects(list){
  const tbody = qs('#projects-table tbody'); tbody.innerHTML='';
  for (const p of list){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.id}</td><td>${p.name}</td><td>${p.reference||''}</td><td>${p.client||''}</td><td>${new Date(p.created_at).toLocaleString()}</td><td><button class="btn">Ouvrir</button></td>`;
    tr.querySelector('button').addEventListener('click', () => openProject(p.id));
    tbody.appendChild(tr);
  }
}
async function refreshProjects(){ const list = await api('/projects'); renderProjects(list); }

async function openProject(id){
  const { project, lots } = await api('/projects/'+id);
  currentProject = project;
  enableTab('tab-project', true); enableTab('tab-lot', false);
  activateTab('tab-project');
  setText('#project-title', `Projet #${project.id} — ${project.name}`);
  const tbody = qs('#lots-table tbody'); tbody.innerHTML='';
  for (const l of lots){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${l.id}</td><td>${l.code||''}</td><td>${l.name}</td><td><button class="btn">Ouvrir</button></td>`;
    tr.querySelector('button').addEventListener('click', () => openLot(l.id, l));
    tbody.appendChild(tr);
  }
}

async function openLot(id, lotMeta){
  currentLot = { id, ...lotMeta };
  enableTab('tab-lot', true);
  activateTab('tab-lot');
  setText('#lot-title', `Lot #${id} — ${lotMeta.name}`);

  // Entreprises du lot
  lotCompanies = await api(`/lots/${id}/companies`);

  // Données pour éditer
  const raw = await api(`/lots/${id}`); // {items, moe, companies, offers}
  buildSheetModel(raw);

  // Afficher comparatif par défaut
  await refreshCompare();
  hide('#sheet-view'); hide('#sheet-actions'); show('#compare-view');
  qs('#mode-compare').classList.add('active-mode'); qs('#mode-edit').classList.remove('active-mode');

  // Chips entreprises
  renderLotCompanies();
}

/* ================= Comparatif (lecture) ================= */
function fmtPct(p){ if (p==null || isNaN(p)) return ''; const cls = p>0?'delta-neg':(p<0?'delta-pos':''); const s=(p>0?'+':'')+p.toFixed(1)+'%'; return `<span class="${cls}">${s}</span>`; }
function fmtNum(v){ 
  if (v == null || v === '') return ''; 
  const n = parseNum(v); 
  return Number.isFinite(n) ? formatNum(n) : ''; 
}

async function refreshCompare(){
  if (!currentLot) return;
  const data = await api('/lots/'+currentLot.id+'/table');
  const head = qs('#compare-head'), body = qs('#compare-body'); head.innerHTML=''; body.innerHTML='';
  let h1 = `<tr><th rowspan="2" class="sticky-col">Num</th><th rowspan="2" class="sticky-col2">Désignation</th><th rowspan="2">Unité</th><th colspan="3" class="moe-col">MOE</th>`;
  for (const c of data.companies) h1 += `<th colspan="5" class="company-col">${c.name}</th>`; h1 += '</tr>';
  let h2 = `<tr><th>Qté</th><th>PU</th><th>Mt</th>`; for (let i=0;i<data.companies.length;i++) h2 += '<th>Unité</th><th>Qté</th><th>PU</th><th>Mt</th><th>ΔPU</th>'; h2 += '</tr>';
  head.innerHTML = h1 + h2;
  for (const r of data.rows){
    let tr = `<tr><td class="sticky-col">${r.num||''}</td><td class="sticky-col2">${r.designation||''}</td><td>${r.unit||''}</td><td>${fmtNum(r.moe.qty)}</td><td>${fmtNum(r.moe.pu)}</td><td>${fmtNum(r.moe.mt)}</td>`;
    for (const c of r.companies){ tr += `<td>${c.u||''}</td><td>${fmtNum(c.qty)}</td><td>${fmtNum(c.pu)}</td><td>${fmtNum(c.mt)}</td><td>${fmtPct(c.delta_pu_pct)}</td>`; }
    tr += '</tr>'; body.insertAdjacentHTML('beforeend', tr);
  }
}

/* ================= Tableur (édition) ================= */
/** 1) Construire le modèle (données + colonnes) puis rendu initial */
function buildSheetModel(raw){
  const moeByItem = new Map(raw.moe.map(m => [m.item_id, m]));
  const offersByItem = new Map();
  for (const o of raw.offers) {
    if (!offersByItem.has(o.item_id)) offersByItem.set(o.item_id, new Map());
    offersByItem.get(o.item_id).set(o.company_id, o);
  }

  sheetRows = raw.items.map((it) => {
    const moe = moeByItem.get(it.id) || {};
    const row = {
      item_id: it.id,
      num: it.num || '',
      designation: it.designation || '',
      unit: it.unit || '',
      moe: { 
        qty: moe.qty != null ? String(moe.qty) : '', 
        pu: moe.unit_price != null ? String(moe.unit_price) : '' 
      },
      offers: {}
    };
    for (const c of lotCompanies) {
      const o = offersByItem.get(it.id)?.get(c.id) || {};
      row.offers[c.id] = { 
        u: o.unit ?? '', 
        qty: o.qty != null ? String(o.qty) : '', 
        pu: o.unit_price != null ? String(o.unit_price) : '' 
      };
    }
    return row;
  });

  if (sheetRows.length === 0)
    sheetRows.push({ item_id:null, num:'', designation:'', unit:'', moe:{qty:'', pu:''}, offers:{} });

  buildColModel();
  renderSheetInitial();
}

function buildColModel(){
  // base 6 colonnes
  colModel = [
    { key:'num',        editable:true },
    { key:'designation',editable:true,  wide:true },
    { key:'unit',       editable:true },
    { key:'moe.qty',    editable:true,  cls:'moe-col' },
    { key:'moe.pu',     editable:true,  cls:'moe-col' },
    { key:'moe.mt',     editable:false, cls:'moe-col' },
  ];
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

/** Rendu initial sans réutiliser pendant les collages */
function renderSheetInitial(){
  const head = qs('#sheet-head');
  const body = qs('#sheet-body');
  head.innerHTML = ''; body.innerHTML = '';

  // top header: base (rowSpan=2) + groupes
  const tr1 = document.createElement('tr');
  // base (6) en rowSpan
  const baseCount = 6;
  for (let i=0;i<baseCount;i++){
    const col = colModel[i];
    const th = document.createElement('th');
    th.textContent = headerLabelFor(col.key);
    th.rowSpan = 2;
    if (col.cls) th.classList.add(col.cls);
    tr1.appendChild(th);
  }
  // groupes par entreprise (4 colonnes)
  for (let i=baseCount;i<colModel.length;i+=4){
    const col = colModel[i];
    const [, cid] = col.key.split('.');
    const th = document.createElement('th');
    th.textContent = companyNameFor(cid);
    th.colSpan = 4;
    th.classList.add('company-col');
    tr1.appendChild(th);
  }
  head.appendChild(tr1);

  // bottom header: libellés des 4 colonnes par entreprise
  const tr2 = document.createElement('tr');
  for (let i=baseCount;i<colModel.length;i++){
    const th = document.createElement('th');
    th.textContent = headerLabelFor(colModel[i].key);
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
  for (let c=0;c<colModel.length;c++){
    const col = colModel[c];
    const td = document.createElement('td');
    td.dataset.r = String(rIndex);
    td.dataset.c = String(c);
    if (col.editable) td.contentEditable = 'true'; else td.classList.add('cell-readonly');
    if (col.wide) td.style.minWidth = '320px';
    td.textContent = valueForCell(data, col.key);
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
  if (key === 'moe.mt')  return amountOf(row.moe?.qty, row.moe?.pu);
  if (key.startsWith('c.')){
    const [, cid, sub] = key.split('.');
    const o = row.offers?.[cid] || {};
    if (sub === 'mt') return amountOf(o.qty, o.pu);
    return o[sub] ?? '';
  }
  return '';
}

/** ====== Mutations incrémentales ====== */
function ensureRows(n){
  // compléter sheetRows + DOM jusqu’à n lignes
  while (qsa('#sheet-body tr').length < n) {
    const blank = { item_id:null, num:'', designation:'', unit:'', moe:{qty:'', pu:''}, offers:{} };
    for (const c of lotCompanies) blank.offers[c.id] = { u:'', qty:'', pu:'' };
    sheetRows.push(blank);
    const rIndex = sheetRows.length - 1;
    appendRowDOM(rIndex, blank);
    // recalcul (vide au départ, mais garde la logique)
    recalcRowAmountsRow(rIndex);
  }
}
function getCell(r, c){
  const rowEl = qsa('#sheet-body tr')[r];
  return rowEl ? rowEl.children[c] : null;
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
  if (cQty>=0 && cPu>=0 && cMt>=0){
    const qty = getCell(r,cQty)?.textContent.trim();
    const pu  = getCell(r,cPu )?.textContent.trim();
    const mt  = getCell(r,cMt );
    if (mt) mt.textContent = amountOf(qty, pu);
  }
  // Entreprises
  for (const c of lotCompanies){
    const base = `c.${c.id}.`;
    const ciQty = colModel.findIndex(x => x.key === base+'qty');
    const ciPu  = colModel.findIndex(x => x.key === base+'pu');
    const ciMt  = colModel.findIndex(x => x.key === base+'mt');
    if (ciQty>=0 && ciPu>=0 && ciMt>=0){
      const qty = getCell(r,ciQty)?.textContent.trim();
      const pu  = getCell(r,ciPu )?.textContent.trim();
      const mt  = getCell(r,ciMt );
      if (mt) mt.textContent = amountOf(qty, pu);
    }
  }
}

/** focus cellule (ajoute lignes si nécessaire), saute readonly */
function focusCell(r, c){
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
  }
}

/* ====== Délégation d’événements (pas de listeners par cellule) ====== */
let delegatesAttached = false;
function attachSheetDelegates(){
  if (delegatesAttached) return;
  const body = qs('#sheet-body');

  body.addEventListener('focusin', (e) => {
    const td = e.target.closest('td'); if (!td) return;
    td.dataset.prev = td.textContent;
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
  body.addEventListener('keydown', (e) => {
    const td = e.target.closest('td'); if (!td) return;
    const r = Number(td.dataset.r), c = Number(td.dataset.c);

    // Undo/Redo
    if (e.ctrlKey && (e.key==='z' || e.key==='Z')) { e.preventDefault(); undo(); return; }
    if (e.ctrlKey && (e.key==='y' || (e.shiftKey && (e.key==='Z'||e.key==='z')))) { e.preventDefault(); redo(); return; }

    const navKeys = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter','Tab'];
    if (!navKeys.includes(e.key)) return;

    // commit avant navigation
    const prev = td.dataset.prev ?? '';
    const now  = td.textContent;
    if (prev !== now) { pushUndo({ r, c, key: colModel[c].key, prev, next: now }); redoStack.length = 0; td.dataset.prev = now; }

    let nr = r, nc = c;
    if (e.key === 'ArrowLeft')  nc = Math.max(0, c - 1);
    if (e.key === 'ArrowRight') nc = c + 1;
    if (e.key === 'ArrowUp')    nr = Math.max(0, r - 1);
    if (e.key === 'ArrowDown')  nr = r + 1;
    if (e.key === 'Enter')      nr = r + 1;
    if (e.key === 'Tab')        nc = c + (e.shiftKey ? -1 : 1);

    e.preventDefault();
    focusCell(nr, nc);
  }, true);

  // collage multi-cellules (Excel / CSV ; ; , auto)
  body.addEventListener('paste', (e) => {
    const td = e.target.closest('td'); if (!td) return;
    e.preventDefault();

    const startR = Number(td.dataset.r);
    const startC = Number(td.dataset.c);

    const text = e.clipboardData.getData('text/plain') || '';
    const delim = detectDelimiter(text);
    // Garder toutes les lignes, même vides, pour préserver l'espacement DPGF
    const lines = text.replace(/\r/g,'').split('\n');
    if (!lines.length) return;
    const grid = lines.map(l => l.split(delim));

    ensureRows(startR + grid.length);

    for (let i = 0; i < grid.length; i++) {
      let col = startC;
      for (let j = 0; j < grid[i].length; j++) {
        // sauter colonnes non éditables (ex: Mt)
        let guard = 0;
        while (col < colModel.length && !colModel[col].editable && guard++ < 100) col++;
        if (col >= colModel.length) break;

        const val = String(grid[i][j]).trim();
        const cellTarget = getCell(startR+i, col);
        if (!cellTarget) break;
        
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

function markAsChanged() {
  hasUnsavedChanges = true;
  updateSaveButton();
}

function updateSaveButton() {
  const btn = qs('#save-grid');
  if (!btn) return;
  if (hasUnsavedChanges) {
    btn.textContent = '💾 Sauvegarder';
    btn.classList.add('btn-unsaved');
  } else {
    btn.textContent = '✓ Sauvegardé';
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
    chip.innerHTML = `${c.name}<button data-id="${c.id}" title="Retirer">×</button>`;
    chip.querySelector('button').addEventListener('click', async () => {
      // Confirmation avant suppression
      if (!confirm(`Supprimer l'entreprise "${c.name}" ?\n\nToutes les offres de cette entreprise seront également supprimées.`)) {
        return;
      }
      
      try {
        await api(`/lots/${currentLot.id}/companies/${c.id}`, { method:'DELETE' });
        lotCompanies = lotCompanies.filter(x => x.id !== c.id);

        // MAJ modèle de colonnes + sheetRows (supprimer les offres de cette entreprise)
        for (const r of sheetRows) delete r.offers[c.id];
        buildColModel();
        renderSheetInitial();  // (on rerend la structure car nombre de colonnes change)
        refreshCompare();
      } catch (err) {
        alert('❌ Erreur lors de la suppression: ' + err.message);
      }
    });
    wrap.appendChild(chip);
  }
}

function addRow(){
  ensureRows(qsa('#sheet-body tr').length + 1);
  // focus première colonne éditable de la nouvelle ligne
  const r = qsa('#sheet-body tr').length - 1;
  const firstEditable = colModel.findIndex(c => c.editable);
  if (firstEditable >= 0) focusCell(r, firstEditable);
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

    // Validation PU MOE
    if (moePu !== '' && isNaN(parseNum(moePu))) {
      alert(`Erreur: Le PU de la ligne "${designation}" n'est pas un nombre valide.`);
      return;
    }

    // Sauvegarder toutes les lignes, même vides, pour préserver l'espacement DPGF
    const row = {
      item_id: sheetRows[r]?.item_id || null,
      num, designation, unit,
      moe: { qty: moeQty, pu: moePu },
      offers: {}
    };

    for (const c of lotCompanies){
      const base = `c.${c.id}.`;
      const offerPu = getByKey(base+'pu');
      if (offerPu !== '' && isNaN(parseNum(offerPu))) {
        alert(`Erreur: Le PU de l'offre (entreprise) de la ligne "${designation}" n'est pas un nombre valide.`);
        return;
      }
      row.offers[c.id] = {
        u:  getByKey(base+'u'),
        qty:getByKey(base+'qty'),
        pu: offerPu,
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
    
    // Sauvegarde en arrière-plan sans loader
    const result = await api(`/lots/${currentLot.id}/save-grid`, { 
      method:'POST', 
      body:{ rows },
      showLoader: false 
    });

    // Le serveur retourne les items créés avec leurs IDs
    // Synchroniser uniquement les item_id sans toucher aux données affichées
    if (result && result.items && Array.isArray(result.items)) {
      for (let i = 0; i < Math.min(result.items.length, sheetRows.length); i++) {
        if (sheetRows[i] && result.items[i] && result.items[i].id) {
          sheetRows[i].item_id = result.items[i].id;
        }
      }
    }
    
    // Rafraîchir uniquement le comparatif (vue lecture seule)
    await refreshCompare();
    
    hasUnsavedChanges = false;
    updateSaveButton();
    
    console.log('✅ Sauvegarde réussie');
  } catch (err) {
    console.error('❌ Erreur sauvegarde:', err);
    alert('❌ Erreur lors de la sauvegarde: ' + err.message);
  } finally {
    isSaving = false;
  }
}

/* ================= Bindings UI ================= */
function renderSheetBindings(){
  // boutons édition
  qs('#add-row').addEventListener('click', addRow);

  qs('#add-company').addEventListener('click', async () => {
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

  qs('#save-grid').addEventListener('click', saveGrid);
  qs('#undo').addEventListener('click', undo);
  qs('#redo').addEventListener('click', redo);

  // bascule modes
  qs('#mode-compare').addEventListener('click', () => {
    hide('#sheet-view'); hide('#sheet-actions'); show('#compare-view');
    qs('#mode-compare').classList.add('active-mode'); qs('#mode-edit').classList.remove('active-mode');
  });
  qs('#mode-edit').addEventListener('click', () => {
    show('#sheet-view'); show('#sheet-actions'); hide('#compare-view');
    qs('#mode-edit').classList.add('active-mode'); qs('#mode-compare').classList.remove('active-mode');
  });

  // Raccourcis globaux
  document.addEventListener('keydown', (e) => {
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
}

/* ================== INIT ================== */
function showDashboard(){ hide('#login-view'); show('#dashboard'); activateTab('tab-projects'); refreshProjects(); }

function bindUI(){
  // Accès direct (sans authentification)
  qs('#direct-access').addEventListener('click', async ()=> {
    setText('#login-msg','Connexion...');
    token = 'direct-access-mode'; // Token factice pour activer l'interface
    localStorage.setItem('token', token);
    showDashboard();
  });
  
  // Auth classique
  qs('#login-btn').addEventListener('click', async ()=>{ 
    setText('#login-msg',''); 
    try{ 
      await login(qs('#email').value.trim(), qs('#password').value); 
      showDashboard(); 
    } catch(e){ 
      setText('#login-msg', e.message); 
    }
  });
  
  qs('#bootstrap-admin').addEventListener('click', async ()=>{ 
    setText('#login-msg',''); 
    try{ 
      await registerFirst(qs('#email').value.trim(), qs('#password').value); 
      showDashboard(); 
    } catch(e){ 
      setText('#login-msg', e.message); 
    }
  });
  
  qs('#logout').addEventListener('click', ()=>{ localStorage.removeItem('token'); location.reload(); });

  // tabs
  qsa('.tab').forEach(b => b.addEventListener('click', () => !b.disabled && activateTab(b.dataset.tab)));

  // projets / lots
  qs('#create-project').addEventListener('click', async ()=>{ try{
    const body={ name:qs('#proj-name').value.trim(), reference:qs('#proj-ref').value.trim(), client:qs('#proj-client').value.trim(), location:qs('#proj-location').value.trim() };
    if(!body.name) return alert('Nom requis');
    await api('/projects',{method:'POST',body});
    qsa('#proj-name,#proj-ref,#proj-client,#proj-location').forEach(i=>i.value='');
    await refreshProjects();
  }catch(e){ alert(e.message);} });

  qs('#add-lot').addEventListener('click', async ()=>{ try{
    if(!currentProject) return alert('Ouvrir un projet');
    const code=qs('#lot-code').value.trim(); const name=qs('#lot-name').value.trim();
    if(!name) return alert('Nom du lot requis');
    await api(`/projects/${currentProject.id}/lots`,{method:'POST',body:{code,name}});
    qsa('#lot-code,#lot-name').forEach(i=>i.value=''); await openProject(currentProject.id);
  }catch(e){ alert(e.message);} });

  renderSheetBindings();
}

document.addEventListener('DOMContentLoaded', () => { bindUI(); if (token) showDashboard(); });
