// server/src/middleware.security.js
// Middleware de sécurité supplémentaire — rate limiting via Redis

import rateLimit from 'express-rate-limit';
import { redisIncr, redisGet, redisSet, redisDel, redisDelPattern } from '../utils/redis.js';

// Préfixes Redis
const LOGIN_ATTEMPTS_PREFIX = 'login_attempts:';
const LOGIN_BLOCKED_PREFIX = 'login_blocked:';

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
        const remainingMinutes = Math.ceil(remaining / 60000);
        return res.status(429).json({ 
          error: `Compte temporairement bloqué. Réessayez dans ${remainingMinutes} minute(s).` 
        });
      }
      // Bloc expiré, nettoyer
      await redisDel(blockedKey);
    }
    
    // Incrémenter les tentatives (TTL 5 min)
    const count = await redisIncr(attemptsKey, 5 * 60);
    
    // Bloquer après 20 tentatives
    if (count > 20) {
      const blockedUntilTs = Date.now() + 5 * 60 * 1000;
      await redisSet(blockedKey, String(blockedUntilTs), 5 * 60); // TTL 5 min
      return res.status(429).json({ 
        error: 'Trop de tentatives échouées. Compte bloqué pendant 5 minutes.' 
      });
    }
    
    req.userEmail = email;
    next();
  }).catch(() => {
    // Si Redis échoue, laisser passer (sécurité dégradée > blocage total)
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
