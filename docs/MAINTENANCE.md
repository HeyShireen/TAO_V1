# Guide de maintenance

Ce document couvre les opérations de maintenance courantes pour l'application TAO_V1 telle qu'elle existe aujourd'hui dans le dépôt.

## Rappel d'architecture

- API Express et interface web dans `server/`
- frontend statique servi depuis `server/src/app/public/`
- base PostgreSQL
- migrations SQL dans `server/src/app/migrations/`
- Redis optionnel pour la révocation des tokens et certains mécanismes de sécurité

## Variables d'environnement a surveiller

Critiques:
- `DATABASE_URL`
- `JWT_SECRET`

Importantes selon l'environnement:
- `ALLOWED_ORIGINS`
- `REDIS_URL`
- `EMAIL_USER` / `EMAIL_PASS`
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- `HTTPS_PROXY`
- `DB_SSL`

Le fichier `server/src/app/security-init.js` bloque le démarrage si les variables critiques sont absentes ou invalides.

## démarrage et vérification rapide

```powershell
cd server
npm install
npm run dev
```

contrôles minimaux apres démarrage:
- Vérifier que le serveur ecoute bien sur le port attendu
- appeler `GET /api/healthz`
- Vérifier qu'aucune migration n'a echoue au démarrage
- Vérifier qu'un compte admin existe ou peut être crée

## Migrations et Schéma

Le flux reel est le suivant:
1. `server/src/app/server.js` appelle `ensureSchema()`
2. `ensureSchema()` charge `Schéma.sql`
3. toutes les migrations `.sql` sont executees dans l'ordre si elles ne sont pas déjà enregistrees dans la table `migrations`

procédure recommandee pour une evolution de Schéma:
1. ajouter une nouvelle migration numerotee dans `server/src/app/migrations/`
2. privilegier un SQL idempotent quand c'est possible
3. demarrer localement l'application pour appliquer la migration
4. Vérifier les tables touchees dans PostgreSQL
5. valider les écrans et endpoints impactes

Le script `server/src/app/tools/init-db.js` reste utile pour les opérations manuelles, mais le chemin principal de production passe par le démarrage normal du serveur.

## Mise a jour des dépendances

Cycle conseille:
1. executer `npm audit` dans `server/`
2. Vérifier `npm outdated`
3. mettre a jour package par package ou par lot maitrise
4. redemarrer l'application localement
5. revalider auth, imports, comparaisons et exports

Apres une mise a jour backend, Vérifier en priorite:
- login / logout / refresh token
- affichage de l'application `/app`
- import DPGF / Excel
- exports Word et Excel

## rôles et contrôles métier

rôles supportes:
- `admin`
- `responsable`
- `visionneur`
- `entreprise`

Points a Vérifier apres toute modification d'accès:
- masquage MOE pour le Rôle `entreprise`
- filtrage des offres par `company_id` pour `entreprise`
- filtrage des questions pour `entreprise`
- restrictions d'ecriture pour `visionneur`
- permissions admin sur la gestion des utilisateurs

## Sauvegardes et restauration

Recommandations minimales:
- dump quotidien PostgreSQL
- test de restauration periodique
- conservation separee des secrets applicatifs

Exemple:
```powershell
pg_dump -Fc -d <database_name> > backups\tao_$(Get-Date -Format yyyyMMdd).dump
pg_restore -l backups\tao_20260408.dump
```

## Exports et vérification fonctionnelle

Lorsqu'une modification touche les Données de lots, rondes, options ou questions, Vérifier:
- que les exports Excel restent générés sans colonne vide inattendue
- que les exports Word continuent d'inclure les champs attendus
- que les montants et regroupements restent coherents avec les vues de comparaison

## Diagnostic rapide

Commandes ou vérifications utiles:

| vérification | Objectif |
|---|---|
| `GET /api/healthz` | Vérifier app, DB et Redis |
| `SELECT count(*) FROM offers;` | volume de données sur les offres |
| `SELECT * FROM migrations ORDER BY executed_at DESC;` | confirmer l'État des migrations |
| recherche `company_id` dans les routes | controler les filtrages entreprise |

## Tests disponibles dans le dépôt

Le dépôt ne declare pas de suite de tests npm complète à la racine. Les vérifications présentes sont surtout manuelles ou scripts ad hoc:
- `tests/test-security-corrections.js`
- `tests/test-security.sh`
- scripts utilitaires sous `server/src/app/tools/`

Avant une mise en production, faire au minimum un passage manuel sur:
- authentification
- gestion des projets et lots
- imports
- comparaisons
- exports
- permissions par Rôle

## Bonnes pratiques

- preferer une migration corrective à la modification d'une migration déjà publiee
- limiter la logique sensible cote frontend
- garder les requetes SQL parametrees
- ne pas documenter comme acquise une fonctionnalité qui n'est pas vérifiée dans le code
