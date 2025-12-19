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

let lotCompanies = [];      // [{id,name}]
let sheetRows = [];         // [{ item_id, num, designation, unit, moe:{qty,pu}, offers:{[cid]:{u,qty,pu}} }]
let lotOptions = [];        // [{ id, designation, unit, offers:[{company_id,qty,unit_price}], checked:bool }]
let selectedOptions = {};   // { option_id: true/false } - track which options are active
const undoStack = [];
const redoStack = [];

/* ====== Helpers DOM ====== */
const qs  = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
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

/* ====== Loading Spinner ====== */
function showLoader() { qs('#global-loader')?.classList.remove('hidden'); }
function hideLoader() { qs('#global-loader')?.classList.add('hidden'); }

/* ====== API ====== */
async function api(path, opts = {}) {
  const url = API_BASE + path;
  const headers = opts.headers || {};
  
  // Cookie HttpOnly: pas d'Authorization, on envoie les credentials
  
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
      <button id="resend-verif" class="btn">📧 Renvoyer l'email</button>
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
      msgEl.innerHTML = `<p style="color:#28a745;margin:0;">✅ ${res.message}</p>`;
    } catch (err) {
      if (err.cooldown) {
        msgEl.innerHTML = `<p style="color:#dc3545;margin:0;">⏰ ${err.message}</p>`;
      } else {
        msgEl.innerHTML = `<p style="color:#dc3545;margin:0;">❌ ${err.message}</p>`;
      }
      btn.disabled = false;
      btn.textContent = "📧 Renvoyer l'email";
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
  
  // Charger les questions automatiquement quand on ouvre l'onglet
  if (id === 'subtab-questions' && currentLot) {
    refreshQuestions();
  }
  
  // Charger l'éditeur de questions
  if (id === 'subtab-questions-editor' && currentLot) {
    loadQuestionsEditor();
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
    console.log('🔐 JWT Payload:', payload);
    if (payload) {
      currentUser = { id: payload.id, email: payload.email, role: payload.role || 'visionneur' };
      console.log('👤 Current user updated:', currentUser);
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
async function registerFirst(email, password){
  const r = await fetch(API_BASE + '/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password, role:'admin' })});
  const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Création admin impossible');
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
function canEditProject() { return isAdmin() || isResponsable(); }
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
    
    tr.innerHTML = `
      <td>${user.id}</td>
      <td>${user.email}</td>
      <td>
        <select class="user-role-select" id="user-role-${user.id}" name="user-role-${user.id}" data-user-id="${user.id}">
          ${roleSelect}
        </select>
      </td>
      <td>${companyDisplay}</td>
      <td>${new Date(user.created_at).toLocaleDateString()}</td>
      <td>
        <button class="btn ghost btn-sm" data-change-role="${user.id}">Modifier rôle</button>
        ${user.role === 'entreprise' ? `<button class="btn ghost btn-sm" data-assign-company="${user.id}">Attribuer entreprise</button>` : ''}
        <button class="btn ghost btn-sm" data-delete-user="${user.id}">Supprimer</button>
      </td>
    `;
    
    // Event listeners pour les boutons
    const changeBtn = tr.querySelector(`[data-change-role="${user.id}"]`);
    const assignBtn = tr.querySelector(`[data-assign-company="${user.id}"]`);
    const deleteBtn = tr.querySelector(`[data-delete-user="${user.id}"]`);
    
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
  if (!confirm('Êtes-vous sûr de vouloir supprimer cet utilisateur ?')) return;
  
  try {
    await api(`/users/${userId}`, { method: 'DELETE' });
    showNotify({ title: 'Succès', message: 'Utilisateur supprimé', type: 'success' });
    loadUsers();
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
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

/* ================= Partage de projets ================= */
let currentShareProjectId = null;

async function openShareModal(projectId) {
  currentShareProjectId = projectId;
  show('#share-modal');
  
  // Charger la liste des visionneurs disponibles
  try {
    const viewers = await api('/shares/available-viewers');
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
    loadExistingShares(currentShareProjectId);
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
}

async function removeShare(projectId, userId) {
  if (!confirm('Retirer ce partage ?')) return;
  
  try {
    await api(`/shares/projects/${projectId}/users/${userId}`, { method: 'DELETE' });
    showNotify({ title: 'Succès', message: 'Partage retiré', type: 'success' });
    loadExistingShares(projectId);
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
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
    setValue('#edit-proj-ref', project.ref || '');
    setValue('#edit-proj-client', project.client || '');
    setValue('#edit-proj-date', project.date ? project.date.split('T')[0] : '');
    
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
    const users = await api('/shares/available-viewers');
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
        <button class="btn ghost" style="font-size:12px;padding:2px;margin:0;" onclick="removeProjectShare(${userId})">×</button>
      `;
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
    await loadEditExistingShares(currentEditProjectId);
  } catch (err) {
    showNotify({ title: 'Erreur', message: 'Erreur lors de l\'ajout du partage: ' + err.message, type: 'error' });
  }
}

async function removeProjectShare(shareId) {
  if (!confirm('Retirer ce partage ?')) return;
  
  try {
    // shareId est en réalité shared_with_user_id, donc on a besoin du projectId aussi
    await api(`/shares/projects/${currentEditProjectId}/users/${shareId}`, { method: 'DELETE' });
    showNotify({ title: 'Succès', message: 'Partage retiré', type: 'success' });
    await loadEditExistingShares(currentEditProjectId);
  } catch (err) {
    showNotify({ title: 'Erreur', message: 'Erreur lors de la suppression: ' + err.message, type: 'error' });
  }
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
      const statusBadge = r.status === 'pending' ? '🕐 En attente' 
        : r.status === 'approved' ? '✅ Approuvée' 
        : '❌ Rejetée';
      
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
      
      const statusBadge = req.status === 'pending' ? '<span style="color:#ffa500;">🕐 En attente</span>'
        : req.status === 'approved' ? '<span style="color:#28a745;">✅ Approuvée</span>'
        : '<span style="color:#dc3545;">❌ Rejetée</span>';
      
      const actions = req.status === 'pending' 
        ? `<button class="btn btn-sm" data-approve-id="${req.id}">✅ Approuver</button>
           <button class="btn ghost btn-sm" data-reject-id="${req.id}">❌ Rejeter</button>`
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
      setText('#approve-selected', `✅ ${selectedProjects[0].name}`);
      qs('#approve-confirm-btn').disabled = false;
    } else if (selectedProjects.length > 1) {
      setText('#approve-selected', `✅ ${selectedProjects.length} projets sélectionnés`);
      qs('#approve-confirm-btn').disabled = false;
    } else {
      // Fallback: on a des IDs mais pas les objets projet - activer quand même
      setText('#approve-selected', `✅ ${approveState.selectedProjectId.length} projet(s) sélectionné(s)`);
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
      ? '📭 Aucun projet partagé avec vous.<br><small>Cliquez sur "Demander l\'accès" ci-dessus pour faire une demande.</small>'
      : '📭 Aucun projet créé.<br><small>Créez votre premier projet ci-dessus.</small>';
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--muted);">${message}</td></tr>`;
    return;
  }
  
  for (const p of list){
    const tr = document.createElement('tr');
    const shareBtn = canShareProject() ? `<button class="btn ghost btn-sm" data-share-id="${p.id}">🔗 Partager</button>` : '';
    const editBtn = canShareProject() ? `<button class="btn ghost btn-sm" data-edit-id="${p.id}">✏️ Éditer</button>` : '';
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
async function refreshProjects(){ const list = await api('/projects'); renderProjects(list); }

async function openProject(id){
  const { project, lots } = await api('/projects/'+id);
  currentProject = project;
  currentRound = null; // Réinitialiser le tour
  
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
            <button class="edit-round" title="Modifier">✏️</button>
            <button class="duplicate-round" title="Dupliquer">📋</button>
            <button class="delete-round" title="Supprimer">🗑️</button>
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
  activateTourTab('tour-lots');
  setText('#current-round-name', `${round.name}`);
  
  // Désactiver Config Questions et Fiches Questions jusqu'à la sélection d'un lot
  disableTourTabs(['tour-config', 'tour-questions']);
  
  // Charger les lots pour ce tour
  await loadLotsForRound();
}

async function selectRoundFromTab(round){
  currentRound = round;
  
  // Mettre à jour les onglets
  qsa('#rounds-tabs button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.roundId === String(round.id));
  });
  
  // Afficher le contenu
  activateTab('round-content');
  activateTourTab('tour-lots');
  setText('#current-round-name', `${round.name}`);
  
  // Désactiver Config Questions et Fiches Questions jusqu'à la sélection d'un lot
  disableTourTabs(['tour-config', 'tour-questions']);
  
  // Charger la liste des lots par défaut
  await loadLotsForRound();
}

async function loadLotsForRound(){
  if (!currentRound) return;
  
  const { project, lots } = await api('/projects/'+currentProject.id);
  const tbody = qs('#lots-table tbody');
  if (!tbody) {
    console.warn('lots-table manquant dans le DOM; chargement des lots ignoré');
    return;
  }
  tbody.innerHTML='';
  
  // enable drag-n-drop
  tbody.dataset.dragEnabled = 'true';

  for (const l of lots){
    const tr = document.createElement('tr');
    tr.setAttribute('draggable', 'true');
    tr.dataset.lotId = String(l.id);
    tr.innerHTML = `
      <td class="drag-handle" style="cursor:grab">⋮⋮</td>
      <td>${l.id}</td>
      <td>${l.code||''}</td>
      <td>${l.name}</td>
      <td style="display:flex;gap:8px;align-items:center">
        <button class="btn">${isVisionneur() ? '👁️ Voir' : 'Ouvrir'}</button>
        ${isVisionneur() ? '' : '<button class="btn ghost btn-edit-lot">✏️ Modifier</button>'}
      </td>`;
    tr.querySelector('button.btn').addEventListener('click', () => openLot(l.id, l));
    const editBtn = tr.querySelector('.btn-edit-lot');
    if (editBtn) editBtn.addEventListener('click', () => openLotEditModal(l));
    tbody.appendChild(tr);
  }

  if (typeof initLotsDragAndDrop === 'function') {
    initLotsDragAndDrop(tbody);
  } else if (typeof window !== 'undefined' && typeof window.initLotsDragAndDrop === 'function') {
    window.initLotsDragAndDrop(tbody);
  } else {
    console.warn('Drag & drop init manquant: initLotsDragAndDrop');
  }
}

async function loadRoundSummary(){
  if (!currentRound) return;
  
  try {
    const data = await api(`/rounds/${currentRound.id}/summary`);
    const { lots } = data;
    const entrepriseMode = isEntreprise();
    
    const table = qs('#summary-table');
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    const tfoot = table.querySelector('tfoot');
    
    // Construire les en-têtes: Lot | MOE (€) | Montant (€) | Écart (€) | Écart (%)
    thead.innerHTML = '';
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = entrepriseMode
      ? '<th>Lot</th><th class="amount">Montant (€)</th>'
      : '<th>Lot</th><th class="amount">MOE (€)</th><th class="amount">Montant (€)</th><th class="amount">Écart (€)</th><th class="amount">Écart (%)</th>';
    thead.appendChild(headerRow);
    
    // Construire les lignes: une ligne par lot avec MOE, puis une ligne par entreprise
    tbody.innerHTML = '';
    let totalMoe = 0;
    const totalsByCompany = {}; // { company_id: { name, total } }
    
    for (const lot of lots) {
      // Ligne d'en-tête du lot avec MOE
      const lotRow = document.createElement('tr');
      lotRow.className = 'lot-header-row';
      
      const lotCell = document.createElement('td');
      lotCell.className = 'lot-name-cell';
      lotCell.innerHTML = lot.lot_code 
        ? `<strong><span class="lot-code">${lot.lot_code}</span> ${lot.lot_name}</strong>` 
        : `<strong>${lot.lot_name}</strong>`;
      lotRow.appendChild(lotCell);
      
      if (!entrepriseMode) {
        const moeCell = document.createElement('td');
        moeCell.className = 'amount moe-amount';
        moeCell.innerHTML = `<strong>MOE</strong><br>${fmtEuro(lot.moe_total)}`;
        lotRow.appendChild(moeCell);
        lotRow.innerHTML += '<td class="amount empty-cell">—</td><td class="amount empty-cell">—</td><td class="amount empty-cell">—</td><td class="amount empty-cell">—</td>';
      } else {
        // En mode entreprise on ne montre que l'en-tête du lot
        lotRow.innerHTML += '<td class="amount empty-cell">—</td>';
      }
      tbody.appendChild(lotRow);
      totalMoe += lot.moe_total;
      
      // Lignes entreprises (uniquement celles qui répondent à ce lot)
      for (const companyData of lot.companies) {
        const companyRow = document.createElement('tr');
        companyRow.className = 'company-row';
        
        // Colonne entreprise (nom)
        const companyNameCell = document.createElement('td');
        companyNameCell.className = 'amount company-name-cell sticky-col';
        companyNameCell.textContent = companyData.company_name;
        companyRow.appendChild(companyNameCell);
        
        // Colonne montant
        const amountCell = document.createElement('td');
        amountCell.className = 'amount';
        amountCell.textContent = fmtEuro(companyData.total);
        companyRow.appendChild(amountCell);
        
        if (!entrepriseMode) {
          const ecartEur = companyData.total - lot.moe_total;
          const ecartEurCell = document.createElement('td');
          ecartEurCell.className = 'amount';
          const ecartEurClass = ecartEur > 0 ? 'ecart-positive' : (ecartEur < 0 ? 'ecart-negative' : 'ecart-zero');
          const ecartEurSign = ecartEur > 0 ? '+' : '';
          ecartEurCell.innerHTML = `<span class="${ecartEurClass}">${ecartEurSign}${fmtEuro(Math.abs(ecartEur))}</span>`;
          companyRow.appendChild(ecartEurCell);
          const ecartPct = lot.moe_total > 0 ? ((companyData.total - lot.moe_total) / lot.moe_total) * 100 : 0;
          const ecartPctCell = document.createElement('td');
          ecartPctCell.className = 'amount';
          const ecartPctClass = ecartPct > 0 ? 'ecart-positive' : (ecartPct < 0 ? 'ecart-negative' : 'ecart-zero');
          const ecartPctSign = ecartPct > 0 ? '+' : '';
          ecartPctCell.innerHTML = `<span class="${ecartPctClass}">${ecartPctSign}${ecartPct.toFixed(1)}%</span>`;
          companyRow.appendChild(ecartPctCell);
        }
        
        tbody.appendChild(companyRow);
        
        // Accumuler pour les totaux
        if (!totalsByCompany[companyData.company_id]) {
          totalsByCompany[companyData.company_id] = {
            name: companyData.company_name,
            total: 0
          };
        }
        totalsByCompany[companyData.company_id].total += companyData.total;
      }
    }
    
    // Calculer simulation moins-disant (meilleur prix par lot)
    let totalMoinsDisant = 0;
    for (const lot of lots) {
      if (lot.companies.length > 0) {
        const minPrice = Math.min(...lot.companies.map(c => c.total));
        totalMoinsDisant += minPrice;
      }
    }
    
    // Ligne de totaux MOE (masquée en entreprise)
    tfoot.innerHTML = '';
    const companiesArray = Object.values(totalsByCompany);
    
    if (!entrepriseMode) {
      const totalMoeRow = document.createElement('tr');
      totalMoeRow.className = 'total-row lot-header-row moe-total-row';
    
      const totalLabelCell = document.createElement('th');
      totalLabelCell.textContent = 'TOTAL';
      totalLabelCell.rowSpan = companiesArray.length + 2; // +2 pour MOE et moins-disant
      totalMoeRow.appendChild(totalLabelCell);
    
      const totalMoeCell = document.createElement('th');
      totalMoeCell.className = 'amount moe-total-cell';
      totalMoeCell.innerHTML = `<strong>MOE</strong><br>${fmtEuro(totalMoe)}`;
      totalMoeRow.appendChild(totalMoeCell);
    
      totalMoeRow.innerHTML += '<th class="amount">—</th><th class="amount">—</th><th class="amount">—</th><th class="amount">—</th>';
      tfoot.appendChild(totalMoeRow);
    }
    
    // Ligne simulation moins-disant
    if (!entrepriseMode) {
      const moinsDRow = document.createElement('tr');
      moinsDRow.className = 'total-row simulation-row';
    
      const moinsDNameCell = document.createElement('th');
      moinsDNameCell.className = 'amount simulation-name';
      moinsDNameCell.innerHTML = '<strong>Moins-disant (simulation)</strong>';
      moinsDRow.appendChild(moinsDNameCell);
    
      const moinsDAmountCell = document.createElement('th');
      moinsDAmountCell.className = 'amount';
      moinsDAmountCell.innerHTML = `<strong>${fmtEuro(totalMoinsDisant)}</strong>`;
      moinsDRow.appendChild(moinsDAmountCell);
    
      const moinsDEcartEur = totalMoinsDisant - totalMoe;
      const moinsDEcartEurCell = document.createElement('th');
      moinsDEcartEurCell.className = 'amount';
      const moinsDEcartClass = moinsDEcartEur > 0 ? 'ecart-positive' : (moinsDEcartEur < 0 ? 'ecart-negative' : 'ecart-zero');
      const moinsDEcartSign = moinsDEcartEur > 0 ? '+' : '';
      moinsDEcartEurCell.innerHTML = `<strong><span class="${moinsDEcartClass}">${moinsDEcartSign}${fmtEuro(Math.abs(moinsDEcartEur))}</span></strong>`;
      moinsDRow.appendChild(moinsDEcartEurCell);
      const moinsDEcartPct = totalMoe > 0 ? ((totalMoinsDisant - totalMoe) / totalMoe) * 100 : 0;
      const moinsDEcartPctCell = document.createElement('th');
      moinsDEcartPctCell.className = 'amount';
      const moinsDPctClass = moinsDEcartPct > 0 ? 'ecart-positive' : (moinsDEcartPct < 0 ? 'ecart-negative' : 'ecart-zero');
      const moinsDPctSign = moinsDEcartPct > 0 ? '+' : '';
      moinsDEcartPctCell.innerHTML = `<strong><span class="${moinsDPctClass}">${moinsDPctSign}${moinsDEcartPct.toFixed(1)}%</span></strong>`;
      moinsDRow.appendChild(moinsDEcartPctCell);
      tfoot.appendChild(moinsDRow);
    }
    
    // Lignes de totaux par entreprise
    for (const companyId in totalsByCompany) {
      const companyData = totalsByCompany[companyId];
      const companyTotalRow = document.createElement('tr');
      companyTotalRow.className = 'total-row company-row';
      
      // Nom entreprise
      const companyNameCell = document.createElement('th');
      companyNameCell.className = 'amount';
      companyNameCell.textContent = companyData.name;
      companyTotalRow.appendChild(companyNameCell);
      
      // Montant total
      const amountCell = document.createElement('th');
      amountCell.className = 'amount';
      amountCell.innerHTML = `<strong>${fmtEuro(companyData.total)}</strong>`;
      companyTotalRow.appendChild(amountCell);
      
      if (!entrepriseMode) {
        const totalEcartEur = companyData.total - totalMoe;
        const totalEcartEurCell = document.createElement('th');
        totalEcartEurCell.className = 'amount';
        const totalEcartEurClass = totalEcartEur > 0 ? 'ecart-positive' : (totalEcartEur < 0 ? 'ecart-negative' : 'ecart-zero');
        const totalEcartEurSign = totalEcartEur > 0 ? '+' : '';
        totalEcartEurCell.innerHTML = `<strong><span class="${totalEcartEurClass}">${totalEcartEurSign}${fmtEuro(Math.abs(totalEcartEur))}</span></strong>`;
        companyTotalRow.appendChild(totalEcartEurCell);
        const totalEcartPct = totalMoe > 0 ? ((companyData.total - totalMoe) / totalMoe) * 100 : 0;
        const totalEcartPctCell = document.createElement('th');
        totalEcartPctCell.className = 'amount';
        const totalEcartPctClass = totalEcartPct > 0 ? 'ecart-positive' : (totalEcartPct < 0 ? 'ecart-negative' : 'ecart-zero');
        const totalEcartPctSign = totalEcartPct > 0 ? '+' : '';
        totalEcartPctCell.innerHTML = `<strong><span class="${totalEcartPctClass}">${totalEcartPctSign}${totalEcartPct.toFixed(1)}%</span></strong>`;
        companyTotalRow.appendChild(totalEcartPctCell);
      }
      
      tfoot.appendChild(companyTotalRow);
    }
    
  } catch (err) {
    console.error('Erreur chargement récapitulatif:', err);
    showNotify({ title:'Erreur', message:'Chargement récapitulatif: ' + err.message, type:'error' });
  }
}

async function loadRoundsComparison(){
  if (!currentProject) return;
  
  try {
    const data = await api(`/rounds/project/${currentProject.id}/compare`);
    const { lots, rounds } = data;
    const entrepriseMode = isEntreprise();
    
    if (rounds.length === 0) {
      qs('#rounds-compare-table').innerHTML = '<tbody><tr><td colspan="10" style="text-align:center;padding:40px;color:var(--muted)">Aucun tour disponible</td></tr></tbody>';
      return;
    }
    
    // Peupler les sélecteurs de tours
    const selectFrom = qs('#compare-round-from');
    const selectTo = qs('#compare-round-to');
    selectFrom.innerHTML = '<option value="">Sélectionner un tour...</option>';
    selectTo.innerHTML = '<option value="">Sélectionner un tour...</option>';
    for (const round of rounds) {
      selectFrom.innerHTML += `<option value="${round.id}">${round.name}</option>`;
      selectTo.innerHTML += `<option value="${round.id}">${round.name}</option>`;
    }
    
    const table = qs('#rounds-compare-table');
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    const tfoot = table.querySelector('tfoot');
    
    // Récupérer les tours sélectionnés pour l'analyse
    const roundFromId = selectFrom.value ? parseInt(selectFrom.value) : null;
    const roundToId = selectTo.value ? parseInt(selectTo.value) : null;
    const showAnalysis = roundFromId && roundToId && roundFromId !== roundToId;
    
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

    // Groupe Analyse
    if (showAnalysis) {
      const grpAna = document.createElement('th');
      grpAna.colSpan = 3;
      grpAna.className = 'amount';
      grpAna.style.cssText = 'background:rgba(255,140,66,0.1);border-left:2px solid var(--accent)';
      grpAna.textContent = '🔍 Analyse';
      headerRow1.appendChild(grpAna);

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

    for (const lot of lots) {
      // Ligne d'en-tête du lot
      const lotRow = document.createElement('tr');
      lotRow.className = 'lot-header-row';

      const lotCell = document.createElement('td');
      lotCell.className = 'lot-name-cell sticky-col';
      lotCell.innerHTML = lot.lot_code
        ? `<strong><span class="lot-code">${lot.lot_code}</span> ${lot.lot_name}</strong>`
        : `<strong>${lot.lot_name}</strong>`;
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
        let bestPrice = null;
        let bestCompanyName = '';
        
        if (companies.length > 0) {
          const minTotal = Math.min(...companies.map(c => c.total));
          const bestCompany = companies.find(c => c.total === minTotal);
          bestPrice = minTotal;
          bestCompanyName = bestCompany?.company_name || '';
        }
        
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

      // Analyse (totaux par lot)
      if (showAnalysis) {
        const fromTotal = lot.round_totals?.[roundFromId] || 0;
        const toTotal = lot.round_totals?.[roundToId] || 0;
        const delta = toTotal - fromTotal;
        const deltaPct = fromTotal > 0 ? (delta / fromTotal) * 100 : 0;
        const tdDelta = document.createElement('td'); tdDelta.className = 'amount'; tdDelta.style.cssText = 'background:rgba(255,140,66,0.05);border-left:2px solid var(--accent);font-weight:600'; tdDelta.style.color = delta < 0 ? 'var(--success)' : (delta > 0 ? 'var(--danger)' : 'var(--fg)'); tdDelta.textContent = (delta > 0 ? '+' : '') + fmtEuro(delta);
        const tdPct = document.createElement('td'); tdPct.className = 'amount'; tdPct.style.cssText = 'background:rgba(255,140,66,0.05);font-weight:600'; tdPct.style.color = deltaPct < 0 ? 'var(--success)' : (deltaPct > 0 ? 'var(--danger)' : 'var(--fg)'); tdPct.textContent = (deltaPct > 0 ? '+' : '') + deltaPct.toFixed(1) + '%';
        const tdTrend = document.createElement('td'); tdTrend.className = 'amount'; tdTrend.style.cssText = 'background:rgba(255,140,66,0.05);font-size:20px'; tdTrend.textContent = delta < 0 ? '↓' : (delta > 0 ? '↑' : '↔'); tdTrend.style.color = delta < 0 ? 'var(--success)' : (delta > 0 ? 'var(--danger)' : 'var(--muted)');
        lotRow.appendChild(tdDelta);
        lotRow.appendChild(tdPct);
        lotRow.appendChild(tdTrend);
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
          const found = companies.find(c => c.company_id === companyId);
          const amount = found ? found.total : 0;

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
        if (showAnalysis) {
          const fromCompanies = lot.companies_by_round?.[roundFromId] || [];
          const toCompanies = lot.companies_by_round?.[roundToId] || [];
          const fromTotal = (fromCompanies.find(c => c.company_id === companyId)?.total) || 0;
          const toTotal = (toCompanies.find(c => c.company_id === companyId)?.total) || 0;
          const delta = toTotal - fromTotal;
          const deltaPct = fromTotal > 0 ? (delta / fromTotal) * 100 : 0;

          const tdDelta = document.createElement('td'); tdDelta.className = 'amount'; tdDelta.style.cssText = 'background:rgba(255,140,66,0.05);border-left:2px solid var(--accent);font-weight:600'; tdDelta.style.color = delta < 0 ? 'var(--success)' : (delta > 0 ? 'var(--danger)' : 'var(--fg)'); tdDelta.textContent = (delta > 0 ? '+' : '') + fmtEuro(delta);
          const tdPct = document.createElement('td'); tdPct.className = 'amount'; tdPct.style.cssText = 'background:rgba(255,140,66,0.05);font-weight:600'; tdPct.style.color = deltaPct < 0 ? 'var(--success)' : (deltaPct > 0 ? 'var(--danger)' : 'var(--fg)'); tdPct.textContent = (deltaPct > 0 ? '+' : '') + deltaPct.toFixed(1) + '%';
          const tdTrend = document.createElement('td'); tdTrend.className = 'amount'; tdTrend.style.cssText = 'background:rgba(255,140,66,0.05);font-size:20px'; tdTrend.textContent = delta < 0 ? '↓' : (delta > 0 ? '↑' : '↔'); tdTrend.style.color = delta < 0 ? 'var(--success)' : (delta > 0 ? 'var(--danger)' : 'var(--muted)');
          row.appendChild(tdDelta);
          row.appendChild(tdPct);
          row.appendChild(tdTrend);
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
    if (showAnalysis) {
      const fromTotal = totalsByRound[roundFromId] || 0;
      const toTotal = totalsByRound[roundToId] || 0;
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
  if (!confirm('Supprimer ce tour et toutes ses données ?')) return;
  
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
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
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
  setText('#lot-questions-title', `Fiches Questions - ${lotMeta.name}`);

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
  
  // Activer l'onglet Fiches Questions
  enableTab('tab-lot-questions', true);
  
  // Activer les onglets Config Questions et Fiches Questions du tour
  const tourTabs = ['tour-questions'];
  if (!isEntreprise() && !isVisionneur()) tourTabs.unshift('tour-config');
  enableTourTabs(tourTabs);
  
  // Charger les seuils et questions
  if (!isEntreprise() && !isVisionneur()) {
    await loadLotThresholds();
  }
  populateCompanyFilter();
}

/* ================= Options (Additifs cochables) ================= */
async function loadLotOptions(){
  if (!currentLot || !currentRound) return;
  try {
    const options = await api(`/options/lot/${currentLot.id}?round_id=${currentRound.id}`);
    lotOptions = options.map(opt => ({
      ...opt,
      checked: false // décoché par défaut
    }));
    selectedOptions = {};
    renderLotOptions();
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
  if (!sel || !btn) return;
  sel.innerHTML = '';
  for (const opt of lotOptions){
    const o = document.createElement('option');
    o.value = String(opt.id); o.textContent = opt.designation;
    sel.appendChild(o);
  }
  btn.onclick = async () => {
    const optionId = Number(sel.value);
    if (!optionId) return;
    try {
      // Crée un article vide (modifiable ensuite)
      await api(`/options/${optionId}/items`, { method:'POST', body:{ num:'', designation:'', unit:'', moe_qty:null, moe_unit_price:null } });
      await loadLotOptions();
      renderOptionsSheetTable();
      showNotify({ title:'Option', message:'Article ajouté', type:'success' });
    } catch (err) {
      showNotify({ title:'Erreur', message: err.message, type:'error' });
    }
  };
}

function renderLotOptions(){
  const container = qs('#lot-options-list');
  if (!container) return;
  
  if (lotOptions.length === 0) {
    container.innerHTML = '<p class="muted">Aucune option</p>';
    if (!isVisionneur()) {
      container.innerHTML += '<button id="add-option-btn" class="btn ghost" style="margin-top:8px">➕ Ajouter option</button>';
      qs('#add-option-btn')?.addEventListener('click', async () => {
        const design = prompt('Désignation de l\'option:');
        if (!design) return;
        try {
          await api(`/options/lot/${currentLot.id}`, {
            method: 'POST',
            body: { round_id: currentRound.id, designation: design }
          });
          await loadLotOptions();
        } catch (err) {
          showNotify({ title: 'Erreur', message: err.message, type: 'error' });
        }
      });
    }
    return;
  }
  
  let html = '<div style="display:flex;flex-direction:column;gap:12px">';
  for (const opt of lotOptions) {
    const checked = selectedOptions[opt.id] ? 'checked' : '';
    const itemCount = opt.items?.length || 0;
    html += `<div style="display:flex;gap:8px;align-items:center;padding:8px;background:var(--input-bg);border-radius:4px;border:1px solid var(--border)">
      <input type="checkbox" data-option-id="${opt.id}" class="option-checkbox" ${checked} />
      <span style="flex:1;font-weight:500">${opt.designation}</span>
      <span class="muted" style="font-size:12px">${itemCount} article(s)</span>
      ${isVisionneur() ? '' : `<button class="btn ghost" style="padding:4px 8px;font-size:11px" data-delete-option="${opt.id}">🗑️</button>`}
    </div>`;
  }
  html += '</div>';
  if (!isVisionneur()) {
    html += '<button id="add-option-btn" class="btn ghost" style="margin-top:12px">➕ Ajouter option</button>';
  }
  container.innerHTML = html;
  
  // Event listeners
  qsa('.option-checkbox').forEach(chk => {
    chk.addEventListener('change', async (e) => {
      const optId = parseInt(e.target.dataset.optionId, 10);
      selectedOptions[optId] = e.target.checked;
      await refreshCompare();
      // Rafraîchir le tableau options en mode édition si visible
      const optSheet = qs('#options-sheet-view');
      if (optSheet && !optSheet.classList.contains('hidden')) {
        renderOptionsSheetTable();
      }
    });
  });
  
  qsa('[data-delete-option]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const optId = parseInt(e.target.dataset.deleteOption, 10);
      if (confirm('Supprimer cette option?')) {
        try {
          await api(`/options/${optId}`, { method: 'DELETE' });
          await loadLotOptions();
        } catch (err) {
          showNotify({ title: 'Erreur', message: err.message, type: 'error' });
        }
      }
    });
  });
  
  qs('#add-option-btn')?.addEventListener('click', async () => {
    const design = prompt('Désignation de l\'option:');
    if (!design) return;
    try {
      await api(`/options/lot/${currentLot.id}`, {
        method: 'POST', body: { round_id: currentRound.id, designation: design }
      });
      await loadLotOptions();
    } catch (err) {
      showNotify({ title: 'Erreur', message: err.message, type: 'error' });
    }
  });
}

let editingOptionId = null;
function openOptionCreateModal(){
  if (isVisionneur()) return;
  editingOptionId = null;
  qs('#option-modal-title').textContent = 'Créer une option';
  qs('#option-designation').value = '';
  qs('#option-items-tbody').innerHTML = '';
  qs('#option-modal').classList.remove('hidden');
}

function openOptionEditModal(option){
  if (isVisionneur()) return;
  editingOptionId = option.id;
  qs('#option-modal-title').textContent = `Modifier: ${option.designation}`;
  qs('#option-designation').value = option.designation;
  
  // Charger les items
  const tbody = qs('#option-items-tbody');
  tbody.innerHTML = '';
  for (const item of (option.items || [])) {
    const tr = document.createElement('tr');
    tr.dataset.itemId = item.id;
    tr.innerHTML = `
      <td style="padding:6px;border-bottom:1px solid var(--border)"><input type="text" class="item-num" value="${item.num || ''}" placeholder="Num" style="width:100%;box-sizing:border-box;padding:4px;border:1px solid var(--border);border-radius:3px" /></td>
      <td style="padding:6px;border-bottom:1px solid var(--border)"><input type="text" class="item-designation" value="${item.designation || ''}" placeholder="Désignation" style="width:100%;box-sizing:border-box;padding:4px;border:1px solid var(--border);border-radius:3px" /></td>
      <td style="padding:6px;border-bottom:1px solid var(--border)"><input type="text" class="item-unit" value="${item.unit || ''}" placeholder="Unité" style="width:100%;box-sizing:border-box;padding:4px;border:1px solid var(--border);border-radius:3px" /></td>
      <td style="padding:6px;border-bottom:1px solid var(--border);text-align:right"><input type="number" class="item-moe-qty" value="${item.moe_qty || ''}" placeholder="Qté" style="width:100%;box-sizing:border-box;padding:4px;border:1px solid var(--border);border-radius:3px;text-align:right" step="0.01" /></td>
      <td style="padding:6px;border-bottom:1px solid var(--border);text-align:right"><input type="number" class="item-moe-pu" value="${item.moe_unit_price || ''}" placeholder="PU" style="width:100%;box-sizing:border-box;padding:4px;border:1px solid var(--border);border-radius:3px;text-align:right" step="0.01" /></td>
      <td style="padding:6px;border-bottom:1px solid var(--border);text-align:center"><button class="btn ghost" style="padding:4px 8px;font-size:11px" data-delete-item="${item.id}">🗑️</button></td>
    `;
    tbody.appendChild(tr);
    
    // Ajouter event listener pour delete
    tr.querySelector('[data-delete-item]')?.addEventListener('click', (e) => {
      e.preventDefault();
      const itemId = parseInt(e.target.dataset.deleteItem, 10);
      tr.remove();
    });
  }
  
  qs('#option-modal').classList.remove('hidden');
}

qs('#option-modal-close')?.addEventListener('click', () => {
  qs('#option-modal').classList.add('hidden');
  editingOptionId = null;
});

qs('#option-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'option-modal') {
    qs('#option-modal').classList.add('hidden');
    editingOptionId = null;
  }
});

qs('#add-option-item-btn')?.addEventListener('click', () => {
  const tbody = qs('#option-items-tbody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td style="padding:6px;border-bottom:1px solid var(--border)"><input type="text" class="item-num" placeholder="Num" style="width:100%;box-sizing:border-box;padding:4px;border:1px solid var(--border);border-radius:3px" /></td>
    <td style="padding:6px;border-bottom:1px solid var(--border)"><input type="text" class="item-designation" placeholder="Désignation" style="width:100%;box-sizing:border-box;padding:4px;border:1px solid var(--border);border-radius:3px" /></td>
    <td style="padding:6px;border-bottom:1px solid var(--border)"><input type="text" class="item-unit" placeholder="Unité" style="width:100%;box-sizing:border-box;padding:4px;border:1px solid var(--border);border-radius:3px" /></td>
    <td style="padding:6px;border-bottom:1px solid var(--border);text-align:right"><input type="number" class="item-moe-qty" placeholder="Qté" style="width:100%;box-sizing:border-box;padding:4px;border:1px solid var(--border);border-radius:3px;text-align:right" step="0.01" /></td>
    <td style="padding:6px;border-bottom:1px solid var(--border);text-align:right"><input type="number" class="item-moe-pu" placeholder="PU" style="width:100%;box-sizing:border-box;padding:4px;border:1px solid var(--border);border-radius:3px;text-align:right" step="0.01" /></td>
    <td style="padding:6px;border-bottom:1px solid var(--border);text-align:center"></td>
  `;
  tbody.appendChild(tr);
});

qs('#option-modal-save')?.addEventListener('click', async () => {
  try {
    const designation = qs('#option-designation').value.trim();
    if (!designation) {
      showNotify({ title: 'Erreur', message: 'Désignation requise', type: 'error' });
      return;
    }

    let optionId = editingOptionId;
    
    // Créer ou mettre à jour l'option
    if (optionId) {
      await api(`/options/${optionId}`, { method: 'PUT', body: { designation } });
    } else {
      const newOpt = await api(`/options/lot/${currentLot.id}`, {
        method: 'POST',
        body: { round_id: currentRound.id, designation }
      });
      optionId = newOpt.id;
    }

    // Sauvegarder les items
    const tbody = qs('#option-items-tbody');
    for (const tr of tbody.querySelectorAll('tr')) {
      const num = tr.querySelector('.item-num').value.trim();
      const des = tr.querySelector('.item-designation').value.trim();
      const unit = tr.querySelector('.item-unit').value.trim();
      const moeQty = tr.querySelector('.item-moe-qty').value;
      const moePu = tr.querySelector('.item-moe-pu').value;
      
      const itemId = tr.dataset.itemId;
      
      if (itemId) {
        // Mettre à jour item existant
        if (des) {
          await api(`/options/items/${itemId}`, {
            method: 'PUT',
            body: { num, designation: des, unit, moe_qty: moeQty ? parseFloat(moeQty) : null, moe_unit_price: moePu ? parseFloat(moePu) : null }
          });
        } else {
          // Supprimer si vide
          await api(`/options/items/${itemId}`, { method: 'DELETE' });
        }
      } else {
        // Créer nouveau item
        if (des) {
          await api(`/options/${optionId}/items`, {
            method: 'POST',
            body: { num, designation: des, unit, moe_qty: moeQty ? parseFloat(moeQty) : null, moe_unit_price: moePu ? parseFloat(moePu) : null }
          });
        }
      }
    }

    qs('#option-modal').classList.add('hidden');
    editingOptionId = null;
    await loadLotOptions();
    await refreshCompare();
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
  }
});

/* ================= Configuration Questions (Projet) ================= */
async function loadProjectQuestionConfig(){
  if (!currentProject) return;
  try {
    const config = await api(`/question-config/project/${currentProject.id}`);
    qs('#q-qty-low').value = config.question_qty_low || '';
    qs('#q-qty-high').value = config.question_qty_high || '';
    qs('#q-price-low').value = config.question_price_low || '';
    qs('#q-price-high').value = config.question_price_high || '';
  } catch (err) {
    console.error('Erreur chargement config questions:', err);
  }
}

async function saveProjectQuestionConfig(){
  if (!currentProject) return;
  try {
    const body = {
      question_qty_low: qs('#q-qty-low').value.trim(),
      question_qty_high: qs('#q-qty-high').value.trim(),
      question_price_low: qs('#q-price-low').value.trim(),
      question_price_high: qs('#q-price-high').value.trim()
    };
    await api(`/question-config/project/${currentProject.id}`, { method: 'PUT', body });
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
    qs('#threshold-qty-low').value = thresholds.qty_low_threshold || 10;
    qs('#threshold-qty-high').value = thresholds.qty_high_threshold || 10;
    qs('#threshold-price-low').value = thresholds.price_low_threshold || 10;
    qs('#threshold-price-high').value = thresholds.price_high_threshold || 10;
  } catch (err) {
    console.error('Erreur chargement seuils:', err);
  }
}

async function saveLotThresholds(){
  if (isVisionneur() || isEntreprise()) { showNotify({ title:'Accès refusé', message:'Vous ne pouvez pas modifier les seuils.', type:'error' }); return; }
  if (!currentLot) return;
  try {
    const body = {
      qty_low_threshold: parseFloat(qs('#threshold-qty-low').value),
      qty_high_threshold: parseFloat(qs('#threshold-qty-high').value),
      price_low_threshold: parseFloat(qs('#threshold-price-low').value),
      price_high_threshold: parseFloat(qs('#threshold-price-high').value)
    };
    await api(`/question-config/lot/${currentLot.id}/thresholds`, { method: 'PUT', body });
    showNotify({ title: 'Succès', message: 'Seuils sauvegardés', type: 'success' });
  } catch (err) {
    showNotify({ title: 'Erreur', message: err.message, type: 'error' });
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

function populateCompanyFilter(){
  const select = qs('#filter-company');
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
    const companyId = qs('#filter-company').value;
    const status = qs('#filter-status').value;
    
    let url = `/question-config/lot/${currentLot.id}/export-excel?round_id=${currentRound.id}`;
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
    a.download = `Fiches_Questions_Lot_${currentLot.id}_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);
  } catch (err) {
    showNotify({ title:'Erreur', message: err.message, type:'error' });
  }
}

async function exportRAO(){
  if (!currentProject) return;
  try {
    const response = await fetch(`${API_BASE}/exports/rao/${currentProject.id}`, {
      credentials: 'include'
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Erreur serveur' }));
      throw new Error(error.error || 'Erreur lors de la génération');
    }
    
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `RAO_${currentProject.name}_${new Date().toISOString().split('T')[0]}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);
    showNotify({ title: 'Succès', message: 'RAO généré avec succès', type: 'success' });
  } catch (err) {
    showNotify({ title:'Erreur', message: err.message, type:'error' });
  }
}

async function refreshQuestions(){
  if (!currentLot || !currentRound) return;
  try {
    const companyId = qs('#filter-company').value;
    const status = qs('#filter-status').value;
    
    let url = `/question-config/lot/${currentLot.id}?round_id=${currentRound.id}`;
    if (companyId) url += `&company_id=${companyId}`;
    if (status) url += `&status=${status}`;
    
    let questions = await api(url);
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
        'qty_low': '📉 Qté Basse',
        'qty_high': '📈 Qté Haute',
        'price_low': '💰 Prix Bas',
        'price_high': '💸 Prix Haut'
      }[q.question_type] || q.question_type;
      
      const statusBadge = {
        'pending': '⏳ En attente',
        'answered': '✅ Répondue',
        'dismissed': '❌ Ignorée'
      }[q.status] || q.status;
      
      const deviationPct = q.deviation_pct != null ? Number(q.deviation_pct).toFixed(1) + '%' : '';
      const moeVal = q.moe_value != null ? fmtNum(q.moe_value) : '';
      const offerVal = q.offer_value != null ? fmtNum(q.offer_value) : '';
      
      html += `
        <tr data-qid="${q.id}">
          <td>${q.company_name}</td>
          <td>${q.num || ''} - ${q.designation || ''}</td>
          <td>${typeLabel}</td>
          <td style="max-width:300px">${q.question_text}</td>
          <td>${deviationPct}</td>
          <td>${moeVal}</td>
          <td>${offerVal}</td>
          <td>
            <textarea id="comment-${q.id}" name="comment-${q.id}" data-qid="${q.id}" style="width:200px;height:60px;padding:4px" placeholder="Commentaire..." autocomplete="off" ${isEntreprise() ? 'disabled' : ''}>${q.comment || ''}</textarea>
          </td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn-answer" data-qid="${q.id}" data-status="answered" style="padding:4px 8px;font-size:12px" aria-label="Marquer réponse question ${q.id}">✓</button>
            <button class="btn-dismiss" data-qid="${q.id}" data-status="dismissed" style="padding:4px 8px;font-size:12px" aria-label="Ignorer question ${q.id}">✗</button>
            <button class="btn-edit-question" data-qid="${q.id}" style="padding:4px 8px;font-size:12px" aria-label="Modifier question ${q.id}">✏️</button>
            <button class="btn-delete-question" data-qid="${q.id}" style="padding:4px 8px;font-size:12px" aria-label="Supprimer question ${q.id}">🗑️</button>
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
      // Masquer les boutons d'actions
      qsa('.btn-answer, .btn-dismiss').forEach(btn => btn.style.display = 'none');
    } else {
      // Bind actions pour les non-visionneurs
      qsa('.btn-answer, .btn-dismiss').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const qid = e.target.dataset.qid;
          const status = e.target.dataset.status;
          const textarea = qs(`textarea[data-qid="${qid}"]`);
          const comment = qs(`#comment-${qid}`)?.value.trim() || '';
          try {
            await api(`/question-config/question/${qid}`, {
              method: 'PUT',
              body: { comment, status }
            });
            await refreshQuestions();
          } catch (err) {
            showNotify({ title:'Erreur', message: err.message, type:'error' });
          }
        });
      });
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
          if (confirm('Supprimer cette question ?')) {
            try {
              await api(`/question-config/question/${qid}`, {
                method: 'DELETE'
              });
              await refreshQuestions();
            } catch (err) {
              showNotify({ title:'Erreur', message: err.message, type:'error' });
            }
          }
        });
      });
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
    }
  } catch (err) {
    console.error('Erreur chargement questions:', err);
    showNotify({ title:'Erreur', message: err.message, type:'error' });
  }
}

/* ================= Éditeur de Questions ================= */
async function loadQuestionsEditor(){
  if (!currentLot || !currentRound) return;
  
  try {
    // Sauvegarder la sélection actuelle d'entreprise ciblée
    const targetCompanySelect = qs('#questions-target-company');
    const previousSelection = targetCompanySelect?.value || '';
    
    // Charger les données du lot et les questions
    const roundParam = `?round_id=${currentRound.id}`;
    const lotData = await api(`/lots/${currentLot.id}${roundParam}`);
    const questionsData = await api(`/question-config/lot/${currentLot.id}${roundParam}`);
    
    // Peupler le sélecteur d'entreprise ciblée (header)
    const targetCompany = qs('#questions-target-company');
    targetCompany.innerHTML = '<option value="">→ Sélectionner une entreprise...</option>';
    for (const c of lotData.companies || []) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
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
      opt.textContent = c.name;
      modalTargetCompany.appendChild(opt);
    }
    
    // Construire le tableau
    renderQuestionsEditorTable(lotData, questionsData);
    
  } catch (err) {
    console.error('Erreur chargement éditeur questions:', err);
    showNotify({ title:'Erreur', message: err.message, type:'error' });
  }
}

function renderQuestionsEditorTable(lotData, questionsData) {
  const viewFilter = qs('#questions-view-filter').value;
  const targetCompany = qs('#questions-target-company').value;
  const thead = qs('#questions-editor-head');
  const tbody = qs('#questions-editor-body');
  
  if (!lotData.items || lotData.items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="20" style="text-align:center;padding:40px;color:var(--muted)">Aucune donnée disponible</td></tr>';
    return;
  }
  
  // Afficher toutes les entreprises dans les colonnes de comparaison
  let companies = lotData.companies || [];
  
  // Créer une map des questions par item_id + company_id
  const questionsMap = new Map();
  for (const q of questionsData || []) {
    const key = `${q.item_id}_${q.company_id}`;
    questionsMap.set(key, q);
  }
  let headerHTML = '<tr>';
  headerHTML += '<th style="width:50px">#</th>';
  headerHTML += '<th style="width:200px">Désignation</th>';
  headerHTML += '<th style="width:80px">Unité</th>';
  
  if (viewFilter === 'all' || viewFilter === 'quantities') {
    headerHTML += '<th style="width:100px" class="moe-highlight">Qté MOE</th>';
    for (const c of companies) {
      const highlightClass = targetCompany && c.id == targetCompany ? ' target-company-highlight' : '';
      headerHTML += `<th style="width:100px" class="${highlightClass}">Qté ${c.name}</th>`;
    }
  }
  
  if (viewFilter === 'all' || viewFilter === 'unit_prices') {
    headerHTML += '<th style="width:100px" class="moe-highlight">PU MOE</th>';
    for (const c of companies) {
      const highlightClass = targetCompany && c.id == targetCompany ? ' target-company-highlight' : '';
      headerHTML += `<th style="width:100px" class="${highlightClass}">PU ${c.name}</th>`;
    }
  }
  
  if (viewFilter === 'all' || viewFilter === 'totals') {
    headerHTML += '<th style="width:120px" class="moe-highlight">Total MOE</th>';
    for (const c of companies) {
      const highlightClass = targetCompany && c.id == targetCompany ? ' target-company-highlight' : '';
      headerHTML += `<th style="width:120px" class="${highlightClass}">Total ${c.name}</th>`;
    }
  }
  
  headerHTML += '<th style="min-width:220px">Question</th>';
  headerHTML += '<th style="width:100px">Statut</th>';
  headerHTML += '<th style="width:100px">Actions</th>';
  headerHTML += '</tr>';
  thead.innerHTML = headerHTML;
  
  let html = '';
  
  // Pour chaque ligne du lot (une ligne par item, pas par entreprise)
  for (const item of lotData.items) {
    const moeQty = item.quantity_moe || 0;
    const moePU = item.unit_price_moe || 0;
    const moeTotal = moeQty * moePU;
    
    // Collecter les offres de toutes les entreprises pour cet item
    const itemOffers = companies.map(company => {
      const offer = (lotData.offers || []).find(o => 
        o.item_id === item.id && o.company_id === company.id
      );
      return {
        company_id: company.id,
        company_name: company.name,
        quantity: offer?.quantity || 0,
        unit_price: offer?.unit_price || 0,
        total: (offer?.quantity || 0) * (offer?.unit_price || 0)
      };
    });
    
    // Trouver la question pour cette entreprise ciblée
    let existingQuestion = null;
    if (targetCompany) {
      const questionKey = `${item.id}_${targetCompany}`;
      existingQuestion = questionsMap.get(questionKey);
    }
    
    const questionId = existingQuestion?.id || '';
    const questionText = existingQuestion?.question_text || '';
    const questionStatus = existingQuestion?.status || 'pending';
    const questionCompanyId = existingQuestion?.company_id || '';
    
    const statusBadge = {
      'pending': '⏳ En attente',
      'answered': '✅ Répondue',
      'dismissed': '❌ Ignorée'
    }[questionStatus] || questionStatus;
    
    html += `<tr data-item-id="${item.id}" data-question-id="${questionId}" data-question-company-id="${questionCompanyId}">`;
    html += `<td>${item.num || ''}</td>`;
    html += `<td>${item.designation || ''}</td>`;
    html += `<td>${item.unit || ''}</td>`;
    
    // Colonnes quantités
    if (viewFilter === 'all' || viewFilter === 'quantities') {
      html += `<td class="moe-cell">${fmtNum(moeQty)}</td>`;
      for (const offer of itemOffers) {
        const deviation = moeQty > 0 ? ((offer.quantity - moeQty) / moeQty) * 100 : 0;
        const deviationClass = Math.abs(deviation) > 10 ? 'ecart-high' : '';
        const highlightClass = targetCompany && offer.company_id == targetCompany ? ' target-company-highlight' : '';
        html += `<td class="${deviationClass}${highlightClass}">${fmtNum(offer.quantity)}</td>`;
      }
    }
    
    // Colonnes prix unitaires
    if (viewFilter === 'all' || viewFilter === 'unit_prices') {
      html += `<td class="moe-cell">${fmtEuro(moePU)}</td>`;
      for (const offer of itemOffers) {
        const deviation = moePU > 0 ? ((offer.unit_price - moePU) / moePU) * 100 : 0;
        const deviationClass = Math.abs(deviation) > 10 ? 'ecart-high' : '';
        const highlightClass = targetCompany && offer.company_id == targetCompany ? ' target-company-highlight' : '';
        html += `<td class="${deviationClass}${highlightClass}">${fmtEuro(offer.unit_price)}</td>`;
      }
    }
    
    // Colonnes totaux
    if (viewFilter === 'all' || viewFilter === 'totals') {
      html += `<td class="moe-cell">${fmtEuro(moeTotal)}</td>`;
      for (const offer of itemOffers) {
        const deviation = moeTotal > 0 ? ((offer.total - moeTotal) / moeTotal) * 100 : 0;
        const deviationClass = Math.abs(deviation) > 10 ? 'ecart-high' : '';
        const highlightClass = targetCompany && offer.company_id == targetCompany ? ' target-company-highlight' : '';
        html += `<td class="${deviationClass}${highlightClass}">${fmtEuro(offer.total)}</td>`;
      }
    }
    
    
    // Question avec statut sauvegarde
    html += '<td style="position:relative">';
    html += `<textarea 
      id="question-${item.id}"
      name="question-${item.id}"
      class="question-text-editor" 
      data-item-id="${item.id}"
      data-question-id="${questionId}"
      rows="2" 
      style="width:100%;padding:6px;border-radius:4px;border:1px solid var(--border);background:var(--input-bg);color:var(--fg)"
      placeholder="Saisir une question..."
      ${isVisionneur() || isEntreprise() ? 'disabled' : ''}
    >${questionText}</textarea>`;
    html += `<div class="save-status" data-item-id="${item.id}" style="position:absolute;top:6px;right:6px;font-size:14px;display:none">💾</div>`;
    html += '</td>';
    
    // Statut
    html += `<td>${statusBadge}</td>`;
    
    // Actions
    html += '<td>';
    if (questionId) {
      html += `<button class="btn-delete-editor-question" data-question-id="${questionId}" style="padding:4px 8px;font-size:12px" title="Supprimer">🗑️</button>`;
    }
    html += '</td>';
    
    html += '</tr>';
  }
  
  tbody.innerHTML = html || '<tr><td colspan="20" style="text-align:center;padding:40px;color:var(--muted)">Aucune ligne correspondante</td></tr>';
  
  // Bind events
  if (!isVisionneur() && !isEntreprise()) {
    bindQuestionsEditorEvents();
  }
}

function bindQuestionsEditorEvents() {
  // Map pour garder les timers de debounce par item
  const saveTimers = new Map();
  
  // Auto-save pour chaque textarea
  qsa('.question-text-editor').forEach(textarea => {
    textarea.addEventListener('input', async (e) => {
      const itemId = textarea.dataset.itemId;
      const questionId = textarea.dataset.questionId;
      const questionText = textarea.value.trim();
      const statusIndicator = qs(`.save-status[data-item-id="${itemId}"]`);
      
      // Annuler le timer précédent
      if (saveTimers.has(itemId)) {
        clearTimeout(saveTimers.get(itemId));
      }
      
      // Si vide, ne pas sauvegarder
      if (!questionText) {
        statusIndicator.style.display = 'none';
        return;
      }
      
      // Montrer l'indicateur "en attente"
      statusIndicator.style.display = 'block';
      statusIndicator.textContent = '⏳';
      statusIndicator.style.color = 'var(--muted)';
      
      // Créer un nouveau timer (debounce 2s)
      const timer = setTimeout(async () => {
        try {
          // Vérifier si une entreprise est sélectionnée
          let companyId = qs('#questions-target-company')?.value;
          
          if (!companyId) {
            // Afficher le modal
            showCompanySelectModal(itemId, questionId, questionText);
            statusIndicator.textContent = '⚠️';
            statusIndicator.style.color = 'var(--copper)';
            return;
          }
          
          // Sauvegarder
          if (questionId) {
            await api(`/question-config/question/${questionId}`, {
              method: 'PUT',
              body: { 
                question_text: questionText,
                company_id: parseInt(companyId)
              }
            });
          } else {
            const result = await api('/question-config/question', {
              method: 'POST',
              body: {
                lot_id: currentLot.id,
                round_id: currentRound.id,
                item_id: parseInt(itemId),
                company_id: parseInt(companyId),
                question_text: questionText,
                question_type: 'manual',
                status: 'pending'
              }
            });
            
            // Mettre à jour le data-question-id après création
            const row = textarea.closest('tr');
            if (result && result.id) {
              row.dataset.questionId = result.id;
              textarea.dataset.questionId = result.id;
            }
          }
          
          // Afficher le succès
          statusIndicator.textContent = '✅';
          statusIndicator.style.color = 'var(--success)';
          
          // Cacher après 2s
          setTimeout(() => {
            statusIndicator.style.display = 'none';
          }, 2000);
          
          // Rafraîchir les fiches questions
          await refreshQuestions();
          
        } catch (err) {
          console.error('Erreur auto-save:', err);
          statusIndicator.textContent = '❌';
          statusIndicator.style.color = 'var(--danger)';
        }
      }, 2000);
      
      saveTimers.set(itemId, timer);
    });
  });
  
  // Supprimer une question
  qsa('.btn-delete-editor-question').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const questionId = e.target.dataset.questionId;
      
      if (!confirm('Supprimer cette question ?')) return;
      
      try {
        await api(`/question-config/question/${questionId}`, {
          method: 'DELETE'
        });
        
        showNotify({ title:'Succès', message:'Question supprimée', type:'success' });
        await loadQuestionsEditor();
        await refreshQuestions();
        
      } catch (err) {
        showNotify({ title:'Erreur', message: err.message, type:'error' });
      }
    });
  });
}

// Fonction pour afficher le modal de sélection d'entreprise
function showCompanySelectModal(itemId, questionId, questionText) {
  const modal = qs('#company-select-modal');
  const modalSelect = qs('#modal-target-company-select');
  const headerSelect = qs('#questions-target-company');
  
  // Synchroniser le modal avec la sélection du header
  modalSelect.value = headerSelect.value;
  
  // Afficher le modal
  modal.classList.remove('hidden');
  
  // Gestionnaire pour le bouton Annuler
  const cancelBtn = qs('#cancel-company-modal');
  const cancelHandler = () => {
    modal.classList.add('hidden');
    cancelBtn.removeEventListener('click', cancelHandler);
    confirmBtn.removeEventListener('click', confirmHandler);
  };
  
  // Gestionnaire pour le bouton Confirmer
  const confirmBtn = qs('#confirm-company-modal');
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
    cancelBtn.removeEventListener('click', cancelHandler);
    confirmBtn.removeEventListener('click', confirmHandler);
    
    // Sauvegarder la question
    await saveQuestionWithCompany(itemId, questionId, companyId, questionText);
  };
  
  cancelBtn.addEventListener('click', cancelHandler);
  confirmBtn.addEventListener('click', confirmHandler);
}

// Fonction pour sauvegarder une question avec l'entreprise

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

async function refreshCompare(){
  try {
    if (!currentLot) return;
    const roundParam = currentRound ? `?round_id=${currentRound.id}` : '';
    
    const data = await api('/lots/'+currentLot.id+'/table'+roundParam);
    const entrepriseMode = isEntreprise();
    
    // Vérifier si l'utilisateur entreprise a des données
    if (entrepriseMode && (!data.companies || data.companies.length === 0)) {
      const head = qs('#compare-head'), body = qs('#compare-body');
      head.innerHTML = '';
      body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--muted)">Aucune entreprise attribuée ou aucune donnée disponible pour ce lot.</td></tr>';
      return;
    }
    
    const head = qs('#compare-head'), body = qs('#compare-body'); head.innerHTML=''; body.innerHTML='';
  
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
  
  for (const r of data.rows){
    let tr = `<tr><td class="sticky-col">${r.num||''}</td><td class="sticky-col2">${r.designation||''}</td><td>${r.unit||''}</td>`;
    
    // Colonnes MOE (seulement si pas entreprise)
    if (!entrepriseMode) {
      tr += `<td class="moe-border">${fmtNum(r.moe.qty)}</td><td>${fmtEuro(r.moe.pu)}</td><td>${fmtEuro(r.moe.mt)}</td>`;
      // Accumuler le total MOE
      if (r.moe.mt != null) totalMoe += parseNum(r.moe.mt);
    }
    
    for (const c of r.companies){
      if (entrepriseMode) {
        // Sans les colonnes ΔQté et ΔPU
        tr += `<td class="company-border">${c.u||''}</td><td>${fmtNum(c.qty)}</td><td>${fmtEuro(c.pu)}</td><td>${fmtEuro(c.mt)}</td>`;
      } else {
        // Calculer delta quantité (MOE - Offre)
        const moeQty = parseNum(r.moe.qty);
        const offerQty = parseNum(c.qty);
        const deltaQty = (moeQty !== null && offerQty !== null) ? moeQty - offerQty : null;
        const deltaQtyClass = deltaQty !== null ? (deltaQty > 0 ? 'delta-positive' : deltaQty < 0 ? 'delta-negative' : '') : '';
        
        tr += `<td class="company-border">${c.u||''}</td><td>${fmtNum(c.qty)}</td><td class="${deltaQtyClass}">${deltaQty !== null ? fmtNum(deltaQty) : ''}</td><td>${fmtEuro(c.pu)}</td><td>${fmtEuro(c.mt)}</td><td>${fmtPct(c.delta_pu_pct)}</td>`;
      }
      
      // Accumuler le total par entreprise
      if (c.mt != null) totalsByCompany[c.company_id] = (totalsByCompany[c.company_id] || 0) + parseNum(c.mt);
    }
    tr += '</tr>'; body.insertAdjacentHTML('beforeend', tr);
  }
  
  // Les options sont maintenant rendues dans un tableau séparé sous le total.
  
  // Ajouter la ligne de totaux
  let totalRow = `<tr class="total-row"><td class="sticky-col"><strong>TOTAL</strong></td><td class="sticky-col2"></td><td></td>`;
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
});
window.addEventListener('load', recalcCompareHeaderOffsets);

/* ================= Tableur (édition) ================= */
/** Rendu du comparatif des options sous le tableau principal */
function renderOptionsCompareTable(companies, entrepriseMode){
  const head = qs('#options-compare-head');
  const body = qs('#options-compare-body');
  if (!head || !body) return;
  head.innerHTML = '';
  body.innerHTML = '';

  // Filtrer options cochées et construire une liste d'items
  const selected = lotOptions.filter(o => selectedOptions[o.id]);
  const items = [];
  for (const opt of selected){
    for (const item of (opt.items || [])){
      items.push({ option: opt, item });
    }
  }
  if (items.length === 0){
    head.innerHTML = '';
    body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:16px;color:var(--muted)">Aucune option cochée</td></tr>';
    return;
  }

  // En-tête ligne 1
  let h1 = `<tr class="head-row-1"><th rowspan="2" class="sticky-col">Num</th><th rowspan="2" class="sticky-col2">Option / Désignation</th><th rowspan="2">Unité</th>`;
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
    let tr = `<tr><td class="sticky-col">${item.num||''}</td><td class="sticky-col2"><span class="muted">${opt.designation}</span> — ${item.designation||''}</td><td>${item.unit||''}</td>`;
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
        tr += `<td class="company-border"></td><td>${fmtNum(qty)}</td><td></td><td>${fmtEuro(pu)}</td><td>${fmtEuro(mt)}</td><td></td>`;
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

  /** Rendu du tableau d'édition des options sous le tableau principal */
  let optionsSheetDelegatesAttached = false;
  function renderOptionsSheetTable(){
    const head = qs('#options-sheet-head');
    const body = qs('#options-sheet-body');
    if (!head || !body) return;
    head.innerHTML = '';
    body.innerHTML = '';

    const entrepriseMode = isEntreprise();
    const companies = lotCompanies || [];
    // En édition: afficher toutes les options (pas uniquement cochées)
    const items = [];
    for (const opt of lotOptions){
      for (const item of (opt.items || [])) items.push({ option: opt, item });
    }
    if (items.length === 0){
      head.innerHTML = '';
      body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:16px;color:var(--muted)">Aucune option cochée</td></tr>';
      return;
    }

    // En-tête similaire au tableur
    const tr1 = document.createElement('tr');
    const baseHeaders = ['Num', 'Option / Désignation', 'Unité'];
    for (const h of baseHeaders){ const th = document.createElement('th'); th.textContent = h; th.rowSpan = 2; tr1.appendChild(th); }
    if (!entrepriseMode){ const th = document.createElement('th'); th.textContent = 'MOE'; th.colSpan = 3; th.classList.add('moe-col'); tr1.appendChild(th); }
    for (const c of companies){ const th = document.createElement('th'); th.textContent = c.name; th.colSpan = entrepriseMode ? 3 : 5; th.classList.add('company-col'); tr1.appendChild(th); }
    head.appendChild(tr1);
    const tr2 = document.createElement('tr');
    if (!entrepriseMode){ ['Qté','PU','Mt'].forEach(t => { const th = document.createElement('th'); th.textContent = t; tr2.appendChild(th); }); }
    for (let i=0;i<companies.length;i++){
      if (entrepriseMode){ ['Qté','PU','Mt'].forEach(t => { const th = document.createElement('th'); th.textContent = t; tr2.appendChild(th); }); }
      else { ['Qté','ΔQté','PU','Mt','ΔPU'].forEach(t => { const th = document.createElement('th'); th.textContent = t; tr2.appendChild(th); }); }
    }
    head.appendChild(tr2);

    // Corps: cellules éditables basiques
    for (const { option: opt, item } of items){
      const tr = document.createElement('tr');
      tr.dataset.itemId = item.id;
      // Num, Désignation (afficher option), Unité
      const tdNum = document.createElement('td'); tdNum.contentEditable = true; tdNum.textContent = item.num || ''; tr.appendChild(tdNum);
      const tdDes = document.createElement('td'); tdDes.contentEditable = true; tdDes.textContent = `${opt.designation} — ${item.designation||''}`; tdDes.dataset.isOptionDesignation = 'true'; tr.appendChild(tdDes);
      const tdUnit = document.createElement('td'); tdUnit.contentEditable = true; tdUnit.textContent = item.unit || ''; tr.appendChild(tdUnit);

      // MOE
      if (!entrepriseMode){
        const tdMoeQty = document.createElement('td'); tdMoeQty.contentEditable = true; tdMoeQty.textContent = item.moe_qty ?? ''; tr.appendChild(tdMoeQty);
        const tdMoePu  = document.createElement('td'); tdMoePu.contentEditable  = true; tdMoePu.textContent  = item.moe_unit_price ?? ''; tr.appendChild(tdMoePu);
        const tdMoeMt  = document.createElement('td'); tdMoeMt.classList.add('cell-readonly'); tdMoeMt.textContent  = amountOf(item.moe_qty, item.moe_unit_price); tr.appendChild(tdMoeMt);
      }

      // Entreprises
      for (const c of companies){
        const off = (item.offers||[]).find(o => Number(o.company_id) === Number(c.id)) || {};
        const tdQty = document.createElement('td'); tdQty.contentEditable = true; tdQty.textContent = off.qty ?? ''; tdQty.dataset.companyId = String(c.id); tdQty.dataset.sub = 'qty'; tr.appendChild(tdQty);
        if (!entrepriseMode){ // ΔQté (lecture seule)
          const tdDeltaQty = document.createElement('td'); tdDeltaQty.classList.add('cell-readonly'); tdDeltaQty.textContent = ''; tr.appendChild(tdDeltaQty);
        }
        const tdPu  = document.createElement('td'); tdPu.contentEditable  = true; tdPu.textContent  = off.unit_price ?? ''; tdPu.dataset.companyId = String(c.id); tdPu.dataset.sub = 'pu'; tr.appendChild(tdPu);
        const tdMt  = document.createElement('td'); tdMt.classList.add('cell-readonly'); tdMt.textContent  = amountOf(off.qty, off.unit_price); tr.appendChild(tdMt);
        if (!entrepriseMode){ // ΔPU (lecture seule)
          const tdDeltaPu = document.createElement('td'); tdDeltaPu.classList.add('cell-readonly'); tdDeltaPu.textContent = ''; tr.appendChild(tdDeltaPu);
        }
      }
      body.appendChild(tr);
    }

    // Délégation simple pour sauvegarder sur blur
    if (!optionsSheetDelegatesAttached){
      optionsSheetDelegatesAttached = true;
      body.addEventListener('blur', async (e) => {
      const td = e.target.closest('td'); if (!td) return;
      const tr = td.closest('tr'); const itemId = tr?.dataset.itemId; if (!itemId) return;
      const cols = Array.from(tr.children);
      const num = cols[0].textContent.trim();
      const fullDes = cols[1].textContent.trim();
      const unit = cols[2].textContent.trim();
      let designation = fullDes;
      // retirer préfixe option "Option — ..."
      const sep = '—'; if (designation.includes(sep)) designation = designation.split(sep).slice(1).join(sep).trim();

      // MOE
      let moe_qty = null, moe_unit_price = null;
      let shift = 3;
      if (!entrepriseMode){
        moe_qty = cols[3].textContent.trim() || null;
        moe_unit_price = cols[4].textContent.trim() || null;
        shift = 6; // after MOE mt
        // Sauvegarder item + MOE
        await api(`/options/items/${itemId}`, { method:'PUT', body:{ num, designation, unit, moe_qty: moe_qty ? parseFloat(moe_qty) : null, moe_unit_price: moe_unit_price ? parseFloat(moe_unit_price) : null } });
      } else {
        // Sauvegarder item sans MOE
        await api(`/options/items/${itemId}`, { method:'PUT', body:{ num, designation, unit } });
      }

      // Entreprises offers
      for (let i=shift;i<cols.length;i++){
        const cell = cols[i]; if (!cell.dataset.companyId) continue;
        const company_id = Number(cell.dataset.companyId);
        const offRow = Math.floor((i-shift) / (entrepriseMode ? 3 : 5));
        const baseIndex = shift + offRow * (entrepriseMode ? 3 : 5);
        const qty = cols[baseIndex].textContent.trim() || null;
        const pu  = cols[baseIndex + (entrepriseMode ? 1 : 2)].textContent.trim() || null;
        await api(`/options/items/${itemId}/offers`, { method:'POST', body:{ company_id, qty: qty ? parseFloat(qty) : null, unit_price: pu ? parseFloat(pu) : null, round_id: currentRound?.id } });
      }

        // Recalcul local
        renderOptionsSheetTable();
        await refreshCompare();
      }, true);
    }
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
      moe: { 
        qty: moe.qty != null ? String(moe.qty) : '', 
        pu: moe.unit_price != null ? String(moe.unit_price) : '' 
      },
      offers: {}
    };
    for (const c of lotCompanies) {
      const companyId = Number(c.id);
      const o = offersByItem.get(itemId)?.get(companyId) || {};
      row.offers[companyId] = { 
        u: o.unit ?? '', 
        qty: o.qty != null ? String(o.qty) : '', 
        pu: o.unit_price != null ? String(o.unit_price) : '' 
      };
    }
    return row;
  });

  if (sheetRows.length === 0) {
    const blank = { item_id:null, num:'', designation:'', unit:'', moe:{qty:'', pu:''}, offers:{} };
    for (const c of lotCompanies) blank.offers[c.id] = { u:'', qty:'', pu:'' };
    sheetRows.push(blank);
  }

  buildColModel();
  renderSheetInitial();
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

/** Rendu initial sans réutiliser pendant les collages */
function renderSheetInitial(){
  const head = qs('#sheet-head');
  const body = qs('#sheet-body');
  head.innerHTML = ''; body.innerHTML = '';

  // top header: base (rowSpan=2) + groupes
  const tr1 = document.createElement('tr');
  
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
    tr1.appendChild(th);
  }
  head.appendChild(tr1);

  // bottom header: libellés des 4 colonnes par entreprise
  const tr2 = document.createElement('tr');
  for (let i=actualBaseCount; i<colModel.length; i++){
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
    if (!isEntreprise()) {
      chip.innerHTML = `${c.name}<button data-id="${c.id}" title="Retirer">×</button>`;
      chip.querySelector('button').addEventListener('click', async () => {
        if (!confirm(`Supprimer l'entreprise "${c.name}" ?\n\nToutes les offres de cette entreprise seront également supprimées.`)) {
          return;
        }
        try {
          await api(`/lots/${currentLot.id}/companies/${c.id}`, { method:'DELETE' });
          lotCompanies = lotCompanies.filter(x => x.id !== c.id);
          for (const r of sheetRows) delete r.offers[c.id];
          buildColModel();
          renderSheetInitial();
          refreshCompare();
        } catch (err) {
          showNotify({ title:'Erreur', message:'Suppression entreprise: ' + err.message, type:'error' });
        }
      });
    } else {
      chip.textContent = c.name; // Pas de bouton suppression pour entreprise
    }
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
      moe: { qty: moeQty, pu: moePu },
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
      body:{ rows, round_id: currentRound?.id },
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
    
    // Le récapitulatif par tour a été supprimé; plus de rafraîchissement dédié
    
    // Rafraîchir la comparaison des tours si visible
    const compareView = qs('#rounds-compare-view');
    if (currentProject && compareView && !compareView.classList.contains('hidden')) {
      await loadRoundsComparison();
    }
    
    hasUnsavedChanges = false;
    updateSaveButton();
    
    console.log('✅ Sauvegarde réussie');
  } catch (err) {
    console.error('❌ Erreur sauvegarde:', err);
    showNotify({ title:'Erreur', message:'Sauvegarde grille: ' + err.message, type:'error' });
  } finally {
    isSaving = false;
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

  qs('#save-grid')?.addEventListener('click', saveGrid);
  qs('#undo')?.addEventListener('click', undo);
  qs('#redo')?.addEventListener('click', redo);

  // bascule modes
  qs('#mode-compare')?.addEventListener('click', () => {
    hide('#sheet-view'); hide('#sheet-actions'); show('#compare-view');
    hide('#options-sheet-view');
    qs('#mode-compare').classList.add('active-mode'); qs('#mode-edit').classList.remove('active-mode');
  });
  qs('#mode-edit')?.addEventListener('click', () => {
    if (isVisionneur()) {
      showNotify({ title:'Accès refusé', message:'Mode édition non disponible en lecture seule.', type:'error' });
      return;
    }
    show('#sheet-view'); show('#sheet-actions'); hide('#compare-view');
    show('#options-sheet-view');
    qs('#mode-edit').classList.add('active-mode'); qs('#mode-compare').classList.remove('active-mode');
    renderOptionsSheetTable();
    setupOptionsSheetControls();
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
  
  const tourLotsTab = qs('[data-tour-tab="tour-lots"]');
  if (tourLotsTab) {
    if (isVisionneur()) {
      tourLotsTab.style.display = 'none';
    } else {
      tourLotsTab.style.display = '';
    }
  }
  
  // Masquer le bouton de sauvegarde config questions projet pour les visionneurs
  const saveProjectQuestions = qs('#save-project-questions');
  if (saveProjectQuestions) {
    if (isVisionneur() || isEntreprise()) {
      saveProjectQuestions.style.display = 'none';
    } else {
      saveProjectQuestions.style.display = '';
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
  console.log('🔍 Access button:', accessBtn, 'isVisionneur:', isVisionneur(), 'user:', currentUser);
  if (accessBtn) {
    if (isVisionneur()) {
      console.log('✅ Showing access request button');
      accessBtn.classList.remove('hidden');
    } else {
      console.log('❌ Hiding access request button');
      accessBtn.classList.add('hidden');
    }
  } else {
    console.error('⚠️ Access request button not found in DOM');
  }
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
        setText('#login-msg', '❌ ' + e.message); 
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
            <div style="font-size: 3rem; margin-bottom: 0.5rem;">📧</div>
            <h3 style="color: #155724; margin: 0 0 0.5rem 0;">✅ Compte créé avec succès!</h3>
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
      setText('#login-msg', '❌ ' + e.message); 
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
      setText('#login-msg', '✅ ' + result.message);
    } catch(e) {
      setText('#login-msg', '❌ ' + e.message);
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

  // Navigation principale
  qsa('.nav-btn').forEach(b => b.addEventListener('click', () => !b.disabled && activateTab(b.dataset.tab)));

  // Sous-onglets dans l'inventaire des tours (liste/comparaison)
  qsa('#tab-rounds .tour-tab-btn').forEach(b => b.addEventListener('click', () => activateRoundsTab(b.dataset.roundsTab)));

  // Bouton de mise à jour de la comparaison des tours
  qs('#update-comparison')?.addEventListener('click', () => loadRoundsComparison());

  // Sous-onglets d'un tour sélectionné (summary, lots, config, questions)
  qsa('#round-content .tour-tab-btn').forEach(b => b.addEventListener('click', () => activateTourTab(b.dataset.tourTab)));

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
  let editingRoundId = null;
  function openRoundEditModal(round){
    if (isVisionneur()) { return; }
    editingRoundId = round.id;
    const modal = qs('#round-modal');
    qs('#round-modal-title').textContent = 'Modifier le tour';
    qs('#round-name').value = round.name || '';
    qs('#round-description').value = round.description || '';
    qs('#round-modal-msg').textContent = '';
    modal.classList.remove('hidden'); modal.style.display='flex';
  }
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
let editingLotId = null;
function openLotCreateModal(){
  editingLotId = null;
  const modal = qs('#lot-modal');
  qs('#lot-modal-title').textContent = 'Créer un lot';
  qs('#lot-code').value = '';
  qs('#lot-name').value = '';
  qs('#lot-modal-msg').textContent = '';
  modal.classList.remove('hidden'); modal.style.display='flex';
}
function openLotEditModal(lot){
  editingLotId = lot.id;
  const modal = qs('#lot-modal');
  qs('#lot-modal-title').textContent = 'Modifier le lot';
  qs('#lot-code').value = lot.code || '';
  qs('#lot-name').value = lot.name || '';
  qs('#lot-modal-msg').textContent = '';
  modal.classList.remove('hidden'); modal.style.display='flex';
}
qs('#lot-modal-close')?.addEventListener('click', ()=>{ const m=qs('#lot-modal'); m.classList.add('hidden'); m.style.display='none'; });
qs('#lot-modal')?.addEventListener('click', (e)=>{ if (e.target.id==='lot-modal'){ const m=qs('#lot-modal'); m.classList.add('hidden'); m.style.display='none'; } });
qs('#lot-modal-save')?.addEventListener('click', async ()=>{ try{
  const code = qs('#lot-code').value.trim();
  const name = qs('#lot-name').value.trim();
  if (!name) { qs('#lot-modal-msg').textContent = 'Le nom du lot est requis'; return; }
  if (editingLotId){
    await api(`/projects/lots/${editingLotId}`, { method:'PUT', body:{ code, name } });
  } else {
    await api(`/projects/${currentProject.id}/lots`, { method:'POST', body:{ code, name } });
  }
  const m=qs('#lot-modal'); m.classList.add('hidden'); m.style.display='none';
  await loadLotsForRound();
}catch(e){ qs('#lot-modal-msg').textContent = e.message; }});

// ===== Drag & Drop lots order =====
function initLotsDragAndDrop(tbody){
  let dragSrcEl = null;

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
    // Persist new order
    const order = Array
      .from(tbody.querySelectorAll('tr[data-lot-id], tr'))
      .map(r => parseInt(r.dataset.lotId, 10))
      .filter(Number.isFinite);
    try {
      await api(`/projects/${currentProject.id}/lots/order`, { method:'POST', body:{ order } });
    } catch(err) {
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

  // Config questions projet
  qs('#save-project-questions')?.addEventListener('click', saveProjectQuestionConfig);
  
  // Fiches questions lot
  qs('#save-thresholds')?.addEventListener('click', saveLotThresholds);
  qs('#generate-questions')?.addEventListener('click', generateQuestions);
  qs('#refresh-questions')?.addEventListener('click', refreshQuestions);
  qs('#export-questions-excel')?.addEventListener('click', exportQuestionsExcel);
  qs('#export-rao')?.addEventListener('click', exportRAO);
    // Rôle entreprise : masquer génération et réglages des questions + ajout entreprise
    if (isEntreprise()) {
      const genBtn = qs('#generate-questions'); if (genBtn) genBtn.style.display = 'none';
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
  qs('#questions-target-company')?.addEventListener('change', loadQuestionsEditor);
  qs('#refresh-questions-editor')?.addEventListener('click', loadQuestionsEditor);

  renderSheetBindings();
  
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
  qs('#export-rounds-compare-pdf')?.addEventListener('click', () => {
    const title = `Comparaison des Tours - ${currentProject?.name || ''}`.trim();
    exportTableToPDF('#rounds-compare-table', title || 'Comparaison des Tours');
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
  qs('#export-rounds-compare-excel')?.addEventListener('click', async () => {
    if (!currentProject) { showNotify({ title:'Validation', message:'Sélectionnez un projet', type:'info' }); return; }
    try {
      const res = await fetch(`${API_BASE}/exports/rounds-comparison/${currentProject.id}`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Erreur export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ComparaisonTours_${currentProject?.name}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      showNotify({ title:'Erreur', message:'Export: ' + err.message, type:'error' });
    }
  });
  
  // Modal de partage
  qs('#close-share-modal')?.addEventListener('click', closeShareModal);
  qs('#share-project-btn')?.addEventListener('click', shareProject);
  qs('#share-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'share-modal') closeShareModal();
  });
  
  // Modal d'édition du projet
  document.querySelectorAll('.close-edit-project-modal')?.forEach(btn => {
    btn.addEventListener('click', closeEditProjectModal);
  });
  qs('#edit-project-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'edit-project-modal') closeEditProjectModal();
  });
  qs('#save-edit-project')?.addEventListener('click', saveEditProject);
  qs('#edit-add-share-btn')?.addEventListener('click', addEditProjectShare);
  
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
    approveConfirmBtn.addEventListener('click', () => {
      confirmApproveAccess();
    });
  }
  
  qs('#approve-search')?.addEventListener('input', (e) => filterApproveProjects(e.target.value));
  qs('#approve-access-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'approve-access-modal') cancelApproveAccessModal();
  });
  
  // Gestion demandes d'accès (responsable/admin)
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
    if (!confirm('Réinitialiser tous les cooldowns de connexion (débloquer tous les comptes) ?')) return;
    try {
      const result = await api('/auth/reset-cooldowns', { method: 'POST' });
      showNotify({ title: 'Succès', message: result.message, type: 'success' });
    } catch (err) {
      showNotify({ title: 'Erreur', message: err.message, type: 'error' });
    }
  });
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

function sanitizeFilename(s) {
  if (!s) return 'export';
  return String(s).replace(/[^a-zA-Z0-9_\-]+/g, '_').slice(0, 60) || 'export';
}

function exportTableToCSV(tableSelector, filename) {
  const table = qs(tableSelector);
  if (!table) { showNotify({ title:'Validation', message:'Tableau introuvable', type:'info' }); return; }
  const rows = Array.from(table.querySelectorAll('thead tr, tbody tr, tfoot tr'));
  const csv = rows.map(tr => {
    const cells = Array.from(tr.children);
    return cells.map(td => {
      let text = td.textContent.replace(/\s+/g, ' ').trim();
      if (text.includes(';') || text.includes('"')) {
        text = '"' + text.replace(/"/g, '""') + '"';
      }
      return text;
    }).join(';');
  }).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'export.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
      'Accédez aux lots, récapitulatif, configuration et fiches questions.',
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

function updateHelpHighlights(){
  document.querySelectorAll('[data-help]').forEach(el => {
    if (window.__HELP_ACTIVE) el.classList.add('help-highlight');
    else el.classList.remove('help-highlight');
  });
  renderHelpOverlay();
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

function annotateDynamicHelp(){
  setHelp(document.getElementById('create-project'), 'Créer un nouveau projet');
  setHelp(document.getElementById('add-round'), 'Ajouter un tour (phase) au projet');
  setHelp(document.getElementById('add-lot'), 'Créer un lot à l’intérieur du tour sélectionné');
  setHelp(document.getElementById('save-grid'), 'Sauvegarder les valeurs saisies dans la grille');
  setHelp(document.getElementById('mode-edit'), 'Basculer en mode édition de la grille');
  setHelp(document.getElementById('mode-compare'), 'Afficher le comparatif consolidé des offres');
  setHelp(document.getElementById('generate-questions'), 'Générer automatiquement les fiches questions pour ce lot');
  setHelp(document.getElementById('export-summary-excel'), 'Exporter le récapitulatif en Excel formaté');
  setHelp(document.getElementById('export-rounds-compare-excel'), 'Exporter la comparaison des tours en Excel');
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
            <strong>📧 Email :</strong>
          </p>
          <p style="font-size: 1em; color: var(--primary, #0066cc);">
            <a href="mailto:alban.michaud65@gmail.com" style="color: inherit; text-decoration: none;">alban.michaud65@gmail.com</a>
          </p>
        </div>
        
        <div style="background: var(--bg-secondary, #f5f5f5); padding: 1.5rem; border-radius: 8px;">
          <p style="font-size: 1.1em; margin-bottom: 0.5rem;">
            <strong>📞 Téléphone :</strong>
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

  // Init aide contextuelle
  initContextHelp();
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
  const compareBtn = document.getElementById('export-rounds-compare-pdf');
  if (compareBtn) {
    compareBtn.addEventListener('click', () => {
      const title = `Comparaison des Tours - ${currentProject?.name || ''}`.trim();
      exportTableToPDF('#rounds-compare-table', title || 'Comparaison des Tours');
    });
  }
});
