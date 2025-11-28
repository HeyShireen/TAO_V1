import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware.auth.js';
import { validateRequired, validateMaxLength, ValidationError } from '../utils.validation.js';
import { isResponsableOrAdmin } from '../middleware.roles.js';
import { canViewProject, canEditProject, canDeleteProject, getVisibleProjects } from '../utils.permissions.js';

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
    const projects = await getVisibleProjects(req.user.id, req.user.role);
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
    const canView = await canViewProject(req.user.id, id, req.user.role);
    if (!canView) {
      return res.status(403).json({ error: 'Accès refusé à ce projet' });
    }
    
    const project = await query('SELECT * FROM projects WHERE id=$1', [id]);
    if (project.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const lots = await query('SELECT * FROM lots WHERE project_id=$1 ORDER BY id', [id]);
    res.json({ project: project.rows[0], lots: lots.rows });
  } catch (err) {
    console.error('Erreur récupération projet:', err);
    res.status(500).json({ error: 'Impossible de récupérer le projet' });
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

// Get companies linked to a project (via lots)
router.get('/:id/companies', async (req, res) => {
  try {
    const projectId = req.params.id;
    
    // Vérifier que l'utilisateur peut voir ce projet
    const canView = await canViewProject(req.user.id, projectId, req.user.role);
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

export default router;
