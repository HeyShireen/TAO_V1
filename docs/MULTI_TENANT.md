# Exploitation multi-tenant

Ce document est la référence opérationnelle pour le cloisonnement des données.

## Architecture

AO Link utilise une application Node.js et une base PostgreSQL partagées. Les
deux tenants initiaux sont :

- `dmx`, de type `customer` ;
- `demo`, de type `demo`.

Toutes les tables métier portent un `tenant_id`. L’isolation repose sur trois
niveaux complémentaires : contexte tenant dans Express, clés étrangères
composites PostgreSQL et politiques `FORCE ROW LEVEL SECURITY` (RLS).
`companies` désigne les entreprises répondantes et non les organisations
clientes. Kubernetes n’est pas nécessaire pour cette architecture mutualisée.

## Utilisateurs et rôles

Un utilisateur appartient à un seul tenant. L’adresse email reste globalement
unique, sans distinction de tenant.

Rôles applicatifs :

- `platform_admin` : administration de la plateforme et changement explicite
  de tenant actif ;
- `tenant_admin` : administration limitée à son tenant ;
- `responsable` : gestion métier ;
- `visionneur` : lecture ;
- `entreprise` : accès limité à l’entreprise répondante associée.

Les nouveaux comptes sont créés par invitation. Il n’existe pas d’inscription
publique donnant automatiquement des droits administratifs.

## Rôles PostgreSQL

Les credentials du propriétaire du schéma et du serveur web sont séparés :

- le propriétaire historique Render sert uniquement aux migrations ;
- `aolink_runtime` est le rôle du service web. Il est `NOSUPERUSER`,
  `NOCREATEROLE`, `NOCREATEDB`, `NOINHERIT`, `NOBYPASSRLS` et ne possède
  aucune table.

Sur Render, un credential créé depuis l’interface reçoit automatiquement le
rôle propriétaire. Il ne doit donc pas être utilisé directement comme
`DATABASE_URL` runtime. Le rôle manuel `aolink_runtime` est validé avec :

```bash
npm run tenant:validate-app-role
```

Cette commande attend `APP_DATABASE_URL`, `APP_CONFIRM_TARGET` et
`APP_DATABASE_ROLE=aolink_runtime`. Elle travaille dans une transaction en
lecture seule.

Le service web reçoit uniquement `DATABASE_URL`. Il ne reçoit jamais
`MIGRATION_DATABASE_URL`.

## Contexte SQL

Le contexte RLS est posé sur chaque connexion par `server/src/app/db.js`. La
façade mémorise le dernier contexte appliqué et le remplace avant toute requête
si le tenant ou le scope change. Le pool PostgreSQL brut reste privé.

Sans contexte tenant valide, une requête métier ne retourne aucune ligne. Le
scope de migration est en plus limité au propriétaire du schéma et ne peut pas
être activé par `aolink_runtime`.

## Migration de production

Procédure obligatoire :

1. créer un export PostgreSQL et vérifier qu’il est lisible ;
2. restaurer une copie isolée de la production ;
3. exécuter le préflight en lecture seule avec `npm run tenant:audit` ;
4. migrer la copie et lancer `npm test` avec `TEST_DATABASE_URL` ;
5. suspendre le service web ;
6. relancer le préflight sur la production ;
7. exécuter explicitement `npm run db:migrate` avec le rôle propriétaire ;
8. contrôler les volumes et l’intégrité avec `npm run tenant:audit` ;
9. configurer `DATABASE_URL` avec `aolink_runtime`, déployer le code puis
   vérifier `/api/healthz` avant de rouvrir l’accès.

Une migration distante est refusée sans :

- `ALLOW_REMOTE_MIGRATION=true` ;
- `MIGRATION_CONFIRM_TARGET=HOST[:PORT]/DATABASE` ;
- `MIGRATION_BACKUP_REFERENCE` ;
- `MIGRATION_DATABASE_URL` explicitement définie.

L’audit attend `AUDIT_DATABASE_URL` ou `TEST_DATABASE_URL`. Si la cible est
aussi `DATABASE_URL`, il faut confirmer volontairement la lecture de production
avec `ALLOW_PRODUCTION_AUDIT=true`. L’audit ouvre une transaction `READ ONLY`.

En cas d’échec avant validation fonctionnelle, restaurer la sauvegarde ou une
récupération PITR. Ne pas tenter de retirer partiellement les colonnes tenant,
les contraintes ou les politiques RLS.

## Déploiement Render

Configuration du service web :

```text
Build Command: cd server && npm install
Start Command: cd server && node src/app/server.js
DATABASE_URL: URL du rôle aolink_runtime
```

Le démarrage vérifie le schéma et la sécurité du rôle PostgreSQL, mais
n’exécute aucune migration. Une erreur de schéma ou un rôle propriétaire
empêche volontairement le démarrage.

## Tenant DEMO

`demo.ao-link.fr` utilise la même application et la même base que DMX. Seul le
compte DEMO peut s’y connecter. Les identifiants préremplis ne sont exposés que
sur cet hôte.

Les données DEMO sont réinitialisées chaque jour à 03:00, heure de Paris :

```cron
CRON_TZ=Europe/Paris
0 3 * * * cd /home/tao/TAO/TAO_V1/server && /usr/bin/npm run demo:reset >> /var/log/tao-demo-reset.log 2>&1
```

`demo:reset` vérifie que la cible est bien le tenant `demo`, prend un verrou
PostgreSQL, travaille dans une transaction et révoque les sessions du compte
partagé. Il ne doit jamais être exécuté avec le rôle propriétaire du schéma.

## Contrôles après déploiement

- connexion DMX ;
- connexion sur `demo.ao-link.fr` et affichage du bandeau DEMO ;
- bascule DMX/DEMO du `platform_admin` et événement d’audit ;
- imports et exports dans les deux tenants ;
- identifiant d’un autre tenant retournant `403` ou `404` ;
- audit SQL sans `tenant_id` toujours limité par RLS ;
- reset DEMO laissant DMX inchangé.
