// server/src/routes/rounds.js
import express from 'express';
import db from '../db.js';
const { query, pool } = db;
import { requireAuth } from '../middleware.auth.js';
import { validateRequired, validateNumber, ValidationError } from '../utils.validation.js';

const router = express.Router();

router.use(requireAuth);

// Lister les tours d'un projet
router.get('/project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const result = await query(
      'SELECT * FROM rounds WHERE project_id = $1 ORDER BY round_number ASC',
      [projectId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur récupération tours:', err);
    res.status(500).json({ error: 'Impossible de récupérer les tours' });
  }
});

// Créer un nouveau tour pour un projet
router.post('/project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { name, description } = req.body;
    
    validateRequired(name, 'Le nom du tour');
    
    // Trouver le prochain numéro de tour
    const maxResult = await query(
      'SELECT COALESCE(MAX(round_number), -1) + 1 as next_number FROM rounds WHERE project_id = $1',
      [projectId]
    );
    const roundNumber = maxResult.rows[0].next_number;
    
    const result = await query(
      `INSERT INTO rounds (project_id, round_number, name, description, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING *`,
      [projectId, roundNumber, name, description]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur création tour:', err);
    const statusCode = err instanceof ValidationError ? 400 : 500;
    res.status(statusCode).json({ error: err.message || 'Impossible de créer le tour' });
  }
});

// Mettre à jour un tour
router.put('/:roundId', async (req, res) => {
  try {
    const { roundId } = req.params;
    const { name, description, status } = req.body;
    
    const result = await query(
      `UPDATE rounds 
       SET name = $1, description = $2, status = $3
       WHERE id = $4
       RETURNING *`,
      [name, description, status, roundId]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Tour introuvable' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur mise à jour tour:', err);
    res.status(500).json({ error: 'Impossible de mettre à jour le tour' });
  }
});

// Supprimer un tour
router.delete('/:roundId', async (req, res) => {
  try {
    const { roundId } = req.params;
    await query('DELETE FROM rounds WHERE id = $1', [roundId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur suppression tour:', err);
    res.status(500).json({ error: 'Impossible de supprimer le tour' });
  }
});

// Dupliquer un tour (copier toutes les données vers un nouveau tour)
router.post('/:roundId/duplicate', async (req, res) => {
  try {
    const { roundId } = req.params;
    const { newName } = req.body;
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Récupérer le tour source
      const sourceRound = await client.query(
        'SELECT * FROM rounds WHERE id = $1',
        [roundId]
      );
      
      if (sourceRound.rowCount === 0) {
        throw new Error('Tour source introuvable');
      }
      
      const source = sourceRound.rows[0];
      
      // Trouver le prochain numéro
      const maxResult = await client.query(
        'SELECT COALESCE(MAX(round_number), -1) + 1 as next_number FROM rounds WHERE project_id = $1',
        [source.project_id]
      );
      const newRoundNumber = maxResult.rows[0].next_number;
      
      // Créer le nouveau tour
      const newRound = await client.query(
        `INSERT INTO rounds (project_id, round_number, name, description, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING *`,
        [source.project_id, newRoundNumber, newName || `${source.name} (copie)`, source.description]
      );
      
      const newRoundId = newRound.rows[0].id;
      
      // Copier les items
      await client.query(
        `INSERT INTO items (lot_id, num, article_no, designation, unit, round_id)
         SELECT lot_id, num, article_no, designation, unit, $1
         FROM items WHERE round_id = $2`,
        [newRoundId, roundId]
      );
      
      // Créer un mapping des anciens IDs vers les nouveaux
      const itemMapping = await client.query(
        `SELECT old.id as old_id, new.id as new_id
         FROM items old
         JOIN items new ON old.num = new.num AND old.lot_id = new.lot_id
         WHERE old.round_id = $1 AND new.round_id = $2`,
        [roundId, newRoundId]
      );
      
      // Copier moe_items
      for (const map of itemMapping.rows) {
        await client.query(
          `INSERT INTO moe_items (item_id, qty, unit_price, round_id)
           SELECT $1, qty, unit_price, $2
           FROM moe_items WHERE item_id = $3 AND round_id = $4`,
          [map.new_id, newRoundId, map.old_id, roundId]
        );
      }
      
      // Copier offers
      for (const map of itemMapping.rows) {
        await client.query(
          `INSERT INTO offers (item_id, company_id, qty, unit_price, round_id)
           SELECT $1, company_id, qty, unit_price, $2
           FROM offers WHERE item_id = $3 AND round_id = $4`,
          [map.new_id, newRoundId, map.old_id, roundId]
        );
      }
      
      await client.query('COMMIT');
      res.json(newRound.rows[0]);
      
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    
  } catch (err) {
    console.error('Erreur duplication tour:', err);
    res.status(500).json({ error: 'Impossible de dupliquer le tour: ' + err.message });
  }
});

// Obtenir les statistiques d'un tour
router.get('/:roundId/stats', async (req, res) => {
  try {
    const { roundId } = req.params;
    
    const stats = await query(
      `SELECT 
        COUNT(DISTINCT i.id) as total_items,
        COUNT(DISTINCT m.id) as moe_items,
        COUNT(DISTINCT o.id) as total_offers,
        COUNT(DISTINCT o.company_id) as companies_count,
        COUNT(DISTINCT gq.id) as total_questions,
        COUNT(DISTINCT CASE WHEN gq.status = 'pending' THEN gq.id END) as pending_questions,
        COUNT(DISTINCT CASE WHEN gq.status = 'answered' THEN gq.id END) as answered_questions
      FROM rounds r
      LEFT JOIN items i ON i.round_id = r.id
      LEFT JOIN moe_items m ON m.round_id = r.id
      LEFT JOIN offers o ON o.round_id = r.id
      LEFT JOIN generated_questions gq ON gq.round_id = r.id
      WHERE r.id = $1
      GROUP BY r.id`,
      [roundId]
    );
    
    res.json(stats.rows[0] || {});
  } catch (err) {
    console.error('Erreur stats tour:', err);
    res.status(500).json({ error: 'Impossible de récupérer les statistiques' });
  }
});

export default router;
