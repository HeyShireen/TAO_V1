import jwt from 'jsonwebtoken';
import { redisSet, redisExists } from '../utils/redis.js';
import { query, runWithTenantContext } from '../db.js';

// SÉCURITÉ: Token blacklist via Redis (fallback mémoire auto si Redis indisponible)
const BLACKLIST_PREFIX = 'blacklist:';

class AuthenticationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function revokeToken(token) {
  // Stocker avec TTL de 7 jours (durée max d'un JWT)
  await redisSet(`${BLACKLIST_PREFIX}${token}`, '1', 7 * 24 * 60 * 60);
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  // Fallback: JWT en cookie HttpOnly 'auth'
  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('auth='));
    if (match) token = decodeURIComponent(match.slice('auth='.length));
  }
  
  if (!token) return res.status(401).json({ error: 'Missing token' });
  
  let tenantContext;
  let authenticatedUser;
  try {
    // SÉCURITÉ: Vérifier si le token est révoqué.
    let isRevoked = false;
    try {
      isRevoked = await redisExists(`${BLACKLIST_PREFIX}${token}`);
    } catch {
      // Redis est une couche de révocation additionnelle. La base reste la
      // source de vérité pour le compte, le rôle et le tenant.
    }
    if (isRevoked) {
      return res.status(401).json({ error: 'Token revoked' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const activeTenantId = Number(payload.active_tenant_id || payload.tenant_id);
    const userId = Number(payload.id);
    if (!Number.isInteger(activeTenantId) || !Number.isInteger(userId)) {
      throw new AuthenticationError(401, 'Session antérieure au cloisonnement. Reconnexion requise.');
    }

    tenantContext = {
      tenantId: activeTenantId,
      userId,
    };
    authenticatedUser = await runWithTenantContext(tenantContext, async () => {
      const result = await query(
        `SELECT u.id, u.email, u.role, u.company_id, u.tenant_id,
                active.id AS active_tenant_id, active.slug AS active_tenant_slug,
                active.name AS active_tenant_name, active.type AS active_tenant_type,
                active.status AS active_tenant_status
         FROM users u
         JOIN tenants active ON active.id = $2
         WHERE u.id = $1`,
        [userId, activeTenantId]
      );
      if (result.rowCount === 0) throw new AuthenticationError(401, 'Compte introuvable');

      const user = result.rows[0];
      if (user.active_tenant_status !== 'active') {
        throw new AuthenticationError(403, 'Organisation suspendue');
      }
      if (user.role !== 'platform_admin' && Number(user.tenant_id) !== activeTenantId) {
        throw new AuthenticationError(403, 'Contexte tenant invalide');
      }
      return {
        id: Number(user.id),
        email: user.email,
        role: user.role,
        company_id: user.company_id ? Number(user.company_id) : null,
        tenant_id: Number(user.tenant_id),
        active_tenant_id: activeTenantId,
        active_tenant_slug: user.active_tenant_slug,
        active_tenant_name: user.active_tenant_name,
        active_tenant_type: user.active_tenant_type,
      };
    });
  } catch (e) {
    if (e.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
    if (e.name === 'JsonWebTokenError' || e.name === 'NotBeforeError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (e instanceof AuthenticationError) return res.status(e.status).json({ error: e.message });
    return next(e);
  }

  req.user = authenticatedUser;
  req.token = token;

  // Le contexte doit entourer les handlers en aval, mais leurs erreurs ne sont
  // pas des erreurs d'authentification. Toute exception synchrone est donc
  // transmise au middleware d'erreur Express, jamais transformée en 401.
  return runWithTenantContext(tenantContext, async () => next()).catch(next);
}

export function requireAdmin(req, res, next) {
  if (!['platform_admin', 'tenant_admin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}
