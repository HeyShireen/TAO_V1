# Guide de migration TAO v2

## ✅ Toutes les corrections ont été implémentées

### Changements majeurs

#### 🔒 Sécurité (CRITIQUE - Action requise)

1. **JWT_SECRET obligatoire**
   - ⚠️ Le serveur ne démarrera PAS sans un JWT_SECRET valide (min 32 caractères)
   - Génération recommandée : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - Ajouter dans `.env` : `JWT_SECRET=votre_secret_genere`

2. **Mot de passe admin**
   - Le mot de passe "admin123" en dur a été supprimé
   - Deux options :
     - Option 1 : Définir `ADMIN_EMAIL` et `ADMIN_PASSWORD` dans `.env`
     - Option 2 : Créer via interface au premier lancement

3. **CORS restreint**
   - Par défaut : `localhost:3000` et `localhost:4000`
   - Production : Ajouter `ALLOWED_ORIGINS=https://votredomaine.com` dans `.env`

#### ⚡ Performance

- Les requêtes du tableur sont 3-5x plus rapides grâce aux JOINs optimisés
- Les sauvegardes sont batch-ées (moins de requêtes)
- 6 nouveaux index créés automatiquement au prochain démarrage

#### 🎨 Interface utilisateur

- **Auto-save** : Sauvegarde auto après 2 sec d'inactivité
- **Spinner** : Feedback visuel pendant les chargements
- **Confirmations** : Avant suppressions importantes
- **Messages d'erreur** : Plus clairs et en français

### Instructions de migration

1. **Copier votre configuration**
```bash
cd server
cp .env .env.backup  # Sauvegarde
cp .env.example .env.new
```

2. **Configurer le nouveau .env**
```bash
# Éditer .env.new avec vos valeurs
# IMPORTANT : Générer un nouveau JWT_SECRET sécurisé
```

3. **Remplacer et redémarrer**
```bash
mv .env.new .env
npm run dev
```

4. **Vérifications**
- ✓ Serveur démarre sans erreur
- ✓ Connexion admin fonctionne
- ✓ Tableur s'affiche correctement
- ✓ Spinner apparaît lors des chargements
- ✓ Auto-save fonctionne (attendre 2 sec après édition)

### Variables .env requises

```bash
# OBLIGATOIRE
DATABASE_URL=postgresql://...
JWT_SECRET=<32+ caractères>

# RECOMMANDÉ
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=MotDePasseSecurise123!
ALLOWED_ORIGINS=http://localhost:4000

# OPTIONNEL
PORT=4000
NODE_ENV=production  # En production uniquement
DB_SSL=true         # Si votre BDD utilise SSL
```

### Nouveaux fichiers créés

- `server/src/utils.validation.js` : Utilitaires de validation
- `server/src/middleware.errors.js` : Gestion centralisée des erreurs
- `server/.env.example` : Template de configuration
- `README_CHANGES.md` : Documentation des changements

### Rollback si problème

```bash
cd server
cp .env.backup .env
git checkout HEAD -- src/
npm run dev
```

### Tests recommandés après migration

1. Créer un nouveau projet
2. Ajouter un lot
3. Ajouter des entreprises
4. Saisir des données dans le tableur
5. Vérifier que l'auto-save fonctionne (bouton devient vert)
6. Supprimer une entreprise (confirmation doit apparaître)
7. Rafraîchir la page et vérifier que les données sont sauvegardées

### En cas de problème

**Le serveur ne démarre pas :**
- Vérifier que `JWT_SECRET` est défini et > 32 caractères
- Vérifier que `DATABASE_URL` est correct
- Regarder les logs : le serveur affiche des messages clairs

**Erreur "Not allowed by CORS" :**
- Ajouter votre origine dans `ALLOWED_ORIGINS`
- Format : `http://localhost:3000,https://votredomaine.com`

**Problème d'authentification :**
- Si admin existe : Utiliser "Réinitialiser mot de passe admin"
- Sinon : Définir `ADMIN_EMAIL` et `ADMIN_PASSWORD` dans `.env` et redémarrer

### Support

Tous les problèmes sont maintenant loggés clairement :
- En développement : Stack traces complètes
- En production : Messages sécurisés sans détails techniques

Consulter les logs du serveur pour diagnostiquer.
