'use strict';
/*
 * Petite couche de stockage "fichier JSON" — aucune dependance native.
 * Toutes les fonctions sont synchrones : le cache memoire (STORE) est la
 * source de verite, et chaque mutation le reecrit immediatement sur disque.
 * Comme Node.js execute le code JS en un seul thread et qu'aucune de ces
 * fonctions ne contient d'attente asynchrone (await) au milieu d'une
 * mutation, deux requetes ne peuvent jamais s'entrelacer au milieu d'une
 * ecriture : c'est suffisant pour l'echelle de cette application.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const SEED = require('../seed/seed-data.json');

function uid() {
  return crypto.randomBytes(5).toString('hex');
}

function emptyCompanyBlock(company) {
  return {
    vehicules: JSON.parse(JSON.stringify(SEED[`vehicules${company === 'tb' ? 'TB' : 'KESHO'}`] || [])),
    infractions: JSON.parse(JSON.stringify(SEED[`infractions${company === 'tb' ? 'TB' : 'KESHO'}`] || [])),
    catalogue: JSON.parse(JSON.stringify(SEED.catalogue || []))
  };
}

function freshStore() {
  return {
    users: [],
    companies: {
      tb: emptyCompanyBlock('tb'),
      kesho: emptyCompanyBlock('kesho')
    }
  };
}

let STORE = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function persist() {
  ensureDataDir();
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(STORE, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function load() {
  ensureDataDir();
  if (fs.existsSync(DATA_FILE)) {
    try {
      STORE = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (!STORE.users) STORE.users = [];
      if (!STORE.companies) STORE.companies = { tb: emptyCompanyBlock('tb'), kesho: emptyCompanyBlock('kesho') };
      ['tb', 'kesho'].forEach(c => {
        if (!STORE.companies[c]) STORE.companies[c] = emptyCompanyBlock(c);
        if (!STORE.companies[c].vehicules) STORE.companies[c].vehicules = [];
        if (!STORE.companies[c].infractions) STORE.companies[c].infractions = [];
        if (!STORE.companies[c].catalogue) STORE.companies[c].catalogue = [];
      });
    } catch (e) {
      console.error("Fichier de donnees illisible, creation d'un nouveau store.", e);
      STORE = freshStore();
      persist();
    }
  } else {
    STORE = freshStore();
    persist();
  }
  return STORE;
}

function isValidCompany(c) {
  return c === 'tb' || c === 'kesho';
}

function company(c) {
  if (!isValidCompany(c)) throw Object.assign(new Error('Societe inconnue'), { status: 400 });
  return STORE.companies[c];
}

/* ------------------------------ USERS ------------------------------ */
function getUsers() {
  return STORE.users.map(u => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt }));
}
function findUserByUsername(username) {
  return STORE.users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
}
function findUserById(id) {
  return STORE.users.find(u => u.id === id);
}
function addUser({ username, passwordHash, role }) {
  const user = { id: uid(), username, passwordHash, role: role === 'admin' ? 'admin' : 'user', createdAt: new Date().toISOString() };
  STORE.users.push(user);
  persist();
  return user;
}
function updateUser(id, changes) {
  const u = findUserById(id);
  if (!u) return null;
  if (changes.passwordHash) u.passwordHash = changes.passwordHash;
  if (changes.role) u.role = changes.role === 'admin' ? 'admin' : 'user';
  persist();
  return u;
}
function deleteUser(id) {
  const before = STORE.users.length;
  STORE.users = STORE.users.filter(u => u.id !== id);
  persist();
  return STORE.users.length < before;
}
function countAdmins() {
  return STORE.users.filter(u => u.role === 'admin').length;
}

/* ---------------------------- VEHICULES ----------------------------- */
function listVehicules(c) { return company(c).vehicules; }
function addVehicule(c, v) {
  const comp = company(c);
  const plaque = String(v.plaque || '').trim().toUpperCase();
  if (!plaque) throw Object.assign(new Error('Plaque requise'), { status: 400 });
  if (comp.vehicules.some(x => x.plaque === plaque)) {
    throw Object.assign(new Error('Ce vehicule existe deja'), { status: 409 });
  }
  const record = {
    plaque,
    marque: (v.marque || '').trim(),
    modele: (v.modele || '').trim(),
    conducteur: (v.conducteur || '').trim(),
    statut: v.statut === 'Inactif' ? 'Inactif' : 'Actif'
  };
  comp.vehicules.push(record);
  persist();
  return record;
}
function deleteVehicule(c, plaque) {
  const comp = company(c);
  const before = comp.vehicules.length;
  comp.vehicules = comp.vehicules.filter(v => v.plaque !== plaque);
  persist();
  return comp.vehicules.length < before;
}

/* --------------------------- INFRACTIONS ---------------------------- */
function computeStatut(montant) { return Number(montant) > 0 ? 'Payée' : 'Non payée'; }

function listInfractions(c) { return company(c).infractions; }
function addInfraction(c, data) {
  const comp = company(c);
  const montant = Number(data.montant) || 0;
  const record = {
    id: uid(),
    plaque: data.plaque,
    numero: data.numero || '',
    code: data.code || '',
    infraction: data.infraction || 'Infraction non precisee',
    montant,
    dateInfraction: data.dateInfraction,
    dateVerbalisation: data.dateVerbalisation || '',
    statut: computeStatut(montant)
  };
  comp.infractions.unshift(record);
  persist();
  return record;
}
function updateInfraction(c, id, data) {
  const comp = company(c);
  const rec = comp.infractions.find(i => i.id === id);
  if (!rec) return null;
  if (data.numero !== undefined) rec.numero = data.numero;
  if (data.infraction !== undefined && data.infraction) rec.infraction = data.infraction;
  if (data.montant !== undefined) {
    rec.montant = Number(data.montant) || 0;
    rec.statut = computeStatut(rec.montant);
  }
  if (data.dateInfraction !== undefined) rec.dateInfraction = data.dateInfraction;
  if (data.dateVerbalisation !== undefined) rec.dateVerbalisation = data.dateVerbalisation;
  persist();
  return rec;
}
function deleteInfraction(c, id) {
  const comp = company(c);
  const before = comp.infractions.length;
  comp.infractions = comp.infractions.filter(i => i.id !== id);
  persist();
  return comp.infractions.length < before;
}

/* ---------------------------- CATALOGUE ------------------------------ */
function listCatalogue(c) { return company(c).catalogue; }
function addCatalogueItem(c, data) {
  const comp = company(c);
  const record = { id: uid(), code: (data.code || '').trim(), libelle: String(data.libelle || '').trim(), montant: Number(data.montant) || 0 };
  if (!record.libelle) throw Object.assign(new Error('Libelle requis'), { status: 400 });
  comp.catalogue.push(record);
  persist();
  return record;
}
function deleteCatalogueItem(c, id) {
  const comp = company(c);
  const before = comp.catalogue.length;
  comp.catalogue = comp.catalogue.filter(x => x.id !== id);
  persist();
  return comp.catalogue.length < before;
}

/* ------------------------- RESET / IMPORT ----------------------------- */
function resetCompany(c) {
  if (!isValidCompany(c)) throw Object.assign(new Error('Societe inconnue'), { status: 400 });
  STORE.companies[c] = emptyCompanyBlock(c);
  persist();
  return STORE.companies[c];
}
function importCompany(c, data) {
  if (!isValidCompany(c)) throw Object.assign(new Error('Societe inconnue'), { status: 400 });
  if (!Array.isArray(data.vehicules) || !Array.isArray(data.infractions)) {
    throw Object.assign(new Error('Format invalide'), { status: 400 });
  }
  STORE.companies[c] = {
    vehicules: data.vehicules,
    infractions: data.infractions,
    catalogue: Array.isArray(data.catalogue) && data.catalogue.length ? data.catalogue : emptyCompanyBlock(c).catalogue
  };
  persist();
  return STORE.companies[c];
}

module.exports = {
  load,
  isValidCompany,
  getUsers, findUserByUsername, findUserById, addUser, updateUser, deleteUser, countAdmins,
  listVehicules, addVehicule, deleteVehicule,
  listInfractions, addInfraction, updateInfraction, deleteInfraction,
  listCatalogue, addCatalogueItem, deleteCatalogueItem,
  resetCompany, importCompany
};
