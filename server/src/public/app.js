// Même domaine que le serveur (same-origin)
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
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const res = await fetch(url, { ...opts, headers, body });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(()=> ({})) : await res.text();
  if (!res.ok) {
    const msg = (isJson && data?.error) ? data.error : (data || res.statusText);
    throw new Error(msg || 'Erreur API');
  }
  return data;
}

/* ===== AUTH ===== */
async function login(email, password) {
  const r = await fetch(API_BASE + '/auth/login', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ email, password })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Identifiants invalides');
  token = j.token; localStorage.setItem('token', token);
  return j.user;
}

async function registerFirst(email, password) {
  const r = await fetch(API_BASE + '/auth/register', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ email, password, role:'admin' })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Création admin impossible');
  token = j.token; localStorage.setItem('token', token);
  return j.user;
}

/* ===== PROJETS / LOTS ===== */
function renderProjects(list){
  const tbody = qs('#projects-table tbody'); tbody.innerHTML = '';
  for (const p of list){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.id}</td>
      <td>${p.name}</td>
      <td>${p.reference || ''}</td>
      <td>${p.client || ''}</td>
      <td>${new Date(p.created_at).toLocaleString()}</td>
      <td><button class="btn" data-id="${p.id}">Ouvrir</button></td>
    `;
    tr.querySelector('button').addEventListener('click', () => openProject(p.id));
    tbody.appendChild(tr);
  }
}

async function refreshProjects(){
  const list = await api('/projects');
  renderProjects(list);
}

async function openProject(id){
  const { project, lots } = await api('/projects/'+id);
  currentProject = project;
  show('#project-view');
  setText('#project-title', `Projet #${project.id} — ${project.name}`);
  const tbody = qs('#lots-table tbody'); tbody.innerHTML='';
  for (const l of lots){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${l.id}</td><td>${l.code || ''}</td><td>${l.name}</td><td><button class="btn">Ouvrir</button></td>`;
    tr.querySelector('button').addEventListener('click', () => openLot(l.id, l));
    tbody.appendChild(tr);
  }
}

async function openLot(id, lotMeta){
  currentLot = { id, ...lotMeta };
  show('#lot-view');
  setText('#lot-title', `Lot #${id} — ${lotMeta.name}`);
  await refreshCompare();
}

/* ===== TABLE COMPARATIF ===== */
function fmtPct(p){
  if (p === null || p === undefined || isNaN(p)) return '';
  const cls = p > 0 ? 'delta-neg' : (p < 0 ? 'delta-pos' : '');
  const s = (p > 0 ? '+' : '') + p.toFixed(1) + '%';
  return `<span class="${cls}">${s}</span>`;
}
function fmtNum(v){
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v); if (Number.isNaN(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

async function refreshCompare(){
  if (!currentLot) return;
  const data = await api('/lots/'+currentLot.id+'/table');
  const head = qs('#compare-head'), body = qs('#compare-body');
  head.innerHTML=''; body.innerHTML='';

  // Entête 1
  let h1 = `
    <tr>
      <th rowspan="2" class="sticky-col">Num</th>
      <th rowspan="2" class="sticky-col2">Désignation</th>
      <th rowspan="2">U</th>
      <th colspan="3" class="moe-col">MOE</th>
  `;
  for (const c of data.companies) h1 += `<th colspan="5" class="company-col">${c.name}</th>`;
  h1 += '</tr>';

  // Entête 2
  let h2 = `<tr><th>Qté</th><th>PU</th><th>Mt</th>`;
  for (let i=0;i<data.companies.length;i++) h2 += '<th>U</th><th>Qté</th><th>PU</th><th>Mt</th><th>ΔPU</th>';
  h2 += '</tr>';
  head.innerHTML = h1 + h2;

  // Lignes
  for (const r of data.rows){
    let tr = `
      <tr>
        <td class="sticky-col">${r.num || ''}</td>
        <td class="sticky-col2">${r.designation || ''}</td>
        <td>${r.unit || ''}</td>
        <td>${fmtNum(r.moe.qty)}</td>
        <td>${fmtNum(r.moe.pu)}</td>
        <td>${fmtNum(r.moe.mt)}</td>
    `;
    for (const c of r.companies){
      tr += `
        <td>${c.u || ''}</td>
        <td>${fmtNum(c.qty)}</td>
        <td>${fmtNum(c.pu)}</td>
        <td>${fmtNum(c.mt)}</td>
        <td>${fmtPct(c.delta_pu_pct)}</td>
      `;
    }
    tr += '</tr>';
    body.insertAdjacentHTML('beforeend', tr);
  }
}

/* ===== INIT ===== */
function showDashboard(){ hide('#login-view'); show('#dashboard'); refreshProjects(); }

function bindEvents(){
  qs('#login-btn').addEventListener('click', async () => {
    setText('#login-msg','');
    try{
      const email = qs('#email').value.trim();
      const password = qs('#password').value;
      await login(email, password);
      showDashboard();
    }catch(e){ setText('#login-msg', e.message); }
  });

  qs('#bootstrap-admin').addEventListener('click', async () => {
    setText('#login-msg','');
    try{
      const email = qs('#email').value.trim();
      const password = qs('#password').value;
      await registerFirst(email, password);
      showDashboard();
    }catch(e){ setText('#login-msg', e.message); }
  });

  qs('#logout').addEventListener('click', () => { localStorage.removeItem('token'); location.reload(); });

  qs('#create-project').addEventListener('click', async () => {
    try{
      const body = {
        name: qs('#proj-name').value.trim(),
        reference: qs('#proj-ref').value.trim(),
        client: qs('#proj-client').value.trim(),
        location: qs('#proj-location').value.trim()
      };
      if (!body.name) return alert('Nom du projet requis');
      await api('/projects', { method:'POST', body });
      qsa('#proj-name,#proj-ref,#proj-client,#proj-location').forEach(i=>i.value='');
      await refreshProjects();
    }catch(e){ alert(e.message); }
  });

  qs('#add-lot').addEventListener('click', async () => {
    try{
      if (!currentProject) return alert('Ouvrir un projet avant d’ajouter un lot');
      const code = qs('#lot-code').value.trim();
      const name = qs('#lot-name').value.trim();
      if (!name) return alert('Nom du lot requis');
      await api(`/projects/${currentProject.id}/lots`, { method:'POST', body:{ code, name } });
      qsa('#lot-code,#lot-name').forEach(i=>i.value='');
      await openProject(currentProject.id);
    }catch(e){ alert(e.message); }
  });

  qs('#excel-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try{
      const fd = new FormData(); fd.append('file', file);
      await api(`/lots/${currentLot.id}/import-excel`, { method:'POST', body: fd });
      await refreshCompare();
    }catch(err){ alert('Import échoué : ' + err.message); }
    finally{ e.target.value=''; }
  });

  qs('#refresh-table').addEventListener('click', refreshCompare);
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  if (token) showDashboard();
});
