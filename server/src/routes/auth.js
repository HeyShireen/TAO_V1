import express from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { hashPassword, comparePassword } from '../utils.hash.js';

const router = express.Router();

// Helper: create token
function sign(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// Register: auto-inscription publique (toujours visionneur sauf premier = admin)
router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  
  // Validation
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Format d\'email invalide' });

  const usersCount = await query('SELECT COUNT(*) FROM users');
  const count = Number(usersCount.rows[0].count);
  
  // Premier utilisateur devient automatiquement admin, tous les autres sont visionneurs
  const finalRole = count === 0 ? 'admin' : 'visionneur';

  const password_hash = await hashPassword(password);
  try {
    const result = await query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1,$2,$3) RETURNING id, email, role',
      [email, password_hash, finalRole]
    );
    const user = result.rows[0];
    return res.json({ user, token: sign(user) });
  } catch (e) {
    console.error(e);
    return res.status(400).json({ error: 'Cet email est déjà utilisé' });
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

// Reset admin password - ONLY if no admin can login
router.post('/reset-admin', async (req, res) => {
  try {
    // 1. Vérifier s'il existe des admins
    const admins = await query('SELECT COUNT(*) FROM users WHERE role = $1', ['admin']);
    if (admins.rows[0].count === '0') {
      return res.status(400).json({ error: 'Aucun compte admin trouvé.' });
    }

    // 2. Réinitialiser le mot de passe du premier admin
    const newPassword = 'admin' + Math.random().toString(36).slice(-4); // ex: admin1x2y
    const password_hash = await hashPassword(newPassword);
    
    const updated = await query(`
      UPDATE users 
      SET password_hash = $1
      WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1)
      RETURNING email
    `, [password_hash]);

    // 3. Retourner le nouveau mot de passe (à changer dès que possible!)
    res.json({ 
      message: 'Mot de passe admin réinitialisé',
      email: updated.rows[0].email,
      newPassword,
      pleaseChange: true
    });

  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Erreur lors de la réinitialisation' });
  }
});

export default router;
