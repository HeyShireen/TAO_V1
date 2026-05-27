# Sécurité AO Link

Ce document décrit les mécanismes de sécurité visibles dans le code actuel. Il remplace les anciennes syntheses d'audit qui sont conservées dans `docs/_archive/`.

## démarrage securise

Le serveur charge `server/src/app/security-init.js` avant Express. Les contrôles verifies au démarrage sont notamment:
- presence de `JWT_SECRET`
- longueur minimale de `JWT_SECRET`
- presence de `DATABASE_URL`
- presence de `ALLOWED_ORIGINS` en production
- journalisation des variables critiques et optionnelles configurées

Si une variable critique manque, le processus s'arrete.

## CORS

La politique CORS est definie dans `server/src/app/server.js`.

Comportement actuel:
- en production, seules les origines declarees dans `ALLOWED_ORIGINS` sont acceptees
- en développement, une liste localhost est acceptée en plus des origines configurées
- les credentials sont actives

En production, l'absence de `ALLOWED_ORIGINS` provoque l'arret du serveur.

## Headers HTTP et CSP

Le serveur utilisé `helmet` avec notamment:
- CSP active
- `frameguard: deny`
- `referrerPolicy: strict-origin-when-cross-origin`
- HSTS active uniquement si `HTTPS_PROXY=true`

Particularite importante du code actuel:
- la CSP autorise encore `unsafe-inline` pour les scripts et styles de l'interface actuelle
- `upgrade-insecure-requests` n'est ajoute que si l'application est explicitement derriere un proxy HTTPS

Cela correspond au fonctionnement present du frontend, mais ce n'est pas une CSP stricte au sens maximal.

## Limitation de debit

Deux niveaux principaux sont appliques:

- limite globale API: `2000` requetes / 15 minutes en production, `10000` en développement
- limite auth IP: `5` tentatives / minute sur `/api/auth/*`, avec Réponse de cooldown detaillee

Un limiteur supplémentaire par email est utilisé dans les routes d'authentification via le middleware de sécurité.

## Authentification et sessions

Le système combine plusieurs mécanismes:

- hash de mot de passe via `bcrypt`
- JWT signes avec `JWT_SECRET`
- cookie HttpOnly `auth`
- refresh token en base avec rotation
- blacklist de JWT via Redis pour la révocation

Endpoints notables:
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/refresh`
- `POST /api/auth/logout-everywhere`

État exact du code:
- le JWT retourne par `sign()` est signe avec `expiresIn: '7d'`
- le cookie `auth` pose au login expire au bout de 15 minutes
- un cookie `refreshToken` expire au bout de 30 jours
- le frontend recoit aussi le JWT dans la Réponse JSON

La révocation des JWT repose sur Redis. Si Redis est indisponible, le middleware retombe sur une vérification JWT seule afin de ne pas bloquer toute l'application.

## Refresh tokens

Le flux de refresh est implemente:
- stockage en base dans `refresh_tokens`
- rotation a chaque refresh
- révocation sur logout
- révocation globale via `logout-everywhere`
- journalisation des reutilisations suspectes dans `suspicious_token_attempts`

Le code declenche aussi une detection d'abus sur les reutilisations suspectes d'une meme famille de tokens.

## vérification email et reset mot de passe

Fonctions actuellement présentes:
- vérification d'email avec token en base et expiration 24h
- renvoi de mail de vérification avec cooldown
- oubli de mot de passe avec token temporaire
- formulaire HTML de reinitialisation servi par l'API

Les inscriptions autres que le tout premier compte restent bloquees tant que l'email n'est pas vérifié.

## Honeypot et anti-bots

Le middleware `server/src/app/middleware/honeypot.js` vérifié des champs pieges sur certaines routes d'authentification.

État actuel:
- champs surveilles: `website_url`, `phone_number`, `company_name`
- en cas de declenchement, la requête est absorbee avec une Réponse de Succès factice
- une tentative de journalisation en base est faite dans `honeypot_attempts`

Attention:
- la journalisation honeypot depend de l'existence de la table `honeypot_attempts`
- le middleware degrade silencieusement si cette table n'existe pas

## Protections applicatives complementaires

- sanitation globale des inputs
- vérification des permissions par Rôle
- masquage des données MOE pour les comptes `entreprise`
- filtrage `company_id` sur plusieurs routes métier sensibles
- taille JSON limitee a `10mb`

## Secrets et configuration

Ne jamais versionner:
- `JWT_SECRET`
- `DATABASE_URL` avec identifiants
- `EMAIL_PASS`
- `REDIS_URL` si l'instance n'est pas publique

En production, Vérifier au minimum:
- `NODE_ENV=production`
- `ALLOWED_ORIGINS` renseigne
- `JWT_SECRET` fort
- `HTTPS_PROXY=true` si TLS termine par nginx ou autre reverse proxy
- `REDIS_URL` configuré si la révocation JWT doit être effective

## contrôles manuels recommandes

Vérifier regulierement:
- qu'une origine non autorisee est bien rejetee en production
- que `GET /api/healthz` remonte l'État attendu de Redis et PostgreSQL
- qu'un compte `entreprise` ne voit ni les Données MOE ni les offres des autres entreprises
- que le cycle login -> refresh -> logout -> logout everywhere reste fonctionnel

## Limites connues a garder en tete

- le JWT signe 7 jours et le cookie `auth` 15 minutes ne refletent pas exactement la meme duree de session
- la blacklist JWT perd de sa valeur si Redis est indisponible
- la CSP reste permissive pour supporter l'interface actuelle
