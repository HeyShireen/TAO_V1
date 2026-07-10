# Environnement DEMO

DEMO n’est plus une instance séparée et `DEMO_MODE` n’existe plus. Le
sous-domaine `demo.ao-link.fr` utilise la même application et la même base
PostgreSQL que DMX, avec le tenant `demo`.

## Variables requises

```env
DEMO_HOST=demo.ao-link.fr
DEMO_USER_EMAIL=demo@ao-link.fr
DEMO_USER_PASSWORD=<secret>
```

`/api/public-config` fournit les identifiants préremplis uniquement lorsque la
requête provient de `DEMO_HOST`. Un compte extérieur au tenant DEMO ne peut pas
se connecter depuis ce sous-domaine.

## Initialisation et réinitialisation

Pour reconstruire manuellement les données DEMO :

```bash
cd server
npm run demo:reset
```

Le script :

- refuse un tenant qui n’est pas de type `demo` ;
- prend un verrou PostgreSQL ;
- reconstruit les données dans une transaction ;
- préserve le compte partagé ;
- révoque ses sessions après le reset.

Ne pas utiliser `demo:seed` ou `demo:reset` avec le rôle propriétaire du
schéma. `DATABASE_URL` doit utiliser le rôle runtime soumis à RLS.

## Planification

La tâche doit être exécutée à 03:00, heure de Paris. Exemple cron :

```cron
CRON_TZ=Europe/Paris
0 3 * * * cd /home/tao/TAO/TAO_V1/server && /usr/bin/npm run demo:reset >> /var/log/tao-demo-reset.log 2>&1
```

Sur PM2, l’entrée `tao-demo-reset` de `server/ecosystem.config.cjs` fournit la
même planification avec `TZ=Europe/Paris`.

## Message utilisateur

La page de connexion et l’application affichent en permanence :

> Environnement de démonstration : toutes les données saisies ici seront
> supprimées chaque jour à 03:00, heure de Paris.

Pour la procédure complète de sécurité et de déploiement, consulter
[MULTI_TENANT.md](MULTI_TENANT.md).
