# Sécurité AO Link

Ce document décrit l’état actuel du code. Les anciens audits sont conservés
dans `docs/_archive/` et ne constituent pas une procédure opérationnelle.

## Démarrage sécurisé

`server/src/app/security-init.js` valide notamment `JWT_SECRET`,
`DATABASE_URL` et, en production, `ALLOWED_ORIGINS`. Le démarrage est refusé si
la configuration critique est absente.

`ensureSchema()` vérifie ensuite :

- la présence des colonnes sentinelles des dernières migrations ;
- que le rôle PostgreSQL runtime n’est ni propriétaire, ni superutilisateur,
  ni `BYPASSRLS`.

Le serveur web ne reçoit jamais le credential de migration et n’exécute aucun
DDL au démarrage.

## Isolation multi-tenant

Chaque table métier porte un `tenant_id`. L’isolation combine :

- contexte tenant appliqué par la façade SQL de `db.js` ;
- clés étrangères composites incluant le tenant ;
- politiques PostgreSQL `ENABLE ROW LEVEL SECURITY` et
  `FORCE ROW LEVEL SECURITY` ;
- revalidation en base de l’utilisateur et du tenant actif à chaque requête
  authentifiée.

Sans contexte, une requête métier ne voit aucune ligne. Le scope de migration
est réservé au propriétaire du schéma et ne peut pas être activé par
`aolink_runtime`.

## Authentification et sessions

- mots de passe hachés avec `bcrypt` ;
- JWT d’accès signé, valable 15 minutes ;
- cookie `auth` HttpOnly, `Secure` en production et `SameSite=Lax` ;
- refresh token rotatif valable 30 jours ;
- révocation d’une session ou de toutes les sessions ;
- détection des réutilisations suspectes d’une famille de refresh tokens ;
- blacklist Redis comme couche de révocation complémentaire.

Le JWT contient l’utilisateur, le rôle, le tenant d’appartenance et le tenant
actif. Ces informations ne sont jamais considérées comme suffisantes sans
relecture de la base.

## Création des comptes

L’inscription publique est désactivée. Un `tenant_admin` invite un utilisateur
dans son tenant. Le token d’invitation est haché, expire et ne peut être utilisé
qu’une fois.

Un `tenant_admin` ne peut pas :

- attribuer `platform_admin` ;
- déplacer un compte vers un autre tenant ;
- consulter les utilisateurs d’un autre tenant.

L’adresse email reste unique sur l’ensemble de la plateforme.

## Administration plateforme

Le `platform_admin` peut créer ou suspendre un tenant et changer son tenant
actif avec un motif obligatoire. Chaque bascule et accès plateforme est
journalisé avec l’utilisateur, le tenant, le motif, l’adresse IP et la date.

Le compte plateforme ne dispose pas d’une requête métier globale : il travaille
toujours dans un tenant actif unique.

## Environnement DEMO

Sur `demo.ao-link.fr` :

- seuls les comptes du tenant DEMO sont acceptés ;
- les identifiants préremplis ne sont exposés que sur cet hôte ;
- un bandeau annonce le reset quotidien ;
- le reset vérifie le type du tenant, prend un verrou PostgreSQL et travaille
  dans une transaction.

Le reset ne doit jamais utiliser le rôle propriétaire du schéma.

## Protections HTTP

- CORS limité à `ALLOWED_ORIGINS` en production ;
- cookies avec credentials ;
- `helmet`, CSP, HSTS derrière proxy HTTPS et interdiction d’iframe ;
- limite globale API ;
- limite renforcée sur `/api/auth` et par adresse email ;
- honeypot sur les routes d’authentification concernées ;
- requêtes SQL paramétrées et validation des entrées ;
- taille JSON limitée.

La CSP autorise encore certaines ressources inline nécessaires à l’interface
actuelle. Son durcissement demandera une migration des scripts et styles vers
des fichiers ou des nonces.

## Secrets

Ne jamais versionner :

- `JWT_SECRET` ;
- les URL PostgreSQL avec credentials ;
- `EMAIL_PASS` ;
- les credentials Redis ;
- les mots de passe DEMO.

Les fichiers `.env` et `.env.*.local` sont ignorés par Git. En production,
utiliser le gestionnaire de secrets Render ou celui de l’hébergeur.

## Contrôles réguliers

- `GET /api/healthz` ;
- `npm run tenant:audit` avec un credential autorisé ;
- `npm run tenant:validate-app-role` ;
- tests d’accès croisé entre DMX, DEMO et un tenant fictif ;
- cycle login, refresh, logout et logout global ;
- invitations expirées ou réutilisées ;
- imports et exports avec des noms d’entreprises identiques dans deux tenants ;
- reset DEMO sans modification de DMX.

Voir [MULTI_TENANT.md](MULTI_TENANT.md) pour la procédure de migration et de
retour arrière.
