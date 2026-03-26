#!/bin/bash
# deploy.sh — Script de déploiement exécuté par le webhook sur le VPS
# Placer à côté de webhook.js et rendre exécutable : chmod +x deploy.sh

set -euo pipefail   # Arrêt immédiat en cas d'erreur

# ─── Variables à adapter à votre VPS ──────────────────────────────────────────
APP_DIR="/var/www/tao"          # Répertoire racine du projet sur le VPS
APP_NAME="tao-app"              # Nom PM2 de votre application principale
BRANCH="main"
LOG_FILE="/var/log/tao-deploy.log"

# ─── Logging ──────────────────────────────────────────────────────────────────
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

log "═══════════════════════════════════════════"
log "🚀  Début du déploiement"

# ─── Se placer dans le bon dossier ────────────────────────────────────────────
cd "$APP_DIR" || { log "❌  Répertoire $APP_DIR introuvable"; exit 1; }

# ─── Récupération du code ─────────────────────────────────────────────────────
log "📥  git pull origin $BRANCH"
git fetch --all
git reset --hard "origin/$BRANCH"
git pull origin "$BRANCH"

COMMIT=$(git rev-parse --short HEAD)
log "📌  Commit déployé : $COMMIT"

# ─── Installation des dépendances (si package.json a changé) ─────────────────
cd "$APP_DIR/server"
if git diff HEAD~1 HEAD --name-only | grep -q "package.json"; then
  log "📦  Mise à jour des dépendances npm"
  npm ci --omit=dev
else
  log "📦  Pas de changement dans package.json, npm ci ignoré"
fi

# ─── Migrations de base de données (si de nouvelles migrations existent) ──────
MIGRATION_DIR="$APP_DIR/server/src/app/migrations"
if git diff HEAD~1 HEAD --name-only | grep -q "migrations/"; then
  log "🗄️   Nouvelles migrations détectées — à appliquer manuellement si besoin"
  log "     → Vérifier : $MIGRATION_DIR"
fi

# ─── Rechargement de l'application avec PM2 (sans coupure) ───────────────────
log "♻️   Rechargement PM2 : $APP_NAME"
pm2 reload "$APP_NAME" --update-env

log "✅  Déploiement $COMMIT terminé avec succès"
log "═══════════════════════════════════════════"
