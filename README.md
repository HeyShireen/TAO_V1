# Comparateur d'offres — Bureau (v0.1)

Architecture:
- **server/** — API Node.js + PostgreSQL (Express)
- **frontend/** — Mini UI HTML/JS (peut être packagée avec Electron plus tard)

## 1) Lancer la base et l'API

### Prérequis
- Node.js 18+
- PostgreSQL (local ou serveur)

### Configurer l'environnement
```
cd server
cp .env.example .env
# Modifier DATABASE_URL et JWT_SECRET
```

Exemple `DATABASE_URL` local :
```
postgres://postgres:postgres@localhost:5432/offer_compare
```

### Installer et initialiser
```
npm install
npm run db:init
npm run dev
```

L'API écoute par défaut sur `http://localhost:4000`

### Bootstrap : créer le premier utilisateur (admin)
Ouvrir le `frontend/index.html` dans un navigateur (ou héberger via un serveur statique).
Renseigner email + mot de passe puis cliquer sur **"Créer admin"**.

## 2) UI Frontend (temporaire)
Ouvrir `frontend/index.html` (double-clic).  
Configurer éventuellement `API_BASE` dans `localStorage` si vous n'êtes pas sur localhost:
```js
localStorage.setItem('api_base', 'https://mon-serveur:4000');
```

## 3) Import Excel (format V1)
- Colonnes obligatoires: **Num**, **Désignation**, **Quantité MOE**, **PU MOE** (Montant MOE optionnel).  
- Pour chaque entreprise, ajouter 3 ou 4 colonnes nommées:  
  - `<Nom Entreprise> Quantité`  
  - `<Nom Entreprise> PU`  
  - `<Nom Entreprise> Montant` (optionnel)  
  - `<Nom Entreprise> U` (optionnel)

Le nom des colonnes peut varier (ex : qté/quantité, p.u/pu), l'importeur essaie de mapper automatiquement.

## 4) Emballer en application Bureau (Electron) — plus tard
- Remplacer le front par React si besoin, ou packager `frontend/` avec Electron.  
- L'API reste sur le serveur; l'appli bureau parle à l'API via HTTP + JWT.

## 5) Prochaines étapes
- Droits avancés par rôle (admin/lecteur).  
- Export PDF/Excel de la comparaison.  
- Mapping de colonnes configurable par lot.  
- Import PDF (si PDF structuré exporté d'Excel).  
- Classements par lot et global projet.

---
Développé pour Alban (DMX) — v0.1
