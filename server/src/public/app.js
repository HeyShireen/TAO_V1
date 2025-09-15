// same-origin
const API_ROOT = window.location.origin;
const API_BASE = API_ROOT + '/api';

let token = localStorage.getItem('token') || null;
let currentProject = null;
let currentLot = null;

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

/* ===== PROJETS / LOTS ===== */
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
  await refreshCompare();
}

/* ===== TABLE COMPARATIF ===== */
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

/* ===== IMPORT EXCEL ===== */
function bindExcelImport(){
  qs('#excel-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try{
      const fd = new FormData(); fd.append('file', file);
      await api(`/lots/${currentLot.id}/import-excel`, { method:'POST', body: fd });
      await refreshCompare();
    }catch(err){ alert('Import Excel échoué : ' + err.message); }
    finally{ e.target.value=''; }
  });
}

/* ===== IMPORT PASTE — ÉDITEUR TABLEAU ===== */
const PASTE = {
  baseCols: [
    { key:'num',     label:'Num' },
    { key:'des',     label:'Désignation' },
    { key:'u',       label:'U' },
    { key:'moeqty',  label:'Quantité MOE' },
    { key:'moepu',   label:'PU MOE' },
    { key:'moemt',   label:'Montant MOE' },
  ],
  companies: [],   // ["Entreprise A", "Entreprise B", ...]
  rows: 20,
};

function openPasteEditor(){
  // init entreprises à partir du lot (si dispo)
  initCompaniesFromLot().then(() => {
    qs('#rows-count').value = PASTE.rows;
    rebuildPasteGrid();
    show('#paste-modal');
    // focus première cellule
    const first = qs('#grid-body td[contenteditable]');
    if (first) first.focus();
  });
}

async function initCompaniesFromLot(){
  try{
    const raw = await api(`/lots/${currentLot.id}`); // retourne companies[]
    if (raw?.companies?.length) {
      PASTE.companies = raw.companies.map(c => c.name);
    } else if (PASTE.companies.length === 0) {
      PASTE.companies = []; // laisse vide si aucune
    }
    renderCompanyChips();
  }catch{ /* ignore */ }
}

function renderCompanyChips(){
  const wrap = qs('#comp-list'); wrap.innerHTML = '';
  PASTE.companies.forEach((name, idx) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${name}<button data-i="${idx}" title="Supprimer">×</button>`;
    chip.querySelector('button').addEventListener('click', () => { 
      PASTE.companies.splice(idx,1); renderCompanyChips(); rebuildPasteGrid(); 
    });
    wrap.appendChild(chip);
  });
}

function rebuildPasteGrid(){
  // en-têtes groupés
  const headTop = qs('#grid-head-top');
  const headBot = qs('#grid-head-bottom');
  headTop.innerHTML = '';
  headBot.innerHTML = '';

  // Base (6 colonnes)
  PASTE.baseCols.forEach((c, i) => {
    const th = document.createElement('th');
    th.rowSpan = 2; th.textContent = c.label;
    headTop.appendChild(th);
  });

  // Groupes par entreprise (4 colonnes chacun)
  PASTE.companies.forEach(name => {
    const th = document.createElement('th');
    th.colSpan = 4; th.className = 'company-col'; th.textContent = name;
    headTop.appendChild(th);
    ['U','Quantité','PU','Montant'].forEach(lbl => {
      const sub = document.createElement('th');
      sub.textContent = lbl;
      headBot.appendChild(sub);
    });
  });

  // si pas d’entreprise, mettre une info
  if (PASTE.companies.length === 0) {
    const th = document.createElement('th');
    th.colSpan = 4; th.className = 'company-col muted';
    th.textContent = 'Ajoute une entreprise pour créer les colonnes';
    headTop.appendChild(th);
  }

  // corps
  const body = qs('#grid-body'); body.innerHTML = '';
  for (let r = 0; r < PASTE.rows; r++) {
    const tr = document.createElement('tr');
    // 6 colonnes base
    for (let c = 0; c < 6; c++) tr.appendChild(makeCell(r, c));
    // colonnes entreprises
    for (let k = 0; k < PASTE.companies.length; k++) {
      for (let c = 0; c < 4; c++) tr.appendChild(makeCell(r, 6 + k*4 + c));
    }
    body.appendChild(tr);
  }
}

function makeCell(r, c){
  const td = document.createElement('td');
  td.contentEditable = 'true';
  td.dataset.ri = String(r);
  td.dataset.ci = String(c);
  td.addEventListener('paste', onPasteIntoGrid);
  return td;
}

function onPasteIntoGrid(e){
  // Collage multi-cellules façon Excel
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain') || '';
  const rows = text.replace(/\r/g,'').split('\n').filter(l => l.length>0).map(l => l.split('\t'));
  const startR = Number(e.currentTarget.dataset.ri);
  const startC = Number(e.currentTarget.dataset.ci);

  // étendre le nombre de lignes si besoin
  const need = startR + rows.length;
  if (need > PASTE.rows) {
    PASTE.rows = need;
    qs('#rows-count').value = PASTE.rows;
    rebuildPasteGrid();
  }

  // remplir
  rows.forEach((cells, i) => {
    const tr = qs(`#grid-body tr:nth-child(${startR + i + 1})`);
    cells.forEach((val, j) => {
      const td = tr?.querySelector(`td:nth-child(${startC + j + 1})`);
      if (td) td.textContent = val;
    });
  });
}

function collectGridData(){
  // headers plats que l’API attend
  const flatHeaders = [
    'Num','Désignation','U','Quantité MOE','PU MOE','Montant MOE',
    ...PASTE.companies.flatMap(name => [
      `${name} U`, `${name} Quantité`, `${name} PU`, `${name} Montant`
    ])
  ];

  const rows = [];
  const trs = qsa('#grid-body tr');
  for (const tr of trs) {
    const tds = qsa('td', tr);
    // ignore les lignes totalement vides
    const vals = tds.map(td => td.textContent.trim());
    if (vals.every(v => v === '')) continue;
    rows.push(vals);
  }
  return { headers: flatHeaders, rows };
}

function bindPasteEditorUI(){
  // ouverture / fermeture
  qs('#open-paste').addEventListener('click', openPasteEditor);
  qs('#paste-close').addEventListener('click', () => hide('#paste-modal'));

  // entreprises
  qs('#comp-add').addEventListener('click', () => {
    const name = qs('#comp-input').value.trim();
    if (!name) return;
    if (!PASTE.companies.includes(name)) PASTE.companies.push(name);
    qs('#comp-input').value = '';
    renderCompanyChips();
    rebuildPasteGrid();
  });

  // gestion lignes
  qs('#rows-count').addEventListener('change', (e) => {
    const v = Math.max(1, Number(e.target.value||1));
    PASTE.rows = v; rebuildPasteGrid();
  });
  qs('#rows-add-50').addEventListener('click', () => {
    PASTE.rows += 50; qs('#rows-count').value = PASTE.rows; rebuildPasteGrid();
  });
  qs('#rows-clear').addEventListener('click', () => {
    qsa('#grid-body td').forEach(td => td.textContent = '');
  });

  // import
  qs('#paste-import').addEventListener('click', async () => {
    try{
      const payload = collectGridData();
      if (!payload.rows.length) return alert('Aucune donnée à importer');
      await api(`/lots/${currentLot.id}/import-clipboard`, { method:'POST', body: payload });
      hide('#paste-modal');
      await refreshCompare();
    }catch(e){
      alert('Import (copier/coller) échoué : ' + e.message);
    }
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

  // imports
  bindExcelImport();
  bindPasteEditorUI();


  // refresh
  qs('#refresh-table').addEventListener('click', refreshCompare);
}
document.addEventListener('DOMContentLoaded', () => { bindUI(); if (token) showDashboard(); });
