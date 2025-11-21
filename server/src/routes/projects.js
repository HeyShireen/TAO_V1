import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware.auth.js';
import { validateRequired, validateMaxLength, ValidationError } from '../utils.validation.js';

const router = express.Router();

router.use(requireAuth);

// Create project
router.post('/', async (req, res) => {
  try {
    const { name, reference, client, location, study_phase, study_date } = req.body;
    
    validateRequired(name, 'Le nom du projet');
    validateMaxLength(name, 200, 'Le nom du projet');
    if (reference) validateMaxLength(reference, 100, 'La référence');
    if (client) validateMaxLength(client, 200, 'Le nom du client');
    if (location) validateMaxLength(location, 200, 'La localisation');
    
    const r = await query(
      `INSERT INTO projects (name, reference, client, location, study_phase, study_date, created_by) 
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        name.trim(), 
        reference ? reference.trim() : null, 
        client ? client.trim() : null, 
        location ? location.trim() : null, 
        study_phase, 
        study_date, 
        req.user.id
      ]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Erreur création projet:', err);
    const statusCode = err instanceof ValidationError ? 400 : 500;
    res.status(statusCode).json({ error: err.message || 'Impossible de créer le projet' });
  }
});

// List projects
router.get('/', async (req, res) => {
  const r = await query('SELECT * FROM projects ORDER BY created_at DESC');
  res.json(r.rows);
});

// Get a project + lots
router.get('/:id', async (req, res) => {
  const id = req.params.id;
  const project = await query('SELECT * FROM projects WHERE id=$1', [id]);
  if (project.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  const lots = await query('SELECT * FROM lots WHERE project_id=$1 ORDER BY id', [id]);
  res.json({ project: project.rows[0], lots: lots.rows });
});

// Create a lot in a project
router.post('/:id/lots', async (req, res) => {
  try {
    const id = req.params.id;
    const { code, name } = req.body;
    
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

export default router;
