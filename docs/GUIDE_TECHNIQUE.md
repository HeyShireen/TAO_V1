# AO Link — Guide Technique 

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

AO Link est un système de gestion et de comparaison d'offres permettant de :
- **Organiser** des projets complexes en lots et rondes d'appel d'offres
- **Comparer** les soumissions de multiples entreprises sur des critères quantitatifs et financier 
- **Analyser** les écarts MOE (Maître d'Œuvre) vs entreprises
- **Générer** des tableaux comparatifs et des questions a envoyer aux entreprises 
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

### Architecture SPA et Routing

AO Link utilise une architecture **Single Page Application (SPA)** avec un système de routing côté serveur pour gérer l'authentification.

#### Pages principales

Le serveur Express expose trois routes HTML distinctes :

1. **`/` (Page d'accueil publique)**
   - Fichier servi : `public/home.html`
   - Page de présentation et point d'entrée pour les visiteurs
   - Redirection vers `/login` pour se connecter

2. **`/login` (Page de connexion)**
   - Fichier servi : `public/login.html`
   - Script : `public/login.js`
   - Formulaire d'authentification (email + mot de passe)
   - Fonctionnalités :
     - Connexion utilisateur existant
     - Création de compte 
     - Réinitialisation mot de passe
     - Vérification email
   - Après connexion réussie : redirection automatique vers `/app`

3. **`/app` (Application principale - SPA)**
   - Fichier servi : `public/index.html`
   - Script : `public/app.js` 
   - **Authentification requise** : vérifie le token JWT avant de servir la page
   - Si non authentifié : redirection automatique vers `/login`
   - Contient toute l'interface utilisateur pour :
     - Gestion des projets, lots, rondes
     - Saisie et comparaison des offres
     - Gestion des options
     - Système RAO
     - Exports Excel/Word
     - Administration utilisateurs

#### Sécurité des routes

**Routes publiques** (pas d'auth requise) :
- `GET /` → home.html
- `GET /login` → login.html
- `POST /api/auth/login` → Authentification
- `POST /api/auth/register` → Création compte
- `POST /api/auth/reset-password` → Réinitialisation

**Routes protégées** (auth requise) :
- `GET /app` → index.html (vérifie JWT côté serveur)
- `GET /api/*` → Toutes les API (vérifie JWT via middleware)

