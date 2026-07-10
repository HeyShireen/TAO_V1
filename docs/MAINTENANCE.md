# Guide de maintenance

## Règles essentielles

- `DATABASE_URL` utilise uniquement le rôle `aolink_runtime` ;
- le service web ne reçoit jamais `MIGRATION_DATABASE_URL` ;
- une migration distante exige une sauvegarde, une copie de test et une cible
  confirmée explicitement ;
- le reset DEMO s’exécute avec le rôle runtime soumis à RLS ;
- aucune migration n’est exécutée au démarrage du serveur.

## Variables principales

Critiques :

- `DATABASE_URL` ;
- `JWT_SECRET` ;
- `ALLOWED_ORIGINS` ;
- `PLATFORM_ADMIN_EMAIL` ;
- `DEMO_HOST`, `DEMO_USER_EMAIL`, `DEMO_USER_PASSWORD`.

Selon l’environnement : `REDIS_URL`, `EMAIL_USER`, `EMAIL_PASS`, `APP_URL`,
`DB_SSL` et `HTTPS_PROXY`.

Variables réservées aux opérations :

- `MIGRATION_DATABASE_URL` ;
- `ALLOW_REMOTE_MIGRATION` ;
- `MIGRATION_CONFIRM_TARGET` ;
- `MIGRATION_BACKUP_REFERENCE` ;
- `TEST_DATABASE_URL` et `TEST_DATABASE_CONFIRM_TARGET`.

## Migration de schéma

1. créer une migration numérotée dans `server/src/app/migrations/` ;
2. restaurer une sauvegarde dans une base isolée ;
3. exécuter le préflight en lecture seule ;
4. migrer la copie et lancer les tests PostgreSQL ;
5. suspendre l’application ;
6. sauvegarder puis auditer la production ;
7. exécuter explicitement la migration ;
8. contrôler l’intégrité avant le redémarrage.

Commandes :

```bash
cd server
npm run tenant:audit
npm run db:migrate
npm test
```

`tenant:audit` exige une URL d’audit explicite et travaille en lecture seule.
`db:migrate` exige le credential propriétaire et les confirmations de cible
décrites dans [MULTI_TENANT.md](MULTI_TENANT.md).

Chaque fichier SQL est exécuté dans une transaction et enregistré dans la
table `migrations`. Une migration déjà publiée ne doit pas être modifiée seule :
ajouter une migration corrective.

## Déploiement Render

Le service web doit avoir :

```text
Build Command: cd server && npm install
Start Command: cd server && node src/app/server.js
DATABASE_URL: credential aolink_runtime
```

Avant de rouvrir l’accès :

- vérifier que le déploiement est terminé ;
- appeler `GET /api/healthz` ;
- tester une connexion DMX ;
- tester la connexion et le bandeau DEMO ;
- vérifier la bascule du `platform_admin` ;
- effectuer un export dans chaque tenant.

## Sauvegarde et restauration

Sur Render, utiliser un export logique et la récupération PITR. Une sauvegarde
n’est considérée comme valide qu’après lecture de l’archive ou restauration
dans une base séparée.

Ne jamais restaurer avec `--clean` dans une base contenant des données utiles.
En cas d’échec de la migration initiale, restaurer la base complète plutôt que
tenter une suppression partielle des colonnes et contraintes multi-tenant.

## DEMO

Le reset quotidien est lancé à 03:00, heure de Paris :

```bash
npm run demo:reset
```

Surveiller le code retour et les journaux. Une deuxième exécution consécutive
doit produire le même état et ne modifier aucune donnée DMX.

## Diagnostic

| Contrôle | Objectif |
|---|---|
| `GET /api/healthz` | application, PostgreSQL et Redis |
| `npm run tenant:audit` | volumes par tenant et intégrité |
| `npm run tenant:validate-app-role` | rôle runtime et RLS |
| table `migrations` | version du schéma |
| `platform_audit_events` | changements de tenant et opérations plateforme |

Une requête métier effectuée sans contexte tenant doit retourner zéro ligne ou
être refusée. Ne pas diagnostiquer RLS avec le credential propriétaire.

## Tests prioritaires

- authentification, refresh et révocation de sessions ;
- invitations et restrictions du `tenant_admin` ;
- projets, lots, tours, options et questions ;
- imports et exports ;
- accès à un identifiant d’un autre tenant ;
- reset DEMO et absence d’impact sur DMX.
