import express from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { hashPassword, comparePassword } from '../utils.hash.js';

const router = express.Router();

// Helper: create token
function sign(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// Register: allow if no users yet; otherwise admin-only
router.post('/register', async (req, res) => {
  const { email, password, role = 'user' } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const usersCount = await query('SELECT COUNT(*) FROM users');
  const count = Number(usersCount.rows[0].count);

  if (count > 0) {
    // Require admin token
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    try {
      const payload = token ? jwt.verify(token, process.env.JWT_SECRET) : null;
      if (!payload || payload.role !== 'admin') {
        return res.status(403).json({ error: 'Only admin can create users' });
      }
    } catch (e) {
      return res.status(403).json({ error: 'Only admin can create users' });
    }
  }

  const password_hash = await hashPassword(password);
  try {
    const result = await query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1,$2,$3) RETURNING id, email, role',
      [email, password_hash, role]
    );
    const user = result.rows[0];
    return res.json({ user, token: sign(user) });
  } catch (e) {
    console.error(e);
    return res.status(400).json({ error: 'User creation failed (email may already exist)' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const r = await query('SELECT * FROM users WHERE email=$1', [email]);
  if (r.rowCount === 0) return res.status(401).json({ error: 'Invalid credentials' });
  const user = r.rows[0];
  const ok = await comparePassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = sign(user);
  return res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

export default router;
