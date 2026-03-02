import jwt from 'jsonwebtoken';
import { redisSet, redisExists } from '../utils/redis.js';

// SÉCURITÉ: Token blacklist via Redis (fallback mémoire auto si Redis indisponible)
const BLACKLIST_PREFIX = 'blacklist:';

export async function revokeToken(token) {
  // Stocker avec TTL de 7 jours (durée max d'un JWT)
  await redisSet(`${BLACKLIST_PREFIX}${token}`, '1', 7 * 24 * 60 * 60);
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  // Fallback: JWT en cookie HttpOnly 'auth'
  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('auth='));
    if (match) token = decodeURIComponent(match.slice('auth='.length));
  }
  
  if (!token) return res.status(401).json({ error: 'Missing token' });
  
  // SÉCURITÉ: Vérifier si le token est révoqué (lookup Redis async)
  redisExists(`${BLACKLIST_PREFIX}${token}`).then(isRevoked => {
    if (isRevoked) {
      return res.status(401).json({ error: 'Token revoked' });
    }
    
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = payload;
      req.token = token; // Garder le token pour le logout
      next();
    } catch (e) {
      if (e.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }
  }).catch(() => {
    // Si Redis échoue, on laisse passer (sécurité dégradée > blocage total)
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = payload;
      req.token = token;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  });
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}
