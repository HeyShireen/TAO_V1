import express from 'express';
import { query } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { validateRequired, validateMaxLength, ValidationError } from '../../utils/validation.js';
import { isResponsableOrAdmin } from '../../middleware/roles.js';
import { canViewProject, canEditProject, canDeleteProject, getVisibleProjects } from '../../utils/permissions.js';

const router = express.Router();

router.use(requireAuth);

// Create project (responsable ou admin uniquement)
router.post('/', isResponsableOrAdmin, async (req, res) => {
  try {
    const { name, reference, client, location, study_phase, study_date } = req.body;
    
    validateRequired(name, 'Le nom du projet');
    validateMaxLength(name, 200, 'Le nom du projet');
    if (reference) validateMaxLength(reference, 100, 'La référence');
    if (client) validateMaxLength(client, 200, 'Le nom du client');
    if (location) validateMaxLength(location, 200, 'La localisation');
    
    const r = await query(
      `INSERT INTO projects (name, reference, client, location, study_phase, study_date, created_by, owner_id) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        name.trim(), 
        reference ? reference.trim() : null, 
        client ? client.trim() : null, 
        location ? location.trim() : null, 
        study_phase, 
        study_date, 
        req.user?.id || null,
        req.user?.id || null
      ]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Erreur création projet:', err);
    const statusCode = err instanceof ValidationError ? 400 : 500;
    res.status(statusCode).json({ error: err.message || 'Impossible de créer le projet' });
  }
});

// List projects (filtré selon le rôle)
router.get('/', async (req, res) => {
  try {
    const projects = await getVisibleProjects(req.user.id, req.user.role, req.user.company_id || null);
    res.json(projects);
  } catch (err) {
    console.error('Erreur liste projets:', err);
    res.status(500).json({ error: 'Impossible de récupérer les projets' });
  }
});

// Get a project + lots (vérification permission)
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    
    // Vérifier que l'utilisateur peut voir ce projet
    const canView = await canViewProject(req.user.id, id, req.user.role, req.user.company_id || null);
    if (!canView) {
      return res.status(403).json({ error: 'Accès refusé à ce projet' });
    }
    
    const project = await query('SELECT * FROM projects WHERE id=$1', [id]);
    if (project.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const lots = await query('SELECT * FROM lots WHERE project_id=$1 ORDER BY sort_order ASC, id ASC', [id]);
    res.json({ project: project.rows[0], lots: lots.rows });
  } catch (err) {
    console.error('Erreur récupération projet:', err);
    res.status(500).json({ error: 'Impossible de récupérer le projet' });
  }
});

// Update a project (responsable/admin + vérification permission)
router.put('/:id', isResponsableOrAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { name, ref, client, date } = req.body;
    
    // Vérifier que l'utilisateur peut éditer ce projet
    const canEdit = await canEditProject(req.user.id, id, req.user.role);
    if (!canEdit) {
      return res.status(403).json({ error: 'Accès refusé - Vous ne pouvez pas modifier ce projet' });
    }
    
    // Valider les champs
    if (name !== undefined) validateMaxLength(name, 200, 'Le nom du projet');
    if (ref !== undefined) validateMaxLength(ref, 100, 'La référence');
    if (client !== undefined) validateMaxLength(client, 200, 'Le client');
    
    // Construire la requête dynamiquement selon les champs fournis
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (name !== undefined) {
      updates.push(`name = $${paramIndex}`);
      values.push(name ? name.trim() : null);
      paramIndex++;
    }
    if (ref !== undefined) {
      updates.push(`reference = $${paramIndex}`);
      values.push(ref ? ref.trim() : null);
      paramIndex++;
    }
    if (client !== undefined) {
      updates.push(`client = $${paramIndex}`);
      values.push(client ? client.trim() : null);
      paramIndex++;
    }
    if (date !== undefined) {
      updates.push(`study_date = $${paramIndex}`);
      values.push(date || null);
      paramIndex++;
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }
    
    values.push(id);
    const sql = `UPDATE projects SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    
    const result = await query(sql, values);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Projet introuvable' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur mise à jour projet:', err);
    const statusCode = err instanceof ValidationError ? 400 : 500;
    res.status(statusCode).json({ error: err.message || 'Impossible de mettre à jour le projet' });
  }
});

// Create a lot in a project (responsable/admin + vérification permission)
router.post('/:id/lots', isResponsableOrAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { code, name } = req.body;
    
    // Vérifier que l'utilisateur peut éditer ce projet
    const canEdit = await canEditProject(req.user.id, id, req.user.role);
    if (!canEdit) {
      return res.status(403).json({ error: 'Accès refusé - Vous ne pouvez pas modifier ce projet' });
    }
    
    validateRequired(name, 'Le nom du lot');
    validateMaxLength(name, 200, 'Le nom du lot');
    if (code) validateMaxLength(code, 50, 'Le code du lot');
    
    // Vérifier que le projet existe
    const projectExists = await query('SELECT id FROM projects WHERE id=$1', [id]);
    if (projectExists.rowCount === 0) {
      return res.status(404).json({ error: 'Projet introuvable' });
    }
    
    const r = await query(
      'INSERT INTO lots (project_id, code, name) VALUES ($1,$2,$3) RETURNING *',
      [id, code ? code.trim() : null, name.trim()]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Erreur création lot:', err);
    const statusCode = err instanceof ValidationError ? 400 : 500;
    res.status(statusCode).json({ error: err.message || 'Impossible de créer le lot' });
  }
});

// Update a lot (code, name)
router.put('/lots/:lotId', isResponsableOrAdmin, async (req, res) => {
  try {
    const { lotId } = req.params;
    const { code, name } = req.body;

    // Vérifier que le lot existe et droits via projet
    const lotRes = await query('SELECT id, project_id FROM lots WHERE id = $1', [lotId]);
    if (lotRes.rowCount === 0) return res.status(404).json({ error: 'Lot introuvable' });
    const projectId = lotRes.rows[0].project_id;
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé - Vous ne pouvez pas modifier ce lot' });

    if (name !== undefined) validateMaxLength(name, 200, 'Le nom du lot');
    if (code !== undefined && code !== null) validateMaxLength(code, 50, 'Le code du lot');

    const result = await query(
      'UPDATE lots SET code = $1, name = $2 WHERE id = $3 RETURNING *',
      [code ? code.trim() : null, name ? name.trim() : null, lotId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur mise à jour lot:', err);
    const statusCode = err instanceof ValidationError ? 400 : 500;
    res.status(statusCode).json({ error: err.message || 'Impossible de mettre à jour le lot' });
  }
});

// Update lots order for a project
router.post('/:id/lots/order', isResponsableOrAdmin, async (req, res) => {
  try {
    const projectId = req.params.id;
    const { order } = req.body; // array of lotIds in desired order

    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ error: 'Ordre invalide' });
    }

    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });

    // Validate/normalize: only keep lots that belong to the project
    const lotsRes = await query('SELECT id FROM lots WHERE project_id = $1 ORDER BY sort_order ASC, id ASC', [projectId]);
    const projectLotIds = lotsRes.rows.map(r => r.id);
    const lotIdsSet = new Set(projectLotIds);
    const filteredOrder = order.filter(id => lotIdsSet.has(id));
    // Append any remaining lots not included to preserve a complete ordering
    const remaining = projectLotIds.filter(id => !filteredOrder.includes(id));
    const finalOrder = [...filteredOrder, ...remaining];

    // Apply order
    let position = 1;
    for (const lotId of finalOrder) {
      await query('UPDATE lots SET sort_order = $1 WHERE id = $2', [position++, lotId]);
    }

    res.json({ ok: true, order: finalOrder });
  } catch (err) {
    console.error('Erreur mise à jour ordre des lots:', err);
    res.status(500).json({ error: 'Impossible de mettre à jour l\'ordre des lots' });
  }
});

// Get companies linked to a project (via lots)
router.get('/:id/companies', async (req, res) => {
  try {
    const projectId = req.params.id;
    
    // Vérifier que l'utilisateur peut voir ce projet
    const canView = await canViewProject(req.user.id, projectId, req.user.role, req.user.company_id || null);
    if (!canView) {
      return res.status(403).json({ error: 'Accès refusé à ce projet' });
    }
    
    // Récupérer toutes les entreprises liées aux lots de ce projet
    const result = await query(
      `SELECT DISTINCT c.id, c.name
       FROM companies c
       INNER JOIN lot_companies lc ON lc.company_id = c.id
       INNER JOIN lots l ON l.id = lc.lot_id
       WHERE l.project_id = $1
       ORDER BY c.name`,
      [projectId]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur récupération entreprises projet:', err);
    res.status(500).json({ error: 'Impossible de récupérer les entreprises' });
  }
});

// Delete a project (responsable/admin seulement, avec vérification ownership)
router.delete('/:id', isResponsableOrAdmin, async (req, res) => {
  try {
    const projectId = req.params.id;
    
    // Vérifier que l'utilisateur a le droit de supprimer ce projet
    const canDelete = await canDeleteProject(req.user.id, projectId, req.user.role);
    if (!canDelete) {
      return res.status(403).json({ 
        error: 'Accès refusé - Seuls les admins ou le responsable propriétaire peuvent supprimer ce projet' 
      });
    }
    
    // Vérifier que le projet existe
    const projectCheck = await query('SELECT id, name FROM projects WHERE id = $1', [projectId]);
    if (projectCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Projet introuvable' });
    }
    
    const projectName = projectCheck.rows[0].name;
    
    // Supprimer le projet (CASCADE supprimera automatiquement lots, items, offres, etc.)
    await query('DELETE FROM projects WHERE id = $1', [projectId]);
    
    console.log(`✅ Projet supprimé: "${projectName}" (ID: ${projectId}) par utilisateur ${req.user.id}`);
    
    res.json({ 
      success: true, 
      message: 'Projet supprimé avec succès',
      projectId: parseInt(projectId, 10)
    });
  } catch (err) {
    console.error('Erreur suppression projet:', err);
    res.status(500).json({ error: 'Impossible de supprimer le projet' });
  }
});

export default router;
