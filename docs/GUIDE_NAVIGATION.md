# Guide de navigation

## Connexion

La page `/login` permet de se connecter, de demander une réinitialisation de
mot de passe et d’accepter une invitation.

Sur `demo.ao-link.fr`, les identifiants du compte partagé sont préremplis et un
message rappelle que les données sont réinitialisées chaque jour à 03:00,
heure de Paris.

## Navigation principale

Après connexion, l’application donne accès aux espaces suivants selon le rôle :

- **Projets** : liste, création et sélection des projets du tenant actif ;
- **Tours** : phases de consultation et comparaisons ;
- **Lots** : articles, données MOE, entreprises et offres ;
- **Questions** : génération, édition et exports ;
- **Paramètres** : utilisateurs, invitations et réglages autorisés.

Un utilisateur ne voit jamais les données d’un autre tenant. Les identifiants
d’objets étrangers sont refusés sans en révéler le contenu.

## Sélecteur de tenant

Le sélecteur est visible uniquement pour le `platform_admin`. Une bascule :

1. exige un motif ;
2. remplace le tenant actif ;
3. ne crée pas de vue globale ;
4. génère un événement dans le journal d’audit.

Les autres utilisateurs restent dans leur unique tenant.

## Projets et tours

Depuis la liste des projets, un utilisateur autorisé peut ouvrir un projet,
modifier ses informations ou gérer ses partages. Dans un projet, la navigation
permet de sélectionner un tour puis un lot.

Les droits d’écriture dépendent du rôle :

- `tenant_admin` et `responsable` gèrent les données métier autorisées ;
- `visionneur` consulte les données accessibles ;
- `entreprise` intervient uniquement sur les données de l’entreprise associée.

## Lots, offres et questions

Un lot regroupe les lignes DPGF, les données MOE et les offres des entreprises.
Les écrans proposent notamment :

- import Excel ou presse-papiers ;
- édition et comparaison des offres ;
- gestion des options ;
- configuration et génération des questions ;
- exports Excel et Word.

## Administration

Le `tenant_admin` gère uniquement les utilisateurs et invitations de son
tenant. Il ne peut ni déplacer un compte vers un autre tenant ni attribuer le
rôle `platform_admin`.

Le `platform_admin` gère les tenants depuis les routes et écrans plateforme,
mais travaille toujours dans un tenant actif pour les opérations métier.

## En cas de problème

1. vérifier le tenant actif affiché ;
2. actualiser la session si une bascule vient d’être effectuée ;
3. vérifier `/api/healthz` pour un incident général ;
4. consulter [MAINTENANCE.md](MAINTENANCE.md) pour les contrôles techniques.
