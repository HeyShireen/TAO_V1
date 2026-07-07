# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Vue d'ensemble

AO Link (TAO_V1) est une application web de gestion et d'analyse d'appels d'offres BTP : projets → lots → rondes → offres des entreprises, comparaison avec les données MOE (maîtrise d'œuvre), génération de fiches questions (RAO), exports Excel/Word. Node.js ESM + Express + PostgreSQL, frontend vanilla JS servi par Express — pas de framework, pas de build frontend.

## Commandes

```bash
cd server
npm install
npm run dev        # démarre sur http://localhost:4000
npm run db:init    # init manuelle de la BDD (le chemin normal est le démarrage du serveur)
npm run demo:seed  # données de démo
```

Variables critiques (le démarrage échoue sinon, via `security-init.js`) : `DATABASE_URL`, `JWT_SECRET`. Fréquentes : `ALLOWED_ORIGINS` (obligatoire en prod), `REDIS_URL`, `EMAIL_USER`/`EMAIL_PASS`, `HTTPS_PROXY`, `DB_SSL`.

Il n'y a **pas de suite de tests ni de lint**. Vérification manuelle : `GET /api/healthz` (app + DB + Redis), puis auth / imports / comparaisons / exports. Scripts ad hoc dans `tests/` et `server/tools/` (`diagnose-questions.mjs`, `audit-questions.mjs` — audits lecture seule du module questions).

## ⚠️ Base de données de production

`server/.env` contient une `DATABASE_URL` qui pointe vers la Postgres de **production** sur Render. Lancer le serveur ou un script en local touche la prod. Les diagnostics doivent rester en lecture seule ; ne jamais exécuter de SQL destructif sans confirmation explicite.

## Architecture

Tout le code applicatif vit dans `server/src/app/` :

- `server.js` — point d'entrée. Au démarrage : valide l'env (`security-init.js`), init Redis, `ensureSchema()` charge `schema.sql` **puis applique automatiquement toutes les migrations de `migrations/` non enregistrées dans la table `migrations`**, dans l'ordre des numéros. Sert ensuite l'API et le frontend statique.
- `routes/` — API REST par domaine : `auth`, `projects`, `lots`, `rounds`, `questions` (+ `questions/config.js` pour la config et la génération), `options`, `users`, `shares`, `access-requests`, `exports`. Les fichiers `exports/index.js` (~3900 lignes) et `questions/config.js` (~1900 lignes) concentrent la logique métier lourde.
- `public/` — frontend : `home.html` (public), `login.html`+`login.js`, `index.html`+`app.js`. **`app.js` est un monolithe de ~12 400 lignes** contenant toute la SPA.
- `importers/` — import DPGF/Excel (exceljs), presse-papiers, options.
- `middleware/` — `auth.js` (JWT), `roles.js`, `security.js`, `honeypot.js`, `demo-mode.js`, `errors.js`.
- `migrations/` — SQL numéroté. Pour toute évolution de schéma : **ajouter une nouvelle migration numérotée** (idempotente de préférence), jamais modifier une migration publiée ni `schema.sql` seul.

### Auth et rôles

JWT dans la réponse JSON + cookies HttpOnly `auth` et `refreshToken` (rotation via `/api/auth/refresh`, révocation via Redis). Quatre rôles : `admin` (premier inscrit), `responsable`, `visionneur`, `entreprise`. Le rôle `entreprise` est rattaché à une `company_id` : toute route touchant offres/questions doit filtrer par `company_id` et masquer les données MOE pour ce rôle — à revérifier après chaque modification de route.

### Module fiches questions (RAO)

Config en cascade : `project_question_config` (seuils globaux + textes) → overrides par lot dans `lot_threshold_config` / `lot_question_config` (colonnes `*_override`, flag calculé côté serveur en comparant à la valeur projet). La génération (`POST /api/question-config/lot/:lotId/generate`) est une **synchronisation** : au plus une question par métrique (qty/price/amount), suppression des questions obsolètes, préservation de `manual_edited`. Après tout changement de seuils, il faut re-générer pour resynchroniser.

### Piège node-postgres

Les colonnes `NUMERIC` arrivent en **string** côté JS : attention aux comparaisons (`!== 0`, tris, égalités) — convertir explicitement avec `Number()`.

## Déploiement

- Render : `render.yaml` (web + Postgres + Redis, région Frankfurt). L'app s'appelle `aolink-app`.
- VPS : nginx + PM2, voir `docs/DEPLOY_VPS.md` et `server/ecosystem.config.cjs`.

## Conventions

- Code, commentaires, messages d'erreur et documentation en **français**.
- Messages de commit : `V1.x.y description courte` (versionnage manuel dans le message).
- Documentation active dans `docs/` (`GUIDE_TECHNIQUE.md`, `MAINTENANCE.md`, `SECURITY.md`) ; `docs/_archive/` est historique, pas une référence.
- `scripts/` à la racine contient des scripts Python de génération documentaire (docs de formation, captures, GIF), pas du code applicatif.
