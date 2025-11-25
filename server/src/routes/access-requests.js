// server/src/routes/access-requests.js
// Routes pour gérer les demandes d'accès aux projets

import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware.auth.js';
import { isResponsableOrAdmin } from '../middleware.roles.js';
import { sendAccessRequestNotification, sendAccessApprovedEmail, sendAccessRejectedEmail } from '../utils.email.js';

const router = express.Router();

router.use(requireAuth);

// Soumettre une demande d'accès à un projet (visionneur uniquement)
router.post('/', async (req, res) => {
  try {
    const { projectId, message } = req.body;
    
    if (!projectId) {
      return res.status(400).json({ error: 'ID du projet requis' });
    }
    
    // Seuls les visionneurs peuvent faire des demandes
    if (req.user.role !== 'visionneur') {
      return res.status(403).json({ error: 'Seuls les visionneurs peuvent faire des demandes d\'accès' });
    }
    
    // Vérifier que le projet existe
    const projectResult = await query('SELECT id, name FROM projects WHERE id = $1', [projectId]);
    if (projectResult.rowCount === 0) {
      return res.status(404).json({ error: 'Projet introuvable' });
    }
    const project = projectResult.rows[0];
    
    // Vérifier s'il n'a pas déjà accès
    const existingShare = await query(
      'SELECT id FROM project_shares WHERE project_id = $1 AND shared_with_user_id = $2',
      [projectId, req.user.id]
    );
    if (existingShare.rowCount > 0) {
      return res.status(400).json({ error: 'Vous avez déjà accès à ce projet' });
    }
    
    // Vérifier s'il n'a pas déjà une demande en attente
    const existingRequest = await query(
      'SELECT id FROM access_requests WHERE project_id = $1 AND user_id = $2 AND status = $3',
      [projectId, req.user.id, 'pending']
    );
    if (existingRequest.rowCount > 0) {
      return res.status(400).json({ error: 'Vous avez déjà une demande en attente pour ce projet' });
    }
    
    // Créer la demande
    const result = await query(
      `INSERT INTO access_requests (user_id, project_id, message, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id, user_id, project_id, message, status, created_at`,
      [req.user.id, projectId, message || null]
    );
    
    // Notifier les responsables et admins
    const responsables = await query(
      `SELECT email FROM users WHERE role IN ('admin', 'responsable')`
    );
    
    for (const responsable of responsables.rows) {
      try {
        await sendAccessRequestNotification(
          responsable.email,
          { email: req.user.email },
          project.name,
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
        p.name as project_name,
        r.email as reviewed_by_email
      FROM access_requests ar
      JOIN users u ON ar.user_id = u.id
      JOIN projects p ON ar.project_id = p.id
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
    const { canEdit = false } = req.body;
    
    // Récupérer la demande
    const requestResult = await query(
      `SELECT ar.*, u.email as user_email, p.name as project_name
       FROM access_requests ar
       JOIN users u ON ar.user_id = u.id
       JOIN projects p ON ar.project_id = p.id
       WHERE ar.id = $1 AND ar.status = 'pending'`,
      [id]
    );
    
    if (requestResult.rowCount === 0) {
      return res.status(404).json({ error: 'Demande introuvable ou déjà traitée' });
    }
    
    const request = requestResult.rows[0];
    
    // Créer le partage dans project_shares
    await query(
      `INSERT INTO project_shares (project_id, shared_with_user_id, can_view, can_edit, shared_by_user_id)
       VALUES ($1, $2, true, $3, $4)
       ON CONFLICT (project_id, shared_with_user_id) 
       DO UPDATE SET can_view = true, can_edit = $3`,
      [request.project_id, request.user_id, canEdit, req.user.id]
    );
    
    // Marquer la demande comme approuvée
    await query(
      'UPDATE access_requests SET status = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3',
      ['approved', req.user.id, id]
    );
    
    // Notifier le visionneur
    try {
      await sendAccessApprovedEmail(request.user_email, request.project_name);
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
      `SELECT ar.*, u.email as user_email, p.name as project_name
       FROM access_requests ar
       JOIN users u ON ar.user_id = u.id
       JOIN projects p ON ar.project_id = p.id
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
      await sendAccessRejectedEmail(request.user_email, request.project_name, reason);
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
        p.name as project_name,
        r.email as reviewed_by_email
      FROM access_requests ar
      JOIN projects p ON ar.project_id = p.id
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
