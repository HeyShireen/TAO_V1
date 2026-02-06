# Cahier des charges - TAO V1 (Tableau d'Analyse des Offres)

## 1. Contexte et objectifs
TAO V1 est une application web destinee a analyser et comparer des offres (entreprises) face a un referentiel MOE. Elle structure les projets en lots et en rounds, genere des questions de RAO et fournit des exports pour la prise de decision.

Objectifs principaux :
- Centraliser les projets, lots, articles et offres dans un referentiel unique.
- Comparer les prix MOE aux propositions des entreprises par round.
- Generer et exporter des tableaux d'analyse et des questions RAO.
- Assurer une gestion securisee des acces (roles, verification email, mots de passe).

## 2. Perimetre fonctionnel
Inclus :
- Gestion des projets, lots, rounds, articles, options.
- Import d'offres via Excel.
- Comparaison MOE vs entreprises, par round.
- Generation de questions RAO.
- Export des analyses (Excel et Word).
- Gestion des utilisateurs et entreprises, droits par role.

Exclus (perimetre non couvert) :
- Interfacage temps reel avec des ERP externes.
- Stockage objet ou GED avancee.
- Gestion avancee des workflows juridiques (signature electronique, etc.).

## 3. Parties prenantes et utilisateurs
Roles applicatifs :
- Admin : administration globale, gestion des utilisateurs, projets et parametres.
- Responsable : gestion complete des projets et analyses.
- Lecteur/Visionneur : acces en lecture a des analyses et exports.
- Entreprise : acces limite a ses propres offres, sans visibilite sur le MOE ni les autres entreprises.

## 4. Parcours utilisateurs cle
- Creation d'un projet puis des lots associes.
- Importation d'offres Excel et affectation aux entreprises.
- Comparaison MOE vs offres par round.
- Generation des questions RAO a partir des ecarts ou conditions definies.
- Export des analyses (tableaux comparatifs, RAO) en Excel et Word.

## 5. Fonctionnalites detaillees
### 5.1 Projets
- Creation, modification, suppression de projets.
- Parametrage des rounds (iterations d'analyse).

### 5.2 Lots
- Ajout et organisation des lots dans un projet.
- Ordonnancement des lots et des articles.

### 5.3 Articles et options
- Gestion des articles (lignes) par lot.
- Gestion d'options (ajout, suppression, parametres).

### 5.4 Offres et comparaison
- Import d'offres depuis Excel (mapping et validation).
- Comparaison MOE vs entreprises par lot et round.
- Calculs et visualisations des ecarts.

### 5.5 RAO (Questions)
- Generation automatique de questions RAO.
- Association des questions aux lots et rounds.

### 5.6 Exports
- Export Excel des analyses (tableaux comparatifs).
- Export Word des syntheses ou RAO.

### 5.7 Gestion des utilisateurs et entreprises
- Creation d'utilisateurs et attribution de roles.
- Gestion des entreprises et affectation des offres.
- Verification email, reset mot de passe, controle d'acces.

## 6. Exigences non fonctionnelles
### 6.1 Performance
- Temps de chargement raisonnable pour projets volumineux.
- Imports Excel robustes avec validation avant integration.

### 6.2 Securite
- Authentification JWT, hachage de mots de passe (bcrypt).
- Protections contre XSS/CSRF, headers stricts, rate limiting.
- Verification des permissions par role et validation stricte des IDs.
- Journalisation des acces sensibles.

### 6.3 Disponibilite et sauvegardes
- Sauvegardes regulieres de la base PostgreSQL.
- Procedures de restauration documentees.

### 6.4 Compatibilite
- Application web accessible via navigateur moderne.
- Interface SPA en JavaScript vanilla.

## 7. Architecture technique
- Backend : Node.js 18+, Express (ESM).
- Frontend : SPA statique (JS, HTML, CSS), servie par Express.
- Base de donnees : PostgreSQL 14+.
- Exports : ExcelJS (Excel), docx (Word).

## 8. Donnees et modeles
Entites principales :
- Projet, Lot, Round, Article, Option.
- Offre, Entreprise, Utilisateur, Role.
- Question RAO.

Contraintes :
- Un projet contient plusieurs lots.
- Les lots contiennent des articles et options.
- Une offre est associee a une entreprise et un round.

## 9. Integrations
- SMTP pour verification email et reinitialisation mot de passe.
- Imports Excel pour les offres.

## 10. Exploitation et deploiement
- Deploiement compatible Render (fichier render.yaml).
- Alternatives possibles : Docker ou systemd.
- Verification des variables d'environnement au demarrage.

## 11. Maintenance
- Scripts de test securite et validation.
- Documentation des correctifs et evolutions.
- Mises a jour dependances planifiees.

## 12. Tests et validation
- Tests de securite (scripts fournis).
- Validation des exports Excel/Word.
- Verification des permissions par role.

## 13. Livrables attendus
- Application web operationnelle (frontend + backend).
- Documentation technique et securite.
- Scripts de deploiement et maintenance.
- Cahier de tests et resultats.

## 14. Criteres d'acceptation
- Imports Excel sans erreurs critiques.
- Exports Excel/Word conformes au format attendu.
- Gestion des roles conforme aux regles definies.
- Respect des exigences de securite et audit.

## 15. Risques et dependances
- Qualite des fichiers Excel importes (format, mapping).
- Complexite des projets multi-lots et multi-rounds.
- Evolution des exigences de securite.

## 16. Annexes (sources)
- README, guide technique, maintenance, securite et audits.
