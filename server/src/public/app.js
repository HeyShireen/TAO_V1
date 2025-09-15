// same-origin
const API_ROOT = window.location.origin;
const API_BASE = API_ROOT + '/api';

let token = localStorage.getItem('token') || null;
let currentProject = null;
let currentLot = null;

let lotCompanies = [];            // [{id,name}]
let sheetRows = [];               // [{ item_id, num, designation, unit, moe:{qty,pu}, offers:{[cid]:{u,qty,pu}} }]
const undoStack = [];
const redoStack = [];

const qs  = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const show = (sel) => qs(sel).classList.remove('hidden');
const hide = (sel) => qs(sel).classList.add('hidden');
const setText = (sel, t) => { const el = qs(sel); if (el) el.textContent = t; };

async function api(path, opts = {}) {
  const url = API_BASE + path;
  const headers = opts.headers || {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  let body = opts.body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const res = await fetch(url, { ...opts, headers, body });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(()=> ({})) : await res.text();
  if (!res.ok) throw new Error((isJson && data?.error) ? data.error : (data || res.statusText));
  return data;
}

/* ===== Tabs ===== */
function activateTab(id){
  qsa('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  qsa('.tabpanel').forEach(p => p.id === id ? show('#'+id) : hide('#'+p.id));
}
function enableTab(id, enabled=true){
  const btn = qsa('.tab').find(b => b.dataset.tab === id);
  if (btn){ btn.disabled = !enabled; }
}

/* ===== AUTH ===== */
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

/* ===== PROJETS / LOTS (navigation) ===== */
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

  // Entreprises
  lotCompanies = await api(`/lots/${id}/companies`);
  renderLotCompanies();

  // Construire le modèle pour le tableur
  const raw = await api(`/lots/${id}`);
  buildSheetModel(raw);

  // Afficher le comparatif par défaut
  await refreshCompare();

  // Par défaut: mode comparatif actif
  hide('#sheet-view'); hide('#sheet-actions'); show('#compare-view');
  qs('#mode-compare').classList.add('active-mode'); qs('#mode-edit').classList.remove('active-mode');
}

/* ===== COMPARATIF (lecture) ===== */
function fmtPct(p){ if (p==null || isNaN(p)) return ''; const cls = p>0?'delta-neg':(p<0?'delta-pos':''); const s=(p>0?'+':'')+p.toFixed(1)+'%'; return `<span class="${cls}">${s}</span>`; }
function fmtNum(v){ if (v==null || v==='') return ''; const n=Number(v); return isNaN(n)?String(v):n.toLocaleString(undefined,{maximumFractionDigits:3}); }
async function refreshCompare(){
  if (!currentLot) return;
  const data = await api('/lots/'+currentLot.id+'/table');
  const head = qs('#compare-head'), body = qs('#compare-body'); head.innerHTML=''; body.innerHTML='';
  let h1 = `<tr><th rowspan="2" class="sticky-col">Num</th><th rowspan="2" class="sticky-col2">Désignation</th><th rowspan="2">U</th><th colspan="3" class="moe-col">MOE</th>`;
  for (const c of data.companies) h1 += `<th colspan="5" class="company-col">${c.name}</th>`; h1 += '</tr>';
  let h2 = `<tr><th>Qté</th><th>PU</th><th>Mt</th>`; for (let i=0;i<data.companies.length;i++) h2 += '<th>U</th><th>Qté</th><th>PU</th><th>Mt</th><th>ΔPU</th>'; h2 += '</tr>';
  head.innerHTML = h1 + h2;
  for (const r of data.rows){
    let tr = `<tr><td class="sticky-col">${r.num||''}</td><td class="sticky-col2">${r.designation||''}</td><td>${r.unit||''}</td><td>${fmtNum(r.moe.qty)}</td><td>${fmtNum(r.moe.pu)}</td><td>${fmtNum(r.moe.mt)}</td>`;
    for (const c of r.companies){ tr += `<td>${c.u||''}</td><td>${fmtNum(c.qty)}</td><td>${fmtNum(c.pu)}</td><td>${fmtNum(c.mt)}</td><td>${fmtPct(c.delta_pu_pct)}</td>`; }
    tr += '</tr>'; body.insertAdjacentHTML('beforeend', tr);
  }
}

/* ===== TABLEUR (édition) ===== */
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
      moe: { qty: moe.qty ?? '', pu: moe.unit_price ?? '' },
      offers: {}
    };
    for (const c of lotCompanies) {
      const o = offersByItem.get(it.id)?.get(c.id) || {};
      row.offers[c.id] = { u: o.unit ?? '', qty: o.qty ?? '', pu: o.unit_price ?? '' };
    }
    return row;
  });

  // au moins une ligne vide
  if (sheetRows.length === 0) sheetRows.push({ item_id:null, num:'', designation:'', unit:'', moe:{qty:'', pu:''}, offers:{} });

  renderSheet();
}

function renderLotCompanies(){
  const wrap = qs('#lot-companies');
  wrap.innerHTML = '';
  for (const c of lotCompanies) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${c.name}<button data-id="${c.id}" title="Retirer">×</button>`;
    chip.querySelector('button').addEventListener('click', async () => {
      await api(`/lots/${currentLot.id}/companies/${c.id}`, { method:'DELETE' });
      lotCompanies = lotCompanies.filter(x => x.id !== c.id);
      // retirer colonnes dans le modèle
      for (const r of sheetRows) delete r.offers[c.id];
      renderLotCompanies();
      renderSheet();
      await refreshCompare();
    });
    wrap.appendChild(chip);
  }
}

function headerStructure(){
  // base: 6 colonnes
  const base = [
    { key:'num', label:'Num', readonly:false },
    { key:'designation', label:'Désignation', readonly:false, wide:true },
    { key:'unit', label:'U', readonly:false },
    { key:'moe.qty', label:'Quantité MOE', readonly:false, cls:'moe-col' },
    { key:'moe.pu',  label:'PU MOE',       readonly:false, cls:'moe-col' },
    { key:'moe.mt',  label:'Mt MOE',       readonly:true,  cls:'moe-col' },
  ];
  const comps = lotCompanies.map(c => ({
    id: c.id,
    name: c.name,
    cols: [
      { key:`c.${c.id}.u`,  label:'U',  readonly:false },
      { key:`c.${c.id}.qty`,label:'Qté',readonly:false },
      { key:`c.${c.id}.pu`, label:'PU', readonly:false },
      { key:`c.${c.id}.mt`, label:'Mt', readonly:true  },
    ]
  }));
  return { base, comps };
}

function renderSheet(){
  const { base, comps } = headerStructure();
  const head = qs('#sheet-head'); const body = qs('#sheet-body');
  head.innerHTML = ''; body.innerHTML = '';

  // header top
  const tr1 = document.createElement('tr');
  for (const b of base){ const th = document.createElement('th'); th.textContent = b.label; th.rowSpan = 2; if (b.cls) th.classList.add(b.cls); tr1.appendChild(th); }
  for (const g of comps){ const th = document.createElement('th'); th.textContent = g.name; th.colSpan = 4; th.classList.add('company-col'); tr1.appendChild(th); }
  head.appendChild(tr1);
  // header bottom
  const tr2 = document.createElement('tr');
  for (const g of comps){ for (const c of g.cols){ const th = document.createElement('th'); th.textContent = c.label; tr2.appendChild(th); } }
  head.appendChild(tr2);

  // body
  sheetRows.forEach((row, rIndex) => {
    const tr = document.createElement('tr');

    // base cells
    for (const b of base){
      tr.appendChild(makeCell(rIndex, b.key, b.readonly, rowValue(row, b.key), b.wide));
    }
    // company cells
    for (const g of comps){
      for (const c of g.cols){
        tr.appendChild(makeCell(rIndex, c.key, c.readonly, rowValue(row, c.key)));
      }
    }
    body.appendChild(tr);
    // calc mt initial
    recalcRowAmounts(rIndex);
  });
}

function rowValue(row, key){
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

function setRowValue(rIndex, key, val){
  const row = sheetRows[rIndex];
  if (key === 'num') row.num = val;
  else if (key === 'designation') row.designation = val;
  else if (key === 'unit') row.unit = val;
  else if (key === 'moe.qty') row.moe.qty = val;
  else if (key === 'moe.pu')  row.moe.pu  = val;
  else if (key.startsWith('c.')){
    const [, cid, sub] = key.split('.');
    row.offers[cid] = row.offers[cid] || { u:'', qty:'', pu:'' };
    if (sub !== 'mt') row.offers[cid][sub] = val;
  }
}

function amountOf(q, pu){
  const n1 = Number(q), n2 = Number(pu);
  if (!isFinite(n1) || !isFinite(n2)) return '';
  if (q === '' || pu === '') return '';
  return (n1 * n2).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function makeCell(r, key, readonly, value, wide=false, colIndex=null){
  const td = document.createElement('td');
  if (!readonly) td.contentEditable = 'true';
  if (readonly) td.classList.add('cell-readonly');
  if (wide) td.style.minWidth = '320px';
  td.textContent = value ?? '';
  td.dataset.r = String(r);
  td.dataset.key = key;
  td.dataset.c = String(colIndex ?? 0);  // <-- index de colonne
  td.addEventListener('focusin', onCellFocus);
  td.addEventListener('blur', onCellBlur);
  td.addEventListener('keydown', onCellKeyDown);
  td.addEventListener('input', onCellInput);
  td.addEventListener('paste', onSheetPaste); // <-- collage multi-cellules
  return td;
}


function onCellFocus(e){
  const td = e.currentTarget;
  td.dataset.prev = td.textContent;
}

function onCellBlur(e){
  const td = e.currentTarget;
  const r = Number(td.dataset.r);
  const key = td.dataset.key;
  const prev = td.dataset.prev ?? '';
  const now  = td.textContent;
  if (prev !== now) {
    pushUndo({ r, key, prev, next: now });
    redoStack.length = 0;
  }
}

function onCellInput(e){
  // mise à jour modèle + recalcul auto des montants
  const td = e.currentTarget;
  const r = Number(td.dataset.r);
  const key = td.dataset.key;
  setRowValue(r, key, td.textContent.trim());
  recalcRowAmounts(r);
}

function onCellKeyDown(e){
  const td = e.currentTarget;
  const r  = Number(td.dataset.r);
  const ci = Number(td.dataset.c);
  const key = td.dataset.key;

  // Undo/Redo clavier
  if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return; }
  if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && (e.key === 'Z' || e.key === 'z')))) { e.preventDefault(); redo(); return; }

  const navKeys = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter','Tab'];
  if (!navKeys.includes(e.key)) return;

  // commit avant navigation
  const prev = td.dataset.prev ?? '';
  const now  = td.textContent;
  if (prev !== now) { pushUndo({ r, key, prev, next: now }); redoStack.length = 0; td.dataset.prev = now; }

  let nr = r, nc = ci;
  if (e.key === 'ArrowLeft')  nc = Math.max(0, ci - 1);
  if (e.key === 'ArrowRight') nc = ci + 1;
  if (e.key === 'ArrowUp')    nr = Math.max(0, r - 1);
  if (e.key === 'ArrowDown')  nr = r + 1;
  if (e.key === 'Enter')      nr = r + 1;
  if (e.key === 'Tab')        nc = ci + (e.shiftKey ? -1 : 1);

  e.preventDefault();
  focusEditableByIndex(nr, nc);
}

function focusEditableByIndex(rowIndex, colIndex){
  // ajoute une ligne si on descend en-dessous de la dernière
  while (rowIndex >= qsa('#sheet-body tr').length) addRow();

  const rowEl = qsa('#sheet-body tr')[rowIndex];
  // cherche la cellule avec le même index de colonne
  let td = qsa('td', rowEl).find(x => Number(x.dataset.c) === colIndex);
  // si la cellule est en lecture seule, avance jusqu’à la prochaine éditable
  let guard = 0;
  while (td && td.classList.contains('cell-readonly') && guard++ < 100) {
    colIndex += 1;
    td = qsa('td', rowEl).find(x => Number(x.dataset.c) === colIndex);
  }
  if (td) { td.focus(); placeCaretEnd(td); }
}


function cellIndex(td){
  const tr = td.parentElement;
  const cells = qsa('td', tr);
  const all = qsa('#sheet-body tr');
  const ci = cells.indexOf(td);
  return { ci, maxCols: qsa('td', all[0] || tr).length };
}

function focusEditable(row, col){
  const rows = qsa('#sheet-body tr');
  if (row < 0) row = 0;
  if (row >= rows.length) {
    // ajoute une ligne si on descend à la fin
    addRow();
  }
  const rEl = qsa('#sheet-body tr')[row] || qsa('#sheet-body tr')[qsa('#sheet-body tr').length-1];
  let td = qsa('td', rEl)[col];
  // sauter les readonly
  let guard = 0;
  while (td && td.classList.contains('cell-readonly') && guard++ < 100) {
    col += 1; td = qsa('td', rEl)[col];
  }
  if (td) { td.focus(); placeCaretEnd(td); }
}

function placeCaretEnd(el){
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
}

function onSheetPaste(e){
  // collage multi-cellules: répartir sur lignes/colonnes à partir de la cellule courante
  e.preventDefault();
  const td = e.currentTarget;
  const startR = Number(td.dataset.r);
  const startC = Number(td.dataset.c);

  const text = e.clipboardData.getData('text/plain') || '';
  const lines = text.replace(/\r/g,'').split('\n').filter(l => l !== '');
  if (lines.length === 0) return;
  const grid = lines.map(l => l.split('\t'));

  // étendre le nombre de lignes si nécessaire
  const needRows = startR + grid.length;
  while (qsa('#sheet-body tr').length < needRows) addRow();

  for (let i = 0; i < grid.length; i++) {
    const tr = qsa('#sheet-body tr')[startR + i];
    let targetCol = startC;

    for (let j = 0; j < grid[i].length; j++) {
      // sauter les colonnes readonly (ex: Mt)
      let cell = qsa('td', tr).find(x => Number(x.dataset.c) === targetCol);
      let guard = 0;
      while (cell && cell.classList.contains('cell-readonly') && guard++ < 100) {
        targetCol += 1;
        cell = qsa('td', tr).find(x => Number(x.dataset.c) === targetCol);
      }
      if (!cell) break;

      const val = grid[i][j].trim();
      const r = Number(cell.dataset.r);
      const key = cell.dataset.key;
      const prev = cell.textContent;

      // maj DOM + modèle
      cell.textContent = val;
      setRowValue(r, key, val);

      // pile undo
      if (prev !== val) { pushUndo({ r, key, prev, next: val }); redoStack.length = 0; }

      targetCol += 1;
    }
    // recalcul des montants pour la ligne
    recalcRowAmounts(startR + i);
  }
}

function recalcRowAmounts(r){
  const tr = qsa('#sheet-body tr')[r];
  if (!tr) return;

  // MOE
  const moeQtyCell = tr.querySelector('td[data-key="moe.qty"]');
  const moePuCell  = tr.querySelector('td[data-key="moe.pu"]');
  const moeMtCell  = tr.querySelector('td[data-key="moe.mt"]');
  if (moeMtCell) {
    moeMtCell.textContent = amountOf(moeQtyCell?.textContent.trim(), moePuCell?.textContent.trim());
  }

  // Companies
  for (const c of lotCompanies) {
    const qty = tr.querySelector(`td[data-key="c.${c.id}.qty"]`)?.textContent.trim();
    const pu  = tr.querySelector(`td[data-key="c.${c.id}.pu"]`)?.textContent.trim();
    const mt  = tr.querySelector(`td[data-key="c.${c.id}.mt"]`);
    if (mt) mt.textContent = amountOf(qty, pu);
  }
}

/* Undo/Redo */
function pushUndo(change){ undoStack.push(change); }
function undo(){
  const ch = undoStack.pop(); if (!ch) return;
  redoStack.push(ch);
  applyChange(ch.r, ch.key, ch.prev);
}
function redo(){
  const ch = redoStack.pop(); if (!ch) return;
  undoStack.push(ch);
  applyChange(ch.r, ch.key, ch.next);
}
function applyChange(r, key, val){
  // DOM
  const tr = qsa('#sheet-body tr')[r]; if (!tr) return;
  const td = tr.querySelector(`td[data-key="${CSS.escape(key)}"]`); if (!td) return;
  td.textContent = val ?? '';
  // modèle
  setRowValue(r, key, val ?? '');
  recalcRowAmounts(r);
  td.dataset.prev = td.textContent;
}

/* Actions édition */
function addRow(){
  const blank = { item_id:null, num:'', designation:'', unit:'', moe:{qty:'', pu:''}, offers:{} };
  for (const c of lotCompanies) blank.offers[c.id] = { u:'', qty:'', pu:'' };
  sheetRows.push(blank);
  renderSheet();
  // focus première cellule de la nouvelle ligne
  const lastIndex = sheetRows.length - 1;
  const tr = qsa('#sheet-body tr')[lastIndex];
  const firstEditable = qsa('td:not(.cell-readonly)', tr)[0];
  if (firstEditable) firstEditable.focus();
}

async function saveGrid(){
  // construit payload depuis DOM (plus fidèle que le modèle si l'utilisateur n'a pas défocalisé)
  const rows = [];
  const trs = qsa('#sheet-body tr');
  for (let r=0; r<trs.length; r++){
    const tr = trs[r];
    const get = (k) => tr.querySelector(`td[data-key="${CSS.escape(k)}"]`)?.textContent.trim() ?? '';
    const designation = get('designation');
    if (!designation) continue;

    const row = {
      item_id: sheetRows[r]?.item_id || null,
      num: get('num'),
      designation,
      unit: get('unit'),
      moe: { qty: get('moe.qty'), pu: get('moe.pu') },
      offers: {}
    };
    for (const c of lotCompanies) {
      row.offers[c.id] = {
        u:  get(`c.${c.id}.u`),
        qty:get(`c.${c.id}.qty`),
        pu: get(`c.${c.id}.pu`)
      };
    }
    rows.push(row);
  }

  await api(`/lots/${currentLot.id}/save-grid`, { method:'POST', body:{ rows } });
  // recharger proprement
  const raw = await api(`/lots/${currentLot.id}`);
  buildSheetModel(raw);
  await refreshCompare();
  alert('Sauvegardé ✅');
}

/* UI bindings */
function renderSheet(){
  const { base, comps } = headerStructure();
  const head = qs('#sheet-head'); const body = qs('#sheet-body');
  head.innerHTML = ''; body.innerHTML = '';

  // header top
  const tr1 = document.createElement('tr');
  for (const b of base){ const th = document.createElement('th'); th.textContent = b.label; th.rowSpan = 2; if (b.cls) th.classList.add(b.cls); tr1.appendChild(th); }
  for (const g of comps){ const th = document.createElement('th'); th.textContent = g.name; th.colSpan = 4; th.classList.add('company-col'); tr1.appendChild(th); }
  head.appendChild(tr1);
  // header bottom
  const tr2 = document.createElement('tr');
  for (const g of comps){ for (const c of g.cols){ const th = document.createElement('th'); th.textContent = c.label; tr2.appendChild(th); } }
  head.appendChild(tr2);

  // body
  const totalCols = base.length + comps.length * 4;
  sheetRows.forEach((row, rIndex) => {
    const tr = document.createElement('tr');
    let colIndex = 0;

    // base cells
    for (const b of base){
      tr.appendChild(makeCell(rIndex, b.key, b.readonly, rowValue(row, b.key), b.wide, colIndex++));
    }
    // company cells
    for (const g of comps){
      for (const c of g.cols){
        tr.appendChild(makeCell(rIndex, c.key, c.readonly, rowValue(row, c.key), false, colIndex++));
      }
    }
    body.appendChild(tr);
    recalcRowAmounts(rIndex);
  });
}


/* ===== INIT ===== */
function showDashboard(){ hide('#login-view'); show('#dashboard'); activateTab('tab-projects'); refreshProjects(); }

function bindUI(){
  // auth
  qs('#login-btn').addEventListener('click', async ()=>{ setText('#login-msg',''); try{ await login(qs('#email').value.trim(), qs('#password').value); showDashboard(); }catch(e){ setText('#login-msg', e.message); }});
  qs('#bootstrap-admin').addEventListener('click', async ()=>{ setText('#login-msg',''); try{ await registerFirst(qs('#email').value.trim(), qs('#password').value); showDashboard(); }catch(e){ setText('#login-msg', e.message); }});
  qs('#logout').addEventListener('click', ()=>{ localStorage.removeItem('token'); location.reload(); });

  // tabs
  qsa('.tab').forEach(b => b.addEventListener('click', () => !b.disabled && activateTab(b.dataset.tab)));

  // projets / lots
  qs('#create-project').addEventListener('click', async ()=>{ try{ const body={ name:qs('#proj-name').value.trim(), reference:qs('#proj-ref').value.trim(), client:qs('#proj-client').value.trim(), location:qs('#proj-location').value.trim() }; if(!body.name) return alert('Nom requis'); await api('/projects',{method:'POST',body}); qsa('#proj-name,#proj-ref,#proj-client,#proj-location').forEach(i=>i.value=''); await refreshProjects(); }catch(e){ alert(e.message);} });
  qs('#add-lot').addEventListener('click', async ()=>{ try{ if(!currentProject) return alert('Ouvrir un projet'); const code=qs('#lot-code').value.trim(); const name=qs('#lot-name').value.trim(); if(!name) return alert('Nom du lot requis'); await api(`/projects/${currentProject.id}/lots`,{method:'POST',body:{code,name}}); qsa('#lot-code,#lot-name').forEach(i=>i.value=''); await openProject(currentProject.id);}catch(e){ alert(e.message);} });

  renderSheetBindings();
}

document.addEventListener('DOMContentLoaded', () => { bindUI(); if (token) showDashboard(); });
