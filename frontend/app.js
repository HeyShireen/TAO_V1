const API_BASE = (localStorage.getItem('api_base') || 'http://localhost:4000') + '/api';
let token = localStorage.getItem('token') || null;
let currentProject = null;
let currentLot = null;

function qs(sel){return document.querySelector(sel)}
function qsa(sel){return Array.from(document.querySelectorAll(sel))}
function show(id){qs(id).classList.remove('hidden')}
function hide(id){qs(id).classList.add('hidden')}

async function api(path, opts={}){
  opts.headers = opts.headers || {};
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(API_BASE + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(()=>({error:res.statusText}));
    throw new Error(err.error || 'Erreur API');
  }
  return res.json();
}

async function login(email, password){
  const r = await fetch(API_BASE + '/auth/login', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({email,password})
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Erreur de connexion');
  token = j.token;
  localStorage.setItem('token', token);
  return j;
}

async function registerFirst(email, password){
  const r = await fetch(API_BASE + '/auth/register', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({email,password,role:'admin'})
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Erreur création admin');
  token = j.token;
  localStorage.setItem('token', token);
  return j;
}

function renderProjects(list){
  const tbody = qs('#projects-table tbody');
  tbody.innerHTML = '';
  for (const p of list){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.id}</td><td>${p.name}</td><td>${p.reference||''}</td><td>${p.client||''}</td><td>${new Date(p.created_at).toLocaleString()}</td><td><button data-id="${p.id}">Ouvrir</button></td>`;
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
  qs('#project-title').textContent = `Projet #${project.id} — ${project.name}`;
  const tbody = qs('#lots-table tbody'); tbody.innerHTML='';
  for (const l of lots){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${l.id}</td><td>${l.code||''}</td><td>${l.name}</td><td><button data-id="${l.id}">Ouvrir</button></td>`;
    tr.querySelector('button').addEventListener('click', () => openLot(l.id, l));
    tbody.appendChild(tr);
  }
}

async function openLot(id, lotMeta){
  currentLot = { id, ...lotMeta };
  show('#lot-view');
  qs('#lot-title').textContent = `Lot #${id} — ${lotMeta.name}`;
  await refreshCompare();
}

function formatPct(p){
  if (p === null || p === undefined || isNaN(p)) return '';
  const cls = p > 0 ? 'delta-neg' : (p < 0 ? 'delta-pos' : '');
  const s = (p>0?'+':'') + p.toFixed(1) + '%';
  return `<span class="${cls}">${s}</span>`;
}

async function refreshCompare(){
  const data = await api('/lots/'+currentLot.id+'/table');
  const head = qs('#compare-head'); const body = qs('#compare-body');
  head.innerHTML=''; body.innerHTML='';

  // Header
  let h1 = '<tr><th>Num</th><th>Désignation</th><th>U</th><th>Qté MOE</th><th>PU MOE</th><th>Mt MOE</th>';
  for (const c of data.companies){
    h1 += `<th colspan="5">${c.name}</th>`;
  }
  h1 += '</tr>';
  let h2 = '<tr><th></th><th></th><th></th><th></th><th></th><th></th>';
  for (const c of data.companies){
    h2 += '<th>U</th><th>Qté</th><th>PU</th><th>Mt</th><th>ΔPU</th>';
  }
  h2 += '</tr>';
  head.innerHTML = h1 + h2;

  for (const r of data.rows){
    let tr = `<tr>
      <td>${r.num||''}</td>
      <td>${r.designation||''}</td>
      <td>${r.unit||''}</td>
      <td>${r.moe.qty ?? ''}</td>
      <td>${r.moe.pu ?? ''}</td>
      <td>${r.moe.mt ?? ''}</td>`;
    for (const c of r.companies){
      tr += `<td>${c.u||''}</td>
             <td>${c.qty ?? ''}</td>
             <td>${c.pu ?? ''}</td>
             <td>${c.mt ?? ''}</td>
             <td>${formatPct(c.delta_pu_pct)}</td>`;
    }
    tr += '</tr>';
    body.insertAdjacentHTML('beforeend', tr);
  }
}

function showDashboard(){
  hide('#login-view');
  show('#dashboard');
  refreshProjects();
}

function onReady(){
  // Login handlers
  qs('#login-btn').addEventListener('click', async () => {
    const email = qs('#email').value.trim();
    const password = qs('#password').value;
    try{
      await login(email,password);
      showDashboard();
    }catch(e){
      qs('#login-msg').textContent = e.message;
    }
  });
  qs('#bootstrap-admin').addEventListener('click', async () => {
    const email = qs('#email').value.trim();
    const password = qs('#password').value;
    try{
      await registerFirst(email,password);
      showDashboard();
    }catch(e){
      qs('#login-msg').textContent = e.message;
    }
  });

  // Create project
  qs('#create-project').addEventListener('click', async () => {
    const body = {
      name: qs('#proj-name').value.trim(),
      reference: qs('#proj-ref').value.trim(),
      client: qs('#proj-client').value.trim(),
      location: qs('#proj-location').value.trim()
    };
    if (!body.name) return alert('Nom requis');
    await api('/projects', { method:'POST', body });
    await refreshProjects();
    qsa('#proj-name,#proj-ref,#proj-client,#proj-location').forEach(i=>i.value='');
  });

  // Add lot
  qs('#add-lot').addEventListener('click', async () => {
    const code = qs('#lot-code').value.trim();
    const name = qs('#lot-name').value.trim();
    if (!currentProject) return alert('Ouvrir un projet');
    if (!name) return alert('Nom du lot requis');
    await api(`/projects/${currentProject.id}/lots`, { method:'POST', body: { code, name } });
    await openProject(currentProject.id);
    qsa('#lot-code,#lot-name').forEach(i=>i.value='');
  });

  // Import Excel
  qs('#excel-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await fetch(API_BASE + `/lots/${currentLot.id}/import-excel`, {
        method:'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd
      }).then(r=>r.json()).then(j=>{
        if (j.error) throw new Error(j.error);
      });
      await refreshCompare();
      e.target.value = '';
    } catch(err){
      alert('Import échoué: '+err.message);
    }
  });

  qs('#refresh-table').addEventListener('click', refreshCompare);
  qs('#logout').addEventListener('click', () => { localStorage.removeItem('token'); location.reload(); });

  // If already logged, go to dashboard
  if (token) showDashboard();
}

document.addEventListener('DOMContentLoaded', onReady);
