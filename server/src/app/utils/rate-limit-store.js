/**
 * Store partagé pour express-rate-limit.
 *
 * Par défaut, express-rate-limit compte les requêtes dans la mémoire du
 * process. Deux conséquences sur ce déploiement :
 *   - avec PM2 en cluster, chaque instance a son propre compteur : la limite
 *     réelle est multipliée par le nombre d'instances ;
 *   - chaque redéploiement remet tous les compteurs à zéro, ce qui annule un
 *     éventuel blocage en cours.
 *
 * Ce store s'appuie sur `utils/redis.js`, dont les primitives retombent
 * d'elles-mêmes sur un cache mémoire si Redis est indisponible : sans Redis, le
 * comportement reste donc celui d'avant, sans dégradation.
 */
import { redisIncr, redisDecr, redisDel } from './redis.js';

export class SharedRateLimitStore {
  /**
   * @param {object} options
   * @param {string} options.prefix - préfixe des clés, pour isoler les limiteurs
   */
  constructor({ prefix = 'rl:' } = {}) {
    this.prefix = prefix;
    this.windowMs = 60 * 1000;
    // Date de fin de fenêtre par clé. Redis connaît le TTL, mais pas le repli
    // mémoire : on garde donc la trace localement pour annoncer un délai juste
    // à l'utilisateur (en-tête Retry-After et message de cooldown).
    this.windowEnds = new Map();
  }

  /** Appelé par express-rate-limit à l'initialisation du middleware. */
  init(options) {
    if (options?.windowMs) this.windowMs = options.windowMs;
  }

  key(key) {
    return `${this.prefix}${key}`;
  }

  resetTimeFor(key, isNewWindow) {
    const now = Date.now();
    const known = this.windowEnds.get(key);
    if (isNewWindow || !known || known <= now) {
      const end = now + this.windowMs;
      this.windowEnds.set(key, end);
      this.pruneWindowEnds(now);
      return new Date(end);
    }
    return new Date(known);
  }

  /** Évite une croissance sans fin de la Map sur un serveur longue durée. */
  pruneWindowEnds(now = Date.now()) {
    if (this.windowEnds.size < 5000) return;
    for (const [k, end] of this.windowEnds) {
      if (end <= now) this.windowEnds.delete(k);
    }
  }

  async increment(key) {
    const ttlSeconds = Math.max(1, Math.ceil(this.windowMs / 1000));
    const totalHits = await redisIncr(this.key(key), ttlSeconds);
    return { totalHits, resetTime: this.resetTimeFor(key, totalHits === 1) };
  }

  async decrement(key) {
    await redisDecr(this.key(key));
  }

  async resetKey(key) {
    this.windowEnds.delete(key);
    await redisDel(this.key(key));
  }
}

/** Fabrique un store isolé pour un limiteur donné. */
export function sharedRateLimitStore(prefix) {
  return new SharedRateLimitStore({ prefix });
}
