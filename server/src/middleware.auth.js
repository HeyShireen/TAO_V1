import jwt from 'jsonwebtoken';

// SÉCURITÉ: Token blacklist global (à remplacer par Redis en prod)
let tokenBlacklist = new Set();

export function revokeToken(token) {
  tokenBlacklist.add(token);
  // Nettoyer après expiration du token (7j = 604800s)
  setTimeout(() => tokenBlacklist.delete(token), 7 * 24 * 60 * 60 * 1000);
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
  
  // SÉCURITÉ: Vérifier si le token est révoqué (logout)
  if (tokenBlacklist.has(token)) {
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
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}
