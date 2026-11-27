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

**Pas de lint ni de typecheck.** `npm test` (`node --test tests/*.test.js`) lance 6 fichiers, ~46 tests, tous sans base de données sauf le premier :

- `multitenancy.integration.test.js` — intégration PostgreSQL, ignoré par défaut (triple garde-fou anti-prod : `ALLOW_TEST_DATABASE` + `TEST_DATABASE_CONFIRM_TARGET`) ;
- `tenant-utils.test.js` — hôte DEMO, cookies, contextes tenant ;
- `import-utils.test.js` — `parseNumber`, matching de désignations, num d'articles. Les tests préfixés `PIEGE` documentent un comportement **actuel jugé dangereux** (ex. `parseNumber('REF-12') === -12`) : ne pas les « corriger » sans décision explicite ;
- `import-preview.test.js` — détection de la ligne d'en-tête et auto-mapping, sur des classeurs `.xlsx` construits en mémoire avec exceljs ;
- `company-scope.test.js` — restriction `entreprise` (voir ci-dessous) ;
- `rate-limit-store.test.js` — store partagé de rate limiting.

Reste non couvert : `exports`, `questions/config`, `lots` et tout le frontend.

La vérification reste donc largement manuelle : `GET /api/healthz` (app + DB + Redis), puis auth / imports / comparaisons / exports, et `npm run tenant:audit` (lecture seule) pour l'intégrité multi-tenant. Audits ad hoc du module questions dans `server/tools/` : `diagnose-questions.mjs`, `audit-questions.mjs`, `audit-missing.mjs`, `audit-manual-duplicates.mjs`. Le dossier `tests/` **à la racine** est abandonné (décembre 2025 / mars 2026) et sans lien avec `npm test`.

## ⚠️ Base de données de production

`server/.env` contient une `DATABASE_URL` qui pointe vers la Postgres de **production** sur Render. Lancer le serveur ou un script en local touche la prod.

Décision du 25 novembre 2026 : on travaille **directement sur cette base**, écritures et migrations incluses — il n'y a pas de base de test et c'est assumé, des sauvegardes existent. Trois règles subsistent :

- **sauvegarde fraîche et vérifiée avant toute migration** ;
- **jamais de SQL destructif sans confirmation explicite** ;
- **ne jamais afficher le contenu de `server/.env`** : il contient `DATABASE_URL` avec credentials, `JWT_SECRET` et `EMAIL_PASS`. Lors des diagnostics, préférer des agrégats et des comptages aux extraits de lignes réelles, et ne rien committer qui contienne des données clients.

## Architecture

Tout le code applicatif vit dans `server/src/app/` :

- `server.js` — point d'entrée. Au démarrage : valide l'env, init Redis et vérifie le schéma. Les migrations sont exécutées explicitement avant le serveur avec `npm run db:migrate` et `MIGRATION_DATABASE_URL`.
- `routes/` — API REST par domaine : `auth`, `projects`, `lots`, `rounds`, `questions` (+ `questions/config.js` pour la config et la génération), `options`, `users`, `shares`, `access-requests`, `exports`, `tenant`, `platform`. Les fichiers `exports/index.js` (~3 890 lignes) et `questions/config.js` (~2 120 lignes) concentrent la logique métier lourde.
- `public/` — frontend : `home.html` (public), `login.html`+`login.js`, `index.html`+`app.js`, plus `options-sheet.js` (~835 lignes, déjà séparé). **`app.js` est un monolithe de ~12 640 lignes** contenant toute la SPA, avec ~42 variables globales mutables et aucune gestion d'état. Il est en revanche découpé en 49 sections cohésives par commentaires. `styles.css` fait ~4 100 lignes.
- `importers/` — `smart-import.js` est le moteur unique (Excel .xlsx/.xlsm, PDF via Tabula puis repli JS), accompagné de `import-utils.js` et `options-import.js` (détection auto des sections OPTIONS / VARIANTES / PSE).
- `middleware/` — `auth.js` (JWT + contexte tenant), `roles.js`, `security.js`, `honeypot.js`, `errors.js`. ⚠️ `errors.js` définit `asyncHandler` et un `errorHandler` global qui **ne sont utilisés nulle part** : les ~115 endpoints font du `try/catch` manuel.
- `migrations/` — SQL numéroté. Pour toute évolution de schéma : **ajouter une nouvelle migration numérotée** (idempotente de préférence), jamais modifier une migration publiée ni `schema.sql` seul. **La prochaine est `048_`.** Attention, trois numéros sont dupliqués (`010`, `032`, `042`) : l'ordre d'exécution suit le tri alphabétique du nom de fichier complet. Le suivi se fait dans la table `migrations`, une transaction par fichier.

### Auth et rôles

JWT dans la réponse JSON + cookies HttpOnly `auth` et `refreshToken` (rotation via `/api/auth/refresh`, révocation via Redis).

**Cinq rôles** depuis la refonte multi-tenant V2.0.0 (hiérarchie 5→1 dans `middleware/roles.js`) : `platform_admin`, `tenant_admin`, `responsable`, `visionneur`, `entreprise`. L'inscription publique est désactivée — les comptes sont créés par invitation d'un `tenant_admin`. La migration 045 a converti l'ancien rôle `admin` en `tenant_admin`.

Le rôle `entreprise` est rattaché à une `company_id` : toute route touchant offres/questions doit filtrer par `company_id` et masquer les données MOE pour ce rôle — à revérifier après chaque modification de route. C'est la source de régression la plus probable du projet, car un oubli ne produit aucune erreur : juste une fuite de données entre entreprises.

**Utiliser `utils/company-scope.js`** (`companyScope(req)`) plutôt que de réécrire le test à la main :

- `scope.restricted` — il faut filtrer *et* on a un identifiant exploitable ;
- `scope.orphan` — compte `entreprise` sans société : répondre 403, **jamais** retomber sur un accès non filtré ;
- `scope.sqlAnd('o.company_id')` — fragment SQL sûr (entier validé, nom de colonne vérifié) ;
- `scope.sqlAndOwnOrShared('i.source_company_id')` — variante où `NULL` signifie « ligne DPGF visible par tous » ;
- `scope.allows(id)` — contrôle en mémoire.

Appliqué dans `routes/lots/index.js`. ⚠️ `exports/index.js` (5 occurrences), `questions/config.js` et `questions/index.js` recopient **encore** le motif à la main : à migrer au fil des modifications.

### Isolation multi-tenant

Deux couches. (1) **RLS PostgreSQL** : `tenant_id NOT NULL` + policy `tenant_isolation` + `FORCE ROW LEVEL SECURITY` sur ~29 tables, contexte posé par la façade SQL de `db.js` et propagé par `AsyncLocalStorage`. Sans contexte, une requête métier ne voit aucune ligne (fail-closed). Le rôle runtime doit être non propriétaire, `NOSUPERUSER`, `NOBYPASSRLS` — `db.js` refuse de démarrer sinon. (2) Le filtre applicatif `company_id` ci-dessus.

Piège connu : `multer` casse le contexte tenant sur les imports, d'où le wrapper `preserveDbContext()` (corrigé en V2.0.1). Toute nouvelle route d'upload doit l'utiliser.

### Module fiches questions (RAO)

Config en cascade : `project_question_config` (seuils globaux + textes) → overrides par lot dans `lot_threshold_config` / `lot_question_config` (colonnes `*_override`, flag calculé côté serveur en comparant à la valeur projet). La génération (`POST /api/question-config/lot/:lotId/generate`) est une **synchronisation** : au plus une question par métrique (qty/price/amount), suppression des questions obsolètes, préservation de `manual_edited`. Après tout changement de seuils, il faut re-générer pour resynchroniser.

Cases « Poser ces questions » par catégorie (migration 044) : 6 booléens `ask_questions_{qty,price,amount,unanswered,unit_mismatch,offer_amount_mismatch}` au niveau projet, avec override par lot, résolus par `effectiveAskQuestions()`. Catégorie décochée = plus de génération, et les fiches auto non éditées du type sont supprimées à la régénération.

**Statuts de `generated_questions.status`** : `pending`, `answered`, `validated`, `dismissed`. ⚠️ `validated` (posé par `PUT /question-config/question/:id/validate`, `questions/config.js`) **n'est documenté dans aucune migration** — le commentaire de la migration 004 ne liste que les trois autres — et **aucune contrainte `CHECK` ne valide la colonne**. La suppression d'une question est un *soft delete* : `status='dismissed'` + `manual_edited=true`.

Une ligne du textarea de l'éditeur = une question `generated_questions` (`syncQuestionCellLines()` côté front). Contrainte d'unicité : `(round_id, lot_id, item_id, company_id, question_type)`, ou `option_item_id` à la place d'`item_id`.

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
