// server/src/middleware.security-fixes.js
// FIXES CRITIQUES DE SÉCURITÉ

import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

// ============================================================================
// 1. CORS SÉCURISÉ
// ============================================================================

export function getCorsConfig() {
  // OBLIGATOIRE en production
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : process.env.NODE_ENV === 'production' 
      ? []  // ❌ FAIL si vide en prod
      : ['http://localhost:3000', 'http://localhost:4000'];

  // Validation stricte
  if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
    throw new Error(
      '❌ SÉCURITÉ CRITIQUE: ALLOWED_ORIGINS doit être configuré en production!\n' +
      'Exemple .env: ALLOWED_ORIGINS=https://app.example.com,https://www.example.com'
    );
  }

  return {
    origin: (origin, callback) => {
      // Requête same-origin (pas d'header Origin)
      if (!origin) return callback(null, true);

      // Vérifier la whitelist
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // ❌ BLOQUÉ
      console.warn(`🚨 CORS BLOQUÉ: Origine non autorisée: ${origin}`);
      callback(new Error('CORS policy violation'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    exposedHeaders: ['X-CSRF-Token'],
    maxAge: 600 // Pré-flight cache 10 min
  };
}

// ============================================================================
// 2. TOKEN JWT BLACKLIST (Revocation)
// ============================================================================

class TokenBlacklist {
  constructor() {
    this.tokens = new Map(); // token -> expiresAt
  }

  revoke(token, expiresAt) {
    const ttl = expiresAt - Date.now();
    if (ttl > 0) {
      this.tokens.set(token, expiresAt);
      // Auto-cleanup
      setTimeout(() => this.tokens.delete(token), ttl + 1000);
    }
  }

  isRevoked(token) {
    return this.tokens.has(token);
  }

  cleanup() {
    const now = Date.now();
    for (const [token, expiresAt] of this.tokens.entries()) {
      if (expiresAt < now) {
        this.tokens.delete(token);
      }
    }
  }
}

export const tokenBlacklist = new TokenBlacklist();

// Nettoyage automatique toutes les heures
setInterval(() => tokenBlacklist.cleanup(), 60 * 60 * 1000);

// ============================================================================
// 3. VALIDATION STRICTE DES PARAMÈTRES NUMÉRIQUES
// ============================================================================

export function validateNumericId(paramName = 'id') {
  return (req, res, next) => {
    const value = req.params[paramName];
    
    // Vérifier format numérique strict
    if (!value || !/^\d+$/.test(value)) {
      return res.status(400).json({ 
        error: `Paramètre '${paramName}' invalide. Doit être un nombre entier positif.` 
      });
    }

    // Vérifier limites PostgreSQL BIGINT
    const num = BigInt(value);
    if (num < 0n || num > 9223372036854775807n) {
      return res.status(400).json({ 
        error: `Paramètre '${paramName}' hors limites.` 
      });
    }

    // ✅ Sûr
    req.params[paramName] = num.toString();
    next();
  };
}

export function validateNumericQuery(paramNames = []) {
  return (req, res, next) => {
    for (const name of paramNames) {
      const value = req.query[name];
      if (value && !/^\d+$/.test(value)) {
        return res.status(400).json({ 
          error: `Query param '${name}' invalide.` 
        });
      }
    }
    next();
  };
}

// ============================================================================
// 4. CSRF PROTECTION
// ============================================================================

const csrfTokens = new Map(); // sessionId -> token

export function generateCsrfToken(sessionId) {
  const token = crypto.randomBytes(32).toString('hex');
  csrfTokens.set(sessionId, token);
  return token;
}

export function validateCsrfToken(req, res, next) {
  const sessionId = req.user?.id; // Ou session ID réel
  const token = req.headers['x-csrf-token'] || req.body?._csrf;

  if (!token || !sessionId) {
    return res.status(403).json({ error: 'CSRF token missing' });
  }

  const storedToken = csrfTokens.get(sessionId);
  if (!storedToken || storedToken !== token) {
    console.warn(`🚨 CSRF ATTACK ATTEMPT: Invalid token for user ${sessionId}`);
    return res.status(403).json({ error: 'CSRF validation failed' });
  }

  next();
}

// ============================================================================
// 5. RATE LIMITING GRANULAIRE
// ============================================================================

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 tentatives par 15 min
  message: 'Trop de tentatives. Réessayez dans 15 minutes.',
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    // Limiter par EMAIL si disponible (pas seulement IP)
    return req.body?.email?.toLowerCase() || req.ip;
  }
});

export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 3, // 3 tentatives par heure
  message: 'Trop de demandes de reset. Réessayez dans 1 heure.',
  skipSuccessfulRequests: false
});

export const emailVerificationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 1, // 1 email par 5 min
  message: 'Veuillez attendre 5 minutes avant de renvoyer.'
});

export const exportLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // 3 exports par minute
  message: 'Trop d\'exports. Réessayez dans 1 minute.'
});

// ============================================================================
// 6. VALIDATION D'EMAIL STRICTE
// ============================================================================

export function validateEmail(email) {
  // RFC 5322 simplified but more accurate
  const emailRegex = /^[a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  
  if (!email || email.length > 254) {
    throw new Error('Email invalide');
  }

  if (!emailRegex.test(email)) {
    throw new Error('Format d\'email invalide');
  }

  return email.toLowerCase().trim();
}

// ============================================================================
// 7. VALIDATION DE MOT DE PASSE STRICTE
// ============================================================================

export function validatePasswordStrength(password) {
  const errors = [];

  if (password.length < 12) {
    errors.push('Minimum 12 caractères');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Au moins une minuscule');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Au moins une majuscule');
  }
  if (!/\d/.test(password)) {
    errors.push('Au moins un chiffre');
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Au moins un caractère spécial (!@#$%^&*)');
  }

  if (errors.length > 0) {
    throw new Error(
      'Mot de passe faible. Requis:\\n' + errors.map(e => `- ${e}`).join('\\n')
    );
  }

  return password;
}

// ============================================================================
// 8. INPUT SANITIZATION AMÉLIORÉ
// ============================================================================

export function sanitizeString(str) {
  if (typeof str !== 'string') return str;

  // Supprimer caractères de contrôle
  let sanitized = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Supprimer HTML tags potentiels
  sanitized = sanitized.replace(/<[^>]*>/g, '');

  // Trim
  sanitized = sanitized.trim();

  // Limiter longueur (prévention DoS)
  if (sanitized.length > 10000) {
    sanitized = sanitized.substring(0, 10000);
  }

  return sanitized;
}

export function sanitizeInput(req, res, next) {
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      return sanitizeString(obj);
    }
    if (typeof obj === 'object' && obj !== null) {
      const sanitized = Array.isArray(obj) ? [] : {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          sanitized[key] = sanitize(obj[key]);
        }
      }
      return sanitized;
    }
    return obj;
  };

  if (req.body) req.body = sanitize(req.body);
  if (req.query) req.query = sanitize(req.query);
  if (req.params) req.params = sanitize(req.params);

  next();
}

// ============================================================================
// 9. PROTECTION CONTRE LES ATTAQUES PAR REPLAY
// ============================================================================

const nonces = new Map(); // nonce -> timestamp

export function generateNonce() {
  const nonce = crypto.randomBytes(16).toString('hex');
  nonces.set(nonce, Date.now());
  return nonce;
}

export function validateNonce(nonce, maxAge = 5 * 60 * 1000) {
  if (!nonces.has(nonce)) {
    return false;
  }

  const timestamp = nonces.get(nonce);
  const age = Date.now() - timestamp;

  // Supprimer le nonce (single-use)
  nonces.delete(nonce);

  if (age > maxAge) {
    return false; // Expiré
  }

  return true;
}

// Nettoyage automatique des vieux nonces
setInterval(() => {
  const maxAge = 10 * 60 * 1000;
  const now = Date.now();
  for (const [nonce, timestamp] of nonces.entries()) {
    if (now - timestamp > maxAge) {
      nonces.delete(nonce);
    }
  }
}, 60 * 1000);

// ============================================================================
// 10. LOGGING DE SÉCURITÉ
// ============================================================================

export function logSecurityEvent(level, event, details) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level, // 'INFO', 'WARN', 'ERROR', 'CRITICAL'
    event,
    details,
    // À envoyer vers système de logging centralisé (ex: Datadog, ELK)
  };

  if (level === 'CRITICAL') {
    console.error(`🚨 [${timestamp}] ${event}`, details);
    // Déclencher alertes
  } else {
    console.log(`[${level}] [${timestamp}] ${event}`);
  }
}

export function auditLog(req, action, resourceType, resourceId, changes = {}) {
  logSecurityEvent('INFO', 'AUDIT', {
    userId: req.user?.id,
    userEmail: req.user?.email,
    action,
    resourceType,
    resourceId,
    changes,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
  });
  
  // À implémenter: Sauvegarder dans table audit_logs
}
