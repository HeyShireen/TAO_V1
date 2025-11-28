# Guide de Maintenance

Ce document décrit les procédures régulières pour garder le système RAO / Comparateur d'offres fiable, sécurisé et performant.

## 1. Architecture Rappel
- API Node.js (`server/`) + PostgreSQL.
- Frontend HTML/JS dans `server/public/` (chargé via Express static).
- Authentification par JWT (payload: `id`, `role`, `company_id`).
- Migrations SQL dans `server/src/migrations/` appliquées au démarrage par `init-db.js`.

## 2. Variables d'environnement
Fichier `.env` (copie de `.env.example`):
- `DATABASE_URL`: Connexion PostgreSQL.
- `JWT_SECRET`: Clé secrète (changer immédiatement en prod, longueur >= 32 chars).
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (si emails activés).

Changer les secrets impliquant: invalider les anciens tokens et forcer reconnexion.

## 3. Cycle de Mise à Jour Dépendances
1. Vérifier vulnérabilités: 
   ```powershell
   cd server
   npm audit
   ```
2. Mettre à jour patch/minor sans rupture:
   ```powershell
   npm outdated
   npm install <package>@latest
   ```
3. Tester démarrage:
   ```powershell
   npm run dev
   ```
4. Si mise à jour majeure: lire CHANGELOG du module (ex: Express, pg, jsonwebtoken).
5. Après update: lancer exports Excel pour valider que `exceljs` fonctionne toujours.

## 4. Migrations Base de Données
- Nouveau fichier: `server/src/migrations/XXX_description.sql` (numéro incrémental).
- Script d'initialisation `server/src/tools/init-db.js` exécute toutes les migrations triées par nom.
- Procédure:
  1. Créer migration SQL (DDL idempotent si possible: utiliser `IF NOT EXISTS`).
  2. Démarrer serveur local pour appliquer.
  3. Vérifier schéma: 
     ```sql
     \d users
     \d offers
     ```
  4. Commiter.
- Rollback manuel: créer migration corrective plutôt que supprimer une migration existante.

### Ajout de colonnes sensibles
Pour colonne liée à sécurité (ex: `users.company_id`):
1. Ajouter colonne + index.
2. Adapter payload JWT (`auth.js`).
3. Adapter middleware d'accès (ex: filtrage entreprise dans `lots.js`).

## 5. Rôles et Sécurité
Rôles actuels:
- `admin`: accès total.
- `responsable`: gestion projets/lots/questions, pas configuration critique sécurité.
- `visionneur`: lecture seule (pas de modification).
- `entreprise`: accès restreint à ses propres offres + ses fiches questions; ne voit pas MOE ni autres entreprises.

Points à vérifier après toute évolution:
- Endpoints masquant correctement MOE pour `entreprise` (`lots.js` GET `/:id`, `/:id/table`).
- Filtrage des offres par `company_id` pour rôle `entreprise` (implémenté).
- Filtrage des questions par `company_id` pour rôle `entreprise` (implémenté dans `questions.js`).
- Blocage création/suppression fiches questions par `entreprise` (implémenté).
- Ne jamais faire confiance au frontend pour la sécurité; vérifier côté serveur. (ZeroTRUST : https://cyber.gouv.fr/publications/zero-trust)

Checklist rapide sécurité:
- [ ] `helmet` actif.
- [ ] Rate limit configuré (login, register) si charge externe.
- [ ] Mot de passe: règles de complexité (validées côté frontend + backend).
- [ ] JWT expirations (si nécessaire ajouter `exp`).
- [x] Filtrage entreprise sur lots (MOE masqué + offres restreintes).
- [x] Filtrage entreprise sur questions (lecture limitée + update restreinte).

## 6. Sauvegardes
Stratégie recommandée:
- Dump quotidien base:
  ```powershell
  pg_dump -Fc -U postgres -d offer_compare > backups/offer_compare_$(Get-Date -Format yyyyMMdd).dump
  ```
- Rotation 7 jours. Vérifier restauration mensuelle:
  ```powershell
  pg_restore -l backups/offer_compare_20251127.dump
  ```
- Conserver clé `JWT_SECRET` séparément (backup chiffré). Sans la clé, sessions existantes invalidées, mais données intactes.

## 7. Gestion des Exports
- Fichier `server/src/routes/exports.js` gère Excel (lib `exceljs`).
- Après mise à jour de colonnes ou logiques de prix: ajuster mapping dans exports pour éviter colonnes vides.
- Vérifier format monétaire (utiliser format Excel `#,##0.00 €`).
- Ajout de nouvelle feuille → maintenir cohérence des largeurs, en-têtes, style gras et bordures.

## 8. Performance & Agrégations
Optimisations déjà en place:
- Endpoint rounds agrégé (`/rounds/project/:id/with-stats`) réduit N+1.
- Lot unique combine items + offres + entreprises.

À surveiller si croissance:
- Index sur `offers(round_id, item_id)`.
- Index sur `moe_items(item_id)` (normalement PK ou unique déjà).
- Ajouter pagination si nombre d'items > 10k.

## 9. Procédure d'Analyse d'Écart (Futures évolutions)
- Génération automatique questions: seuil configurable.
- Ajouter prochainement: détection anomalies prix (`price_anomaly`).
- Documenter algorithme quand implémenté (section à compléter).

## 10. Nettoyage & Archivage
- Archiver projets terminés: ajouter colonne `projects.archived_at` (future migration) puis exclure des listes actives.
- Purger tokens invalides (si stockage futur) — actuellement JWT stateless, rien à purger.
- Nettoyer uploads temporaires (si ajout future fonctionnalité import avancé via fichiers).

## 11. Procédure de Release
1. Créer branche `release/x.y.z`.
2. Mettre à jour `package.json` version.
3. Vérifier migrations non appliquées.
4. Exécuter tests manuels clés: login, import Excel, export Excel, création lot, rôle entreprise accès limité.
5. Tag git et déployer.

## 12. Diagnostic Rapide
Commande | Objectif
---------|---------
`SELECT count(*) FROM offers;` | Taille table offres
`EXPLAIN ANALYZE SELECT * FROM offers WHERE round_id=...;` | Vérifier index
`grep -R "company_id" server/src/routes` | Vérifier filtrages

## 13. À Faire (Maintenance Documentation)
- Filtrage questions pour `entreprise` (limiter visibilité).
- Documenter algorithme anomalies prix une fois implémenté.
- Ajouter section sur tests automatisés (quand présents).

## 14. Bonnes Pratiques Code
- Limiter logique métier dans routes → extraire fonctions utilitaires si complexité augmente.
- Garder SQL lisible; éviter concaténation non paramétrée (risques injection).
- Préférer `json_agg` côté SQL pour réduire recomposition JS.

## 15. Glossaire
Terme | Signification
------|--------------
MOE | Maîtrise d'Œuvre (référence estimative)
Offre | Proposition entreprise (quantité + prix)
Tour | Snapshot des offres à une date
Fiche question | Demande d'explication ou justification envoyée à une entreprise

---
Dernière mise à jour: 2025-11-27
