// server/src/app/utils/redis.js
// Client Redis centralisé avec fallback in-memory si Redis non disponible

import Redis from 'ioredis';

let redisClient = null;
let isRedisAvailable = false;

// Fallback in-memory (dev local sans Redis)
const memoryStore = new Map();
const memoryTimers = new Map();

/**
 * Initialise la connexion Redis
 * En cas d'échec, bascule automatiquement sur un store en mémoire
 */
export async function initRedis() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) {
          console.warn('⚠️  Redis: Trop de tentatives, basculement sur mémoire');
          return null; // Stop retrying
        }
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    // Gestion des événements
    redisClient.on('error', (err) => {
      if (isRedisAvailable) {
        console.warn('⚠️  Redis: Connexion perdue, fallback mémoire -', err.message);
        isRedisAvailable = false;
      }
    });

    redisClient.on('connect', () => {
      isRedisAvailable = true;
      console.log('✅ Redis: Connecté');
    });

    redisClient.on('reconnecting', () => {
      console.log('🔄 Redis: Reconnexion...');
    });

    await redisClient.connect();
    isRedisAvailable = true;
    console.log('✅ Redis: Prêt');
    return true;
  } catch (err) {
    console.warn('⚠️  Redis non disponible, utilisation du fallback mémoire');
    console.warn('   Pour activer Redis: REDIS_URL=redis://localhost:6379');
    isRedisAvailable = false;
    return false;
  }
}

/**
 * Vérifie si Redis est connecté
 */
export function isRedisConnected() {
  return isRedisAvailable && redisClient?.status === 'ready';
}

// ============================================================================
// API unifiée : Redis si disponible, sinon mémoire
// ============================================================================

/**
 * Stocke une valeur avec TTL optionnel (en secondes)
 */
export async function redisSet(key, value, ttlSeconds = null) {
  try {
    if (isRedisConnected()) {
      if (ttlSeconds) {
        await redisClient.set(key, value, 'EX', ttlSeconds);
      } else {
        await redisClient.set(key, value);
      }
    } else {
      memoryStore.set(key, value);
      if (ttlSeconds) {
        // Nettoyer le timer précédent s'il existe
        if (memoryTimers.has(key)) clearTimeout(memoryTimers.get(key));
        memoryTimers.set(key, setTimeout(() => {
          memoryStore.delete(key);
          memoryTimers.delete(key);
        }, ttlSeconds * 1000));
      }
    }
  } catch (err) {
    // Fallback silencieux
    memoryStore.set(key, value);
  }
}

/**
 * Récupère une valeur
 */
export async function redisGet(key) {
  try {
    if (isRedisConnected()) {
      return await redisClient.get(key);
    }
    return memoryStore.get(key) || null;
  } catch (err) {
    return memoryStore.get(key) || null;
  }
}

/**
 * Supprime une clé
 */
export async function redisDel(key) {
  try {
    if (isRedisConnected()) {
      await redisClient.del(key);
    }
    memoryStore.delete(key);
    if (memoryTimers.has(key)) {
      clearTimeout(memoryTimers.get(key));
      memoryTimers.delete(key);
    }
  } catch (err) {
    memoryStore.delete(key);
  }
}

/**
 * Vérifie si une clé existe
 */
export async function redisExists(key) {
  try {
    if (isRedisConnected()) {
      return (await redisClient.exists(key)) === 1;
    }
    return memoryStore.has(key);
  } catch (err) {
    return memoryStore.has(key);
  }
}

/**
 * Incrémente un compteur avec TTL (pour rate-limiting)
 * Retourne la nouvelle valeur
 */
export async function redisIncr(key, ttlSeconds = null) {
  try {
    if (isRedisConnected()) {
      const val = await redisClient.incr(key);
      if (ttlSeconds && val === 1) {
        // Ne set le TTL qu'à la première incrémentation
        await redisClient.expire(key, ttlSeconds);
      }
      return val;
    }
    // Fallback mémoire
    const current = parseInt(memoryStore.get(key) || '0', 10) + 1;
    memoryStore.set(key, String(current));
    if (ttlSeconds && current === 1) {
      if (memoryTimers.has(key)) clearTimeout(memoryTimers.get(key));
      memoryTimers.set(key, setTimeout(() => {
        memoryStore.delete(key);
        memoryTimers.delete(key);
      }, ttlSeconds * 1000));
    }
    return current;
  } catch (err) {
    return 1;
  }
}

/**
 * Récupère le TTL restant d'une clé (en secondes)
 */
export async function redisTTL(key) {
  try {
    if (isRedisConnected()) {
      return await redisClient.ttl(key);
    }
    return -1;
  } catch (err) {
    return -1;
  }
}

/**
 * Supprime toutes les clés avec un préfixe (pattern)
 * Utile pour resetAllCooldowns
 */
export async function redisDelPattern(pattern) {
  try {
    if (isRedisConnected()) {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
      return keys.length;
    }
    // Fallback mémoire
    let count = 0;
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    for (const key of memoryStore.keys()) {
      if (regex.test(key)) {
        memoryStore.delete(key);
        if (memoryTimers.has(key)) {
          clearTimeout(memoryTimers.get(key));
          memoryTimers.delete(key);
        }
        count++;
      }
    }
    return count;
  } catch (err) {
    return 0;
  }
}

/**
 * Ferme proprement la connexion Redis
 */
export async function closeRedis() {
  if (redisClient) {
    try {
      await redisClient.quit();
      console.log('✅ Redis: Déconnecté proprement');
    } catch (err) {
      redisClient.disconnect();
    }
  }
}

export default {
  initRedis,
  isRedisConnected,
  redisSet,
  redisGet,
  redisDel,
  redisExists,
  redisIncr,
  redisTTL,
  redisDelPattern,
  closeRedis,
};
