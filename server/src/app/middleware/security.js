// server/src/middleware.security.js
// Middleware de sécurité supplémentaire

import rateLimit from 'express-rate-limit';

// Store pour tracker les tentatives de login par email (en mémoire)
// En production, utiliser Redis pour partager entre instances
const loginAttempts = new Map();

/**
 * Rate limiter par email (pas seulement par IP)
 * Empêche le brute-force même avec changement d'IP
 */
export function emailRateLimiter(req, res, next) {
  const email = req.body.email?.toLowerCase().trim();
  
  if (!email) return next();
  
  const now = Date.now();
  const attempts = loginAttempts.get(email) || { count: 0, firstAttempt: now, blockedUntil: 0 };
  
  // Si bloqué temporairement
  if (attempts.blockedUntil > now) {
    const remainingMinutes = Math.ceil((attempts.blockedUntil - now) / 60000);
    return res.status(429).json({ 
      error: `Compte temporairement bloqué. Réessayez dans ${remainingMinutes} minute(s).` 
    });
  }
  
  // Reset après 5 minutes
  if (now - attempts.firstAttempt > 5 * 60 * 1000) {
    attempts.count = 0;
    attempts.firstAttempt = now;
  }
  
  // Incrémenter
  attempts.count++;
  
  // Bloquer après 20 tentatives
  if (attempts.count > 20) {
    attempts.blockedUntil = now + 5 * 60 * 1000; // 5 min
    loginAttempts.set(email, attempts);
    return res.status(429).json({ 
      error: 'Trop de tentatives échouées. Compte bloqué pendant 5 minutes.' 
    });
  }
  
  loginAttempts.set(email, attempts);
  
  // Passer au middleware suivant
  // Si login réussit, on devrait appeler resetEmailAttempts(email)
  req.userEmail = email;
  next();
}

/**
 * Réinitialiser les tentatives après un login réussi
 */
export function resetEmailAttempts(email) {
  if (email) {
    loginAttempts.delete(email.toLowerCase().trim());
  }
}

/**
 * Nettoyer les anciennes entrées (à appeler périodiquement)
 */
export function cleanupLoginAttempts() {
  const now = Date.now();
  for (const [email, attempts] of loginAttempts.entries()) {
    if (now - attempts.firstAttempt > 30 * 60 * 1000) { // 30 min d'inactivité
      loginAttempts.delete(email);
    }
  }
}

/**
 * Réinitialiser tous les cooldowns (admin uniquement)
 */
export function resetAllCooldowns() {
  loginAttempts.clear();
  return { cleared: true, message: 'Tous les cooldowns ont été réinitialisés' };
}

// Nettoyer toutes les heures
setInterval(cleanupLoginAttempts, 60 * 60 * 1000);

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
