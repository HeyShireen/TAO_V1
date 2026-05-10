# Schema de donnees PostgreSQL

Documentation consolidee depuis `server/src/app/schema.sql` et les migrations `server/src/app/migrations/*.sql`.

## Vue d'ensemble

L'application gere des affaires d'appel d'offres autour de cette hierarchie principale :

```mermaid
erDiagram
  users ||--o{ projects : owns
  projects ||--o{ lots : contains
  projects ||--o{ rounds : has
  lots ||--o{ items : contains
  items ||--o| moe_items : has_moe
  companies ||--o{ lot_companies : participates
  lots ||--o{ lot_companies : has_companies
  items ||--o{ offers : receives
  companies ||--o{ offers : submits
  rounds ||--o{ offers : scopes
  lots ||--o{ options : has
  options ||--o{ option_items : contains
  option_items ||--o| option_item_moe : has_moe
  option_items ||--o{ option_item_offers : receives
  generated_questions }o--|| lots : belongs_to
  generated_questions }o--|| rounds : belongs_to
  generated_questions }o--|| companies : concerns
```

Logique metier importante :

- Les `projects` representent les affaires.
- Les `lots` appartiennent a un projet.
- Les `items` sont les lignes DPGF d'un lot. Depuis la migration 006, ils sont partages entre les tours.
- Les `moe_items` portent l'estimation MOE par ligne DPGF. Ils sont aussi partages entre les tours.
- Les `rounds` representent les phases ou tours de consultation d'un projet.
- Les `offers` sont les reponses des entreprises. Elles sont specifiques a un `round_id`.
- Les `companies` sont associees aux lots via `lot_companies`.
- Les `generated_questions` stockent les fiches questions generees ou manuelles, par lot, tour, entreprise et ligne ou option.
- Les `options` representent des mini-lots optionnels, avec leurs propres lignes, MOE et offres.

## Cycle d'initialisation

Au demarrage, `ensureSchema()` dans `server/src/app/db.js` :

1. execute `server/src/app/schema.sql` ;
2. cree la table technique `migrations` si besoin ;
3. execute les migrations SQL triees par nom ;
4. cree ou promeut un administrateur si `ADMIN_EMAIL` et `ADMIN_PASSWORD` sont definis.

La table `migrations` contient :

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Identifiant technique |
| `name` | `TEXT UNIQUE NOT NULL` | Nom du fichier de migration execute |
| `executed_at` | `TIMESTAMPTZ DEFAULT now()` | Date d'execution |

## Domaine utilisateurs et acces

### `users`

Comptes applicatifs.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `BIGSERIAL PRIMARY KEY` | Identifiant utilisateur |
| `email` | `TEXT NOT NULL` | Email de connexion |
| `password_hash` | `TEXT NOT NULL` | Mot de passe hashe |
| `role` | `TEXT NOT NULL DEFAULT 'visionneur'` | Role applicatif : `admin`, `responsable`, `visionneur` |
| `company_id` | `INTEGER REFERENCES companies(id) ON DELETE SET NULL` | Entreprise rattachee, utile pour les comptes entreprise |
| `email_verified` | `BOOLEAN DEFAULT FALSE` | Statut de verification email |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Date de creation |

Index :

- `users_email_lower_idx` : unicite fonctionnelle sur `lower(email)`.
- `idx_users_company_id` : recherche par entreprise.

### `project_shares`

Partages d'affaires avec des utilisateurs.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `BIGSERIAL PRIMARY KEY` | Identifiant du partage |
| `project_id` | `BIGINT REFERENCES projects(id) ON DELETE CASCADE` | Projet partage |
| `shared_with_user_id` | `BIGINT REFERENCES users(id) ON DELETE CASCADE` | Utilisateur beneficiaire |
| `can_view` | `BOOLEAN DEFAULT true` | Droit de lecture |
| `can_edit` | `BOOLEAN DEFAULT false` | Droit d'ecriture |
| `shared_by_user_id` | `BIGINT REFERENCES users(id) ON DELETE SET NULL` | Auteur du partage |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Date de creation |

Contrainte : un seul partage par couple `(project_id, shared_with_user_id)`.

### `access_requests`

Demandes d'acces faites par les utilisateurs.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Identifiant |
| `user_id` | `INTEGER REFERENCES users(id) ON DELETE CASCADE` | Demandeur |
| `project_id` | `INTEGER REFERENCES projects(id) ON DELETE CASCADE`, nullable | Projet cible si connu |
| `project_name` | `TEXT`, nullable | Nom libre du projet demande |
| `message` | `TEXT` | Message du demandeur |
| `status` | `TEXT DEFAULT 'pending'` | `pending`, `approved`, `rejected` |
| `reviewed_by` | `INTEGER REFERENCES users(id) ON DELETE SET NULL` | Validateur |
| `reviewed_at` | `TIMESTAMPTZ` | Date de validation ou refus |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Date de demande |

Index uniques partiels :

- une demande `pending` par utilisateur et `project_name` ;
- une demande `pending` par utilisateur et `project_id`.

## Domaine projet, lots et DPGF

### `projects`

Affaires ou projets.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `BIGSERIAL PRIMARY KEY` | Identifiant projet |
| `name` | `TEXT NOT NULL` | Nom de l'affaire |
| `reference` | `TEXT` | Reference interne |
| `client` | `TEXT` | Client |
| `location` | `TEXT` | Localisation |
| `study_phase` | `TEXT` | Phase d'etude |
| `study_date` | `DATE` | Date d'etude |
| `created_by` | `BIGINT` | Ancien createur, sans cle etrangere depuis migration 002 |
| `owner_id` | `BIGINT REFERENCES users(id) ON DELETE SET NULL` | Proprietaire applicatif |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Date de creation |

### `lots`

Lots techniques d'une affaire.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `BIGSERIAL PRIMARY KEY` | Identifiant lot |
| `project_id` | `BIGINT REFERENCES projects(id) ON DELETE CASCADE` | Projet parent |
| `code` | `TEXT` | Code du lot |
| `macro_lot` | `TEXT` | Regroupement superieur |
| `name` | `TEXT NOT NULL` | Nom du lot |
| `sort_order` | `INTEGER DEFAULT 0` | Ordre d'affichage |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Date de creation |

Index :

- `idx_lots_project_id`
- `idx_lots_sort_order` sur `(project_id, sort_order)`
- `idx_lots_project_macro_lot` sur `(project_id, macro_lot)`

### `companies`

Entreprises consultantes ou repondantes.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `BIGSERIAL PRIMARY KEY` | Identifiant entreprise |
| `name` | `TEXT NOT NULL` | Nom |
| `color` | `TEXT` | Couleur d'affichage |
| `email` | `TEXT` | Email destinataire des fiches questions |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Date de creation |

### `lot_companies`

Association plusieurs-a-plusieurs entre lots et entreprises.

| Colonne | Type | Role |
| --- | --- | --- |
| `lot_id` | `BIGINT REFERENCES lots(id) ON DELETE CASCADE` | Lot |
| `company_id` | `BIGINT REFERENCES companies(id) ON DELETE CASCADE` | Entreprise |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Date d'association, aussi utilisee pour l'ordre d'affichage |

Cle primaire : `(lot_id, company_id)`.

### `items`

Lignes DPGF d'un lot.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `BIGSERIAL PRIMARY KEY` | Identifiant ligne |
| `lot_id` | `BIGINT REFERENCES lots(id) ON DELETE CASCADE` | Lot parent |
| `num` | `TEXT` | Numero de poste |
| `designation` | `TEXT` | Designation. Nullable depuis migration 003 |
| `unit` | `TEXT` | Unite MOE |
| `position` | `INTEGER` | Ordre dans le tableau importe |
| `source_company_id` | `BIGINT REFERENCES companies(id) ON DELETE SET NULL` | Entreprise source si poste ajoute par une entreprise |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Date de creation |

### `moe_items`

Estimation MOE pour une ligne DPGF.

| Colonne | Type | Role |
| --- | --- | --- |
| `item_id` | `BIGINT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE` | Ligne DPGF |
| `qty` | `NUMERIC` | Quantite MOE |
| `unit_price` | `NUMERIC` | Prix unitaire MOE |
| `amount` | `NUMERIC` | Montant MOE |
| `comment` | `TEXT` | Commentaire MOE |

Relation : un `item` a zero ou un `moe_items`.

### `offers`

Offres des entreprises pour les lignes DPGF. Contrairement aux items et MOE, les offres sont liees a un tour.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `BIGSERIAL PRIMARY KEY` | Identifiant offre |
| `item_id` | `BIGINT REFERENCES items(id) ON DELETE CASCADE` | Ligne DPGF |
| `company_id` | `BIGINT REFERENCES companies(id) ON DELETE CASCADE` | Entreprise |
| `round_id` | `INTEGER REFERENCES rounds(id) ON DELETE CASCADE` | Tour de consultation |
| `unit` | `TEXT` | Unite repondue |
| `qty` | `NUMERIC` | Quantite repondue |
| `unit_price` | `NUMERIC` | Prix unitaire repondu |
| `amount` | `NUMERIC` | Montant repondu |
| `comment` | `TEXT` | Commentaire importe ou saisi |
| `offer_designation` | `TEXT` | Designation entreprise si differente de la DPGF |

Contrainte finale : unicite `(item_id, company_id, round_id)`.

## Domaine tours et options

### `rounds`

Tours ou phases d'un projet.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Identifiant tour |
| `project_id` | `INTEGER REFERENCES projects(id) ON DELETE CASCADE` | Projet parent |
| `round_number` | `INTEGER NOT NULL` | Ordre logique : 0 = ouverture |
| `name` | `VARCHAR(255) NOT NULL` | Nom du tour |
| `description` | `TEXT` | Description |
| `status` | `VARCHAR(50) DEFAULT 'active'` | `active`, `closed`, `archived` |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Date de creation |

Contrainte : un seul tour par `(project_id, round_number)`.

### `round_lots`

Association entre tours et lots.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Identifiant |
| `round_id` | `INTEGER REFERENCES rounds(id) ON DELETE CASCADE` | Tour |
| `lot_id` | `INTEGER REFERENCES lots(id) ON DELETE CASCADE` | Lot |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Date d'association |

Contrainte : unicite `(round_id, lot_id)`.

### `options`

Mini-lots optionnels rattaches a un lot et a un tour.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Identifiant option |
| `lot_id` | `INT REFERENCES lots(id) ON DELETE CASCADE` | Lot parent |
| `round_id` | `INT REFERENCES rounds(id) ON DELETE CASCADE` | Tour parent |
| `designation` | `VARCHAR(255) NOT NULL` | Nom de l'option |
| `created_at` | `TIMESTAMP DEFAULT now()` | Date de creation |

Contrainte : unicite `(lot_id, round_id, designation)`.

### `option_items`

Lignes d'une option.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Identifiant ligne d'option |
| `option_id` | `INT REFERENCES options(id) ON DELETE CASCADE` | Option parent |
| `num` | `VARCHAR(50)` | Numero |
| `designation` | `VARCHAR(255)` | Designation |
| `unit` | `VARCHAR(50)` | Unite |
| `created_at` | `TIMESTAMP DEFAULT now()` | Date de creation |

### `option_item_moe`

MOE d'une ligne d'option.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Identifiant |
| `option_item_id` | `INT REFERENCES option_items(id) ON DELETE CASCADE` | Ligne d'option |
| `qty` | `DECIMAL(15,4)` | Quantite MOE |
| `unit_price` | `DECIMAL(15,4)` | Prix unitaire MOE |

Contrainte : unicite `option_item_id`.

### `option_item_offers`

Offres entreprises sur les lignes d'option.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Identifiant offre d'option |
| `option_item_id` | `INT REFERENCES option_items(id) ON DELETE CASCADE` | Ligne d'option |
| `company_id` | `INT REFERENCES companies(id) ON DELETE CASCADE` | Entreprise |
| `round_id` | `INT REFERENCES rounds(id) ON DELETE CASCADE` | Tour |
| `qty` | `DECIMAL(15,4)` | Quantite repondue |
| `unit_price` | `DECIMAL(15,4)` | Prix unitaire repondu |

Contrainte : unicite `(option_item_id, company_id, round_id)`.

## Domaine fiches questions

### `project_question_config`

Configuration des textes de questions au niveau projet.

| Colonne | Type | Role |
| --- | --- | --- |
| `project_id` | `BIGINT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE` | Projet configure |
| `question_qty_*` | `TEXT` | Textes pour ecarts de quantite |
| `question_price_*` | `TEXT` | Textes pour ecarts de prix unitaire |
| `question_amount_*` | `TEXT` | Textes pour ecarts de montant |
| `question_unit_mismatch` | `TEXT` | Texte pour incoherence d'unite |
| `unanswered_comment` | `TEXT` | Commentaire automatique pour article sans reponse |
| `unanswered_color` | `TEXT` | Couleur d'affichage pour article sans reponse |
| `offer_amount_mismatch_comment` | `TEXT` | Commentaire automatique si montant importe incoherent |
| `updated_at` | `TIMESTAMPTZ DEFAULT now()` | Date de mise a jour |

Les suffixes utilises sont notamment `very_low`, `low`, `high`, `very_high`.

### `lot_threshold_config`

Configuration des seuils de declenchement au niveau lot.

| Colonne | Type | Role |
| --- | --- | --- |
| `lot_id` | `BIGINT PRIMARY KEY REFERENCES lots(id) ON DELETE CASCADE` | Lot configure |
| `qty_*_threshold` | `NUMERIC` | Seuils quantite |
| `price_*_threshold` | `NUMERIC` | Seuils prix unitaire |
| `amount_*_threshold` | `NUMERIC` | Seuils montant |
| `updated_at` | `TIMESTAMPTZ DEFAULT now()` | Date de mise a jour |

### `generated_questions`

Questions generees automatiquement ou creees manuellement.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `BIGSERIAL PRIMARY KEY` | Identifiant question |
| `lot_id` | `BIGINT REFERENCES lots(id) ON DELETE CASCADE` | Lot concerne |
| `round_id` | `INTEGER REFERENCES rounds(id) ON DELETE CASCADE` | Tour concerne |
| `item_id` | `BIGINT REFERENCES items(id) ON DELETE CASCADE`, nullable | Ligne DPGF concernee |
| `option_item_id` | `BIGINT REFERENCES option_items(id) ON DELETE CASCADE`, nullable | Ligne d'option concernee |
| `company_id` | `BIGINT REFERENCES companies(id) ON DELETE CASCADE` | Entreprise concernee |
| `question_type` | `TEXT NOT NULL` | Type de question |
| `question_text` | `TEXT NOT NULL` | Texte final |
| `moe_value` | `NUMERIC` | Valeur MOE comparee |
| `offer_value` | `NUMERIC` | Valeur entreprise comparee |
| `deviation_pct` | `NUMERIC` | Ecart en pourcentage |
| `status` | `TEXT DEFAULT 'pending'` | `pending`, `answered`, `dismissed` |
| `comment` | `TEXT` | Commentaire / reponse interne |
| `answered_at` | `TIMESTAMPTZ` | Date de reponse |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Date de creation |

Types valides finaux :

- `qty_very_low`, `qty_low`, `qty_high`, `qty_very_high`
- `price_very_low`, `price_low`, `price_high`, `price_very_high`
- `amount_very_low`, `amount_low`, `amount_high`, `amount_very_high`
- `unit_mismatch`
- `manual`

Contraintes :

- une question cible soit un `item_id`, soit un `option_item_id`, mais jamais les deux ;
- unicite partielle par `(round_id, lot_id, item_id, company_id, question_type)` quand `item_id` est renseigne ;
- unicite partielle par `(round_id, lot_id, option_item_id, company_id, question_type)` quand `option_item_id` est renseigne.

### `question_sheets`

Ancien systeme RAO de fiches questions liees directement aux items. La migration 005 supprime cette table si elle provenait de l'ancien modele `rounds` par lot, puis le code actuel continue a l'utiliser dans `routes/questions/index.js`.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `BIGSERIAL PRIMARY KEY` | Identifiant |
| `round_id` | `BIGINT REFERENCES rounds(id) ON DELETE CASCADE` | Tour |
| `item_id` | `BIGINT REFERENCES items(id) ON DELETE CASCADE` | Ligne DPGF |
| `company_id` | `BIGINT REFERENCES companies(id) ON DELETE CASCADE` | Entreprise |
| `question_type` | `TEXT NOT NULL` | Type de question |
| `question` | `TEXT NOT NULL` | Texte |
| `moe_qty` | `NUMERIC` | Quantite MOE au moment de la generation |
| `company_qty` | `NUMERIC` | Quantite entreprise |
| `difference_percent` | `NUMERIC` | Ecart |
| `response` | `TEXT` | Reponse entreprise |
| `response_date` | `DATE` | Date de reponse |
| `status` | `TEXT DEFAULT 'pending'` | Statut |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Creation |
| `updated_at` | `TIMESTAMPTZ DEFAULT now()` | Mise a jour |

### `question_sheet_sends`

Historique des envois de fiches questions par email.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `BIGSERIAL PRIMARY KEY` | Identifiant envoi |
| `lot_id` | `BIGINT REFERENCES lots(id) ON DELETE CASCADE` | Lot |
| `round_id` | `BIGINT REFERENCES rounds(id) ON DELETE CASCADE` | Tour |
| `company_id` | `BIGINT REFERENCES companies(id) ON DELETE CASCADE` | Entreprise |
| `sent_at` | `TIMESTAMPTZ DEFAULT now()` | Date d'envoi |
| `sent_by` | `BIGINT REFERENCES users(id) ON DELETE SET NULL` | Utilisateur emetteur |
| `sent_to_email` | `TEXT NOT NULL` | Adresse destinataire |
| `email_subject` | `TEXT` | Sujet email |

Contrainte : unicite `(lot_id, round_id, company_id, sent_at)`.

## Domaine securite

### `email_verifications`

Tokens de verification d'email.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Identifiant |
| `user_id` | `INTEGER REFERENCES users(id) ON DELETE CASCADE` | Utilisateur |
| `token` | `TEXT UNIQUE NOT NULL` | Token |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | Expiration |
| `verified_at` | `TIMESTAMPTZ` | Date de validation |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Creation |

### `password_resets`

Tokens de reinitialisation de mot de passe.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `BIGSERIAL PRIMARY KEY` | Identifiant |
| `user_id` | `BIGINT REFERENCES users(id) ON DELETE CASCADE` | Utilisateur |
| `token` | `TEXT UNIQUE NOT NULL` | Token |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | Expiration |
| `used_at` | `TIMESTAMPTZ` | Date d'utilisation |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Creation |

### `refresh_tokens`

Refresh tokens avec rotation.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Identifiant |
| `user_id` | `BIGINT REFERENCES users(id) ON DELETE CASCADE` | Utilisateur |
| `token` | `VARCHAR(255) UNIQUE NOT NULL` | Token |
| `family` | `VARCHAR(255)` | Famille de rotation |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | Expiration |
| `revoked_at` | `TIMESTAMPTZ` | Revocation |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Creation |
| `rotation_count` | `INT DEFAULT 0` | Nombre de rotations |

### `suspicious_token_attempts`

Journal des reutilisations suspectes de refresh tokens.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Identifiant |
| `user_id` | `BIGINT REFERENCES users(id) ON DELETE CASCADE` | Utilisateur |
| `token_family` | `VARCHAR(255)` | Famille concernee |
| `ip_address` | `VARCHAR(45)` | Adresse IP |
| `user_agent` | `TEXT` | User agent |
| `attempted_at` | `TIMESTAMPTZ DEFAULT now()` | Date de detection |

### `honeypot_attempts`

Journal anti-bot des champs pieges remplis.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Identifiant |
| `ip_address` | `VARCHAR(45)` | Adresse IP |
| `user_agent` | `TEXT` | User agent |
| `endpoint` | `VARCHAR(100)` | Endpoint cible |
| `filled_fields` | `JSONB` | Champs honeypot remplis |
| `detected_at` | `TIMESTAMPTZ DEFAULT now()` | Date de detection |

## Tables historiques ou de compatibilite

### `moe`

Table legacy conservee pour compatibilite. Le modele actif utilise `moe_items`.

| Colonne | Type | Role |
| --- | --- | --- |
| `id` | `BIGSERIAL PRIMARY KEY` | Identifiant |
| `item_id` | `BIGINT UNIQUE REFERENCES items(id) ON DELETE CASCADE` | Ligne DPGF |
| `qty` | `NUMERIC` | Quantite |
| `unit_price` | `NUMERIC` | Prix unitaire |

### `round_offers`

Table historique issue du premier systeme RAO. Elle est supprimee lors de la migration 005 si l'ancien modele de `rounds` par lot est detecte. Le modele courant utilise `offers.round_id`.

## Points d'attention

- `schema.sql` et le `defaultSchemaSQL()` de `db.js` ne sont pas strictement identiques. Par exemple `defaultSchemaSQL()` cree un index unique `companies_name_lower_idx`, alors que `schema.sql` ne le cree pas.
- Les importeurs `excel.js` et `clipboard.js` utilisent `ON CONFLICT (name)` sur `companies`, ce qui necessite une contrainte unique ou un index unique simple sur `companies(name)`. L'index fonctionnel sur `lower(name)` ne suffit pas pour cette clause.
- Plusieurs migrations ont corrige des modeles precedents. Pour comprendre l'etat final, il faut lire `schema.sql` plus toutes les migrations executees, pas seulement le fichier initial.
- Les `items` et `moe_items` ne dependent plus des tours ; les `offers` et `generated_questions` en dependent.
- `generated_questions` peut cibler soit une ligne DPGF (`item_id`), soit une ligne d'option (`option_item_id`).

