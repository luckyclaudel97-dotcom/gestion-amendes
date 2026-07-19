'use strict';
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');

db.load();

/* --------------------- Bootstrap du premier administrateur --------------------- */
function bootstrapAdmin() {
  if (db.getUsers().length > 0) return;
  const username = process.env.ADMIN_USERNAME || 'LUCRS';
  const password = process.env.ADMIN_PASSWORD || '1234';
  const user = db.addUser({ username, passwordHash: bcrypt.hashSync(password, 10), role: 'admin' });
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'ADMIN_INITIAL_PASSWORD.txt'),
    `Identifiant : ${username}\nMot de passe initial : ${password}\n\nChangez ce mot de passe dès la première connexion (bouton "Mon compte").\nCe fichier n'est créé qu'une seule fois, à la toute première initialisation du serveur.\n`,
    'utf8');
  console.log('================================================================');
  console.log(' Premier compte administrateur créé :');
  console.log('   Identifiant : ' + username);
  console.log('   Mot de passe : ' + password);
  console.log(' -> également enregistré dans data/ADMIN_INITIAL_PASSWORD.txt');
  console.log('================================================================');
}
bootstrapAdmin();

const app = express();
app.use(express.json({ limit: '5mb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/companies', require('./routes/companies'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Gestion des Amendes — serveur démarré sur le port ${PORT}`);
});
