# Gestion des Amendes — Tropical Bois / KESHO (version web multi-utilisateurs)

Cette version transforme le fichier HTML original (qui stockait tout dans le
navigateur, donc uniquement sur un seul ordinateur) en une véritable
application web : un serveur central conserve toutes les données, et
n'importe quel ordinateur — au bureau ou à distance — peut s'y connecter
avec son propre compte pour voir et modifier les mêmes informations en
temps réel.

## Ce qui a changé par rapport au fichier original

- Les données (véhicules, amendes, catalogue des infractions) sont stockées
  sur le serveur, plus dans le navigateur de chaque poste.
- Chaque personne se connecte avec un identifiant et un mot de passe.
- Deux rôles : **administrateur** (gère les véhicules, le catalogue, les
  utilisateurs, peut supprimer et réinitialiser) et **utilisateur standard**
  (peut enregistrer des amendes, ajouter des véhicules, modifier/marquer
  payées les amendes, consulter le tableau de bord et l'historique, exporter
  vers Excel et imprimer — mais ne peut pas supprimer ni gérer les comptes).
- Les données se rafraîchissent automatiquement toutes les 15 secondes sur
  chaque poste connecté, donc tout le monde voit rapidement les nouvelles
  amendes saisies par les autres.
- Toutes les fonctionnalités d'origine sont conservées : export Excel avec
  logo, impression de l'historique, sauvegarde/restauration JSON,
  réinitialisation des données par société, deux sociétés indépendantes
  (Tropical Bois / KESHO).
- La connexion "base de données en ligne (Firebase)" de l'ancienne version a
  été retirée : elle est remplacée par ce vrai serveur central.

## Démarrer en local (pour tester)

Prérequis : [Node.js](https://nodejs.org) 18 ou plus récent.

```bash
npm install
npm start
```

Le serveur démarre sur `http://localhost:3000`. Au tout premier démarrage,
un compte administrateur est créé automatiquement :

- Identifiant : **LUCRS**
- Mot de passe : **1234**

Ces mêmes identifiants sont aussi enregistrés dans
`data/ADMIN_INITIAL_PASSWORD.txt`. Connectez-vous avec ce compte, puis
changez le mot de passe via "Mon compte" (recommandé, 1234 n'est pas un mot
de passe sûr pour un usage durable) et créez les comptes de votre équipe
depuis l'onglet Administrateur.

Vous pouvez changer ces identifiants par défaut avant le tout premier
démarrage : copiez `.env.example` en `.env` et renseignez `ADMIN_USERNAME` /
`ADMIN_PASSWORD` avec les valeurs de votre choix.

## Déployer pour un accès depuis Internet (postes distants)

Le plus simple et le moins cher est [Railway](https://railway.app) ou
[Render](https://render.com). Les deux détectent automatiquement une
application Node.js à partir de `package.json`.

Point important : cette application enregistre ses données dans un fichier
(`data/store.json`). Sur la plupart des hébergeurs, le disque est effacé à
chaque redéploiement **sauf si vous attachez un volume/disque persistant**.
N'oubliez pas cette étape, sinon vos données disparaîtraient au prochain
déploiement.

### Avec Railway (recommandé)

1. Créez un compte sur [railway.app](https://railway.app) et un nouveau projet.
2. Déployez ce dossier (via GitHub, ou "Deploy from local directory" avec la
   CLI Railway).
3. Dans l'onglet **Variables**, ajoutez `JWT_SECRET` (une longue chaîne
   aléatoire) et, si vous le souhaitez, `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
4. Dans l'onglet **Settings → Volumes**, ajoutez un volume monté sur
   `/app/data` (c'est ce dossier qui contient toutes les données).
5. Railway assigne automatiquement un domaine public en `https://...` —
   c'est l'adresse que chaque poste utilisera pour se connecter, où qu'il
   soit dans le monde.

### Avec Render

1. Créez un "Web Service" à partir de ce dossier (dépôt Git).
2. Build command : `npm install` — Start command : `npm start`.
3. Dans **Environment**, ajoutez les mêmes variables que ci-dessus.
4. Dans **Disks**, ajoutez un disque persistant monté sur `/opt/render/project/src/data`.
5. Render fournit une URL publique `https://votre-app.onrender.com`.

Sur les deux plateformes, le plan gratuit convient largement à un usage
interne pour une poignée d'utilisateurs.

## Gérer les utilisateurs

Une fois connecté en tant qu'administrateur, ouvrez l'onglet
**Administrateur → Gestion des utilisateurs** pour créer un compte par
personne (identifiant + mot de passe + rôle). Chaque personne se connecte
ensuite depuis son propre ordinateur avec ces identifiants, à l'adresse web
de l'application.

## Sauvegardes

En plus du fichier `data/store.json` sur le serveur, utilisez régulièrement
le bouton **Exporter une sauvegarde (JSON)** dans l'onglet Administrateur
(par société) pour garder une copie de sécurité en dehors du serveur.

## Structure du projet

```
server/            Backend Express (API, authentification, stockage)
  index.js          Point d'entrée du serveur
  db.js             Lecture/écriture des données (fichier JSON)
  auth.js           Jetons de connexion (JWT) et contrôle des rôles
  routes/           Routes de l'API (auth, utilisateurs, sociétés)
public/             Front-end (HTML/CSS/JS servis par le serveur)
seed/               Données d'origine (importées depuis le fichier Excel)
data/               Créé automatiquement : données vivantes + mots de passe
```
