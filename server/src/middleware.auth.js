import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;
  // Fallback: JWT en cookie HttpOnly 'auth'
  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('auth='));
    if (match) token = decodeURIComponent(match.slice('auth='.length));
  }
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
