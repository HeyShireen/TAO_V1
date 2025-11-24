import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  // Mode développement : autoriser l'accès sans authentification
  if (process.env.NODE_ENV !== 'production') {
    req.user = { id: 0, email: 'dev@local', role: 'admin' };
    return next();
  }
  
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}
