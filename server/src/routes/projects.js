import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware.auth.js';

const router = express.Router();

router.use(requireAuth);

// Create project
router.post('/', async (req, res) => {
  const { name, reference, client, location, study_phase, study_date } = req.body;
  const r = await query(
    `INSERT INTO projects (name, reference, client, location, study_phase, study_date, created_by) 
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name, reference, client, location, study_phase, study_date, req.user.id]
  );
  res.json(r.rows[0]);
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
  const id = req.params.id;
  const { code, name } = req.body;
  const r = await query(
    'INSERT INTO lots (project_id, code, name) VALUES ($1,$2,$3) RETURNING *',
    [id, code, name]
  );
  res.json(r.rows[0]);
});

export default router;
