# TAO - Comparateur d'offres

## 🚀 Démarrage rapide

### 1. Prérequis
- Node.js (v18+)
- PostgreSQL (v14+)

### 2. Installation

```bash
cd server
npm install
```

### 3. Configuration

Copier `.env.example` vers `.env` et configurer les variables :

```bash
cp .env.example .env
```

**Variables critiques à configurer :**
- `DATABASE_URL` : Connexion PostgreSQL
- `JWT_SECRET` : Secret JWT (min 32 caractères) - **CHANGEZ OBLIGATOIREMENT**
- `ADMIN_EMAIL` et `ADMIN_PASSWORD` : Pour créer l'admin au démarrage

### 4. Lancement

```bash
npm run dev
```

Le serveur démarre sur http://localhost:4000

## 📋 Nouvelles fonctionnalités

### ✅ Sécurité
- ✓ Validation JWT_SECRET au démarrage (min 32 caractères)
- ✓ CORS restreint aux origines autorisées
- ✓ SSL configuré selon l'environnement
- ✓ Suppression du mot de passe admin en dur

### ⚡ Performance
- ✓ Requêtes optimisées avec JOINs
- ✓ Batch inserts pour save-grid
- ✓ Index composés sur les tables principales
- ✓ Réduction des requêtes N+1

### 🎨 UX
- ✓ **Auto-save** : Sauvegarde automatique après 2 secondes d'inactivité
- ✓ **Spinner de chargement** : Feedback visuel lors des opérations
- ✓ **Confirmations** : Avant suppression d'entreprises
- ✓ **Messages d'erreur** : Clairs et compréhensibles
- ✓ **Indicateur de changements** : Bouton "Sauvegarder" orange si modifications

### 🔧 Code
- ✓ Validation centralisée des inputs
- ✓ Gestion d'erreurs cohérente et standardisée
- ✓ Middleware global d'erreurs
- ✓ Utilitaires de validation réutilisables

## 🔒 Sécurité - Configuration requise

### Génération d'un JWT_SECRET sécurisé

```bash
# Linux/Mac
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Windows PowerShell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Coller le résultat dans `.env` :
```
JWT_SECRET=votre_secret_genere_ici
```

### Variables d'environnement en production

En production, définir également :
```
NODE_ENV=production
ALLOWED_ORIGINS=https://votredomaine.com
```

## 📊 Structure de la base de données

Le schéma est créé automatiquement au démarrage. Les nouveaux index incluent :
- `idx_items_lot_position` : Pour le tri des items
- `idx_offers_item_company` : Pour les recherches d'offres
- `idx_lot_companies_lot` et `idx_lot_companies_company` : Pour les jointures

## 🐛 Corrections de bugs

- ✓ Double déclaration de `login()` supprimée
- ✓ Direction du texte (LTR) fixée dans les cellules
- ✓ Gestion des erreurs PostgreSQL améliorée

## 📝 Changements de comportement

### Auto-save
Le tableur sauvegarde maintenant automatiquement après 2 secondes sans édition. Le bouton "Sauvegarder" devient orange (●) quand il y a des changements non sauvegardés, puis vert (✓) après sauvegarde.

### Création admin
Au premier démarrage sans utilisateurs :
1. Si `ADMIN_EMAIL` et `ADMIN_PASSWORD` sont dans `.env` → Admin créé automatiquement
2. Sinon → Utiliser le bouton "Créer admin" dans l'interface

## ⚠️ Migration depuis version précédente

Si vous migrez depuis une version antérieure :

1. **Sauvegarder votre base de données**
2. Copier votre `.env` actuel
3. Ajouter les nouvelles variables requises (voir `.env.example`)
4. Redémarrer le serveur - les nouveaux index seront créés automatiquement

## 🛠️ Développement

### Scripts disponibles
```bash
npm run dev      # Démarrage en mode développement
npm run db:init  # Réinitialisation de la base de données
```

### Tests (à venir)
Des tests unitaires et d'intégration seront ajoutés prochainement.

## 📞 Support

Pour tout problème :
1. Vérifier que toutes les variables `.env` sont définies
2. Vérifier les logs du serveur pour les erreurs détaillées
3. En production, les erreurs techniques ne sont pas exposées (voir logs serveur)
