# Documentation TAO_V1

Cette documentation couvre l'etat actuel du depot. L'application est une web app Node.js + PostgreSQL dont l'interface HTML/CSS/JS est servie directement par Express depuis `server/src/app/public/`.

## Demarrage rapide

Pre-requis:
- Node.js 18+
- PostgreSQL

Commandes:
```bash
cd server
npm install
npm run dev
```

Le serveur demarre sur `http://localhost:4000` par defaut. Au lancement, `src/app/server.js` valide la configuration, charge le schema SQL, puis applique automatiquement les migrations presentes dans `server/src/app/migrations/`.

Variables minimales:
- `DATABASE_URL`
- `JWT_SECRET`

Variables frequentes selon l'environnement:
- `ALLOWED_ORIGINS`
- `REDIS_URL`
- `EMAIL_USER` / `EMAIL_PASS`
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- `HTTPS_PROXY`

## Documents actifs

- `GUIDE_TECHNIQUE.md` : vue d'ensemble du produit, architecture et principaux flux.
- `MAINTENANCE.md` : exploitation courante, migrations, dependances et controles manuels.
- `SECURITY.md` : protections actuellement implementees et points d'attention.
- `DEPLOY_VPS.md` : deploiement sur VPS avec nginx et PM2.

## Structure utile du depot

- `server/src/app/server.js` : point d'entree Express.
- `server/src/app/public/` : interface web (home, login, app).
- `server/src/app/routes/` : API REST.
- `server/src/app/middleware/` : auth, roles, securite, honeypot, erreurs.
- `server/src/app/migrations/` : migrations SQL appliquees au demarrage.
- `tests/` : scripts de verification manuelle et securite.
- `render.yaml` : configuration Render.

## Archives documentaires

Les documents historiques, rapports d'audit, plans ponctuels et anciennes syntheses sont conserves dans `docs/_archive/` :

- `docs/_archive/audit/`
- `docs/_archive/reports/`
- `docs/_archive/SECURITY_AUDIT/`

Les documents places dans `_archive` sont conserves pour l'historique, mais ne doivent pas etre traites comme reference operationnelle principale.
