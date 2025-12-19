# TAO V1 — Guide Technique 

**Tableau d'Analyse des Offres — Version 1.0**  
Application web de comparaison et d'analyse d'offres pour marchés publics et privés.

---

## 📋 Table des matières

1. [Vue d'ensemble](#vue-densemble)
2. [Architecture technique](#architecture-technique)
3. [Prérequis techniques](#prérequis-techniques)
4. [Installation et configuration](#installation-et-configuration)
5. [Concepts et fonctionnalités](#concepts-et-fonctionnalités)
6. [Workflow utilisateur](#workflow-utilisateur)
7. [Sécurité](#sécurité)
8. [Maintenance et support](#maintenance-et-support)

---

## Vue d'ensemble

### Objectif du logiciel

TAO V1 est un système de gestion et de comparaison d'offres permettant de :
- **Organiser** des projets complexes en lots et rondes d'appel d'offres
- **Comparer** les soumissions de multiples entreprises sur des critères quantitatifs et financier 
- **Analyser** les écarts MOE (Maître d'Œuvre) vs entreprises
- **Générer** des tableaux comparatifs et des questions RAO (Réponse Aux Offres)
- **Exporter** les analyses en formats Excel et Word

### Cas d'usage typique

1. Un maître d'œuvre crée un **projet** 
2. Le projet est divisé en **lots** 
3. Chaque lot contient des **articles** (désignation, quantité, prix unitaire MOE)
4. Les entreprises envoie leurs excel et soumissionnent sur chaque article (le logiciel envisage aussi l'option de reponse direct sur le logiciel)
5. Le système permet de comparer les offres sur plusieurs **rondes** successives
6. Les **options** techniques sont gérées séparément avec leurs propres articles
7. Le système génère automatiquement des **questions RAO** sur les écarts
8. Les tableaux comparatifs sont exportés pour aide à la décision

---

**Fonctionnement des Rôles** :
- **admin** : Tous les droits (CRUD projets, utilisateurs, exports)
- **responsable**: accès de modification des donnée, creation des projets partage aux user 
- **lecteur** : Lecture seule pas d'accès aux projets de base mais peuvent faire une demande 
- **entreprise**: role donné uniquement par les admin qui permet de lire et de renseigner les donnée d'une entreprise mais sans voir ou avoir accés aux estimation MOE ou aux chiffrages des autres entreprises 

## Architecture technique

### Stack technologique

#### Backend (API REST)
- **Runtime**: Node.js 18+ (ESM modules)
- **Framework**: Express.js 4.x
- **Base de données**: PostgreSQL 14+
- **ORM/Query**: pg (node-postgres) avec requêtes SQL natives
- **Authentification**: JWT avec bcrypt
- **Sécurité**: Helmet, CORS strict, Rate limiting, sanitization
- **Email**: Nodemailer (vérification comptes, notifications)
- **Export**: ExcelJS (Excel), docx (Word)

#### Frontend (SPA)
- **Architecture**: Vanilla JavaScript (ES6+)
- **Style**: CSS3 avec variables et grilles
- **Templating**: DOM manipulation native
- **Drag & Drop**: API HTML5 native
- **State management**: Variables globales + localStorage
- **API client**: Fetch API avec gestion d'erreurs

#### Infrastructure
- **Développement**: Local avec PostgreSQL
- **Production**: Actuellement sur Render l'hebergement en local est envisageable un option appli electron marcherais aussi 
- **Fichiers statiques**: Serveur Express intégré
- **Stockage**: PostgreSQL uniquement (pas de S3/blob storage)

### Structure du projet

```
TAO_V1/
├── server/                      # Backend Node.js
│   ├── src/
│   │   ├── server.js           # Point d'entrée principal
│   │   ├── db.js               # Connexion PostgreSQL + migrations
│   │   ├── security-init.js    # Vérifications sécurité au startup
│   │   ├── schema.sql          # Schéma de base initial
│   │   ├── middleware.*.js     # Middlewares (auth, errors, security, roles)
│   │   ├── utils.*.js          # Utilitaires (email, hash, validation, permissions)
│   │   ├── routes/             # Routes API REST
│   │   │   ├── auth.js         # Authentification (login, register, reset)
│   │   │   ├── projects.js     # CRUD projets
│   │   │   ├── lots.js         # CRUD lots
│   │   │   ├── rounds.js       # CRUD rondes
│   │   │   ├── questions.js    # Articles + MOE + Offres
│   │   │   ├── options.js      # Options (mini-lots) + items + offres
│   │   │   ├── question-config.js # Configuration RAO
│   │   │   ├── shares.js       # Partages inter-utilisateurs
│   │   │   ├── users.js        # Gestion utilisateurs
│   │   │   ├── access-requests.js # Demandes d'accès
│   │   │   └── exports.js      # Export Excel/Word
│   │   ├── migrations/         # Migrations SQL versionnées
│   │   │   ├── 001_add_rao_system.sql
│   │   │   ├── ...
│   │   │   └── 018_fix_options_tables.sql
│   │   ├── public/             # Frontend SPA
│   │   │   ├── index.html      # Application principale
│   │   │   ├── app.js          # Logique métier (2000+ lignes)
│   │   │   ├── login.html      # Page connexion
│   │   │   ├── login.js        # Logique authentification
│   │   │   ├── home.html       # Page d'accueil publique
│   │   │   ├── styles.css      # Styles globaux
│   │   │   └── assets/         # Images, icônes
│   │   ├── importers/          # Importeurs de données
│   │   │   ├── excel.js        # Import fichiers .xlsx
│   │   │   └── clipboard.js    # Import depuis presse-papiers
│   │   └── tools/              # Scripts utilitaires
│   │       ├── init-db.js      # Initialisation BDD
│   │       ├── check-users.js  # Vérification utilisateurs
│   │       └── ...
│   ├── package.json            # Dépendances backend
│   ├── .env.example            # Template variables environnement
│   └── .env                    # Variables réelles (git ignored)
├── docs/                       # Documentation
│   ├── audit/                  # Audits sécurité
│   └── reports/                # Rapports et guides de maintenance 
├── SECURITY_AUDIT/             # Dossier audit sécurité structuré
├── README.md                   # ;]
├── GUIDE_TECHNIQUE.md          # Ce fichier
└── render.yaml                 # Configuration déploiement Render

```
