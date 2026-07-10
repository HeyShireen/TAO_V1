# AO Link — Guide technique

## Vue d’ensemble

AO Link structure des projets d’appel d’offres en lots, tours, articles et
options. Il permet d’importer les données MOE et les offres des entreprises,
de produire des comparatifs, de générer des questions et d’exporter les
résultats en Excel ou Word.

## Architecture

### Backend

- Node.js en modules ESM ;
- Express 4 ;
- PostgreSQL avec le client `pg` ;
- Redis optionnel pour la révocation et certains contrôles de sécurité ;
- JWT d’accès et refresh tokens rotatifs ;
- `exceljs` et `docx` pour les exports.

Le point d’entrée est `server/src/app/server.js`. Au démarrage, il :

1. charge et valide la configuration ;
2. initialise les dépendances applicatives ;
3. vérifie que les migrations attendues sont présentes ;
4. refuse un rôle PostgreSQL propriétaire, superutilisateur ou `BYPASSRLS` ;
5. enregistre les routes et sert l’interface statique.

Le serveur n’exécute aucun DDL. Les migrations sont lancées séparément avec
`npm run db:migrate`.

### Frontend

L’interface est une SPA en JavaScript vanilla dans
`server/src/app/public/` :

- `home.html` : accueil public ;
- `login.html` et `login.js` : connexion et acceptation d’invitation ;
- `index.html` et `app.js` : application authentifiée.

## Multi-tenant

Les tenants initiaux sont `dmx` et `demo`. Un utilisateur standard appartient
à un seul tenant. Toutes les tables métier portent `tenant_id` et PostgreSQL
applique `FORCE ROW LEVEL SECURITY`.

Le JWT contient le tenant d’appartenance et le tenant actif. L’utilisateur est
revalidé en base à chaque requête authentifiée. Le `platform_admin` travaille
toujours dans un tenant actif unique ; il n’existe pas de vue métier globale.

Voir [MULTI_TENANT.md](MULTI_TENANT.md) pour les rôles PostgreSQL, les garde-fous
de migration et la procédure Render.

## Rôles applicatifs

- `platform_admin` : gestion des tenants et changement de contexte audité ;
- `tenant_admin` : utilisateurs et invitations de son tenant ;
- `responsable` : opérations métier ;
- `visionneur` : consultation ;
- `entreprise` : données limitées à son entreprise répondante.

Les comptes sont créés par invitation. L’adresse email est unique sur toute la
plateforme.

## Routes principales

- `/api/auth` : connexion, invitation, refresh et déconnexion ;
- `/api/projects`, `/api/lots`, `/api/rounds`, `/api/options` : données métier ;
- `/api/questions`, `/api/question-config` : questions et configuration ;
- `/api/users`, `/api/shares`, `/api/access-requests` : utilisateurs et accès ;
- `/api/exports` : exports Excel et Word ;
- `/api/tenant` : invitations et administration du tenant actif ;
- `/api/platform` : opérations réservées au `platform_admin` ;
- `/api/public-config` : configuration publique dépendante de l’hôte ;
- `/api/healthz` : état applicatif.

## Données métier

Hiérarchie principale :

1. tenant ;
2. projet ;
3. lot ;
4. tour ;
5. article ou option ;
6. données MOE et offres des entreprises ;
7. questions générées et exports.

`companies` représente les entreprises répondantes. Ce n’est pas la table des
clients SaaS, qui est `tenants`.

## Déploiement

Render utilise `render.yaml`. Le service web reçoit l’URL de
`aolink_runtime`, jamais le credential propriétaire. La commande de démarrage
est :

```text
cd server && node src/app/server.js
```

Pour un VPS, consulter [DEPLOY_VPS.md](DEPLOY_VPS.md) et
[MAINTENANCE.md](MAINTENANCE.md).
