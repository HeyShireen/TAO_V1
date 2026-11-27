// server/src/middleware.security.js
// Middleware de sécurité supplémentaire — rate limiting via Redis

import rateLimit from 'express-rate-limit';
import { redisIncr, redisGet, redisSet, redisDel, redisDelPattern } from '../utils/redis.js';

// Préfixes Redis
const LOGIN_ATTEMPTS_PREFIX = 'login_attempts:';
const LOGIN_BLOCKED_PREFIX = 'login_blocked:';

// Seuils anti-brute-force par ADRESSE EMAIL (le limiteur par IP est dans
// server.js). Les valeurs precedentes — 20 tentatives par minute puis blocage
// d'une minute — autorisaient environ 1 200 essais par heure sur un meme
// compte, ce qui n'arrete pas une attaque par dictionnaire.
//
// Un login reussi appelle resetEmailAttempts() : un utilisateur qui se trompe
// quelques fois puis entre le bon mot de passe repart de zero.
const LOGIN_ATTEMPTS_WINDOW_SECONDS = Number(process.env.LOGIN_ATTEMPTS_WINDOW_SECONDS || 600); // 10 min
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 10);
const LOGIN_BLOCK_DURATION_SECONDS = Number(process.env.LOGIN_BLOCK_DURATION_SECONDS || 600); // 10 min

/**
 * Rate limiter par email (pas seulement par IP)
 * Empêche le brute-force même avec changement d'IP
 * Stocké dans Redis (persistant, partagé entre instances)
 */
export function emailRateLimiter(req, res, next) {
  const email = req.body.email?.toLowerCase().trim();
  
  if (!email) return next();
  
  const blockedKey = `${LOGIN_BLOCKED_PREFIX}${email}`;
  const attemptsKey = `${LOGIN_ATTEMPTS_PREFIX}${email}`;
  
  // Vérification async via Redis
  redisGet(blockedKey).then(async (blockedUntil) => {
    if (blockedUntil) {
      const remaining = parseInt(blockedUntil, 10) - Date.now();
      if (remaining > 0) {
        const remainingSeconds = Math.max(1, Math.ceil(remaining / 1000));
        return res.status(429).json({ 
          error: `Compte temporairement bloqué. Réessayez dans ${remainingSeconds} seconde(s).`,
          cooldown: true,
          remainingSeconds,
          blockedUntil: Number(blockedUntil)
        });
      }
      // Bloc expiré, nettoyer
      await redisDel(blockedKey);
    }
    
    // Incrémenter les tentatives sur la fenêtre glissante
    const count = await redisIncr(attemptsKey, LOGIN_ATTEMPTS_WINDOW_SECONDS);

    if (count > LOGIN_MAX_ATTEMPTS) {
      const blockedUntilTs = Date.now() + LOGIN_BLOCK_DURATION_SECONDS * 1000;
      await redisSet(blockedKey, String(blockedUntilTs), LOGIN_BLOCK_DURATION_SECONDS);
      const minutes = Math.max(1, Math.round(LOGIN_BLOCK_DURATION_SECONDS / 60));
      return res.status(429).json({
        error: `Trop de tentatives échouées. Compte bloqué pendant ${minutes} minute(s).`,
        cooldown: true,
        remainingSeconds: LOGIN_BLOCK_DURATION_SECONDS,
        blockedUntil: blockedUntilTs
      });
    }

    req.userEmail = email;
    next();
  }).catch((err) => {
    // `utils/redis.js` retombe de lui-même sur un cache mémoire quand Redis est
    // injoignable : arriver ici signale donc une anomalie, pas une simple
    // indisponibilité. On laisse passer la requête pour ne pas bloquer toutes
    // les connexions sur un bug de compteur — le limiteur par IP (5 échecs par
    // minute, également partagé) reste actif — mais on le signale clairement
    // au lieu de l'avaler en silence.
    console.error('[security] limiteur par email hors service, protection degradee:', err);
    req.userEmail = email;
    next();
  });
}

/**
 * Réinitialiser les tentatives après un login réussi
 */
export async function resetEmailAttempts(email) {
  if (email) {
    const normalized = email.toLowerCase().trim();
    await redisDel(`${LOGIN_ATTEMPTS_PREFIX}${normalized}`);
    await redisDel(`${LOGIN_BLOCKED_PREFIX}${normalized}`);
  }
}

/**
 * Réinitialiser tous les cooldowns (admin uniquement)
 */
export async function resetAllCooldowns() {
  const attemptsCleared = await redisDelPattern(`${LOGIN_ATTEMPTS_PREFIX}*`);
  const blocksCleared = await redisDelPattern(`${LOGIN_BLOCKED_PREFIX}*`);
  return { cleared: true, message: `Cooldowns réinitialisés (${attemptsCleared + blocksCleared} clés supprimées)` };
}

/**
 * Sanitizer pour prévenir les injections
 */
export function sanitizeInput(req, res, next) {
  // Nettoyer les strings des caractères dangereux
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      // Enlever les caractères de contrôle et nuls
      return obj.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    }
    if (typeof obj === 'object' && obj !== null) {
      for (const key in obj) {
        obj[key] = sanitize(obj[key]);
      }
    }
    return obj;
  };
  
  if (req.body) req.body = sanitize(req.body);
  if (req.query) req.query = sanitize(req.query);
  if (req.params) req.params = sanitize(req.params);
  
  next();
}

/**
 * Validation stricte des IDs numériques
 */
export function validateNumericId(paramName = 'id') {
  return (req, res, next) => {
    const id = req.params[paramName];
    if (id && !/^\d+$/.test(id)) {
      return res.status(400).json({ error: 'ID invalide' });
    }
    next();
  };
}
