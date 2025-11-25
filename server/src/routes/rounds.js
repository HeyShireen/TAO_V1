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
    
    // Récupérer le tour pour avoir le project_id
    const roundResult = await query('SELECT project_id FROM rounds WHERE id = $1', [roundId]);
    if (roundResult.rowCount === 0) {
      return res.status(404).json({ error: 'Tour introuvable' });
    }
    const projectId = roundResult.rows[0].project_id;
    
    // Items et MOE sont partagés au niveau projet (via les lots)
    let itemsCount = 0;
    let moeCount = 0;
    
    try {
      const itemsResult = await query(
        `SELECT COUNT(DISTINCT i.id) as count 
         FROM items i 
         JOIN lots l ON l.id = i.lot_id 
         WHERE l.project_id = $1`,
        [projectId]
      );
      itemsCount = parseInt(itemsResult.rows[0]?.count || 0);
    } catch (itemsErr) {
      console.error('Erreur comptage items:', itemsErr);
    }
    
    try {
      const moeResult = await query(
        `SELECT COUNT(DISTINCT m.item_id) as count 
         FROM moe_items m 
         JOIN items i ON i.id = m.item_id
         JOIN lots l ON l.id = i.lot_id 
         WHERE l.project_id = $1`,
        [projectId]
      );
      moeCount = parseInt(moeResult.rows[0]?.count || 0);
    } catch (moeErr) {
      console.error('Erreur comptage MOE:', moeErr);
    }
    
    // Offres sont spécifiques au tour
    let offersCount = 0;
    let companiesCount = 0;
    
    try {
      const offersResult = await query(
        'SELECT COUNT(*) as count, COUNT(DISTINCT company_id) as companies FROM offers WHERE round_id = $1',
        [roundId]
      );
      offersCount = parseInt(offersResult.rows[0]?.count || 0);
      companiesCount = parseInt(offersResult.rows[0]?.companies || 0);
    } catch (offersErr) {
      console.error('Erreur comptage offres:', offersErr);
    }
    
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
          total: parseInt(qResult.rows[0].total || 0),
          pending: parseInt(qResult.rows[0].pending || 0),
          answered: parseInt(qResult.rows[0].answered || 0)
        };
      }
    } catch (qErr) {
      console.log('Table generated_questions non disponible:', qErr.message);
    }
    
    res.json({
      total_items: itemsCount,
      moe_items: moeCount,
      total_offers: offersCount,
      companies_count: companiesCount,
      total_questions: questionsStats.total,
      pending_questions: questionsStats.pending,
      answered_questions: questionsStats.answered
    });
  } catch (err) {
    console.error('Erreur stats tour:', err);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: 'Impossible de récupérer les statistiques: ' + err.message });
  }
});

// Tableau récapitulatif des montants par lot et par entreprise
router.get('/:roundId/summary', async (req, res) => {
  try {
    const { roundId } = req.params;
    
    // Récupérer le projet_id du tour
    const roundResult = await query('SELECT project_id FROM rounds WHERE id = $1', [roundId]);
    if (roundResult.rowCount === 0) {
      return res.status(404).json({ error: 'Tour introuvable' });
    }
    const projectId = roundResult.rows[0].project_id;
    
    // Récupérer tous les lots du projet
    const lotsResult = await query(
      'SELECT id, code, name FROM lots WHERE project_id = $1 ORDER BY code, name',
      [projectId]
    );
    const lots = lotsResult.rows;
    
    // Calculer les montants pour chaque lot
    const summary = [];
    for (const lot of lots) {
      // Montant MOE du lot
      const moeResult = await query(
        `SELECT COALESCE(SUM(m.qty * m.unit_price), 0) as total
         FROM moe_items m
         JOIN items i ON i.id = m.item_id
         WHERE i.lot_id = $1`,
        [lot.id]
      );
      const moeTotal = parseFloat(moeResult.rows[0].total);
      
      // Récupérer les entreprises qui répondent à ce lot spécifique
      const lotCompaniesResult = await query(
        `SELECT c.id, c.name 
         FROM companies c
         JOIN lot_companies lc ON lc.company_id = c.id
         WHERE lc.lot_id = $1
         ORDER BY lc.created_at, c.id`,
        [lot.id]
      );
      const lotCompanies = lotCompaniesResult.rows;
      
      // Montants par entreprise pour ce lot
      const companyTotals = [];
      for (const company of lotCompanies) {
        const offerResult = await query(
          `SELECT COALESCE(SUM(o.qty * o.unit_price), 0) as total
           FROM offers o
           JOIN items i ON i.id = o.item_id
           WHERE i.lot_id = $1 AND o.company_id = $2 AND o.round_id = $3`,
          [lot.id, company.id, roundId]
        );
        const total = parseFloat(offerResult.rows[0].total);
        companyTotals.push({
          company_id: company.id,
          company_name: company.name,
          total: total
        });
      }
      
      summary.push({
        lot_id: lot.id,
        lot_code: lot.code,
        lot_name: lot.name,
        moe_total: moeTotal,
        companies: companyTotals
      });
    }
    
    res.json({
      lots: summary
    });
  } catch (err) {
    console.error('Erreur récupération récapitulatif:', err);
    res.status(500).json({ error: 'Impossible de récupérer le récapitulatif' });
  }
});

// Comparaison des montants entre tous les tours d'un projet
router.get('/project/:projectId/compare', async (req, res) => {
  try {
    const { projectId } = req.params;
    
    // Récupérer tous les tours du projet
    const roundsResult = await query(
      'SELECT id, name FROM rounds WHERE project_id = $1 ORDER BY created_at',
      [projectId]
    );
    const rounds = roundsResult.rows;
    
    if (rounds.length === 0) {
      return res.json({ lots: [], rounds: [] });
    }
    
    // Récupérer tous les lots du projet
    const lotsResult = await query(
      'SELECT id, code, name FROM lots WHERE project_id = $1 ORDER BY code, name',
      [projectId]
    );
    const lots = lotsResult.rows;
    
    // Calculer les montants pour chaque lot et chaque tour
    const summary = [];
    for (const lot of lots) {
      // Montant MOE du lot
      const moeResult = await query(
        `SELECT COALESCE(SUM(m.qty * m.unit_price), 0) as total
         FROM moe_items m
         JOIN items i ON i.id = m.item_id
         WHERE i.lot_id = $1`,
        [lot.id]
      );
      const moeTotal = parseFloat(moeResult.rows[0].total);
      
      // Montants par tour pour ce lot (somme de toutes les entreprises)
      const roundTotals = {};
      const companiesByRound = {};
      
      for (const round of rounds) {
        const roundResult = await query(
          `SELECT COALESCE(SUM(o.qty * o.unit_price), 0) as total
           FROM offers o
           JOIN items i ON i.id = o.item_id
           WHERE i.lot_id = $1 AND o.round_id = $2`,
          [lot.id, round.id]
        );
        roundTotals[round.id] = parseFloat(roundResult.rows[0].total);
        
        // Détails par entreprise pour ce tour et ce lot
        const companiesResult = await query(
          `SELECT 
             c.id as company_id,
             c.name as company_name,
             COALESCE(SUM(o.qty * o.unit_price), 0) as total
           FROM lot_companies lc
           JOIN companies c ON c.id = lc.company_id
           LEFT JOIN offers o ON o.company_id = c.id AND o.round_id = $2
           LEFT JOIN items i ON i.id = o.item_id AND i.lot_id = $1
           WHERE lc.lot_id = $1
           GROUP BY c.id, c.name
           HAVING COALESCE(SUM(o.qty * o.unit_price), 0) > 0
           ORDER BY c.name`,
          [lot.id, round.id]
        );
        
        companiesByRound[round.id] = companiesResult.rows.map(row => ({
          company_id: row.company_id,
          company_name: row.company_name,
          total: parseFloat(row.total)
        }));
      }
      
      summary.push({
        lot_id: lot.id,
        lot_code: lot.code,
        lot_name: lot.name,
        moe_total: moeTotal,
        round_totals: roundTotals,
        companies_by_round: companiesByRound
      });
    }
    
    res.json({
      lots: summary,
      rounds: rounds
    });
  } catch (err) {
    console.error('Erreur comparaison tours:', err);
    res.status(500).json({ error: 'Impossible de récupérer la comparaison' });
  }
});

export default router;

