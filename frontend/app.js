// frontend/app.js
// Client léger pour l'API offer-compare-server
// - Auth (login + bootstrap admin)
// - Projets / Lots
// - Import Excel par lot
// - Tableau comparatif multi-entreprises (ΔPU / ΔQté)

const API_ROOT = (() => {
  // Si tu ouvres le fichier en local (file://), on tombe sur localhost:4000
  // Sinon tu peux configurer une URL d'API Render : localStorage.setItem('api_base', 'https://ton-api.onrender.com')
  const saved = localStorage.getItem('api_base');
  if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '');
  return 'http://localhost:4000';
})();
const API_BASE = API_ROOT + '/api';

let token = localStorage.getItem('token') || null;
let currentProject = null;
let currentLot = null;

const qs  = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));

function show(sel){ qs(sel).classList.remove('hidden'); }
function hide(sel){ qs(sel).classList.add('hidden'); }
function setText(sel, txt){ qs(sel).textContent = txt; }

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
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();

  if (!res.ok) {
    const message = (isJson && data?.error) ? data.error : (data || res.statusText);
    throw new Error(message || 'Erreur API');
  }
  return data;
}

/* ===================== AUTH ===================== */

async function login(email, password) {
  const res = await fetch(API_BASE + '/auth/login', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ email, password })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Identifiants invalides');

  token = json.token;
  localStorage.setItem('token', token);
  return json.user;
}

async function registerFirst(email, password) {
  const res = await fetch(API_BASE + '/auth/register', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ email, password, role:'admin' })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Création admin impossible');

  token = json.token;
  localStorage.setItem('token', token);
  return json.user;
}

/* ===================== PROJETS / LOTS ===================== */

function renderProjects(list) {
  const tbody = qs('#projects-table tbody');
  tbody.innerHTML = '';
  for (const p of list) {
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

async function refreshProjects() {
  const list = await api('/projects', { method:'GET' });
  renderProjects(list);
}

async function openProject(id) {
  const data = await api(`/projects/${id}`, { method:'GET' });
  currentProject = data.project;

  show('#project-view');
  setText('#project-title', `Projet #${data.project.id} — ${data.project.name}`);

  const tbody = qs('#lots-table tbody');
  tbody.innerHTML = '';
  for (const l of data.lots) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${l.id}</td>
      <td>${l.code || ''}</td>
      <td>${l.name}</td>
      <td><button class="btn" data-id="${l.id}">Ouvrir</button></td>
    `;
    tr.querySelector('button').addEventListener('click', () => openLot(l.id, l));
    tbody.appendChild(tr);
  }
}

async function openLot(id, lotMeta) {
  currentLot = { id, ...lotMeta };
  show('#lot-view');
  setText('#lot-title', `Lot #${id} — ${lotMeta.name}`);
  await refreshCompare();
}

/* ===================== TABLEAU COMPARATIF ===================== */

function fmtPct(p) {
  if (p === null || p === undefined || isNaN(p)) return '';
  const cls = p > 0 ? 'delta-neg' : (p < 0 ? 'delta-pos' : '');
  const s = (p > 0 ? '+' : '') + p.toFixed(1) + '%';
  return `<span class="${cls}">${s}</span>`;
}

function fmtNum(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

async function refreshCompare() {
  if (!currentLot) return;
  const data = await api(`/lots/${currentLot.id}/table`, { method:'GET' });

  const head = qs('#compare-head');
  const body = qs('#compare-body');
  head.innerHTML = '';
  body.innerHTML = '';

  // Ligne entête 1 : libellés entreprises
  let h1 = `
    <tr>
      <th rowspan="2" class="sticky-col">Num</th>
      <th rowspan="2" class="sticky-col2">Désignation</th>
      <th rowspan="2">U</th>
      <th colspan="3" class="moe-col">MOE</th>
  `;
  for (const c of data.companies) {
    h1 += `<th colspan="5" class="company-col">${c.name}</th>`;
  }
  h1 += '</tr>';

  // Ligne entête 2 : sous-colonnes
  let h2 = `
    <tr>
      <th>Qté</th><th>PU</th><th>Mt</th>
  `;
  for (let i = 0; i < data.companies.length; i++) {
    h2 += '<th>U</th><th>Qté</th><th>PU</th><th>Mt</th><th>ΔPU</th>';
  }
  h2 += '</tr>';

  head.innerHTML = h1 + h2;

  // Lignes
  for (const r of data.rows) {
    let row = `
      <tr>
        <td class="sticky-col">${r.num || ''}</td>
        <td class="sticky-col2">${r.designation || ''}</td>
        <td>${r.unit || ''}</td>
        <td>${fmtNum(r.moe.qty)}</td>
        <td>${fmtNum(r.moe.pu)}</td>
        <td>${fmtNum(r.moe.mt)}</td>
    `;
    for (const c of r.companies) {
      row += `
        <td>${c.u || ''}</td>
        <td>${fmtNum(c.qty)}</td>
        <td>${fmtNum(c.pu)}</td>
        <td>${fmtNum(c.mt)}</td>
        <td>${fmtPct(c.delta_pu_pct)}</td>
      `;
    }
    row += '</tr>';
    body.insertAdjacentHTML('beforeend', row);
  }
}

/* ===================== INIT UI ===================== */

function showDashboard() {
  hide('#login-view');
  show('#dashboard');
  refreshProjects();
}

function bindEvents() {
  // Login
  qs('#login-btn').addEventListener('click', async () => {
    setText('#login-msg', '');
    try {
      const email = qs('#email').value.trim();
      const password = qs('#password').value;
      await login(email, password);
      showDashboard();
    } catch (e) {
      setText('#login-msg', e.message);
    }
  });

  // Bootstrap admin (premier utilisateur)
  qs('#bootstrap-admin').addEventListener('click', async () => {
    setText('#login-msg', '');
    try {
      const email = qs('#email').value.trim();
      const password = qs('#password').value;
      await registerFirst(email, password);
      showDashboard();
    } catch (e) {
      setText('#login-msg', e.message);
    }
  });

  // Déconnexion
  qs('#logout').addEventListener('click', () => {
    localStorage.removeItem('token');
    location.reload();
  });

  // Créer un projet
  qs('#create-project').addEventListener('click', async () => {
    try {
      const body = {
        name: qs('#proj-name').value.trim(),
        reference: qs('#proj-ref').value.trim(),
        client: qs('#proj-client').value.trim(),
        location: qs('#proj-location').value.trim()
      };
      if (!body.name) return alert('Nom du projet requis');
      await api('/projects', { method:'POST', body });
      qsa('#proj-name,#proj-ref,#proj-client,#proj-location').forEach(i => i.value = '');
      await refreshProjects();
    } catch (e) {
      alert(e.message);
    }
  });

  // Ajouter un lot
  qs('#add-lot').addEventListener('click', async () => {
    try {
      if (!currentProject) return alert('Ouvrir un projet avant d’ajouter un lot');
      const code = qs('#lot-code').value.trim();
      const name = qs('#lot-name').value.trim();
      if (!name) return alert('Nom du lot requis');
      await api(`/projects/${currentProject.id}/lots`, { method:'POST', body:{ code, name } });
      qsa('#lot-code,#lot-name').forEach(i => i.value = '');
      await openProject(currentProject.id);
    } catch (e) {
      alert(e.message);
    }
  });

  // Import Excel
  qs('#excel-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api(`/lots/${currentLot.id}/import-excel`, { method:'POST', body: fd });
      await refreshCompare();
    } catch (err) {
      alert('Import échoué : ' + err.message);
    } finally {
      e.target.value = '';
    }
  });

  // Rafraîchir tableau
  qs('#refresh-table').addEventListener('click', refreshCompare);

  // Config API (petite roue dentée)
  qs('#api-config').addEventListener('click', () => {
    const cur = localStorage.getItem('api_base') || API_ROOT;
    const next = prompt('URL de base de l’API (ex: https://ton-api.onrender.com)', cur);
    if (next !== null) {
      localStorage.setItem('api_base', next.trim());
      alert('API mise à jour. Recharge la page.');
      location.reload();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  if (token) showDashboard();
});
