// server/src/routes/shares.js
// Routes pour le partage de projets (responsable et admin)

import express from 'express';
import { query } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { isResponsableOrAdmin } from '../../middleware/roles.js';
import { canEditProject, canShareProject } from '../../utils/permissions.js';

const router = express.Router();

router.use(requireAuth);

// Obtenir les partages d'un projet
router.get('/projects/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;

    // Vérifier que l'utilisateur peut éditer ce projet
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const result = await query(
      `SELECT ps.*, u.email as shared_with_email 
       FROM project_shares ps
       JOIN users u ON ps.shared_with_user_id = u.id
       WHERE ps.project_id = $1
       ORDER BY ps.created_at DESC`,
      [projectId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur récupération partages:', err);
    res.status(500).json({ error: 'Impossible de récupérer les partages' });
  }
});

// Partager un projet avec un utilisateur
router.post('/projects/:projectId', isResponsableOrAdmin, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { userId, canView = true, canEdit = false } = req.body;

    // Vérifier que l'utilisateur peut partager ce projet
    if (!canShareProject(req.user.role)) {
      return res.status(403).json({ error: 'Vous ne pouvez pas partager de projets' });
    }

    // Vérifier que l'utilisateur peut éditer ce projet
    const canEditProj = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEditProj) {
      return res.status(403).json({ error: 'Accès refusé - Vous ne pouvez pas partager ce projet' });
    }

    // Vérifier que le projet existe
    const projectExists = await query('SELECT id FROM projects WHERE id = $1', [projectId]);
    if (projectExists.rowCount === 0) {
      return res.status(404).json({ error: 'Projet introuvable' });
    }

    // Vérifier que l'utilisateur cible existe
    const userExists = await query('SELECT id, role FROM users WHERE id = $1', [userId]);
    if (userExists.rowCount === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    // Ne pas partager avec un admin ou responsable (ils ont déjà accès)
    const targetRole = userExists.rows[0].role;
    if (['platform_admin', 'tenant_admin', 'responsable'].includes(targetRole)) {
      return res.status(400).json({ error: 'Les administrateurs et responsables ont déjà accès à tous les projets' });
    }

    // Créer ou mettre à jour le partage
    const result = await query(
      `INSERT INTO project_shares (project_id, shared_with_user_id, can_view, can_edit, shared_by_user_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, shared_with_user_id) 
       DO UPDATE SET can_view = $3, can_edit = $4
       RETURNING *`,
      [projectId, userId, canView, canEdit, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur partage projet:', err);
    res.status(500).json({ error: 'Impossible de partager le projet' });
  }
});

// Retirer un partage
router.delete('/projects/:projectId/users/:userId', isResponsableOrAdmin, async (req, res) => {
  try {
    const { projectId, userId } = req.params;

    // Vérifier que l'utilisateur peut partager ce projet
    if (!canShareProject(req.user.role)) {
      return res.status(403).json({ error: 'Vous ne pouvez pas gérer les partages' });
    }

    // Vérifier que l'utilisateur peut éditer ce projet
    const canEditProj = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEditProj) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const result = await query(
      'DELETE FROM project_shares WHERE project_id = $1 AND shared_with_user_id = $2 RETURNING id',
      [projectId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Partage introuvable' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur suppression partage:', err);
    res.status(500).json({ error: 'Impossible de supprimer le partage' });
  }
});

// Liste des visionneurs disponibles pour partage
router.get('/available-viewers', isResponsableOrAdmin, async (req, res) => {
  try {
    const projectId = req.query.projectId;

    if (projectId && !/^\d+$/.test(String(projectId))) {
      return res.status(400).json({ error: 'projectId invalide' });
    }

    const params = [];
    let sql = `SELECT u.id, u.email FROM users u WHERE u.role = 'visionneur'`;

    if (projectId) {
      params.push(Number(projectId));
      sql += ` AND NOT EXISTS (
        SELECT 1 FROM project_shares ps
        WHERE ps.project_id = $1 AND ps.shared_with_user_id = u.id
      )`;
    }

    sql += ' ORDER BY u.email';

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur liste visionneurs:', err);
    res.status(500).json({ error: 'Impossible de récupérer les visionneurs' });
  }
});

export default router;
