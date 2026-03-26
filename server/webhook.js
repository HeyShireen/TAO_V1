/**
 * Serveur webhook de déploiement continu
 * À lancer sur le VPS avec PM2 : pm2 start webhook.js --name webhook
 *
 * Flux : GitHub push → webhook → deploy.sh → git pull + pm2 restart
 */

import express from 'express';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ─── Configuration ────────────────────────────────────────────────────────────
const PORT          = process.env.WEBHOOK_PORT   || 9000;
const SECRET        = process.env.WEBHOOK_SECRET;          // obligatoire
const BRANCH        = process.env.WEBHOOK_BRANCH  || 'main';
const DEPLOY_SCRIPT = process.env.DEPLOY_SCRIPT   || path.join(__dirname, 'deploy.sh');
const DEPLOY_TIMEOUT = 5 * 60 * 1000; // 5 minutes max

if (!SECRET) {
  console.error('[webhook] ❌  WEBHOOK_SECRET manquant dans les variables d\'environnement');
  process.exit(1);
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' })); // Limite taille payload

// ─── Validation signature GitHub (HMAC-SHA256) ───────────────────────────────
function verifySignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(JSON.stringify(req.body));
  const digest = 'sha256=' + hmac.digest('hex');

  // Comparaison en temps constant pour éviter les timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch {
    return false;
  }
}

// ─── Rate limiting simple en mémoire ─────────────────────────────────────────
let lastDeploy = 0;
const MIN_INTERVAL_MS = 30_000; // 30 secondes entre 2 déploiements

// ─── Route principale ─────────────────────────────────────────────────────────
app.post('/deploy', (req, res) => {
  // 1) Vérification signature
  if (!verifySignature(req)) {
    console.warn('[webhook] ⚠️  Signature invalide depuis', req.ip);
    return res.status(401).json({ error: 'Signature invalide' });
  }

  // 2) Vérification branche
  const ref = req.body?.ref;
  if (ref !== `refs/heads/${BRANCH}`) {
    console.log(`[webhook] ℹ️  Push sur ${ref} ignoré (attendu refs/heads/${BRANCH})`);
    return res.status(200).json({ message: 'Branche ignorée' });
  }

  // 3) Rate limiting
  const now = Date.now();
  if (now - lastDeploy < MIN_INTERVAL_MS) {
    const wait = Math.ceil((MIN_INTERVAL_MS - (now - lastDeploy)) / 1000);
    console.warn(`[webhook] ⏳  Déploiement trop fréquent, réessayer dans ${wait}s`);
    return res.status(429).json({ error: `Réessayez dans ${wait}s` });
  }
  lastDeploy = now;

  // 4) Info commit
  const commit  = req.body?.after?.slice(0, 7) || '?';
  const pusher  = req.body?.pusher?.name        || '?';
  console.log(`[webhook] 🚀  Déploiement déclenché — commit ${commit} par ${pusher}`);

  // Réponse immédiate (ne pas bloquer GitHub)
  res.status(202).json({ message: 'Déploiement en cours', commit });

  // 5) Exécution du script de déploiement
  execFile('/bin/bash', [DEPLOY_SCRIPT], { timeout: DEPLOY_TIMEOUT }, (err, stdout, stderr) => {
    if (err) {
      console.error('[webhook] ❌  Échec déploiement:', err.message);
      if (stderr) console.error('[deploy stderr]', stderr);
      return;
    }
    if (stdout) console.log('[deploy stdout]', stdout);
    console.log('[webhook] ✅  Déploiement réussi');
  });
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ─── Démarrage ────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  // Écoute uniquement sur localhost — nginx fait le proxy
  console.log(`[webhook] 🎣  En écoute sur 127.0.0.1:${PORT}`);
});
