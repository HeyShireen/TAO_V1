// server/src/routes/access-requests.js
// Routes pour gérer les demandes d'accès aux projets

import express from 'express';
import { query } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { isResponsableOrAdmin } from '../../middleware/roles.js';
import { canEditProject } from '../../utils/permissions.js';
import { sendAccessRequestNotification, sendAccessApprovedEmail, sendAccessRejectedEmail } from '../../utils/email.js';

const router = express.Router();

router.use(requireAuth);

// Soumettre une demande d'accès à un projet (visionneur uniquement)
router.post('/', async (req, res) => {
  try {
    const { projectName, message } = req.body;
    
    if (!projectName || projectName.trim() === '') {
      return res.status(400).json({ error: 'Nom du projet requis' });
    }
    
    // Seuls les visionneurs peuvent faire des demandes
    if (req.user.role !== 'visionneur') {
      return res.status(403).json({ error: 'Seuls les visionneurs peuvent faire des demandes d\'accès' });
    }
    
    // Vérifier s'il n'a pas déjà une demande en attente pour ce nom de projet
    const existingRequest = await query(
      'SELECT id FROM access_requests WHERE user_id = $1 AND LOWER(project_name) = LOWER($2) AND status = $3',
      [req.user.id, projectName.trim(), 'pending']
    );
    if (existingRequest.rowCount > 0) {
      return res.status(400).json({ error: 'Vous avez déjà une demande en attente pour ce projet' });
    }
    
    // Créer la demande (sans project_id, juste le nom)
    const result = await query(
      `INSERT INTO access_requests (user_id, project_name, message, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id, user_id, project_name, message, status, created_at`,
      [req.user.id, projectName.trim(), message || null]
    );
    
    // Notifier les responsables et admins
    const responsables = await query(
      `SELECT email FROM users WHERE role IN ('platform_admin', 'tenant_admin', 'responsable')`
    );
    
    for (const responsable of responsables.rows) {
      try {
        await sendAccessRequestNotification(
          responsable.email,
          { email: req.user.email },
          projectName.trim(),
          message || ''
        );
      } catch (emailErr) {
        console.error('Erreur envoi notification:', emailErr);
        // Ne pas bloquer la demande si l'email échoue
      }
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur création demande d\'accès:', err);
    res.status(500).json({ error: 'Impossible de créer la demande d\'accès' });
  }
});

// Lister les demandes d'accès (responsable/admin)
router.get('/', isResponsableOrAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    
    let sql = `
      SELECT 
        ar.*,
        u.email as user_email,
        r.email as reviewed_by_email
      FROM access_requests ar
      JOIN users u ON ar.user_id = u.id
      LEFT JOIN users r ON ar.reviewed_by = r.id
    `;
    
    const params = [];
    if (status) {
      sql += ' WHERE ar.status = $1';
      params.push(status);
    }
    
    sql += ' ORDER BY ar.created_at DESC';
    
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur liste demandes:', err);
    res.status(500).json({ error: 'Impossible de récupérer les demandes' });
  }
});

// Approuver une demande d'accès
router.patch('/:id/approve', isResponsableOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { projectId, canEdit = false } = req.body;
    
    if (!projectId) {
      return res.status(400).json({ error: 'ID du projet requis pour l\'approbation' });
    }
    
    // Vérifier que le projet existe
    const projectResult = await query('SELECT id, name FROM projects WHERE id = $1', [projectId]);
    if (projectResult.rowCount === 0) {
      return res.status(404).json({ error: 'Projet introuvable' });
    }
    const project = projectResult.rows[0];

    const canEditProjectTarget = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEditProjectTarget) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    
    // Récupérer la demande (accepter aussi les demandes déjà approuvées pour multi-projet)
    const requestResult = await query(
      `SELECT ar.*, u.email as user_email
       FROM access_requests ar
       JOIN users u ON ar.user_id = u.id
       WHERE ar.id = $1 AND ar.status IN ('pending', 'approved')`,
      [id]
    );
    
    if (requestResult.rowCount === 0) {
      return res.status(404).json({ error: 'Demande introuvable ou rejetée' });
    }
    
    const request = requestResult.rows[0];
    
    // Créer le partage dans project_shares
    await query(
      `INSERT INTO project_shares (project_id, shared_with_user_id, can_view, can_edit, shared_by_user_id)
       VALUES ($1, $2, true, $3, $4)
       ON CONFLICT (project_id, shared_with_user_id) 
       DO UPDATE SET can_view = true, can_edit = $3`,
      [projectId, request.user_id, canEdit, req.user.id]
    );
    
    // Mettre à jour la demande avec le project_id et marquer comme approuvée (seulement si pending)
    await query(
      `UPDATE access_requests 
       SET status = 'approved', 
           reviewed_by = COALESCE(reviewed_by, $1), 
           reviewed_at = COALESCE(reviewed_at, now()), 
           project_id = $2 
       WHERE id = $3`,
      [req.user.id, projectId, id]
    );
    
    // Notifier le visionneur
    try {
      await sendAccessApprovedEmail(request.user_email, project.name);
    } catch (emailErr) {
      console.error('Erreur envoi email approbation:', emailErr);
    }
    
    res.json({ success: true, message: 'Demande approuvée' });
  } catch (err) {
    console.error('Erreur approbation demande:', err);
    res.status(500).json({ error: 'Impossible d\'approuver la demande' });
  }
});

// Rejeter une demande d'accès
router.patch('/:id/reject', isResponsableOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    // Récupérer la demande
    const requestResult = await query(
      `SELECT ar.*, u.email as user_email
       FROM access_requests ar
       JOIN users u ON ar.user_id = u.id
       WHERE ar.id = $1 AND ar.status = 'pending'`,
      [id]
    );
    
    if (requestResult.rowCount === 0) {
      return res.status(404).json({ error: 'Demande introuvable ou déjà traitée' });
    }
    
    const request = requestResult.rows[0];
    
    // Marquer la demande comme rejetée
    await query(
      'UPDATE access_requests SET status = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3',
      ['rejected', req.user.id, id]
    );
    
    // Notifier le visionneur
      try {
        await sendAccessRejectedEmail(request.user_email, request.project_name || 'le projet demandé', reason);
    } catch (emailErr) {
      console.error('Erreur envoi email rejet:', emailErr);
    }
    
    res.json({ success: true, message: 'Demande rejetée' });
  } catch (err) {
    console.error('Erreur rejet demande:', err);
    res.status(500).json({ error: 'Impossible de rejeter la demande' });
  }
});

// Obtenir les demandes d'un visionneur spécifique
router.get('/my-requests', async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        ar.*,
        r.email as reviewed_by_email
      FROM access_requests ar
      LEFT JOIN users r ON ar.reviewed_by = r.id
      WHERE ar.user_id = $1
      ORDER BY ar.created_at DESC`,
      [req.user.id]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur récupération demandes utilisateur:', err);
    res.status(500).json({ error: 'Impossible de récupérer vos demandes' });
  }
});

export default router;
