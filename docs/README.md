# Documentation AO Link

L’application est une web app Node.js/Express avec une interface HTML, CSS et
JavaScript servie par le backend. Les données sont stockées dans PostgreSQL et
cloisonnées par tenant avec Row-Level Security.

## Documents actifs

- [GUIDE_TECHNIQUE.md](GUIDE_TECHNIQUE.md) : architecture et flux applicatifs ;
- [GUIDE_NAVIGATION.md](GUIDE_NAVIGATION.md) : parcours utilisateur et rôles ;
- [MULTI_TENANT.md](MULTI_TENANT.md) : isolation, rôles PostgreSQL et procédure
  de déploiement ;
- [SETUP_DEMO.md](SETUP_DEMO.md) : configuration et reset du tenant DEMO ;
- [MAINTENANCE.md](MAINTENANCE.md) : exploitation courante et migrations ;
- [SECURITY.md](SECURITY.md) : protections et points de vigilance ;
- [SCHEMA_BASE_DONNEES.md](SCHEMA_BASE_DONNEES.md) : modèle de données ;
- [DEPLOY_VPS.md](DEPLOY_VPS.md) : déploiement sur VPS avec nginx et PM2.

## Démarrage local

Prérequis : Node.js, PostgreSQL et des credentials dédiés à une base locale.

```bash
cd server
npm install
npm run db:migrate
npm run dev
```

`db:migrate` nécessite `MIGRATION_DATABASE_URL`. Le serveur web utilise
`DATABASE_URL`, vérifie que le schéma est à jour et refuse un rôle propriétaire
ou `BYPASSRLS`.

Variables principales :

- `DATABASE_URL` ;
- `MIGRATION_DATABASE_URL`, uniquement pendant une migration ;
- `JWT_SECRET` ;
- `ALLOWED_ORIGINS` ;
- `PLATFORM_ADMIN_EMAIL` ;
- `DEMO_HOST`, `DEMO_USER_EMAIL`, `DEMO_USER_PASSWORD` ;
- `REDIS_URL` et les variables email selon l’environnement.

## Structure utile

- `server/src/app/server.js` : point d’entrée Express ;
- `server/src/app/db.js` : pool, contextes SQL et migrations ;
- `server/src/app/routes/` : routes API ;
- `server/src/app/public/` : interface web ;
- `server/src/app/migrations/` : migrations SQL explicites ;
- `server/src/app/tools/` : audit, reset DEMO et outils d’exploitation ;
- `server/tests/` : tests Node.js et intégration PostgreSQL ;
- `render.yaml` : configuration Render.

## Archives

`docs/_archive/` contient des audits et procédures historiques. Ces documents
ne sont pas une référence opérationnelle et peuvent décrire d’anciens rôles ou
modes de déploiement.
