// server/src/public/app.js
// Front monolithique (same-origin)
const API_ROOT = window.location.origin;
const API_BASE = API_ROOT + '/api';

/* ====== Auth ================= */
let token = localStorage.getItem('token') || null;
let currentProject = null;
let currentRound = null;    // Tour/phase actuel
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
  // Mettre à jour la navigation principale
  qsa('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  qsa('.tabpanel').forEach(p => p.id === id ? show('#'+id) : hide('#'+p.id));
  
  // Afficher/masquer la sous-navigation des tours
  if (id === 'tab-rounds' || id === 'round-content') {
    show('#rounds-subnav');
  } else {
    hide('#rounds-subnav');
  }
}
function enableTab(id, enabled=true){
  const btn = qsa('.nav-btn').find(b => b.dataset.tab === id);
  if (btn){ btn.disabled = !enabled; }
}

/* ================= Sous-onglets pour les tours ================= */
function activateTourTab(id){
  qsa('.tour-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tourTab === id));
  qsa('.tour-tabpanel').forEach(p => p.id === id ? p.classList.remove('hidden') : p.classList.add('hidden'));
  
  // Charger les données selon l'onglet
  if (id === 'tour-summary') {
    loadRoundSummary();
  } else if (id === 'tour-lots') {
    loadLotsForRound();
  }
}

/* ================= Sous-onglets pour les lots ================= */
function activateSubtab(id){
  qsa('.subnav-tab').forEach(b => b.classList.toggle('active', b.dataset.subtab === id));
  qsa('.subtabpanel').forEach(p => p.id === id ? p.classList.remove('hidden') : p.classList.add('hidden'));
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
  currentRound = null; // Réinitialiser le tour
  
  enableTab('tab-rounds', true); 
  activateTab('tab-rounds');
  setText('#project-title-nav', `Projet #${project.id} — ${project.name}`);
  
  // Charger les tours/phases
  await loadRounds();
  
  // Charger la config des questions
  await loadProjectQuestionConfig();
}

async function loadRounds(){
  try {
    const rounds = await api(`/rounds/project/${currentProject.id}`);
    
    // Charger les cartes dans la gestion des tours
    const container = qs('#rounds-list');
    container.innerHTML = '';
    
    // Charger les onglets dans la sous-navigation
    const tabsContainer = qs('#rounds-tabs');
    tabsContainer.innerHTML = '';
    
    for (const round of rounds){
      // Charger les stats avec gestion d'erreur
      let stats = { total_items: 0, companies_count: 0, pending_questions: 0 };
      try {
        stats = await api(`/rounds/${round.id}/stats`);
      } catch (statsErr) {
        console.error('Erreur chargement stats pour tour', round.id, ':', statsErr);
      }
      
      // Créer la carte pour la liste des tours
      const card = document.createElement('div');
      card.className = 'round-card';
      card.dataset.roundId = round.id;
      card.innerHTML = `
        <div class="round-card-header">
          <span class="round-number">${round.round_number}</span>
          <div class="round-actions">
            <button class="edit-round" title="Modifier">✏️</button>
            <button class="duplicate-round" title="Dupliquer">📋</button>
            <button class="delete-round" title="Supprimer">🗑️</button>
          </div>
        </div>
        <div class="round-name" contenteditable="false">${round.name}</div>
        <div class="round-stats">
          <span>${stats.total_items || 0} items</span>
          <span>${stats.companies_count || 0} entreprises</span>
          <span>${stats.pending_questions || 0} questions</span>
        </div>
      `;
      
      card.addEventListener('click', (e) => {
        // Ne pas sélectionner si on clique sur le nom en mode édition
        if (!e.target.classList.contains('round-name') || e.target.getAttribute('contenteditable') === 'false') {
          selectRound(round, card);
        }
      });
      
      // Créer l'onglet dans la sous-navigation
      const tab = document.createElement('button');
      tab.className = 'round-tab';
      tab.textContent = round.name;
      tab.dataset.roundId = round.id;
      tab.addEventListener('click', () => selectRoundFromTab(round));
      tabsContainer.appendChild(tab);
      
      const nameEl = card.querySelector('.round-name');
      
      card.querySelector('.edit-round').addEventListener('click', (e) => {
        e.stopPropagation();
        nameEl.setAttribute('contenteditable', 'true');
        nameEl.focus();
        // Sélectionner tout le texte
        const range = document.createRange();
        range.selectNodeContents(nameEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });
      
      nameEl.addEventListener('blur', async () => {
        nameEl.setAttribute('contenteditable', 'false');
        const newName = nameEl.textContent.trim();
        if (newName && newName !== round.name) {
          try {
            await api(`/rounds/${round.id}`, {
              method: 'PUT',
              body: { name: newName, description: round.description, status: round.status }
            });
            round.name = newName; // Mettre à jour localement
          } catch (err) {
            alert('Erreur: ' + err.message);
            nameEl.textContent = round.name; // Restaurer l'ancien nom
          }
        }
      });
      
      nameEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          nameEl.blur();
        } else if (e.key === 'Escape') {
          nameEl.textContent = round.name;
          nameEl.blur();
        }
      });
      
      card.querySelector('.duplicate-round').addEventListener('click', (e) => {
        e.stopPropagation();
        duplicateRound(round.id);
      });
      card.querySelector('.delete-round').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteRound(round.id);
      });
      
      container.appendChild(card);
    }
  } catch (err) {
    console.error('Erreur chargement tours:', err);
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
  activateTourTab('tour-summary');
  setText('#current-round-name', `${round.name}`);
  
  // Charger le récapitulatif par défaut
  await loadRoundSummary();
}

async function loadLotsForRound(){
  if (!currentRound) return;
  
  const { project, lots } = await api('/projects/'+currentProject.id);
  const tbody = qs('#lots-table tbody'); 
  tbody.innerHTML='';
  
  for (const l of lots){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${l.id}</td><td>${l.code||''}</td><td>${l.name}</td><td><button class="btn">Ouvrir</button></td>`;
    tr.querySelector('button').addEventListener('click', () => openLot(l.id, l));
    tbody.appendChild(tr);
  }
}

async function loadRoundSummary(){
  if (!currentRound) return;
  
  try {
    const data = await api(`/rounds/${currentRound.id}/summary`);
    const { lots, companies } = data;
    
    const table = qs('#summary-table');
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    const tfoot = table.querySelector('tfoot');
    
    // Construire les en-têtes: Lot | MOE (€) | Montant (€) | Écart (€) | Écart (%)
    thead.innerHTML = '';
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th>Lot</th><th class="amount">MOE (€)</th><th class="amount">Montant (€)</th><th class="amount">Écart (€)</th><th class="amount">Écart (%)</th>';
    thead.appendChild(headerRow);
    
    // Construire les lignes: une ligne par lot avec MOE, puis une ligne par entreprise
    tbody.innerHTML = '';
    let totalMoe = 0;
    const totalsByCompany = {};
    companies.forEach(c => totalsByCompany[c.id] = 0);
    
    for (const lot of lots) {
      // Ligne d'en-tête du lot avec MOE
      const lotRow = document.createElement('tr');
      lotRow.className = 'lot-header-row';
      
      const lotCell = document.createElement('td');
      lotCell.rowSpan = companies.length + 1;
      lotCell.className = 'lot-name-cell';
      lotCell.innerHTML = lot.lot_code 
        ? `<strong><span class="lot-code">${lot.lot_code}</span> ${lot.lot_name}</strong>` 
        : `<strong>${lot.lot_name}</strong>`;
      lotRow.appendChild(lotCell);
      
      const moeCell = document.createElement('td');
      moeCell.className = 'amount moe-amount';
      moeCell.innerHTML = `<strong>MOE</strong><br>${fmtEuro(lot.moe_total)}`;
      lotRow.appendChild(moeCell);
      
      // Cellules vides pour Montant, Écart €, Écart %
      lotRow.innerHTML += '<td class="amount empty-cell">—</td><td class="amount empty-cell">—</td><td class="amount empty-cell">—</td>';
      
      tbody.appendChild(lotRow);
      totalMoe += lot.moe_total;
      
      // Lignes entreprises (une par entreprise)
      for (const company of companies) {
        const companyTotal = lot.company_totals[company.id] || 0;
        const companyRow = document.createElement('tr');
        companyRow.className = 'company-row';
        
        // Colonne entreprise (nom)
        const companyNameCell = document.createElement('td');
        companyNameCell.className = 'amount company-name-cell';
        companyNameCell.textContent = company.name;
        companyRow.appendChild(companyNameCell);
        
        // Colonne montant
        const amountCell = document.createElement('td');
        amountCell.className = 'amount';
        amountCell.textContent = fmtEuro(companyTotal);
        companyRow.appendChild(amountCell);
        
        // Colonne écart en euros
        const ecartEur = companyTotal - lot.moe_total;
        const ecartEurCell = document.createElement('td');
        ecartEurCell.className = 'amount';
        const ecartEurClass = ecartEur > 0 ? 'ecart-positive' : (ecartEur < 0 ? 'ecart-negative' : 'ecart-zero');
        const ecartEurSign = ecartEur > 0 ? '+' : '';
        ecartEurCell.innerHTML = `<span class="${ecartEurClass}">${ecartEurSign}${fmtEuro(Math.abs(ecartEur))}</span>`;
        companyRow.appendChild(ecartEurCell);
        
        // Colonne écart en pourcentage
        const ecartPct = lot.moe_total > 0 ? ((companyTotal - lot.moe_total) / lot.moe_total) * 100 : 0;
        const ecartPctCell = document.createElement('td');
        ecartPctCell.className = 'amount';
        const ecartPctClass = ecartPct > 0 ? 'ecart-positive' : (ecartPct < 0 ? 'ecart-negative' : 'ecart-zero');
        const ecartPctSign = ecartPct > 0 ? '+' : '';
        ecartPctCell.innerHTML = `<span class="${ecartPctClass}">${ecartPctSign}${ecartPct.toFixed(1)}%</span>`;
        companyRow.appendChild(ecartPctCell);
        
        tbody.appendChild(companyRow);
        totalsByCompany[company.id] += companyTotal;
      }
    }
    
    // Ligne de totaux MOE
    tfoot.innerHTML = '';
    const totalMoeRow = document.createElement('tr');
    totalMoeRow.className = 'total-row lot-header-row';
    
    const totalLabelCell = document.createElement('th');
    totalLabelCell.textContent = 'TOTAL';
    totalLabelCell.rowSpan = companies.length + 1;
    totalMoeRow.appendChild(totalLabelCell);
    
    const totalMoeCell = document.createElement('th');
    totalMoeCell.className = 'amount';
    totalMoeCell.innerHTML = `<strong>MOE</strong><br>${fmtEuro(totalMoe)}`;
    totalMoeRow.appendChild(totalMoeCell);
    
    totalMoeRow.innerHTML += '<th class="amount">—</th><th class="amount">—</th><th class="amount">—</th>';
    
    tfoot.appendChild(totalMoeRow);
    
    // Lignes de totaux par entreprise
    for (const company of companies) {
      const companyTotal = totalsByCompany[company.id];
      const companyTotalRow = document.createElement('tr');
      companyTotalRow.className = 'total-row company-row';
      
      // Nom entreprise
      const companyNameCell = document.createElement('th');
      companyNameCell.className = 'amount';
      companyNameCell.textContent = company.name;
      companyTotalRow.appendChild(companyNameCell);
      
      // Montant total
      const amountCell = document.createElement('th');
      amountCell.className = 'amount';
      amountCell.innerHTML = `<strong>${fmtEuro(companyTotal)}</strong>`;
      companyTotalRow.appendChild(amountCell);
      
      // Écart total en euros
      const totalEcartEur = companyTotal - totalMoe;
      const totalEcartEurCell = document.createElement('th');
      totalEcartEurCell.className = 'amount';
      const totalEcartEurClass = totalEcartEur > 0 ? 'ecart-positive' : (totalEcartEur < 0 ? 'ecart-negative' : 'ecart-zero');
      const totalEcartEurSign = totalEcartEur > 0 ? '+' : '';
      totalEcartEurCell.innerHTML = `<strong><span class="${totalEcartEurClass}">${totalEcartEurSign}${fmtEuro(Math.abs(totalEcartEur))}</span></strong>`;
      companyTotalRow.appendChild(totalEcartEurCell);
      
      // Écart total en pourcentage
      const totalEcartPct = totalMoe > 0 ? ((companyTotal - totalMoe) / totalMoe) * 100 : 0;
      const totalEcartPctCell = document.createElement('th');
      totalEcartPctCell.className = 'amount';
      const totalEcartPctClass = totalEcartPct > 0 ? 'ecart-positive' : (totalEcartPct < 0 ? 'ecart-negative' : 'ecart-zero');
      const totalEcartPctSign = totalEcartPct > 0 ? '+' : '';
      totalEcartPctCell.innerHTML = `<strong><span class="${totalEcartPctClass}">${totalEcartPctSign}${totalEcartPct.toFixed(1)}%</span></strong>`;
      companyTotalRow.appendChild(totalEcartPctCell);
      
      tfoot.appendChild(companyTotalRow);
    }
    
  } catch (err) {
    console.error('Erreur chargement récapitulatif:', err);
    alert('Erreur lors du chargement du récapitulatif: ' + err.message);
  }
}

async function createRound(){
  console.log('createRound called, currentProject:', currentProject);
  if (!currentProject) {
    alert('Veuillez d\'abord ouvrir un projet');
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
    alert('Erreur: ' + err.message);
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
    alert('Erreur: ' + err.message);
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
    alert('Erreur: ' + err.message);
  }
}

async function openLot(id, lotMeta){
  currentLot = { id, ...lotMeta };
  
  // Afficher l'onglet lot (il n'est pas dans la nav principale)
  qsa('.tabpanel').forEach(p => p.classList.add('hidden'));
  show('#tab-lot');
  
  activateSubtab('subtab-data'); // Activer le sous-onglet "Données" par défaut
  setText('#lot-title', `Lot #${id} — ${lotMeta.name}`);
  setText('#lot-questions-title', `Fiches Questions - ${lotMeta.name}`);

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
  
  // Activer l'onglet Fiches Questions
  enableTab('tab-lot-questions', true);
  
  // Charger les seuils et questions
  await loadLotThresholds();
  populateCompanyFilter();
}

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
    alert('✅ Configuration sauvegardée');
  } catch (err) {
    alert('❌ Erreur: ' + err.message);
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
  if (!currentLot) return;
  try {
    const body = {
      qty_low_threshold: parseFloat(qs('#threshold-qty-low').value),
      qty_high_threshold: parseFloat(qs('#threshold-qty-high').value),
      price_low_threshold: parseFloat(qs('#threshold-price-low').value),
      price_high_threshold: parseFloat(qs('#threshold-price-high').value)
    };
    await api(`/question-config/lot/${currentLot.id}/thresholds`, { method: 'PUT', body });
    alert('✅ Seuils sauvegardés');
  } catch (err) {
    alert('❌ Erreur: ' + err.message);
  }
}

async function generateQuestions(){
  if (!currentLot || !currentRound) return;
  try {
    const result = await api(`/question-config/lot/${currentLot.id}/generate`, { 
      method: 'POST',
      body: { round_id: currentRound.id }
    });
    alert(`✅ ${result.generated} fiche(s) question générée(s)`);
    await refreshQuestions();
  } catch (err) {
    alert('❌ Erreur: ' + err.message);
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
    
    // Télécharger directement en ouvrant l'URL
    window.location.href = API_BASE + url;
  } catch (err) {
    alert('❌ Erreur: ' + err.message);
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
    
    const questions = await api(url);
    
    const listDiv = qs('#questions-list');
    if (questions.length === 0) {
      listDiv.innerHTML = '<p class="muted" style="padding:20px;text-align:center">Aucune fiche question trouvée</p>';
      return;
    }
    
    let html = '<table><thead><tr><th>Entreprise</th><th>Article</th><th>Type</th><th>Question</th><th>Écart</th><th>MOE</th><th>Offre</th><th>Réponse</th><th>Statut</th><th>Actions</th></tr></thead><tbody>';
    
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
          <td><textarea data-qid="${q.id}" style="width:200px;height:60px;padding:4px" placeholder="Réponse...">${q.answer || ''}</textarea></td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn-answer" data-qid="${q.id}" data-status="answered" style="padding:4px 8px;font-size:12px">✓</button>
            <button class="btn-dismiss" data-qid="${q.id}" data-status="dismissed" style="padding:4px 8px;font-size:12px">✗</button>
          </td>
        </tr>
      `;
    }
    
    html += '</tbody></table>';
    listDiv.innerHTML = html;
    
    // Bind actions
    qsa('.btn-answer, .btn-dismiss').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const qid = e.target.dataset.qid;
        const status = e.target.dataset.status;
        const textarea = qs(`textarea[data-qid="${qid}"]`);
        const answer = textarea ? textarea.value.trim() : '';
        
        try {
          await api(`/question-config/question/${qid}`, {
            method: 'PUT',
            body: { answer, status }
          });
          await refreshQuestions();
        } catch (err) {
          alert('❌ Erreur: ' + err.message);
        }
      });
    });
  } catch (err) {
    console.error('Erreur chargement questions:', err);
    alert('❌ Erreur: ' + err.message);
  }
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

async function refreshCompare(){
  if (!currentLot) return;
  const data = await api('/lots/'+currentLot.id+'/table');
  const head = qs('#compare-head'), body = qs('#compare-body'); head.innerHTML=''; body.innerHTML='';
  let h1 = `<tr><th rowspan="2" class="sticky-col">Num</th><th rowspan="2" class="sticky-col2">Désignation</th><th rowspan="2">Unité</th><th colspan="3" class="moe-col">MOE</th>`;
  for (const c of data.companies) h1 += `<th colspan="5" class="company-col">${c.name}</th>`; h1 += '</tr>';
  let h2 = `<tr><th>Qté</th><th>PU</th><th>Mt</th>`; for (let i=0;i<data.companies.length;i++) h2 += '<th>Unité</th><th>Qté</th><th>PU</th><th>Mt</th><th>ΔPU</th>'; h2 += '</tr>';
  head.innerHTML = h1 + h2;
  for (const r of data.rows){
    let tr = `<tr><td class="sticky-col">${r.num||''}</td><td class="sticky-col2">${r.designation||''}</td><td>${r.unit||''}</td><td>${fmtNum(r.moe.qty)}</td><td>${fmtEuro(r.moe.pu)}</td><td>${fmtEuro(r.moe.mt)}</td>`;
    for (const c of r.companies){ tr += `<td>${c.u||''}</td><td>${fmtNum(c.qty)}</td><td>${fmtEuro(c.pu)}</td><td>${fmtEuro(c.mt)}</td><td>${fmtPct(c.delta_pu_pct)}</td>`; }
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

    // Validation et conversion PU MOE
    if (moePu !== '') {
      const parsedPu = parseNum(moePu);
      if (isNaN(parsedPu)) {
        alert(`Erreur: Le PU MOE de la ligne "${designation || '(vide)'}" n'est pas un nombre valide.\nValeur saisie: "${moePu}"`);
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
          alert(`Erreur: Le PU de ${companyName} pour la ligne "${designation || '(vide)'}" n'est pas un nombre valide.\nValeur saisie: "${offerPu}"`);
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
    
    // Rafraîchir le récapitulatif du tour si on est dans un lot de ce tour
    if (currentRound) {
      await loadRoundSummary();
    }
    
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

  // Navigation principale
  qsa('.nav-btn').forEach(b => b.addEventListener('click', () => !b.disabled && activateTab(b.dataset.tab)));

  // Sous-onglets des tours (lots, config, questions)
  qsa('.tour-tab-btn').forEach(b => b.addEventListener('click', () => activateTourTab(b.dataset.tourTab)));

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

  // projets / lots
  qs('#create-project').addEventListener('click', async ()=>{ try{
    const body={ name:qs('#proj-name').value.trim(), reference:qs('#proj-ref').value.trim(), client:qs('#proj-client').value.trim(), location:qs('#proj-location').value.trim() };
    if(!body.name) return alert('Nom requis');
    await api('/projects',{method:'POST',body});
    qsa('#proj-name,#proj-ref,#proj-client,#proj-location').forEach(i=>i.value='');
    await refreshProjects();
  }catch(e){ alert(e.message);} });

  // Gestion des tours
  qs('#add-round')?.addEventListener('click', createRound);

  qs('#add-lot').addEventListener('click', async ()=>{ try{
    if(!currentProject) return alert('Ouvrir un projet');
    if(!currentRound) return alert('Sélectionner un tour d\'abord');
    const code=qs('#lot-code').value.trim(); const name=qs('#lot-name').value.trim();
    if(!name) return alert('Nom du lot requis');
    await api(`/projects/${currentProject.id}/lots`,{method:'POST',body:{code,name}});
    qsa('#lot-code,#lot-name').forEach(i=>i.value=''); 
    await loadLotsForRound();
  }catch(e){ alert(e.message);} });

  // Config questions projet
  qs('#save-project-questions').addEventListener('click', saveProjectQuestionConfig);
  
  // Fiches questions lot
  qs('#save-thresholds').addEventListener('click', saveLotThresholds);
  qs('#generate-questions').addEventListener('click', generateQuestions);
  qs('#refresh-questions').addEventListener('click', refreshQuestions);
  qs('#export-questions-excel').addEventListener('click', exportQuestionsExcel);
  qs('#filter-company').addEventListener('change', refreshQuestions);
  qs('#filter-status').addEventListener('change', refreshQuestions);

  renderSheetBindings();
}

document.addEventListener('DOMContentLoaded', () => { bindUI(); if (token) showDashboard(); });
