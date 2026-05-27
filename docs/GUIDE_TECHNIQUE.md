# AO Link - Guide technique

## Vue d'ensemble

AO Link est une application web de gestion et d'analyse d'offres. Le coeur du produit permet de structurer un projet en lots et rondes, d'importer ou saisir les offres des entreprises, de comparer ces offres aux Données MOE, puis d'exporter les analyses.

fonctionnalités actuellement visibles dans le dépôt:
- gestion des projets, lots et rondes
- gestion des articles et options
- import DPGF / Excel
- comparaison MOE vs entreprises
- génération et suivi de questions
- exports Excel et Word
- gestion des utilisateurs, partages et demandes d'accès

## Architecture actuelle

### Backend

- Runtime: Node.js ESM
- Framework: Express
- Base de données: PostgreSQL via `pg`
- Export: `exceljs`, `docx`
- Sécurité: `helmet`, `cors`, `express-rate-limit`, JWT, Redis optionnel pour révocation

Le point d'entrée est `server/src/app/server.js`. Au démarrage, le serveur:
1. charge `.env`
2. valide les variables critiques via `security-init.js`
3. initialise Redis si configuré
4. charge `Schéma.sql`
5. applique les migrations SQL présentes dans `server/src/app/migrations/`
6. démarre l'API et sert les fichiers statiques

### Frontend

L'interface est une SPA en JavaScript vanilla servie depuis `server/src/app/public/`:
- `home.html`: page d'accueil publique
- `login.html` + `login.js`: connexion, inscription, vérification email, reset mot de passe
- `index.html` + `app.js`: application authentifiee

Il n'y a pas de dossier `frontend/` séparé dans l'état actuel du dépôt.

## Routage principal

Routes HTML:
- `GET /` -> page publique
- `GET /login` -> page de connexion
- `GET /app` -> SPA principale avec vérification du cookie JWT cote serveur

Routes API principales:
- `/api/auth` -> auth, vérification email, reset mot de passe, refresh token, logout
- `/api/projects` -> projets, lots, imports DPGF
- `/api/lots` -> détail des lots, entreprises, offres, comparaisons
- `/api/rounds` -> gestion des rondes et tableaux comparatifs
- `/api/questions` et `/api/question-config` -> RAO et configuration
- `/api/options` -> options et grilles associees
- `/api/users`, `/api/shares`, `/api/access-requests` -> administration et partage
- `/api/exports` -> exports Excel / Word
- `/api/healthz` -> vérification rapide app + base + Redis

## rôles applicatifs

rôles actuellement supportes dans le code:
- `admin`: administration globale, gestion des utilisateurs et Accès total
- `responsable`: gestion des projets, lots, rondes, partages et analyses
- `visionneur`: lecture et demandes d'accès à des projets partages
- `entreprise`: Accès restreint a ses propres Données, sans visibilite MOE ni Données des autres entreprises

Notes de comportement Vérifiées:
- le premier utilisateur inscrit devient `admin`
- les inscriptions suivantes deviennent `visionneur` tant que l'email n'est pas vérifié
- les utilisateurs `entreprise` sont rattachés à une `company_id`

## Données et structure

Objets principaux:
- `projects`
- `lots`
- `rounds`
- `items`
- `moe_items`
- `offers`
- `companies`
- `questions`
- `options`
- `users`
- tables de sécurité et de support: `email_verifications`, `password_resets`, `refresh_tokens`, `suspicious_token_attempts`

Le schéma initial est defini dans `server/src/app/Schéma.sql`, puis complète par les migrations numerotees.

## Authentification et sessions

Le flux en place combine JWT et refresh tokens:
- `POST /api/auth/login` retourne un JWT dans la Réponse JSON
- le serveur ecrit aussi un cookie HttpOnly `auth`
- un cookie HttpOnly `refreshToken` est stocke pour la rotation des sessions
- `POST /api/auth/refresh` renouvelle la session et effectue la rotation du refresh token
- `POST /api/auth/logout-everywhere` revoque toutes les sessions d'un utilisateur

Le contrôle d'accès est complète par des middlewares de rôles et des filtrages SQL sur les Données sensibles des comptes `entreprise`.

## Import, comparaison et exports

Flux métier principal:
1. creation du projet
2. creation ou import des lots et articles
3. rattachement des entreprises aux lots
4. creation des rondes
5. import ou saisie des offres
6. calcul des tableaux comparatifs et des ecarts
7. génération des questions
8. export des resultats

Les routes projets et lots portent aussi une partie importante des imports métier, en particulier les aperçus et imports DPGF.

## déploiement

Deux modes de déploiement sont documentes dans le dépôt:
- Render via `render.yaml`
- VPS via nginx + PM2 dans `DEPLOY_VPS.md`

Dans les deux cas, l'application sert elle-meme l'interface web. Aucun serveur frontend distinct n'est requis.

## Documents associes

- `README.md` pour l'index documentaire
- `SECURITY.md` pour les protections en place
- `MAINTENANCE.md` pour l'exploitation et les mises a jour
- `DEPLOY_VPS.md` pour le déploiement manuel sur serveur

