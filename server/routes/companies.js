'use strict';
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

function checkCompany(req, res, next) {
  if (!db.isValidCompany(req.params.company)) {
    return res.status(404).json({ error: 'Société inconnue.' });
  }
  next();
}
router.use('/:company', checkCompany);

function wrap(fn) {
  return (req, res) => {
    try {
      fn(req, res);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'Erreur serveur.' });
    }
  };
}

/* Instantané complet (véhicules + infractions + catalogue) en un seul appel,
   pour limiter les allers-retours réseau depuis le front-end. */
router.get('/:company/snapshot', wrap((req, res) => {
  const c = req.params.company;
  res.json({
    vehicules: db.listVehicules(c),
    infractions: db.listInfractions(c),
    catalogue: db.listCatalogue(c)
  });
}));

/* ---------------------------- Véhicules ---------------------------- */
router.get('/:company/vehicules', wrap((req, res) => res.json({ vehicules: db.listVehicules(req.params.company) })));
router.post('/:company/vehicules', wrap((req, res) => {
  const v = db.addVehicule(req.params.company, req.body || {});
  res.status(201).json({ vehicule: v });
}));
router.delete('/:company/vehicules/:plaque', requireAdmin, wrap((req, res) => {
  const ok = db.deleteVehicule(req.params.company, req.params.plaque);
  if (!ok) return res.status(404).json({ error: 'Véhicule introuvable.' });
  res.json({ ok: true });
}));

/* --------------------------- Infractions ---------------------------- */
router.get('/:company/infractions', wrap((req, res) => res.json({ infractions: db.listInfractions(req.params.company) })));
router.post('/:company/infractions', wrap((req, res) => {
  const body = req.body || {};
  if (!body.plaque || !body.dateInfraction) {
    return res.status(400).json({ error: 'Véhicule et date de l\'infraction requis.' });
  }
  const rec = db.addInfraction(req.params.company, body);
  res.status(201).json({ infraction: rec });
}));
router.put('/:company/infractions/:id', wrap((req, res) => {
  const rec = db.updateInfraction(req.params.company, req.params.id, req.body || {});
  if (!rec) return res.status(404).json({ error: 'Amende introuvable.' });
  res.json({ infraction: rec });
}));
router.delete('/:company/infractions/:id', requireAdmin, wrap((req, res) => {
  const ok = db.deleteInfraction(req.params.company, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Amende introuvable.' });
  res.json({ ok: true });
}));
/* Marquer une amende comme payee / non payee : action explicite et distincte
   de la modification des details (montant, dates, etc.). */
router.post('/:company/infractions/:id/statut', wrap((req, res) => {
  const statut = (req.body || {}).statut === 'Payée' ? 'Payée' : 'Non payée';
  const rec = db.markInfractionStatut(req.params.company, req.params.id, statut);
  if (!rec) return res.status(404).json({ error: 'Amende introuvable.' });
  res.json({ infraction: rec });
}));

/* ---------------------------- Catalogue ------------------------------ */
router.get('/:company/catalogue', wrap((req, res) => res.json({ catalogue: db.listCatalogue(req.params.company) })));
router.post('/:company/catalogue', wrap((req, res) => {
  const item = db.addCatalogueItem(req.params.company, req.body || {});
  res.status(201).json({ item });
}));
router.delete('/:company/catalogue/:id', requireAdmin, wrap((req, res) => {
  const ok = db.deleteCatalogueItem(req.params.company, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Type introuvable.' });
  res.json({ ok: true });
}));

/* --------------------------- Reset / Import --------------------------- */
router.post('/:company/reset', requireAdmin, wrap((req, res) => {
  const data = db.resetCompany(req.params.company);
  res.json(data);
}));
router.post('/:company/import', requireAdmin, wrap((req, res) => {
  const data = db.importCompany(req.params.company, req.body || {});
  res.json(data);
}));

module.exports = router;
