/* ================================================================
 * Options d'un lot — tableur d'édition + comparatif.
 *
 * Script classique chargé AVANT app.js : les fonctions et l'état
 * ci-dessous sont globaux et consommés par app.js (loadLotOptions,
 * setupOptionsSheetControls, renderOptionsSheetTable,
 * renderOptionsCompareTable, flushOptionsAutosave, formatOptionNum...).
 * Inversement, ce module utilise à l'exécution les helpers globaux
 * d'app.js (qs, api, showNotify, parseNum, refreshCompare, etc.).
 *
 * Principes anti-perte de données :
 *  - `currentOptionId` est la source de vérité de la sélection (le
 *    <select> n'est qu'une vue) : la sélection survit aux rechargements.
 *  - Le modèle `optionsSheetRows` est tenu à jour à chaque frappe ; la
 *    sauvegarde envoie le modèle (pas de relecture DOM fragile).
 *  - Chaque ligne envoyée porte son `index` ; le serveur le renvoie pour
 *    associer les ids créés sans risque de décalage.
 *  - Changement d'option = flush de l'autosave PUIS rechargement serveur.
 *  - Les lignes ne sont jamais supprimées côté serveur par la sauvegarde
 *    groupée : seule la corbeille (DELETE explicite) supprime.
 *  - L'ajout de ligne est purement local ; l'article n'est créé en base
 *    que lorsqu'il a du contenu (fini les articles vides).
 * ================================================================ */

let lotOptions = [];              // [{ id, designation, items: [...] }]
let currentOptionId = null;       // option affichée dans le tableur
let optionsColModel = [];
let optionsSheetRows = [];
let optionsSheetDelegatesAttached = false;
let hasUnsavedOptionsChanges = false;
let isSavingOptions = false;
let optionsChangeGen = 0;

/* ================= Helpers ================= */

function formatOptionNum(num) {
  const s = String(num ?? '').trim();
  return s ? `O${s}` : '';
}

function parseOptionNum(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  return s.replace(/^O\s*/i, '').trim();
}

/** Sélection courante, revalidée contre lotOptions (fallback: 1re option) */
function resolveCurrentOptionId() {
  if (currentOptionId != null && lotOptions.some(o => Number(o.id) === Number(currentOptionId))) {
    return Number(currentOptionId);
  }
  currentOptionId = lotOptions[0]?.id != null ? Number(lotOptions[0].id) : null;
  return currentOptionId;
}

function makeBlankOptionsRow(optionId) {
  const opt = lotOptions.find(o => Number(o.id) === Number(optionId));
  const row = {
    item_id: null,
    option_id: Number(optionId),
    option_designation: opt?.designation || '',
    num: '', designation: '', unit: '',
    moe: { qty: '', pu: '' },
    offers: {}
  };
  for (const c of lotCompanies) row.offers[c.id] = { u: '', qty: '', pu: '' };
  return row;
}

function optionsRowHasContent(row) {
  if (!row) return false;
  if ((row.num || '').trim() || (row.designation || '').trim() || (row.unit || '').trim()) return true;
  if ((row.moe?.qty ?? '') !== '' || (row.moe?.pu ?? '') !== '') return true;
  for (const o of Object.values(row.offers || {})) {
    if ((o?.qty ?? '') !== '' || (o?.pu ?? '') !== '' || (o?.u ?? '') !== '') return true;
  }
  return false;
}

/* ================= Chargement ================= */

async function loadLotOptions() {
  if (!currentLot || !currentRound) return;
  try {
    const options = await api(`/options/lot/${currentLot.id}?round_id=${currentRound.id}`);
    lotOptions = Array.isArray(options) ? options.map(opt => ({ ...opt })) : [];
    resolveCurrentOptionId();
    const optSheet = qs('#options-sheet-view');
    if (optSheet && !optSheet.classList.contains('hidden')) {
      setupOptionsSheetControls();
      renderOptionsSheetTable();
    }
  } catch (err) {
    console.error('Erreur chargement options:', err);
  }
}

/** Force la sauvegarde des modifications en attente (appelé avant navigation) */
async function flushOptionsAutosave() {
  if (hasUnsavedOptionsChanges) {
    await autoSaveOptionsGrid();
  }
}

/* ================= Contrôles (select + boutons) ================= */

function setupOptionsSheetControls() {
  const sel = qs('#options-add-select');
  const addBtn = qs('#options-add-btn');
  const createBtn = qs('#options-create-btn');
  const renameBtn = qs('#options-rename-btn');
  const deleteBtn = qs('#options-delete-btn');
  if (!sel || !addBtn) return;

  // Repeupler le sélecteur en restaurant la sélection courante
  sel.innerHTML = '';
  for (const opt of lotOptions) {
    const o = document.createElement('option');
    o.value = String(opt.id);
    o.textContent = opt.designation;
    sel.appendChild(o);
  }
  const selectedId = resolveCurrentOptionId();
  if (selectedId != null) sel.value = String(selectedId);

  const readOnly = isVisionneur();
  const hasOptions = lotOptions.length > 0;
  addBtn.disabled = !hasOptions || readOnly;
  if (renameBtn) renameBtn.disabled = !hasOptions || readOnly;
  if (deleteBtn) deleteBtn.disabled = !hasOptions || readOnly;
  if (readOnly) {
    if (createBtn) createBtn.style.display = 'none';
    if (renameBtn) renameBtn.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';
  }

  if (createBtn) {
    createBtn.onclick = async () => {
      if (isVisionneur()) return;
      if (!currentRound?.id) {
        showNotify({ title: 'Erreur', message: 'Sélectionnez un tour avant de créer une option.', type: 'error' });
        return;
      }
      const design = prompt('Désignation de l\'option:');
      if (!design || !design.trim()) return;
      try {
        await flushOptionsAutosave();
        const created = await api(`/options/lot/${currentLot.id}`, {
          method: 'POST', body: { round_id: currentRound.id, designation: design.trim() }
        });
        if (created?.id != null) currentOptionId = Number(created.id);
        await loadLotOptions();
        await refreshCompare({ silent: true });
      } catch (err) {
        showNotify({ title: 'Erreur', message: err.message, type: 'error' });
      }
    };
  }

  if (renameBtn) {
    renameBtn.onclick = async () => {
      if (isVisionneur()) return;
      const optionId = resolveCurrentOptionId();
      if (!optionId) return;
      const opt = lotOptions.find(o => Number(o.id) === optionId);
      const nextName = prompt('Nouveau nom de l\'option:', opt?.designation || '');
      if (!nextName || !nextName.trim()) return;
      try {
        const updated = await api(`/options/${optionId}`, {
          method: 'PUT',
          body: { designation: nextName.trim() }
        });
        if (opt) opt.designation = updated?.designation || nextName.trim();
        for (const row of optionsSheetRows) {
          if (Number(row.option_id) === optionId) row.option_designation = opt?.designation || '';
        }
        setupOptionsSheetControls();
        renderOptionsSheetTable(false);
        await refreshCompare({ silent: true });
      } catch (err) {
        showNotify({ title: 'Erreur', message: err.message, type: 'error' });
      }
    };
  }

  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (isVisionneur()) return;
      const optionId = resolveCurrentOptionId();
      if (!optionId) return;
      const opt = lotOptions.find(o => Number(o.id) === optionId);
      showDeleteConfirmation({
        title: 'Supprimer une option',
        message: `Confirmer la suppression de l'option "${opt?.designation || 'sélectionnée'}" ?`,
        extra: '<strong>Attention:</strong> tous les articles, montants MOE, offres et questions rattachés à cette option seront supprimés.',
        onConfirm: async () => {
          try {
            await api(`/options/${optionId}`, { method: 'DELETE', showLoader: false });
            selectedRoundOptions.delete(optionId);
            const idx = lotOptions.findIndex(o => Number(o.id) === optionId);
            lotOptions = lotOptions.filter(o => Number(o.id) !== optionId);
            // Sélectionner l'option suivante (ou la précédente en fin de liste)
            currentOptionId = lotOptions[Math.min(idx, lotOptions.length - 1)]?.id ?? null;
            hasUnsavedOptionsChanges = false;
            setupOptionsSheetControls();
            renderOptionsSheetTable();
            await refreshCompare({ silent: true });
            showNotify({ title: 'Option', message: 'Option supprimée', type: 'success' });
          } catch (err) {
            showNotify({ title: 'Erreur', message: err.message, type: 'error' });
          }
        }
      });
    };
  }

  // Changement d'option : sauvegarder d'abord, puis recharger depuis le
  // serveur (jamais de ré-affichage d'un modèle local périmé).
  sel.onchange = async () => {
    await flushOptionsAutosave();
    currentOptionId = Number(sel.value) || null;
    await loadLotOptions();
  };

  addBtn.onclick = () => addOptionsRowLocal();
  sel.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addOptionsRowLocal();
    }
  };
}

/** Ajoute une ligne vide locale (l'article n'est créé en base qu'une fois rempli) */
function addOptionsRowLocal() {
  if (isVisionneur()) return;
  const optionId = resolveCurrentOptionId();
  if (!optionId) {
    showNotify({ title: 'Options', message: 'Créez d\'abord une option.', type: 'info' });
    return;
  }
  const wasEmpty = optionsSheetRows.length === 0;
  const row = makeBlankOptionsRow(optionId);
  optionsSheetRows.push(row);
  if (wasEmpty) {
    renderOptionsSheetTable(false);
  } else {
    appendOptionsRowDOM(optionsSheetRows.length - 1, row);
  }
  focusOptionsCell(optionsSheetRows.length - 1, 0);
}

/* ================= Modèle du tableur ================= */

function buildOptionsColModel() {
  const entrepriseMode = isEntreprise();
  optionsColModel = [
    { key: 'num',         editable: true },
    { key: 'designation', editable: true, wide: true },
    { key: 'unit',        editable: true }
  ];
  if (!entrepriseMode) {
    optionsColModel.push(
      { key: 'moe.qty', editable: true,  cls: 'moe-col' },
      { key: 'moe.pu',  editable: true,  cls: 'moe-col' },
      { key: 'moe.mt',  editable: false, cls: 'moe-col' }
    );
  }
  for (const c of lotCompanies) {
    optionsColModel.push({ key: `c.${c.id}.u`,   editable: true  });
    optionsColModel.push({ key: `c.${c.id}.qty`, editable: true  });
    optionsColModel.push({ key: `c.${c.id}.pu`,  editable: true  });
    optionsColModel.push({ key: `c.${c.id}.mt`,  editable: false });
  }
}

function buildOptionsSheetModel() {
  optionsSheetRows = [];
  const selectedOptionId = resolveCurrentOptionId();
  if (selectedOptionId == null) return;
  for (const opt of lotOptions) {
    if (Number(opt.id) !== selectedOptionId) continue;
    for (const item of (opt.items || [])) {
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
      for (const c of lotCompanies) {
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

/** Reporte le modèle du tableur dans lotOptions (comparatif à jour sans refetch) */
function syncOptionsRowsIntoLotOptions() {
  const rowsByOption = new Map();
  for (const row of optionsSheetRows) {
    if (!row.option_id) continue;
    const key = Number(row.option_id);
    if (!rowsByOption.has(key)) rowsByOption.set(key, []);
    rowsByOption.get(key).push(row);
  }
  for (const [optionId, rows] of rowsByOption) {
    const opt = lotOptions.find(o => Number(o.id) === optionId);
    if (!opt) continue;
    opt.items = rows
      .filter(r => r.item_id != null)
      .map(r => ({
        id: r.item_id,
        num: r.num || '',
        designation: r.designation || '',
        unit: r.unit || '',
        moe_qty: (r.moe?.qty ?? '') !== '' ? parseNum(r.moe.qty) : null,
        moe_unit_price: (r.moe?.pu ?? '') !== '' ? parseNum(r.moe.pu) : null,
        offers: lotCompanies
          .map(c => {
            const o = r.offers?.[c.id] || {};
            return {
              company_id: Number(c.id),
              round_id: currentRound?.id != null ? Number(currentRound.id) : null,
              qty: (o.qty ?? '') !== '' ? parseNum(o.qty) : null,
              unit_price: (o.pu ?? '') !== '' ? parseNum(o.pu) : null,
              unit: (o.u ?? '') !== '' ? o.u : null
            };
          })
          .filter(o => o.qty != null || o.unit_price != null || o.unit != null)
      }));
  }
}

/* ================= Cellules ================= */

function optionsValueForCell(row, key) {
  if (!row) return '';
  if (key === 'num') return formatOptionNum(row.num);
  if (key === 'designation') return `${row.option_designation} — ${row.designation}`;
  if (key === 'unit') return row.unit ?? '';
  if (key === 'moe.qty') return row.moe?.qty ?? '';
  if (key === 'moe.pu')  return row.moe?.pu  ?? '';
  if (key === 'moe.mt')  return amountOf(row.moe?.qty, row.moe?.pu);
  if (key.startsWith('c.')) {
    const [, cid, sub] = key.split('.');
    const o = row.offers?.[cid] || {};
    if (sub === 'mt') return amountOf(o.qty, o.pu);
    return o[sub] ?? '';
  }
  return '';
}

function getOptionsCell(r, c) {
  const rowEl = qsa('#options-sheet-body tr')[r];
  if (!rowEl) return null;
  return rowEl.querySelector(`td[data-c="${c}"]`) || null;
}

function setOptionsCell(r, c, text, updateDOM = true) {
  const key = optionsColModel[c]?.key;
  const row = optionsSheetRows[r];
  if (!key || !row) return;
  if (updateDOM) {
    const td = getOptionsCell(r, c);
    if (td) td.textContent = text ?? '';
  }
  if (key === 'num') row.num = parseOptionNum(text);
  else if (key === 'designation') {
    let d = text || '';
    const sep = '—';
    if (d.includes(sep)) d = d.split(sep).slice(1).join(sep).trim();
    row.designation = d;
  }
  else if (key === 'unit') row.unit = text;
  else if (key === 'moe.qty') row.moe.qty = text;
  else if (key === 'moe.pu')  row.moe.pu  = text;
  else if (key.startsWith('c.')) {
    const [, cid, sub] = key.split('.');
    row.offers[cid] = row.offers[cid] || { u: '', qty: '', pu: '' };
    if (sub !== 'mt') row.offers[cid][sub] = text;
  }
}

function recalcOptionsAmountsRow(r) {
  const row = optionsSheetRows[r];
  if (!row) return;
  const setMt = (key, value) => {
    const c = optionsColModel.findIndex(x => x.key === key);
    if (c < 0) return;
    const td = getOptionsCell(r, c);
    if (td) td.textContent = value;
  };
  setMt('moe.mt', amountOf(row.moe?.qty, row.moe?.pu));
  for (const c of lotCompanies) {
    const o = row.offers?.[c.id] || {};
    setMt(`c.${c.id}.mt`, amountOf(o.qty, o.pu));
  }
}

/* ================= Rendu ================= */

function appendOptionsRowDOM(rIndex, data) {
  const body = qs('#options-sheet-body');
  if (!body) return;
  const tr = document.createElement('tr');
  const tdActions = document.createElement('td');
  tdActions.className = 'cell-readonly options-row-actions';
  tdActions.style.cssText = 'text-align:center;padding:4px 8px;width:44px';
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn ghost btn-delete-option-row';
  deleteBtn.dataset.r = String(rIndex);
  deleteBtn.title = 'Supprimer cette ligne option';
  deleteBtn.innerHTML = icon('trash', 'icon-only');
  if (isVisionneur()) deleteBtn.disabled = true;
  tdActions.appendChild(deleteBtn);
  tr.appendChild(tdActions);
  for (let c = 0; c < optionsColModel.length; c++) {
    const col = optionsColModel[c];
    const td = document.createElement('td');
    td.dataset.r = String(rIndex);
    td.dataset.c = String(c);
    if (col.editable && !isVisionneur()) td.contentEditable = 'true';
    else td.classList.add('cell-readonly');
    if (col.wide) td.style.minWidth = '320px';
    if (col.key.startsWith('c.') && col.key.endsWith('.u')) {
      const [, cid] = col.key.split('.');
      applyCompanyColumnStyle(td, cid);
    }
    td.textContent = optionsValueForCell(data, col.key);
    tr.appendChild(td);
  }
  body.appendChild(tr);
}

/**
 * Rend le tableur options.
 * @param {boolean} rebuildModel - false pour re-rendre le modèle en l'état
 *   (préserve les lignes locales non sauvegardées, ex: après suppression d'une ligne)
 */
function renderOptionsSheetTable(rebuildModel = true) {
  const head = qs('#options-sheet-head');
  const body = qs('#options-sheet-body');
  if (!head || !body) return;

  buildOptionsColModel();
  if (rebuildModel) buildOptionsSheetModel();

  head.innerHTML = '';
  body.innerHTML = '';

  if (optionsSheetRows.length === 0) {
    const message = lotOptions.length === 0
      ? 'Aucune option pour ce tour — créez-en une ou importez une DPGF contenant des options.'
      : 'Aucun article dans cette option — « Ajouter article » pour commencer.';
    body.innerHTML = `<tr><td colspan="${optionsColModel.length + 1}" style="text-align:center;padding:16px;color:var(--muted)">${message}</td></tr>`;
    return;
  }

  // En-tête ligne 1 : colonnes de base (rowSpan=2) + groupes entreprise
  const tr1 = document.createElement('tr');
  const thActions = document.createElement('th');
  thActions.textContent = '';
  thActions.rowSpan = 2;
  thActions.style.cssText = 'text-align:center;width:44px';
  tr1.appendChild(thActions);
  const baseCount = optionsColModel.findIndex(col => col.key.startsWith('c.'));
  const actualBaseCount = baseCount === -1 ? optionsColModel.length : baseCount;
  for (let i = 0; i < actualBaseCount; i++) {
    const col = optionsColModel[i];
    const th = document.createElement('th');
    th.textContent = headerLabelFor(col.key);
    th.rowSpan = 2;
    if (col.cls) th.classList.add(col.cls);
    tr1.appendChild(th);
  }
  for (let i = actualBaseCount; i < optionsColModel.length; i += 4) {
    const [, cid] = optionsColModel[i].key.split('.');
    const th = document.createElement('th');
    th.textContent = companyNameFor(cid);
    th.colSpan = 4;
    th.classList.add('company-col');
    applyCompanyColumnStyle(th, cid, true);
    tr1.appendChild(th);
  }
  head.appendChild(tr1);

  // En-tête ligne 2 : sous-colonnes par entreprise
  const tr2 = document.createElement('tr');
  for (let i = actualBaseCount; i < optionsColModel.length; i++) {
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

  for (let r = 0; r < optionsSheetRows.length; r++) {
    appendOptionsRowDOM(r, optionsSheetRows[r]);
  }

  attachOptionsSheetDelegates();
  for (let r = 0; r < optionsSheetRows.length; r++) recalcOptionsAmountsRow(r);
}

/* ================= Suppression de ligne ================= */

function deleteOptionsRow(rIndex) {
  const row = optionsSheetRows[rIndex];
  if (!row) return;
  const itemId = row.item_id ? Number(row.item_id) : null;

  const removeLocalRow = () => {
    optionsSheetRows.splice(rIndex, 1);
    if (itemId) {
      const opt = lotOptions.find(o => Number(o.id) === Number(row.option_id));
      if (opt) opt.items = (opt.items || []).filter(item => Number(item.id) !== itemId);
    }
    renderOptionsSheetTable(false);
  };

  // Ligne locale jamais enregistrée : suppression directe sans confirmation
  if (!itemId) {
    removeLocalRow();
    return;
  }

  showDeleteConfirmation({
    title: 'Supprimer une ligne option',
    message: 'Confirmer la suppression de cette ligne option ?',
    onConfirm: async () => {
      try {
        await api(`/options/items/${itemId}`, { method: 'DELETE', showLoader: false });
        removeLocalRow();
        await refreshCompare({ silent: true });
        showNotify({ title: 'Option', message: 'Ligne supprimée', type: 'success' });
      } catch (err) {
        showNotify({ title: 'Erreur', message: err.message, type: 'error' });
      }
    }
  });
}

/* ================= Navigation / saisie ================= */

/** Crée des lignes locales jusqu'à n lignes (utilisé par le collage multi-lignes) */
function ensureOptionsRows(n) {
  const optionId = resolveCurrentOptionId();
  if (!optionId) return;
  while (optionsSheetRows.length < n) {
    const row = makeBlankOptionsRow(optionId);
    optionsSheetRows.push(row);
    appendOptionsRowDOM(optionsSheetRows.length - 1, row);
  }
}

function focusOptionsCell(r, c) {
  if (optionsSheetRows.length === 0) return;
  if (r < 0) r = 0;
  if (r >= optionsSheetRows.length) r = optionsSheetRows.length - 1;
  if (c < 0) c = 0;
  if (c >= optionsColModel.length) c = optionsColModel.length - 1;
  let guard = 0;
  while (!optionsColModel[c]?.editable && guard++ < 100) c++;
  if (c >= optionsColModel.length) c = optionsColModel.findIndex(x => x.editable);
  const td = getOptionsCell(r, c);
  if (td) {
    td.focus();
    const range = document.createRange(); range.selectNodeContents(td); range.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  }
}

function markOptionsChanged() {
  hasUnsavedOptionsChanges = true;
  optionsChangeGen++;
  debounceAutoSave('options-grid', autoSaveOptionsGrid, 800);
}

/* ================= Sauvegarde ================= */

async function autoSaveOptionsGrid() {
  if (!currentLot || !currentRound?.id || isVisionneur()) return;
  if (isSavingOptions || !hasUnsavedOptionsChanges) return;
  isSavingOptions = true;
  const genAtStart = optionsChangeGen;
  try {
    const rows = [];
    for (let r = 0; r < optionsSheetRows.length; r++) {
      const data = optionsSheetRows[r];
      if (!data.option_id) continue;
      // Les lignes neuves sans contenu ne sont pas envoyées (pas d'article vide en base)
      if (!data.item_id && !optionsRowHasContent(data)) continue;
      const row = {
        index: r,
        item_id: data.item_id || null,
        option_id: data.option_id,
        num: data.num ?? '',
        designation: data.designation ?? '',
        unit: data.unit ?? '',
        moe: { qty: data.moe?.qty ?? '', pu: data.moe?.pu ?? '' },
        offers: {}
      };
      for (const c of lotCompanies) {
        const o = data.offers?.[c.id] || {};
        row.offers[c.id] = { u: o.u ?? '', qty: o.qty ?? '', pu: o.pu ?? '' };
      }
      rows.push(row);
    }

    const result = await api(`/options/lot/${currentLot.id}/save-grid`, {
      method: 'POST',
      body: { rows, round_id: currentRound.id },
      showLoader: false
    });

    // Associer les ids créés via l'index explicite renvoyé par le serveur
    for (const it of (result?.items || [])) {
      if (it?.index == null || it?.id == null) continue;
      const row = optionsSheetRows[it.index];
      if (row && !row.item_id && Number(row.option_id) === Number(it.option_id)) {
        row.item_id = Number(it.id);
      }
    }

    if (optionsChangeGen === genAtStart) {
      hasUnsavedOptionsChanges = false;
    }
    syncOptionsRowsIntoLotOptions();
    await refreshCompare({ silent: true });
  } catch (err) {
    console.error('Erreur autosave options:', err);
    showNotify({ title: 'Options', message: 'Échec de la sauvegarde automatique des options.', type: 'error' });
  } finally {
    isSavingOptions = false;
    if (optionsChangeGen !== genAtStart) {
      debounceAutoSave('options-grid', autoSaveOptionsGrid, 200);
    }
  }
}

/* ================= Délégation d'événements ================= */

function attachOptionsSheetDelegates() {
  if (optionsSheetDelegatesAttached) return;
  const body = qs('#options-sheet-body');
  if (!body) return;

  body.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-delete-option-row');
    if (!btn) return;
    e.preventDefault();
    if (isVisionneur()) return;
    const r = Number(btn.dataset.r);
    if (Number.isInteger(r)) deleteOptionsRow(r);
  });

  body.addEventListener('input', (e) => {
    const td = e.target.closest('td'); if (!td) return;
    const r = Number(td.dataset.r), c = Number(td.dataset.c);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return;
    setOptionsCell(r, c, td.textContent.trim(), false);
    recalcOptionsAmountsRow(r);
    markOptionsChanged();
  });

  body.addEventListener('keydown', (e) => {
    const td = e.target.closest('td'); if (!td) return;
    const r = Number(td.dataset.r), c = Number(td.dataset.c);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return;

    const navKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Tab'];
    if (!navKeys.includes(e.key)) return;

    let nr = r, nc = c;
    if (e.key === 'ArrowLeft')  nc = c - 1;
    if (e.key === 'ArrowRight') nc = c + 1;
    if (e.key === 'ArrowUp')    nr = r - 1;
    if (e.key === 'ArrowDown')  nr = r + 1;
    if (e.key === 'Tab')        nc = c + (e.shiftKey ? -1 : 1);

    if (e.key === 'Enter') {
      e.preventDefault();
      // Entrée sur la dernière ligne → nouvelle ligne locale
      if (r + 1 >= optionsSheetRows.length) {
        if (isVisionneur()) return;
        addOptionsRowLocal();
        focusOptionsCell(optionsSheetRows.length - 1, c);
      } else {
        focusOptionsCell(r + 1, c);
      }
      return;
    }

    e.preventDefault();
    focusOptionsCell(nr, nc);
  }, true);

  // Collage multi-lignes/multi-colonnes
  body.addEventListener('paste', (e) => {
    const td = e.target.closest('td'); if (!td) return;
    e.preventDefault();
    if (isVisionneur()) return;
    const startR = Number(td.dataset.r), startC = Number(td.dataset.c);
    if (!Number.isInteger(startR) || !Number.isInteger(startC)) return;
    const text = e.clipboardData.getData('text/plain') || '';
    const delim = detectDelimiter(text);
    const lines = text.replace(/\r/g, '').split('\n');
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const grid = lines.map(l => l.split(delim));
    ensureOptionsRows(startR + grid.length);
    for (let i = 0; i < grid.length; i++) {
      let col = startC;
      for (let j = 0; j < grid[i].length; j++) {
        let guard = 0;
        while (col < optionsColModel.length && !optionsColModel[col].editable && guard++ < 100) col++;
        if (col >= optionsColModel.length) break;
        let val = String(grid[i][j]).trim();
        const colKey = optionsColModel[col]?.key || '';
        const isNum = colKey.includes('qty') || colKey.includes('pu');
        if (isNum && val !== '') { const p = parseNum(val); if (Number.isFinite(p)) val = String(p); }
        setOptionsCell(startR + i, col, val, true);
        col++;
      }
      recalcOptionsAmountsRow(startR + i);
    }
    markOptionsChanged();
  }, true);

  optionsSheetDelegatesAttached = true;
}

/* ================= Comparatif options (sous le tableau principal) ================= */

function renderOptionsCompareTable(companies, entrepriseMode) {
  const head = qs('#options-compare-head');
  const body = qs('#options-compare-body');
  if (!head || !body) return;
  head.innerHTML = '';
  body.innerHTML = '';

  // Construire une liste d'items pour toutes les options
  const items = [];
  for (const opt of lotOptions) {
    for (const item of (opt.items || [])) {
      items.push({ option: opt, item });
    }
  }
  if (items.length === 0) {
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
  for (let i = 0; i < companies.length; i++) {
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

  for (const { option: opt, item } of items) {
    const numLabel = formatOptionNum(item.num);
    let tr = `<tr><td class="sticky-col">${numLabel}</td><td class="sticky-col2"><span class="muted">${opt.designation}</span> — ${item.designation || ''}</td><td>${item.unit || ''}</td>`;
    if (!entrepriseMode) {
      const moeQty = parseNum(item.moe_qty); const moePu = parseNum(item.moe_unit_price);
      const moeMt = (moeQty !== null && moePu !== null) ? moeQty * moePu : null;
      tr += `<td class="moe-border">${fmtNum(moeQty)}</td><td>${fmtEuro(moePu)}</td><td>${fmtEuro(moeMt)}</td>`;
      if (moeMt != null) totalMoe += moeMt;
    }
    for (const c of companies) {
      const off = (item.offers || []).find(o => Number(o.company_id) === Number(c.id));
      const qty = off?.qty || 0; const pu = off?.unit_price || 0; const mt = (parseNum(qty) || 0) * (parseNum(pu) || 0);
      const offUnit = off?.unit || '';
      if (entrepriseMode) {
        tr += `<td class="company-border">${offUnit}</td><td>${fmtNum(qty)}</td><td>${fmtEuro(pu)}</td><td>${fmtEuro(mt)}</td>`;
      } else {
        const moeQty = parseNum(item.moe_qty);
        const moePu = parseNum(item.moe_unit_price);
        const deltaQty = (Number.isFinite(moeQty) && Number.isFinite(parseNum(qty))) ? (moeQty - parseNum(qty)) : null;
        const deltaQtyClass = deltaQty !== null ? (deltaQty > 0 ? 'delta-positive' : deltaQty < 0 ? 'delta-negative' : '') : '';
        const deltaPuPct = (Number.isFinite(moePu) && moePu !== 0 && Number.isFinite(parseNum(pu)))
          ? ((parseNum(pu) - moePu) / moePu) * 100
          : null;
        tr += `<td class="company-border">${offUnit}</td><td>${fmtNum(qty)}</td><td class="${deltaQtyClass}">${deltaQty !== null ? fmtNum(deltaQty) : ''}</td><td>${fmtEuro(pu)}</td><td>${fmtEuro(mt)}</td><td>${fmtPct(deltaPuPct)}</td>`;
      }
      if (mt) totalsByCompany[c.id] = (totalsByCompany[c.id] || 0) + mt;
    }
    tr += '</tr>';
    body.insertAdjacentHTML('beforeend', tr);
  }

  // Ligne totaux options
  let totalRow = `<tr class="total-row"><td class="sticky-col"><strong>TOTAL OPTIONS</strong></td><td class="sticky-col2"></td><td></td>`;
  if (!entrepriseMode) totalRow += `<td class="moe-border"></td><td></td><td><strong>${fmtEuro(totalMoe)}</strong></td>`;
  for (const c of companies) {
    const t = totalsByCompany[c.id] || 0;
    if (entrepriseMode) totalRow += `<td class="company-border"></td><td></td><td></td><td><strong>${fmtEuro(t)}</strong></td>`;
    else totalRow += `<td class="company-border"></td><td></td><td></td><td></td><td><strong>${fmtEuro(t)}</strong></td><td></td>`;
  }
  totalRow += '</tr>';
  body.insertAdjacentHTML('beforeend', totalRow);
}
