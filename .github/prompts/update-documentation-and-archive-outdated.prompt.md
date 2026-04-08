---
name: "Mettre a jour la documentation"
description: "Met a jour la documentation existante du projet, archive les documents trop vieux ou obsoletes dans docs/_archive, et repare les index et liens associes"
argument-hint: "Portee ou objectif documentaire a traiter"
agent: "agent"
---
Mets a jour la documentation existante du projet en fonction de l'etat reel du code et de la structure actuelle du depot.

Argument utilisateur: ${input}

Objectif:
- garder la documentation utile, exacte et concise
- mettre a jour les documents existants plutot que recreer inutilement de nouveaux fichiers
- deplacer les documents trop vieux, redondants ou obsoletes dans `docs/_archive`
- corriger les index, sommaires, README et liens apres chaque deplacement

Contraintes:
- inspecter d'abord les fichiers de documentation concernes et le code source associe avant de modifier quoi que ce soit
- utiliser la structure d'archive existante sous `docs/_archive` au lieu d'inventer un nouvel emplacement
- ne pas supprimer un document simplement parce qu'il est vieux: l'archiver sauf si l'utilisateur demande explicitement la suppression
- preserver l'intention et l'historique utile, mais retirer les affirmations devenues fausses ou non verifiees
- si un document contient encore des instructions valides mais mal placees, le mettre a jour ou le deplacer plutot que le reecrire entierement
- si plusieurs documents se recouvrent, conserver une source principale et transformer les autres en archives ou references courtes

Procedure attendue:
1. Identifier les documents touches par la demande `${input}`.
2. Verifier leur exactitude contre le code, la configuration et la structure du depot.
3. Mettre a jour le contenu encore utile.
4. Deplacer les documents obsoletes, temporaires, redondants ou historiquement conserves vers `docs/_archive` avec une arborescence coherente.
5. Corriger les references croisees, les chemins, les README et les index documentaires impactes.
6. Signaler les points incertains seulement s'ils bloquent une decision raisonnable.

Critere de decision pour archiver un document:
- il decrit un etat ancien du projet
- il contredit la structure actuelle du depot
- il duplique largement une autre documentation plus a jour
- il correspond a un plan, audit, rapport ou livrable historique qui doit etre conserve mais non expose comme documentation active

Livrable attendu:
- effectuer directement les modifications dans le depot
- terminer par un resume concis indiquant:
  - les documents mis a jour
  - les documents deplaces vers `docs/_archive`
  - les liens ou index corriges
  - les zones encore ambiguës ou a valider

Fais des changements cibles, coherents avec le style existant du depot, sans etendre la portee au-dela de `${input}` sauf si c'est necessaire pour maintenir la coherence documentaire.