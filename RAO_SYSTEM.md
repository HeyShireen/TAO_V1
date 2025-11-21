# Système RAO (Relevé d'Appel d'Offres)

## Vue d'ensemble

Le système RAO permet de gérer plusieurs tours de négociation pour un lot, avec génération automatique de fiches questions basées sur les écarts entre quantités MOE et entreprises.

## Structure

### 1. Tours (`rounds`)
Chaque lot peut avoir plusieurs tours :
- **Tour 0** : Ouverture des offres (snapshot initial)
- **Tour 1** : Premier tour de négociation
- **Tour 2** : Deuxième tour
- etc.

Chaque tour capture un snapshot des offres à un moment donné.

### 2. Fiches Questions (`question_sheets`)
Questions générées automatiquement ou manuellement entre les tours :
- **Type `qty_difference`** : Écart significatif entre quantités MOE et entreprise
- **Type `price_anomaly`** : Anomalie de prix (à implémenter)
- **Type `manual`** : Question manuelle créée par l'utilisateur

### 3. Snapshots des offres (`round_offers`)
Historique des offres à chaque tour pour traçabilité.

## API Endpoints

### Tours

#### Créer un tour
```http
POST /api/rounds
Content-Type: application/json

{
  "lot_id": 1,
  "round_number": 0,
  "name": "Ouverture des offres",
  "date": "2025-11-21",
  "notes": "Premier tour"
}
```

#### Liste des tours d'un lot
```http
GET /api/rounds/lot/:lotId
```

Retourne les tours avec le nombre de questions et réponses.

#### Détails d'un tour
```http
GET /api/rounds/:id
```

Retourne le tour avec toutes ses offres.

#### Générer les fiches questions automatiquement
```http
POST /api/rounds/:id/generate-questions
Content-Type: application/json

{
  "threshold": 10  // Seuil d'écart en % (optionnel, défaut: 10%)
}
```

Génère automatiquement des fiches questions pour tous les articles où l'écart entre quantité MOE et quantité entreprise dépasse le seuil.

### Fiches Questions

#### Liste des questions d'un tour
```http
GET /api/questions/round/:roundId?status=pending
```

Paramètres query optionnels :
- `status` : `pending`, `answered`, `resolved`

#### Liste des questions d'un lot (tous tours)
```http
GET /api/questions/lot/:lotId
```

#### Créer une question manuelle
```http
POST /api/questions
Content-Type: application/json

{
  "round_id": 1,
  "item_id": 5,
  "company_id": 2,
  "question": "Pouvez-vous justifier votre prix unitaire ?"
}
```

#### Mettre à jour une question (ajouter réponse)
```http
PUT /api/questions/:id
Content-Type: application/json

{
  "response": "L'écart s'explique par...",
  "status": "answered",
  "response_date": "2025-11-22"
}
```

#### Supprimer une question
```http
DELETE /api/questions/:id
```

#### Exporter les questions d'un tour
```http
GET /api/questions/round/:roundId/export?format=json
```

## Workflow typique

### 1. Ouverture des offres
```javascript
// Créer le tour d'ouverture
const round0 = await fetch('/api/rounds', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    lot_id: 1,
    round_number: 0,
    name: "Ouverture des offres",
    date: "2025-11-21"
  })
})

// Générer automatiquement les fiches questions (écarts > 10%)
await fetch(`/api/rounds/${round0.id}/generate-questions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ threshold: 10 })
})
```

### 2. Consultation des questions
```javascript
// Récupérer toutes les questions du tour
const questions = await fetch(`/api/questions/round/${round0.id}`)

// Exemple de question générée automatiquement :
// {
//   "id": 1,
//   "round_id": 1,
//   "item_id": 5,
//   "company_id": 2,
//   "question_type": "qty_difference",
//   "question": "Écart de 25% sur les quantités - Article A1.2.3 \"Dalle béton\": MOE = 100 m², Entreprise ABC = 125 m². Merci de justifier cet écart.",
//   "moe_qty": 100,
//   "company_qty": 125,
//   "difference_percent": 25.00,
//   "status": "pending"
// }
```

### 3. Réponse aux questions
```javascript
// L'entreprise répond
await fetch(`/api/questions/1`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    response: "L'écart s'explique par des surfaces additionnelles identifiées sur site",
    status: "answered",
    response_date: "2025-11-22"
  })
})
```

### 4. Premier tour de négociation
```javascript
// Après analyse des réponses, créer le 1er tour
const round1 = await fetch('/api/rounds', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    lot_id: 1,
    round_number: 1,
    name: "1er tour",
    date: "2025-11-25"
  })
})

// Générer à nouveau les fiches questions si besoin
await fetch(`/api/rounds/${round1.id}/generate-questions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ threshold: 5 }) // Seuil plus strict au 2ème tour
})
```

## Génération automatique des fiches questions

Le système analyse automatiquement les écarts et génère des questions pour :

### Écarts de quantités
- Compare `moe_items.qty` avec `offers.qty`
- Calcule le pourcentage d'écart
- Génère une question si l'écart absolu dépasse le seuil

**Exemple de question générée** :
> Écart de 25% sur les quantités - Article A1.2.3 "Dalle béton": MOE = 100 m², Entreprise ABC = 125 m². Merci de justifier cet écart.

### Extensibilité future
Le système est conçu pour accepter d'autres types d'analyses :
- Anomalies de prix unitaires
- Incohérences d'unités
- Variations importantes entre tours
- etc.

## Intégration frontend

### Affichage RAO complet
Pour afficher le RAO complet d'un lot avec tous les tours :

```javascript
async function displayRAO(lotId) {
  // 1. Récupérer tous les tours
  const rounds = await fetch(`/api/rounds/lot/${lotId}`).then(r => r.json())
  
  // 2. Pour chaque tour, récupérer les offres
  for (const round of rounds) {
    const details = await fetch(`/api/rounds/${round.id}`).then(r => r.json())
    console.log(`${round.name}:`, details.offers)
    
    // 3. Récupérer les fiches questions
    const questions = await fetch(`/api/questions/round/${round.id}`).then(r => r.json())
    console.log(`Questions (${questions.length}):`, questions)
  }
}
```

### Vue tableau RAO
```
┌────────────────────────────────────────────────────────┐
│ RELEVÉ D'APPEL D'OFFRES - LOT 1                        │
├────────────────────────────────────────────────────────┤
│ OUVERTURE DES OFFRES - 21/11/2025                      │
├────────┬──────────┬────────────┬───────────┬───────────┤
│ Article│ Désign.  │ Entreprise │  Quantité │ Prix Unit │
├────────┼──────────┼────────────┼───────────┼───────────┤
│ A1.2.3 │ Dalle... │ MOE        │ 100 m²    │ 150 €     │
│        │          │ Ent. ABC   │ 125 m²    │ 145 €     │
│        │          │ Ent. XYZ   │ 110 m²    │ 155 €     │
└────────┴──────────┴────────────┴───────────┴───────────┘

┌────────────────────────────────────────────────────────┐
│ FICHES QUESTIONS                                        │
├────────────────────────────────────────────────────────┤
│ Q1. [Ent. ABC] Écart de 25% sur quantités...          │
│     Réponse: Surfaces additionnelles sur site          │
├────────────────────────────────────────────────────────┤
│ Q2. [Ent. XYZ] Prix unitaire supérieur à MOE...       │
│     Réponse: En attente                                 │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ 1ER TOUR - 25/11/2025                                  │
├────────┬──────────┬────────────┬───────────┬───────────┤
│ Article│ Désign.  │ Entreprise │  Quantité │ Prix Unit │
├────────┼──────────┼────────────┼───────────┼───────────┤
│ A1.2.3 │ Dalle... │ MOE        │ 100 m²    │ 150 €     │
│        │          │ Ent. ABC   │ 100 m²    │ 140 € ⬇   │
│        │          │ Ent. XYZ   │ 105 m²    │ 148 € ⬇   │
└────────┴──────────┴────────────┴───────────┴───────────┘
```

## Migration de données

La migration `001_add_rao_system.sql` crée automatiquement :
- ✅ Table `rounds`
- ✅ Table `question_sheets`
- ✅ Table `round_offers`
- ✅ Indexes de performance
- ✅ Fonction `calculate_difference_percent()`

Aucune action manuelle requise, la migration s'exécute automatiquement au démarrage du serveur.

## Prochaines étapes

1. **Interface frontend** : Créer les vues pour afficher et gérer les tours/questions
2. **Export PDF** : Générer un document RAO imprimable
3. **Notifications** : Alerter les entreprises quand de nouvelles questions sont disponibles
4. **Analytics** : Tableaux de bord d'évolution des prix entre tours
5. **Types de questions supplémentaires** : Anomalies de prix, variations d'unités, etc.
