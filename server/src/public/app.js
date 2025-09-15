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

/* ===== IMPORT PASTE ===== */
function detectDelimiter(text){
  const first = text.split(/\r?\n/)[0] || '';
  if (first.includes('\t')) return '\t';
  if (first.split(';').length > first.split(',').length) return ';';
  return ',';
}
function parseGrid(text){
  const lines = text.replace(/\r/g,'').split('\n').filter(l => l.trim()!=='');
  if (!lines.length) return { headers:[], rows:[] };
  const d = detectDelimiter(text);
  const headers = lines[0].split(d).map(s => s.trim());
  const rows = lines.slice(1).map(l => l.split(d).map(s => s.trim()));
  return { headers, rows };
}
function renderPastePreview(headers, rows){
  const thead = qs('#paste-head'), tbody = qs('#paste-body');
  thead.innerHTML = '<tr>' + headers.map(h=>`<th>${h||''}</th>`).join('') + '</tr>';
  tbody.innerHTML = '';
  for (const r of rows.slice(0,200)){ // limiter l’aperçu
    const tr = '<tr>' + headers.map((_,i)=>`<td>${r[i]??''}</td>`).join('') + '</tr>';
    tbody.insertAdjacentHTML('beforeend', tr);
  }
}
function bindPasteModal(){
  const modal = qs('#paste-modal');
  const area = qs('#paste-area');
  const btnPreview = qs('#paste-preview');
  const btnImport = qs('#paste-import');
  const btnClose = qs('#paste-close');

  qs('#open-paste').addEventListener('click', () => { show('#paste-modal'); area.value=''; hide('#paste-preview-wrap'); btnImport.disabled=true; setTimeout(()=>area.focus(),50); });
  btnClose.addEventListener('click', ()=> hide('#paste-modal'));

  btnPreview.addEventListener('click', () => {
    const { headers, rows } = parseGrid(area.value);
    if (!headers.length || !rows.length) { alert('Données vides'); return; }
    renderPastePreview(headers, rows);
    show('#paste-preview-wrap'); btnImport.disabled=false;
    btnImport.dataset.headers = JSON.stringify(headers);
    btnImport.dataset.rows = JSON.stringify(rows);
  });

  btnImport.addEventListener('click', async () => {
    try{
      const headers = JSON.parse(btnImport.dataset.headers||'[]');
      const rows = JSON.parse(btnImport.dataset.rows||'[]');
      await api(`/lots/${currentLot.id}/import-clipboard`, { method:'POST', body: { headers, rows }});
      hide('#paste-modal'); await refreshCompare();
    }catch(e){ alert('Import (copier/coller) échoué : ' + e.message); }
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
  bindPasteModal();

  // refresh
  qs('#refresh-table').addEventListener('click', refreshCompare);
}
document.addEventListener('DOMContentLoaded', () => { bindUI(); if (token) showDashboard(); });
