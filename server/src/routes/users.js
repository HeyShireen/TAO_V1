// server/src/routes/users.js
// Routes pour la gestion des utilisateurs (admin uniquement)

import express from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { requireAuth } from '../middleware.auth.js';
import { isAdmin } from '../middleware.roles.js';
import { hashPassword } from '../utils.hash.js';

const router = express.Router();

router.use(requireAuth);
router.use(isAdmin); // Toutes ces routes sont réservées aux admins

// Liste tous les utilisateurs
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.role, u.created_at, u.company_id, c.name as company_name
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       ORDER BY u.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur liste users:', err);
    res.status(500).json({ error: 'Impossible de récupérer les utilisateurs' });
  }
});

// Créer un utilisateur
router.post('/', async (req, res) => {
  try {
    const { email, password, role = 'visionneur' } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const validRoles = ['admin', 'responsable', 'entreprise', 'visionneur'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }

    const password_hash = await hashPassword(password);
    const result = await query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role, created_at',
      [email.trim().toLowerCase(), password_hash, role]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur création user:', err);
    if (err.code === '23505') { // Duplicate key
      return res.status(400).json({ error: 'Cet email existe déjà' });
    }
    res.status(500).json({ error: 'Impossible de créer l\'utilisateur' });
  }
});

// Modifier le rôle d'un utilisateur
router.patch('/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const validRoles = ['admin', 'responsable', 'entreprise', 'visionneur'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }

    // Empêcher de se retirer ses propres droits admin
    if (Number(id) === req.user.id && role !== 'admin') {
      return res.status(400).json({ error: 'Vous ne pouvez pas retirer vos propres droits admin' });
    }

    const result = await query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role, created_at',
      [role, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur modification rôle:', err);
    res.status(500).json({ error: 'Impossible de modifier le rôle' });
  }
});

// Supprimer un utilisateur
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Empêcher de se supprimer soi-même
    if (Number(id) === req.user.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
    }

    const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    res.json({ success: true, deletedId: id });
  } catch (err) {
    console.error('Erreur suppression user:', err);
    res.status(500).json({ error: 'Impossible de supprimer l\'utilisateur' });
  }
});

// Réinitialiser le mot de passe d'un utilisateur
router.post('/:id/reset-password', async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password || password.length < 12) {
      return res.status(400).json({ error: 'Mot de passe trop court (min 12 caractères)' });
    }

    const password_hash = await hashPassword(password);
    const result = await query(
      'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id',
      [password_hash, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur reset password:', err);
    res.status(500).json({ error: 'Impossible de réinitialiser le mot de passe' });
  }
});

// Attribuer une entreprise à un utilisateur
router.patch('/:id/company', async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.body;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id requis' });
    }

    // Vérifier que l'entreprise existe
    const companyCheck = await query('SELECT id FROM companies WHERE id = $1', [company_id]);
    if (companyCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Entreprise introuvable' });
    }

    const result = await query(
      'UPDATE users SET company_id = $1 WHERE id = $2 RETURNING id, email, role, company_id',
      [company_id, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    const user = result.rows[0];
    
    // Si c'est l'utilisateur concerné qui est connecté, générer un nouveau token
    let newToken = null;
    if (Number(id) === req.user?.id) {
      newToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role, company_id: user.company_id },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
    }

    res.json({ user, token: newToken });
  } catch (err) {
    console.error('Erreur attribution entreprise:', err);
    res.status(500).json({ error: 'Impossible d\'attribuer l\'entreprise' });
  }
});

export default router;
