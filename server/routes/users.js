'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  res.json({ users: db.getUsers() });
});

router.post('/', (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  if (password.length < 6) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
  if (db.findUserByUsername(username)) return res.status(409).json({ error: 'Cet identifiant existe déjà.' });
  const user = db.addUser({ username: username.trim(), passwordHash: bcrypt.hashSync(password, 10), role });
  res.status(201).json({ user: { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt } });
});

router.patch('/:id', (req, res) => {
  const { role, password } = req.body || {};
  const target = db.findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  if (role && role !== 'admin' && target.role === 'admin' && db.countAdmins() <= 1) {
    return res.status(400).json({ error: 'Impossible de retirer le dernier administrateur.' });
  }
  const changes = {};
  if (role) changes.role = role;
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    changes.passwordHash = bcrypt.hashSync(password, 10);
  }
  const updated = db.updateUser(req.params.id, changes);
  res.json({ user: { id: updated.id, username: updated.username, role: updated.role } });
});

router.delete('/:id', (req, res) => {
  const target = db.findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  if (target.role === 'admin' && db.countAdmins() <= 1) {
    return res.status(400).json({ error: 'Impossible de supprimer le dernier administrateur.' });
  }
  if (target.id === req.user.sub) {
    return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
  }
  db.deleteUser(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
