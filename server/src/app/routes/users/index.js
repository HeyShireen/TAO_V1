// server/src/routes/users.js
// Routes pour la gestion des utilisateurs (admin uniquement)

import express from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { isAdmin } from '../../middleware/roles.js';
import { hashPassword } from '../../utils/hash.js';

const router = express.Router();

router.use(requireAuth);
router.use(isAdmin); // Toutes ces routes sont réservées aux admins

// Liste tous les utilisateurs
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.role, u.created_at, u.company_id, u.email_verified, c.name as company_name
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE ($1::boolean OR u.role <> 'platform_admin')
       ORDER BY u.created_at DESC`
      , [req.user.role === 'platform_admin']
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur liste users:', err);
    res.status(500).json({ error: 'Impossible de récupérer les utilisateurs' });
  }
});

// Créer un utilisateur
router.post('/', async (req, res) => {
  return res.status(410).json({ error: 'La création directe est remplacée par POST /api/tenant/invitations' });
});

// Modifier le rôle d'un utilisateur
router.patch('/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const validRoles = ['tenant_admin', 'responsable', 'entreprise', 'visionneur'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }

    // Empêcher de se retirer ses propres droits admin
    if (Number(id) === req.user.id && !['tenant_admin', 'platform_admin'].includes(role)) {
      return res.status(400).json({ error: 'Vous ne pouvez pas retirer vos propres droits admin' });
    }

    const result = await query(
      `UPDATE users SET role = $1
       WHERE id = $2 AND role <> 'platform_admin'
       RETURNING id, email, role, created_at`,
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

// Forcer la validation email d'un utilisateur
router.post('/:id/verify-email', async (req, res) => {
  try {
    const { id } = req.params;

    const existingUser = await query(
      'SELECT id, email, role, created_at, email_verified FROM users WHERE id = $1',
      [id]
    );

    if (existingUser.rowCount === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }
    if (existingUser.rows[0].role === 'platform_admin' && req.user.role !== 'platform_admin') {
      return res.status(403).json({ error: 'Le compte plateforme ne peut pas être modifié' });
    }

    if (existingUser.rows[0].email_verified) {
      return res.json(existingUser.rows[0]);
    }

    const result = await query(
      "UPDATE users SET email_verified = TRUE WHERE id = $1 AND role <> 'platform_admin' RETURNING id, email, role, created_at, email_verified",
      [id]
    );

    await query(
      'UPDATE email_verifications SET verified_at = now() WHERE user_id = $1 AND verified_at IS NULL',
      [id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur validation email admin:', err);
    res.status(500).json({ error: 'Impossible de valider l\'email de l\'utilisateur' });
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

    const result = await query("DELETE FROM users WHERE id = $1 AND role <> 'platform_admin' RETURNING id", [id]);

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
      "UPDATE users SET password_hash = $1 WHERE id = $2 AND role <> 'platform_admin' RETURNING id",
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
      "UPDATE users SET company_id = $1 WHERE id = $2 AND role <> 'platform_admin' RETURNING id, email, role, company_id, tenant_id",
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
        { id: user.id, email: user.email, role: user.role, company_id: user.company_id, tenant_id: user.tenant_id, active_tenant_id: req.user.active_tenant_id },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );
    }

    res.json({ user, token: newToken });
  } catch (err) {
    console.error('Erreur attribution entreprise:', err);
    res.status(500).json({ error: 'Impossible d\'attribuer l\'entreprise' });
  }
});

export default router;
