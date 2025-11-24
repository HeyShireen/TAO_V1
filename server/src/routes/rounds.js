// server/src/routes/rounds.js
import express from 'express';
import { query, pool } from '../db.js';
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
      
      // Les items et moe_items sont partagés entre tous les tours (pas de copie)
      // On copie uniquement les offres vers le nouveau tour
      
      // Récupérer tous les items du projet (via les lots)
      const itemsResult = await client.query(
        `SELECT i.id FROM items i
         JOIN lots l ON l.id = i.lot_id
         WHERE l.project_id = $1`,
        [source.project_id]
      );
      
      // Copier les offres pour chaque item
      for (const item of itemsResult.rows) {
        await client.query(
          `INSERT INTO offers (item_id, company_id, qty, unit_price, round_id)
           SELECT item_id, company_id, qty, unit_price, $1
           FROM offers WHERE item_id = $2 AND round_id = $3`,
          [newRoundId, item.id, roundId]
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
    
    // Requêtes séparées pour éviter les erreurs si certaines tables n'existent pas
    const itemsCount = await query(
      'SELECT COUNT(*) as count FROM items WHERE round_id = $1',
      [roundId]
    );
    
    const moeCount = await query(
      'SELECT COUNT(*) as count FROM moe_items WHERE round_id = $1',
      [roundId]
    );
    
    const offersStats = await query(
      'SELECT COUNT(*) as count, COUNT(DISTINCT company_id) as companies FROM offers WHERE round_id = $1',
      [roundId]
    );
    
    // Questions (si la table existe)
    let questionsStats = { total: 0, pending: 0, answered: 0 };
    try {
      const qResult = await query(
        `SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'answered' THEN 1 END) as answered
         FROM generated_questions WHERE round_id = $1`,
        [roundId]
      );
      if (qResult.rows[0]) {
        questionsStats = {
          total: parseInt(qResult.rows[0].total),
          pending: parseInt(qResult.rows[0].pending),
          answered: parseInt(qResult.rows[0].answered)
        };
      }
    } catch (qErr) {
      console.log('Table generated_questions non disponible:', qErr.message);
    }
    
    res.json({
      total_items: parseInt(itemsCount.rows[0].count),
      moe_items: parseInt(moeCount.rows[0].count),
      total_offers: parseInt(offersStats.rows[0].count),
      companies_count: parseInt(offersStats.rows[0].companies),
      total_questions: questionsStats.total,
      pending_questions: questionsStats.pending,
      answered_questions: questionsStats.answered
    });
  } catch (err) {
    console.error('Erreur stats tour:', err);
    res.status(500).json({ error: 'Impossible de récupérer les statistiques' });
  }
});

export default router;
