# Guide de maintenance

Ce document couvre les operations de maintenance courantes pour l'application TAO_V1 telle qu'elle existe aujourd'hui dans le depot.

## Rappel d'architecture

- API Express et interface web dans `server/`
- frontend statique servi depuis `server/src/app/public/`
- base PostgreSQL
- migrations SQL dans `server/src/app/migrations/`
- Redis optionnel pour la revocation des tokens et certains mecanismes de securite

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

Le fichier `server/src/app/security-init.js` bloque le demarrage si les variables critiques sont absentes ou invalides.

## Demarrage et verification rapide

```powershell
cd server
npm install
npm run dev
```

Controles minimaux apres demarrage:
- verifier que le serveur ecoute bien sur le port attendu
- appeler `GET /api/healthz`
- verifier qu'aucune migration n'a echoue au demarrage
- verifier qu'un compte admin existe ou peut etre cree

## Migrations et schema

Le flux reel est le suivant:
1. `server/src/app/server.js` appelle `ensureSchema()`
2. `ensureSchema()` charge `schema.sql`
3. toutes les migrations `.sql` sont executees dans l'ordre si elles ne sont pas deja enregistrees dans la table `migrations`

Procedure recommandee pour une evolution de schema:
1. ajouter une nouvelle migration numerotee dans `server/src/app/migrations/`
2. privilegier un SQL idempotent quand c'est possible
3. demarrer localement l'application pour appliquer la migration
4. verifier les tables touchees dans PostgreSQL
5. valider les ecrans et endpoints impactes

Le script `server/src/app/tools/init-db.js` reste utile pour les operations manuelles, mais le chemin principal de production passe par le demarrage normal du serveur.

## Mise a jour des dependances

Cycle conseille:
1. executer `npm audit` dans `server/`
2. verifier `npm outdated`
3. mettre a jour package par package ou par lot maitrise
4. redemarrer l'application localement
5. revalider auth, imports, comparaisons et exports

Apres une mise a jour backend, verifier en priorite:
- login / logout / refresh token
- affichage de l'application `/app`
- import DPGF / Excel
- exports Word et Excel

## Roles et controles metier

Roles supportes:
- `admin`
- `responsable`
- `visionneur`
- `entreprise`

Points a verifier apres toute modification d'acces:
- masquage MOE pour le role `entreprise`
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

## Exports et verification fonctionnelle

Lorsqu'une modification touche les donnees de lots, rondes, options ou questions, verifier:
- que les exports Excel restent generes sans colonne vide inattendue
- que les exports Word continuent d'inclure les champs attendus
- que les montants et regroupements restent coherents avec les vues de comparaison

## Diagnostic rapide

Commandes ou verifications utiles:

| Verification | Objectif |
|---|---|
| `GET /api/healthz` | verifier app, DB et Redis |
| `SELECT count(*) FROM offers;` | volume de donnees sur les offres |
| `SELECT * FROM migrations ORDER BY executed_at DESC;` | confirmer l'etat des migrations |
| recherche `company_id` dans les routes | controler les filtrages entreprise |

## Tests disponibles dans le depot

Le depot ne declare pas de suite de tests npm complete a la racine. Les verifications presentes sont surtout manuelles ou scripts ad hoc:
- `tests/test-security-corrections.js`
- `tests/test-security.sh`
- scripts utilitaires sous `server/src/app/tools/`

Avant une mise en production, faire au minimum un passage manuel sur:
- authentification
- gestion des projets et lots
- imports
- comparaisons
- exports
- permissions par role

## Bonnes pratiques

- preferer une migration corrective a la modification d'une migration deja publiee
- limiter la logique sensible cote frontend
- garder les requetes SQL parametrees
- ne pas documenter comme acquise une fonctionnalite qui n'est pas verifiee dans le code
