'use strict';
/* ============================================================
   Gestion des Amendes — Tropical Bois / KESHO
   Front-end multi-utilisateurs : toutes les données vivent sur
   le serveur (API REST). Ce fichier remplace l'ancienne logique
   basée sur localStorage par des appels fetch() authentifiés.
   ============================================================ */

/* ------------------------- ETAT GLOBAL ------------------------- */
const TOKEN_KEY = 'amendes_token_v1';
const ACTIVE_COMPANY_KEY = 'amendes_active_company_v2';

let TOKEN = localStorage.getItem(TOKEN_KEY) || null;
let CURRENT_USER = null; // { username, role }
let currentCompany = localStorage.getItem(ACTIVE_COMPANY_KEY) || 'tb';
const COMPANIES = {
  tb:    { key:'tb',    name:'Tropical Bois', short:'TB',    hasLogo:true },
  kesho: { key:'kesho', name:'KESHO',         short:'KESHO', hasLogo:false }
};
if (!COMPANIES[currentCompany]) currentCompany = 'tb';

let DB = {
  tb:    { vehicules: [], infractions: [], catalogue: [] },
  kesho: { vehicules: [], infractions: [], catalogue: [] }
};
let editingId = null;
let pollTimer = null;

function cur(){ return DB[currentCompany]; }
function curMeta(){ return COMPANIES[currentCompany]; }
function isAdmin(){ return CURRENT_USER && CURRENT_USER.role === 'admin'; }

/* ------------------------------ API ------------------------------ */
async function api(path, options){
  options = options || {};
  const headers = Object.assign({}, options.headers || {});
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  const res = await fetch('/api' + path, Object.assign({}, options, { headers }));
  if (res.status === 401) {
    logout(true);
    throw new Error('Session expirée. Merci de vous reconnecter.');
  }
  let data = null;
  try { data = await res.json(); } catch(e){ data = null; }
  if (!res.ok) {
    throw new Error((data && data.error) || ('Erreur ' + res.status));
  }
  return data;
}

/* --------------------------- AUTHENTIFICATION --------------------------- */
function showLogin(){
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appRoot').classList.remove('ready');
  stopPolling();
}
function showApp(){
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appRoot').classList.add('ready');
}

function logout(silent){
  TOKEN = null;
  CURRENT_USER = null;
  localStorage.removeItem(TOKEN_KEY);
  showLogin();
  if (!silent) showToastRaw('Déconnecté.');
}

async function tryAutoLogin(){
  if (!TOKEN) { showLogin(); return; }
  try {
    const data = await api('/auth/me');
    CURRENT_USER = data.user;
    await afterLoginSuccess();
  } catch(e) {
    showLogin();
  }
}

async function afterLoginSuccess(){
  applyRoleUI();
  updateUserChip();
  showApp();
  updateBrandUI();
  try {
    await loadAllCompanies();
  } catch(e) {
    showToast('Impossible de charger les données depuis le serveur.');
  }
  refreshAll();
  startPolling();
}

document.getElementById('formLogin').addEventListener('submit', async function(e){
  e.preventDefault();
  const errBox = document.getElementById('loginError');
  errBox.classList.remove('show');
  const username = document.getElementById('l_username').value.trim();
  const password = document.getElementById('l_password').value;
  const btn = document.getElementById('btnLogin');
  btn.disabled = true;
  btn.textContent = 'Connexion...';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Connexion impossible.');
    TOKEN = data.token;
    CURRENT_USER = data.user;
    localStorage.setItem(TOKEN_KEY, TOKEN);
    document.getElementById('formLogin').reset();
    await afterLoginSuccess();
  } catch(err){
    errBox.textContent = err.message;
    errBox.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Se connecter';
  }
});

document.getElementById('btnLogout').addEventListener('click', ()=> logout(false));

function updateUserChip(){
  document.getElementById('chipUsername').textContent = CURRENT_USER ? CURRENT_USER.username : '—';
  const roleTag = document.getElementById('chipRole');
  roleTag.textContent = CURRENT_USER ? (CURRENT_USER.role === 'admin' ? 'Admin' : 'Utilisateur') : '—';
  roleTag.classList.toggle('user', !(CURRENT_USER && CURRENT_USER.role === 'admin'));
}

function applyRoleUI(){
  const adminOnly = document.querySelectorAll('.admin-only-toggle');
  adminOnly.forEach(el => el.style.display = isAdmin() ? '' : 'none');
  const usersPanel = document.getElementById('usersPanel');
  if (usersPanel) usersPanel.style.display = isAdmin() ? '' : 'none';
  const resetBtn = document.getElementById('btnResetAll');
  if (resetBtn) resetBtn.style.display = isAdmin() ? '' : 'none';
  const importLabel = document.getElementById('btnBackupImportLabel');
  if (importLabel) importLabel.style.display = isAdmin() ? '' : 'none';
}

/* ------------------------- MON COMPTE (mot de passe) ------------------------- */
document.getElementById('btnMyAccount').addEventListener('click', ()=>{
  document.getElementById('modalAccount').classList.add('show');
});
document.getElementById('btnCloseAccount').addEventListener('click', ()=>{
  document.getElementById('modalAccount').classList.remove('show');
  document.getElementById('formChangePassword').reset();
});
document.getElementById('formChangePassword').addEventListener('submit', async function(e){
  e.preventDefault();
  const currentPassword = document.getElementById('cp_current').value;
  const newPassword = document.getElementById('cp_new').value;
  try {
    await api('/auth/change-password', { method:'POST', body: JSON.stringify({ currentPassword, newPassword }) });
    showToast('Mot de passe mis à jour.');
    document.getElementById('modalAccount').classList.remove('show');
    this.reset();
  } catch(err){
    showToast(err.message);
  }
});

/* ------------------------------ UTILITAIRES ------------------------------ */
function uid(){ return Math.random().toString(16).slice(2,10); }
function fmtMoney(n){ return (n||0).toLocaleString('fr-FR') + ' FCFA'; }
function fmtDate(d){
  if(!d) return '—';
  const [y,m,day] = d.split('-');
  return `${day}/${m}/${y}`;
}
function todayISO(){ return new Date().toISOString().slice(0,10); }
function computeStatut(montant){ return Number(montant) > 0 ? 'Payée' : 'Non payée'; }
const DATE_DEBUT_BASE = '2025-01-01';
const NUMERO_PREFIX = 'C00000000000';
function normalizeNumero(raw){
  if(!raw) return '';
  const digits = String(raw).replace(/\D/g,'').slice(-9);
  return digits ? (NUMERO_PREFIX + digits) : '';
}
function stripNumeroPrefix(numero){
  if(!numero) return '';
  const s = String(numero);
  if(s.startsWith(NUMERO_PREFIX)) return s.slice(NUMERO_PREFIX.length);
  return s.replace(/^C/i,'');
}
function bindNumeroInput(el){
  if(!el) return;
  el.addEventListener('input', function(){
    this.value = this.value.replace(/\D/g,'').slice(0,9);
  });
}
function isoToFr(iso){
  if(!iso) return '';
  const parts = String(iso).split('-');
  if(parts.length!==3) return '';
  const [y,m,d] = parts;
  return `${d}/${m}/${y}`;
}
function frToIso(fr){
  if(!fr) return null;
  const m = String(fr).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  if(mo<1 || mo>12) return null;
  const daysInMonth = new Date(y, mo, 0).getDate();
  if(d<1 || d>daysInMonth) return null;
  const pad = n=>String(n).padStart(2,'0');
  return `${y}-${pad(mo)}-${pad(d)}`;
}
function bindDateMaskInput(el){
  if(!el) return;
  el.addEventListener('input', function(){
    const digits = this.value.replace(/\D/g,'').slice(0,8);
    let out = digits;
    if(digits.length>4) out = digits.slice(0,2)+'/'+digits.slice(2,4)+'/'+digits.slice(4);
    else if(digits.length>2) out = digits.slice(0,2)+'/'+digits.slice(2);
    this.value = out;
  });
}
function escapeAttr(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function showToastRaw(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToastRaw._t);
  showToastRaw._t = setTimeout(()=>t.classList.remove('show'), 2600);
}
function showToast(msg){ showToastRaw(msg); }

/* ============ MARQUE / SOCIETE ACTIVE ============ */
const TB_LOGO_HTML = document.getElementById('brandLogoSlot').innerHTML;
const KESHO_LOGO_HTML = `<div class="kesho-badge">KESHO</div>`;

function updateBrandUI(){
  const meta = curMeta();
  document.getElementById('brandLogoSlot').innerHTML = meta.hasLogo ? TB_LOGO_HTML : KESHO_LOGO_HTML;
  document.getElementById('brandTitle').textContent = `${meta.name} · Gestion des Amendes`;
  document.querySelectorAll('#companySwitch button').forEach(b=> b.classList.toggle('active', b.dataset.company===currentCompany));
  const note = `Vous consultez actuellement les données de <b>${meta.name}</b>. Les véhicules et l'historique de ${meta.key==='tb' ? 'KESHO' : 'Tropical Bois'} sont totalement séparés. Ces données sont partagées en temps réel avec tous les postes connectés.`;
  ['dashCompanyNote','recordCompanyNote','historyCompanyNote','adminCompanyNote'].forEach(id=>{
    document.getElementById(id).innerHTML = note;
  });
  document.getElementById('backupCompanyName').textContent = meta.name;
}

document.querySelectorAll('#companySwitch button').forEach(b=>{
  b.addEventListener('click', async ()=>{
    currentCompany = b.dataset.company;
    localStorage.setItem(ACTIVE_COMPANY_KEY, currentCompany);
    editingId = null;
    updateBrandUI();
    await loadCompanyData(currentCompany);
    refreshAll();
    showToast(`Société active : ${curMeta().name}`);
  });
});

/* ============ CHARGEMENT DES DONNEES (API) ============ */
async function loadCompanyData(company){
  const data = await api(`/companies/${company}/snapshot`);
  DB[company] = { vehicules: data.vehicules, infractions: data.infractions, catalogue: data.catalogue };
}
async function loadAllCompanies(){
  await Promise.all(Object.keys(COMPANIES).map(loadCompanyData));
}

function startPolling(){
  stopPolling();
  pollTimer = setInterval(async ()=>{
    if (editingId) return; // ne pas écraser une ligne en cours de modification
    try {
      await loadCompanyData(currentCompany);
      refreshAll();
    } catch(e) { /* silencieux : la connexion sera rétablie au prochain essai */ }
  }, 15000);
}
function stopPolling(){ if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

/* ============ ONGLETS / NAVIGATION ============ */
const TAB_LABELS = { dashboard:'Tableau de bord', record:'Enregistrement', history:'Historique', admin:'Administrateur' };
const TAB_ICONS = {
  dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="10" width="4.5" height="10.5" rx="1"/><rect x="9.75" y="5.5" width="4.5" height="15" rx="1"/><rect x="16" y="13.5" width="4.5" height="7" rx="1"/></svg>`,
  record: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.5H6.8A1.3 1.3 0 0 0 5.5 4.8v14.4A1.3 1.3 0 0 0 6.8 20.5h10.4a1.3 1.3 0 0 0 1.3-1.3V8.5L13.5 3.5Z"/><path d="M13.3 3.5V8.5H18.3"/><path d="M12 12.2v5.1M9.5 14.75h5"/></svg>`,
  history: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12.5" r="8.25"/><path d="M12 8v4.7l3.2 1.9"/><path d="M9 3.5h6"/></svg>`,
  admin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.9"/><path d="M19.4 13.1a7.6 7.6 0 0 0 0-2.2l2-1.55-2-3.44-2.4.96a7.7 7.7 0 0 0-1.9-1.1L14.8 3.5h-4l-.3 2.27a7.7 7.7 0 0 0-1.9 1.1l-2.4-.96-2 3.44 2 1.55a7.6 7.6 0 0 0 0 2.2l-2 1.55 2 3.44 2.4-.96c.57.46 1.21.83 1.9 1.1l.3 2.27h4l.3-2.27a7.7 7.7 0 0 0 1.9-1.1l2.4.96 2-3.44Z"/></svg>`
};

function buildNavMenu(){
  const menu = document.getElementById('navMenu');
  menu.innerHTML = Object.keys(TAB_LABELS).map(key=>`
    <button class="nav-item${key==='dashboard'?' active':''}" type="button" data-tab="${key}">${TAB_ICONS[key]}<span>${TAB_LABELS[key]}</span></button>
  `).join('');
  menu.querySelectorAll('.nav-item').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      selectTab(btn.dataset.tab);
      closeNavMenu();
    });
  });
}

function selectTab(tabKey){
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.tab===tabKey));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('tab-'+tabKey).classList.add('active');
  document.getElementById('navTriggerLabel').textContent = TAB_LABELS[tabKey];
  document.getElementById('navTriggerIcon').innerHTML = TAB_ICONS[tabKey];
  if(tabKey==='dashboard') renderDashboard();
  if(tabKey==='history') renderHistory();
  if(tabKey==='admin') { renderVehiculesAdmin(); renderCatalogueAdmin(); if(isAdmin()) renderUsers(); }
}

function closeNavMenu(){ document.getElementById('navDropdown').classList.remove('open'); }

buildNavMenu();
document.getElementById('navTriggerIcon').innerHTML = TAB_ICONS.dashboard;
document.getElementById('navTrigger').addEventListener('click', (e)=>{
  e.stopPropagation();
  document.getElementById('navDropdown').classList.toggle('open');
});
document.addEventListener('click', (e)=>{
  const dd = document.getElementById('navDropdown');
  if(dd.classList.contains('open') && !dd.contains(e.target)) closeNavMenu();
});
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape') closeNavMenu();
});

/* ============ SELECTS COMMUNS ============ */
function populateVehiculeSelects(){
  const options = cur().vehicules
    .slice().sort((a,b)=>a.plaque.localeCompare(b.plaque))
    .map(v=>`<option value="${escapeAttr(v.plaque)}">${escapeAttr(v.plaque)}${v.marque?(' — '+escapeAttr(v.marque)+(v.modele?' '+escapeAttr(v.modele):'')):''}</option>`).join('');
  document.getElementById('f_plaque').innerHTML = options || '<option value="">Aucun véhicule — ajoutez-en un dans Administrateur</option>';
  document.getElementById('h_plaque').innerHTML = '<option value="">Tous</option>' + options;
}
function populateCatalogueSelects(){
  const options = cur().catalogue.map(c=>`<option value="${escapeAttr(c.libelle)}" data-montant="${c.montant}">${c.code?('['+escapeAttr(c.code)+'] '):''}${escapeAttr(c.libelle)}</option>`).join('');
  document.getElementById('f_type').innerHTML = options + '<option value="__AUTRE__">Autre (libellé personnalisé)</option>';
  document.getElementById('h_type').innerHTML = '<option value="">Tous</option>' + cur().catalogue.map(c=>`<option value="${escapeAttr(c.libelle)}">${escapeAttr(c.libelle)}</option>`).join('');
}
document.getElementById('f_type').addEventListener('change', function(){
  const opt = this.options[this.selectedIndex];
  if(this.value !== '__AUTRE__'){
    document.getElementById('f_montant').value = opt.dataset.montant || '';
  }
});

/* ============ TABLEAU DE BORD ============ */
function renderDashboard(){
  const infractions = cur().infractions;
  const totalVeh = cur().vehicules.length;
  const totalAmendes = infractions.length;
  const montantTotal = infractions.reduce((s,i)=>s+(i.montant||0),0);
  const montantPaye = infractions.filter(i=>i.statut==='Payée').reduce((s,i)=>s+(i.montant||0),0);
  const montantImpaye = montantTotal - montantPaye;
  const pct = montantTotal ? Math.round((montantPaye/montantTotal)*100) : 0;

  document.getElementById('dashCards').innerHTML = `
    <div class="card">
      <div class="label">Véhicules enregistrés</div>
      <div class="value">${totalVeh}</div>
    </div>
    <div class="card">
      <div class="label">Amendes enregistrées</div>
      <div class="value">${totalAmendes}</div>
    </div>
    <div class="card">
      <div class="label">Montant total</div>
      <div class="value">${fmtMoney(montantTotal)}</div>
    </div>
    <div class="card alt">
      <div class="label">Montant payé</div>
      <div class="value">${fmtMoney(montantPaye)}</div>
    </div>
    <div class="card alt2">
      <div class="label">Montant impayé</div>
      <div class="value">${fmtMoney(montantImpaye)}</div>
    </div>
  `;

  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('tauxPayeLabel').textContent = pct + '%';
  document.getElementById('montantPayeSmall').textContent = fmtMoney(montantPaye);
  document.getElementById('montantImpayeSmall').textContent = fmtMoney(montantImpaye);

  const byType = {};
  infractions.forEach(i=>{
    const key = i.infraction || 'Non précisé';
    byType[key] = byType[key] || {count:0, total:0};
    byType[key].count++;
    byType[key].total += (i.montant||0);
  });
  const typeRows = Object.entries(byType).sort((a,b)=>b[1].total-a[1].total);
  const typeGrandTotal = typeRows.reduce((s,[,d])=>s+d.total,0) || 1;
  document.getElementById('repartitionBody').innerHTML = typeRows.length ? typeRows.map(([type,d])=>{
    const pct = Math.round((d.total/typeGrandTotal)*100);
    return `
    <div class="repartition-row">
      <div class="repartition-row-top">
        <span class="repartition-label">${type}</span>
        <span class="repartition-stats"><b>${d.count}</b> amende${d.count>1?'s':''} &middot; <b>${fmtMoney(d.total)}</b> &middot; ${pct}%</span>
      </div>
      <div class="repartition-bar"><div class="repartition-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('') : `<div class="empty-state">Aucune donnée</div>`;
}

/* ============ ENREGISTREMENT ============ */
document.getElementById('formInfraction').addEventListener('submit', async function(e){
  e.preventDefault();
  const plaque = document.getElementById('f_plaque').value;
  if(!plaque){ showToast("Ajoutez d'abord un véhicule dans l'onglet Administrateur."); return; }
  const typeSelect = document.getElementById('f_type');
  const isAutre = typeSelect.value === '__AUTRE__';
  const libre = document.getElementById('f_infraction_libre').value.trim();
  const infractionLabel = isAutre ? (libre || 'Infraction non précisée') : typeSelect.value;
  const montant = Number(document.getElementById('f_montant').value) || 0;

  const isoDateInf = frToIso(document.getElementById('f_dateinf').value);
  if(!isoDateInf){ showToast("Date de l'infraction invalide (format attendu JJ/MM/AAAA)."); return; }
  if(isoDateInf < DATE_DEBUT_BASE){ showToast('La base de données démarre en 2025 : dates antérieures non acceptées.'); return; }

  const payload = {
    plaque,
    numero: normalizeNumero(document.getElementById('f_numero').value),
    infraction: infractionLabel,
    montant,
    dateInfraction: isoDateInf,
    dateVerbalisation: document.getElementById('f_dateverb').value
  };
  try {
    await api(`/companies/${currentCompany}/infractions`, { method:'POST', body: JSON.stringify(payload) });
    await loadCompanyData(currentCompany);
    this.reset();
    document.getElementById('f_dateinf').value = isoToFr(todayISO());
    populateCatalogueSelects();
    refreshAll();
    showToast(`Amende enregistrée (${computeStatut(montant)}).`);
  } catch(err){
    showToast(err.message);
  }
});
bindNumeroInput(document.getElementById('f_numero'));
bindDateMaskInput(document.getElementById('f_dateinf'));

/* ============ HISTORIQUE ============ */
function buildFiltersDescription(){
  const parts = [];
  const plaque = document.getElementById('h_plaque').value;
  const type = document.getElementById('h_type').value;
  const statut = document.getElementById('h_statut').value;
  const from = document.getElementById('h_from').value;
  const to = document.getElementById('h_to').value;
  const search = document.getElementById('h_search').value.trim();
  if(plaque) parts.push('Véhicule : '+plaque);
  if(type) parts.push('Type : '+type);
  if(statut) parts.push('Statut : '+statut);
  if(from) parts.push('Du '+fmtDate(from));
  if(to) parts.push('Au '+fmtDate(to));
  if(search) parts.push('Recherche : "'+search+'"');
  return parts.join(' — ');
}

function getFilteredHistory(){
  const plaque = document.getElementById('h_plaque').value;
  const type = document.getElementById('h_type').value;
  const statut = document.getElementById('h_statut').value;
  const from = document.getElementById('h_from').value;
  const to = document.getElementById('h_to').value;
  const search = document.getElementById('h_search').value.trim().toLowerCase();

  return cur().infractions.filter(i=>{
    if(plaque && i.plaque !== plaque) return false;
    if(type && i.infraction !== type) return false;
    if(statut && i.statut !== statut) return false;
    if(from && i.dateInfraction && i.dateInfraction < from) return false;
    if(to && i.dateInfraction && i.dateInfraction > to) return false;
    if(search && !(i.numero||'').toLowerCase().includes(search)) return false;
    return true;
  }).sort((a,b)=> (b.dateInfraction||'').localeCompare(a.dateInfraction||''));
}

function renderHistory(){
  const rows = getFilteredHistory();
  const body = document.getElementById('historyBody');
  const empty = document.getElementById('historyEmpty');
  document.getElementById('historyCount').textContent = `${rows.length} amende(s) affichée(s) sur ${cur().infractions.length} au total.`;

  if(!rows.length){
    body.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  const canDelete = isAdmin();
  body.innerHTML = rows.map(i=>{
    if(i.id === editingId){
      return `<tr>
        <td>${i.plaque}</td>
        <td>
          <div class="numero-input numero-input-sm">
            <span class="numero-prefix">C00000000000</span>
            <input type="text" id="e_numero_${i.id}" value="${escapeAttr(stripNumeroPrefix(i.numero))}" inputmode="numeric" pattern="[0-9]{1,9}" maxlength="9" autocomplete="off">
          </div>
        </td>
        <td><input type="text" class="edit-input" id="e_infraction_${i.id}" value="${escapeAttr(i.infraction)}"></td>
        <td><input type="number" class="edit-input col-right" id="e_montant_${i.id}" min="0" step="100" value="${i.montant||0}"></td>
        <td><input type="text" class="edit-input col-center" id="e_dateinf_${i.id}" placeholder="JJ/MM/AAAA" inputmode="numeric" maxlength="10" autocomplete="off" value="${isoToFr(i.dateInfraction)}"></td>
        <td><input type="date" class="edit-input col-center" id="e_dateverb_${i.id}" min="2025-01-01" value="${i.dateVerbalisation||''}"></td>
        <td class="col-center"><span class="hint">Auto</span></td>
        <td class="actions-cell colActions">
          <button class="btn btn-sm btn-success" data-save="${i.id}">Enregistrer</button>
          <button class="btn btn-sm btn-outline" data-cancel="${i.id}">Annuler</button>
        </td>
      </tr>`;
    }
    return `<tr>
      <td>${i.plaque}</td>
      <td>${i.numero||'—'}</td>
      <td>${i.infraction}</td>
      <td class="col-right">${fmtMoney(i.montant)}</td>
      <td class="col-center">${fmtDate(i.dateInfraction)}</td>
      <td class="col-center dateverb-cell"><span class="dv-value">${fmtDate(i.dateVerbalisation)}</span></td>
      <td class="col-center"><span class="badge ${i.statut==='Payée'?'payee':'nonpayee'}">${i.statut}</span></td>
      <td class="actions-cell colActions">
        <button class="btn btn-sm btn-outline" data-edit="${i.id}">Modifier</button>
        ${canDelete ? `<button class="btn btn-sm btn-danger" data-delete="${i.id}">Supprimer</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  if(editingId){
    bindNumeroInput(document.getElementById('e_numero_'+editingId));
    bindDateMaskInput(document.getElementById('e_dateinf_'+editingId));
  }

  body.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click', ()=>{
    editingId = b.dataset.edit;
    renderHistory();
  }));
  body.querySelectorAll('[data-cancel]').forEach(b=>b.addEventListener('click', ()=>{
    editingId = null;
    renderHistory();
  }));
  body.querySelectorAll('[data-save]').forEach(b=>b.addEventListener('click', async ()=>{
    const id = b.dataset.save;
    const montant = Number(document.getElementById(`e_montant_${id}`).value) || 0;
    const isoDateInf = frToIso(document.getElementById(`e_dateinf_${id}`).value);
    if(!isoDateInf){ showToast("Date de l'infraction invalide (format attendu JJ/MM/AAAA)."); return; }
    if(isoDateInf < DATE_DEBUT_BASE){ showToast('La base de données démarre en 2025 : dates antérieures non acceptées.'); return; }
    const payload = {
      numero: normalizeNumero(document.getElementById(`e_numero_${id}`).value),
      infraction: document.getElementById(`e_infraction_${id}`).value.trim(),
      montant,
      dateInfraction: isoDateInf,
      dateVerbalisation: document.getElementById(`e_dateverb_${id}`).value
    };
    try {
      await api(`/companies/${currentCompany}/infractions/${id}`, { method:'PUT', body: JSON.stringify(payload) });
      await loadCompanyData(currentCompany);
      editingId = null;
      refreshAll();
      showToast(`Amende mise à jour (${computeStatut(montant)}).`);
    } catch(err){ showToast(err.message); }
  }));
  body.querySelectorAll('[data-delete]').forEach(b=>b.addEventListener('click', async ()=>{
    if(!confirm('Supprimer définitivement cette amende ?')) return;
    try {
      await api(`/companies/${currentCompany}/infractions/${b.dataset.delete}`, { method:'DELETE' });
      await loadCompanyData(currentCompany);
      renderHistory();
      renderDashboard();
      renderVehiculesAdmin();
      showToast('Amende supprimée.');
    } catch(err){ showToast(err.message); }
  }));
}

['h_plaque','h_type','h_statut','h_from','h_to','h_search'].forEach(id=>{
  document.getElementById(id).addEventListener('input', renderHistory);
  document.getElementById(id).addEventListener('change', renderHistory);
});
document.getElementById('btnResetFilters').addEventListener('click', ()=>{
  ['h_plaque','h_type','h_statut','h_from','h_to','h_search'].forEach(id=>document.getElementById(id).value='');
  renderHistory();
});

/* ============ EXPORT EXCEL (ExcelJS, mise en forme + logo) ============ */
const BORDER_THIN = {
  top:{style:'thin', color:{argb:'FFD8CBB8'}},
  left:{style:'thin', color:{argb:'FFD8CBB8'}},
  bottom:{style:'thin', color:{argb:'FFD8CBB8'}},
  right:{style:'thin', color:{argb:'FFD8CBB8'}}
};

document.getElementById('btnExportExcel').addEventListener('click', async ()=>{
  const rows = getFilteredHistory();
  if(!rows.length){ showToast('Aucune donnée à exporter.'); return; }
  const meta = curMeta();
  const btn = document.getElementById('btnExportExcel');
  const originalLabel = btn.textContent;
  btn.textContent = 'Génération...';
  btn.disabled = true;

  try{
    const wb = new ExcelJS.Workbook();
    wb.creator = meta.name;
    wb.created = new Date();

    const ws = wb.addWorksheet('Historique', { views:[{state:'frozen', ySplit:4}] });
    const headers = ['Plaque','Marque','Modèle','Conducteur','N° Contravention','Infraction','Montant (FCFA)','Statut',"Date de l'infraction",'Date de verbalisation'];
    const widths = [16,14,14,18,26,42,15,12,16,16];
    widths.forEach((w,i)=> ws.getColumn(i+1).width = w);

    ws.mergeCells(1,3,1,headers.length);
    const titleCell = ws.getCell(1,3);
    titleCell.value = `${meta.name} — Historique des Amendes`;
    titleCell.font = { size:16, bold:true, color:{argb:'FF4A2E18'} };
    titleCell.alignment = { vertical:'middle' };
    ws.getRow(1).height = 30;

    ws.mergeCells(2,3,2,headers.length);
    const subCell = ws.getCell(2,3);
    const filtersDesc = buildFiltersDescription();
    subCell.value = `Généré le ${new Date().toLocaleString('fr-FR')} — ${rows.length} amende(s)${filtersDesc? ' — '+filtersDesc:''}`;
    subCell.font = { italic:true, size:10, color:{argb:'FF7A6A5A'} };
    ws.getRow(2).height = 18;
    ws.getRow(3).height = 8;

    if(meta.hasLogo){
      const imgId = wb.addImage({ base64: TB_LOGO_BASE64, extension:'png' });
      ws.addImage(imgId, { tl:{col:0,row:0}, ext:{width:118,height:89} });
    } else {
      ws.mergeCells(1,1,2,2);
      const logoCell = ws.getCell(1,1);
      logoCell.value = meta.short;
      logoCell.font = { bold:true, size:18, color:{argb:'FFFFFFFF'} };
      logoCell.alignment = { vertical:'middle', horizontal:'center' };
      logoCell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF6B4226'} };
    }

    const headerRow = ws.getRow(4);
    headers.forEach((h,i)=>{
      const c = headerRow.getCell(i+1);
      c.value = h;
      c.font = { bold:true, color:{argb:'FFFFFFFF'} };
      c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF4A2E18'} };
      c.alignment = { vertical:'middle', horizontal:'center', wrapText:true };
      c.border = BORDER_THIN;
    });
    headerRow.height = 24;

    rows.forEach((r,idx)=>{
      const veh = cur().vehicules.find(v=>v.plaque===r.plaque) || {};
      const row = ws.getRow(5+idx);
      const vals = [r.plaque, veh.marque||'', veh.modele||'', veh.conducteur||'', r.numero||'', r.infraction, r.montant, r.statut, fmtDate(r.dateInfraction), fmtDate(r.dateVerbalisation)];
      vals.forEach((v,i)=>{
        const c = row.getCell(i+1);
        c.value = v;
        c.border = BORDER_THIN;
        c.alignment = { vertical:'middle' };
        if(i===6){ c.numFmt = '#,##0 "FCFA"'; c.alignment = { horizontal:'right', vertical:'middle' }; }
        if(i===7){
          c.font = { bold:true, color:{argb: v==='Payée' ? 'FF3F7D4E' : 'FFB5442F'} };
          c.alignment = { horizontal:'center', vertical:'middle' };
          c.fill = { type:'pattern', pattern:'solid', fgColor:{argb: v==='Payée' ? 'FFE5F3E7' : 'FFFBE9E5'} };
        }
      });
    });

    const byVeh = {};
    rows.forEach(r=>{
      byVeh[r.plaque] = byVeh[r.plaque] || {nb:0, total:0, paye:0};
      byVeh[r.plaque].nb++;
      byVeh[r.plaque].total += (r.montant||0);
      if(r.statut==='Payée') byVeh[r.plaque].paye += (r.montant||0);
    });
    const summaryEntries = Object.entries(byVeh).sort((a,b)=>b[1].total-a[1].total);

    const ws2 = wb.addWorksheet('Récapitulatif par véhicule', { views:[{state:'frozen', ySplit:3}] });
    const sHeaders = ['Plaque','Marque','Modèle',"Nombre d'amendes",'Montant total (FCFA)','Montant payé (FCFA)','Montant impayé (FCFA)'];
    const sWidths = [16,16,16,17,20,20,20];
    sWidths.forEach((w,i)=> ws2.getColumn(i+1).width = w);

    ws2.mergeCells(1,1,1,sHeaders.length);
    const t2 = ws2.getCell(1,1);
    t2.value = `${meta.name} — Récapitulatif par véhicule`;
    t2.font = { size:15, bold:true, color:{argb:'FF4A2E18'} };
    ws2.getRow(1).height = 26;

    const hRow2 = ws2.getRow(2);
    sHeaders.forEach((h,i)=>{
      const c = hRow2.getCell(i+1);
      c.value = h;
      c.font = { bold:true, color:{argb:'FFFFFFFF'} };
      c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF4A2E18'} };
      c.alignment = { vertical:'middle', horizontal:'center', wrapText:true };
      c.border = BORDER_THIN;
    });
    hRow2.height = 24;

    summaryEntries.forEach(([plaque,d],idx)=>{
      const veh = cur().vehicules.find(v=>v.plaque===plaque) || {};
      const row = ws2.getRow(3+idx);
      const vals = [plaque, veh.marque||'', veh.modele||'', d.nb, d.total, d.paye, d.total-d.paye];
      vals.forEach((v,i)=>{
        const c = row.getCell(i+1);
        c.value = v;
        c.border = BORDER_THIN;
        c.alignment = { vertical:'middle' };
        if(i>=4){ c.numFmt = '#,##0 "FCFA"'; c.alignment = { horizontal:'right', vertical:'middle' }; }
      });
    });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${meta.short}_Historique_Amendes_${todayISO()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Export Excel généré.');
  } catch(err){
    console.error(err);
    showToast("Erreur lors de l'export Excel.");
  } finally {
    btn.textContent = originalLabel;
    btn.disabled = false;
  }
});

/* ============ IMPRESSION (Historique uniquement) ============ */
function updatePrintHeader(){
  const meta = curMeta();
  document.getElementById('printTitle').textContent = `${meta.name} — Historique des Amendes`;
  const filterTxt = buildFiltersDescription();
  document.getElementById('printMetaLine').textContent = `Généré le ${new Date().toLocaleString('fr-FR')}${filterTxt? ' — '+filterTxt : ''}`;
  document.getElementById('printLogoWrap').innerHTML = meta.hasLogo ? TB_LOGO_HTML : KESHO_LOGO_HTML;
}
window.addEventListener('beforeprint', updatePrintHeader);
document.getElementById('btnPrintHistory').addEventListener('click', ()=>{
  selectTab('history');
  setTimeout(()=>window.print(), 30);
});

/* ============ ADMINISTRATEUR — VEHICULES ============ */
function renderVehiculesAdmin(){
  const body = document.getElementById('vehiculesBody');
  const list = cur().vehicules.slice().sort((a,b)=>a.plaque.localeCompare(b.plaque));
  const canDelete = isAdmin();
  body.innerHTML = list.length ? list.map(v=>{
    const nb = cur().infractions.filter(i=>i.plaque===v.plaque).length;
    return `<tr>
      <td>${v.plaque}</td>
      <td>${v.marque||'—'}</td>
      <td>${v.modele||'—'}</td>
      <td>${v.conducteur||'—'}</td>
      <td><span class="badge ${v.statut==='Actif'?'payee':'nonpayee'}">${v.statut}</span></td>
      <td>${nb}</td>
      <td class="actions-cell colActions">${canDelete ? `<button class="btn btn-sm btn-danger" data-delveh="${escapeAttr(v.plaque)}">Supprimer</button>` : ''}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="7" class="empty-state">Aucun véhicule enregistré</td></tr>`;

  body.querySelectorAll('[data-delveh]').forEach(b=>b.addEventListener('click', async ()=>{
    const plaque = b.dataset.delveh;
    const nb = cur().infractions.filter(i=>i.plaque===plaque).length;
    const msg = nb>0 ? `Ce véhicule a ${nb} amende(s) associée(s). Supprimer quand même le véhicule (les amendes resteront dans l'historique) ?` : 'Supprimer ce véhicule ?';
    if(!confirm(msg)) return;
    try {
      await api(`/companies/${currentCompany}/vehicules/${encodeURIComponent(plaque)}`, { method:'DELETE' });
      await loadCompanyData(currentCompany);
      renderVehiculesAdmin();
      populateVehiculeSelects();
      showToast('Véhicule supprimé.');
    } catch(err){ showToast(err.message); }
  }));
}

document.getElementById('formVehicule').addEventListener('submit', async function(e){
  e.preventDefault();
  const plaque = document.getElementById('v_plaque').value.trim().toUpperCase();
  if(!plaque) return;
  const payload = {
    plaque,
    marque: document.getElementById('v_marque').value.trim(),
    modele: document.getElementById('v_modele').value.trim(),
    conducteur: document.getElementById('v_conducteur').value.trim(),
    statut: document.getElementById('v_statut').value
  };
  try {
    await api(`/companies/${currentCompany}/vehicules`, { method:'POST', body: JSON.stringify(payload) });
    await loadCompanyData(currentCompany);
    this.reset();
    renderVehiculesAdmin();
    populateVehiculeSelects();
    showToast(`Véhicule ajouté à ${curMeta().name}.`);
  } catch(err){ showToast(err.message); }
});

/* ============ ADMINISTRATEUR — CATALOGUE INFRACTIONS ============ */
function renderCatalogueAdmin(){
  const body = document.getElementById('catalogueBody');
  const canDelete = isAdmin();
  body.innerHTML = cur().catalogue.map((c)=>`
    <tr>
      <td>${c.code||'—'}</td>
      <td>${c.libelle}</td>
      <td>${fmtMoney(c.montant)}</td>
      <td>${canDelete ? `<button class="btn btn-sm btn-danger" data-delcat="${c.id}">Supprimer</button>` : ''}</td>
    </tr>
  `).join('');
  body.querySelectorAll('[data-delcat]').forEach(b=>b.addEventListener('click', async ()=>{
    try {
      await api(`/companies/${currentCompany}/catalogue/${b.dataset.delcat}`, { method:'DELETE' });
      await loadCompanyData(currentCompany);
      renderCatalogueAdmin();
      populateCatalogueSelects();
    } catch(err){ showToast(err.message); }
  }));
}

document.getElementById('formCatalogue').addEventListener('submit', async function(e){
  e.preventDefault();
  const libelle = document.getElementById('c_libelle').value.trim();
  if(!libelle) return;
  const payload = {
    code: document.getElementById('c_code').value.trim(),
    libelle,
    montant: Number(document.getElementById('c_montant').value) || 0
  };
  try {
    await api(`/companies/${currentCompany}/catalogue`, { method:'POST', body: JSON.stringify(payload) });
    await loadCompanyData(currentCompany);
    this.reset();
    renderCatalogueAdmin();
    populateCatalogueSelects();
    showToast("Type d'infraction ajouté.");
  } catch(err){ showToast(err.message); }
});

/* ============ ADMINISTRATEUR — UTILISATEURS ============ */
async function renderUsers(){
  if (!isAdmin()) return;
  const body = document.getElementById('usersBody');
  try {
    const data = await api('/users');
    body.innerHTML = data.users.map(u=>{
      const created = u.createdAt ? new Date(u.createdAt).toLocaleDateString('fr-FR') : '—';
      const isSelf = CURRENT_USER && u.username === CURRENT_USER.username;
      return `<tr>
        <td>${escapeAttr(u.username)}${isSelf ? ' <span class="hint">(vous)</span>' : ''}</td>
        <td>
          <select class="role-select" data-role-user="${u.id}" ${isSelf ? 'disabled' : ''}>
            <option value="user" ${u.role==='user'?'selected':''}>Utilisateur standard</option>
            <option value="admin" ${u.role==='admin'?'selected':''}>Administrateur</option>
          </select>
        </td>
        <td>${created}</td>
        <td class="actions-cell colActions">${isSelf ? '' : `<button class="btn btn-sm btn-danger" data-deluser="${u.id}">Supprimer</button>`}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="4" class="empty-state">Aucun utilisateur</td></tr>`;

    body.querySelectorAll('[data-role-user]').forEach(sel=>sel.addEventListener('change', async ()=>{
      try {
        await api(`/users/${sel.dataset.roleUser}`, { method:'PATCH', body: JSON.stringify({ role: sel.value }) });
        showToast('Rôle mis à jour.');
      } catch(err){ showToast(err.message); renderUsers(); }
    }));
    body.querySelectorAll('[data-deluser]').forEach(b=>b.addEventListener('click', async ()=>{
      if(!confirm('Supprimer cet utilisateur ? Il ne pourra plus se connecter.')) return;
      try {
        await api(`/users/${b.dataset.deluser}`, { method:'DELETE' });
        renderUsers();
        showToast('Utilisateur supprimé.');
      } catch(err){ showToast(err.message); }
    }));
  } catch(err){
    body.innerHTML = `<tr><td colspan="4" class="empty-state">${escapeAttr(err.message)}</td></tr>`;
  }
}

document.getElementById('formUser').addEventListener('submit', async function(e){
  e.preventDefault();
  const payload = {
    username: document.getElementById('u_username').value.trim(),
    password: document.getElementById('u_password').value,
    role: document.getElementById('u_role').value
  };
  if (payload.password.length < 6) { showToast('Le mot de passe doit contenir au moins 6 caractères.'); return; }
  try {
    await api('/users', { method:'POST', body: JSON.stringify(payload) });
    this.reset();
    renderUsers();
    showToast(`Compte "${payload.username}" créé.`);
  } catch(err){ showToast(err.message); }
});

/* ============ SAUVEGARDE / RESTAURATION (par société active) ============ */
document.getElementById('btnBackupExport').addEventListener('click', ()=>{
  const payload = { company: currentCompany, companyName: curMeta().name, ...cur() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${curMeta().short}_Sauvegarde_${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Sauvegarde exportée.');
});

document.getElementById('btnBackupImport').addEventListener('change', function(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async function(evt){
    try{
      const data = JSON.parse(evt.target.result);
      if(!data.vehicules || !data.infractions) throw new Error('Format invalide');
      if(data.company && data.company !== currentCompany){
        if(!confirm(`Ce fichier semble être une sauvegarde de "${data.companyName||data.company}", mais la société active est "${curMeta().name}". Importer quand même dans ${curMeta().name} ?`)) return;
      } else if(!confirm(`Cette action remplacera toutes les données de ${curMeta().name} par celles de la sauvegarde. Continuer ?`)){
        return;
      }
      await api(`/companies/${currentCompany}/import`, { method:'POST', body: JSON.stringify({
        vehicules: data.vehicules, infractions: data.infractions, catalogue: data.catalogue
      })});
      await loadCompanyData(currentCompany);
      refreshAll();
      showToast('Sauvegarde restaurée avec succès.');
    }catch(err){
      alert("Impossible de restaurer cette sauvegarde : "+err.message);
    }
  };
  reader.readAsText(file);
  this.value = '';
});

document.getElementById('btnResetAll').addEventListener('click', async ()=>{
  if(!confirm(`Cette action supprimera TOUTES les données de ${curMeta().name} (véhicules, amendes) et restaurera les données d'origine importées d'Excel. Continuer ?`)) return;
  try {
    await api(`/companies/${currentCompany}/reset`, { method:'POST' });
    await loadCompanyData(currentCompany);
    editingId = null;
    refreshAll();
    showToast('Données réinitialisées.');
  } catch(err){ showToast(err.message); }
});

/* ============ INIT ============ */
function refreshAll(){
  populateVehiculeSelects();
  populateCatalogueSelects();
  renderDashboard();
  renderHistory();
  renderVehiculesAdmin();
  renderCatalogueAdmin();
  if (isAdmin()) renderUsers();
}

document.getElementById('todayBadge').textContent = new Date().toLocaleDateString('fr-FR', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
document.getElementById('f_dateinf').value = isoToFr(todayISO());

tryAutoLogin();
