// server/src/routes/rounds.js
import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware.auth.js';
import { validateRequired, validateNumber, ValidationError } from '../utils.validation.js';

const router = express.Router();

router.use(requireAuth);

// Créer un nouveau tour pour un lot
router.post('/', async (req, res) => {
  try {
    const { lot_id, round_number, name, date, notes } = req.body;
    
    validateRequired(lot_id, 'L\'ID du lot');
    validateRequired(round_number, 'Le numéro du tour');
    validateRequired(name, 'Le nom du tour');
    
    // Créer le tour
    const round = await query(
      `INSERT INTO rounds (lot_id, round_number, name, date, notes) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [lot_id, round_number, name, date, notes]
    );
    
    // Créer un snapshot des offres actuelles
    await query(
      `INSERT INTO round_offers (round_id, item_id, company_id, unit, qty, unit_price, amount)
       SELECT $1, item_id, company_id, unit, qty, unit_price, amount
       FROM offers
       WHERE item_id IN (SELECT id FROM items WHERE lot_id = $2)`,
      [round.rows[0].id, lot_id]
    );
    
    res.json(round.rows[0]);
  } catch (err) {
    console.error('Erreur création tour:', err);
    const statusCode = err instanceof ValidationError ? 400 : 500;
    res.status(statusCode).json({ error: err.message || 'Impossible de créer le tour' });
  }
});

// Liste des tours pour un lot
router.get('/lot/:lotId', async (req, res) => {
  try {
    const { lotId } = req.params;
    
    const rounds = await query(
      `SELECT r.*, 
        COUNT(DISTINCT qs.id) as question_count,
        COUNT(DISTINCT CASE WHEN qs.status = 'answered' THEN qs.id END) as answered_count
       FROM rounds r
       LEFT JOIN question_sheets qs ON qs.round_id = r.id
       WHERE r.lot_id = $1
       GROUP BY r.id
       ORDER BY r.round_number`,
      [lotId]
    );
    
    res.json(rounds.rows);
  } catch (err) {
    console.error('Erreur récupération tours:', err);
    res.status(500).json({ error: 'Impossible de récupérer les tours' });
  }
});

// Détails d'un tour avec ses offres
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Informations du tour
    const round = await query('SELECT * FROM rounds WHERE id = $1', [id]);
    if (round.rowCount === 0) {
      return res.status(404).json({ error: 'Tour introuvable' });
    }
    
    // Offres du tour
    const offers = await query(
      `SELECT ro.*, i.num, i.designation, i.unit as item_unit, c.name as company_name
       FROM round_offers ro
       JOIN items i ON i.id = ro.item_id
       JOIN companies c ON c.id = ro.company_id
       WHERE ro.round_id = $1
       ORDER BY i.position, c.name`,
      [id]
    );
    
    res.json({
      round: round.rows[0],
      offers: offers.rows
    });
  } catch (err) {
    console.error('Erreur récupération tour:', err);
    res.status(500).json({ error: 'Impossible de récupérer le tour' });
  }
});

// Générer automatiquement les fiches questions pour un tour
router.post('/:id/generate-questions', async (req, res) => {
  try {
    const { id } = req.params;
    const { threshold = 10 } = req.body; // Seuil d'écart en % (par défaut 10%)
    
    // Récupérer le tour
    const round = await query('SELECT * FROM rounds WHERE id = $1', [id]);
    if (round.rowCount === 0) {
      return res.status(404).json({ error: 'Tour introuvable' });
    }
    
    const lotId = round.rows[0].lot_id;
    
    // Trouver les écarts significatifs entre MOE et offres
    const discrepancies = await query(
      `SELECT 
        i.id as item_id,
        i.num,
        i.designation,
        i.unit,
        moe.qty as moe_qty,
        o.company_id,
        c.name as company_name,
        o.qty as company_qty,
        o.unit_price,
        calculate_difference_percent(moe.qty, o.qty) as difference_percent
       FROM items i
       JOIN moe_items moe ON moe.item_id = i.id
       JOIN offers o ON o.item_id = i.id
       JOIN companies c ON c.id = o.company_id
       WHERE i.lot_id = $1
         AND moe.qty IS NOT NULL
         AND o.qty IS NOT NULL
         AND moe.qty > 0
         AND ABS(calculate_difference_percent(moe.qty, o.qty)) >= $2
       ORDER BY ABS(calculate_difference_percent(moe.qty, o.qty)) DESC`,
      [lotId, threshold]
    );
    
    // Créer les fiches questions
    const questions = [];
    for (const row of discrepancies.rows) {
      const questionText = `Écart de ${row.difference_percent}% sur les quantités - Article ${row.num || ''} "${row.designation}": MOE = ${row.moe_qty} ${row.unit || ''}, ${row.company_name} = ${row.company_qty} ${row.unit || ''}. Merci de justifier cet écart.`;
      
      const result = await query(
        `INSERT INTO question_sheets 
          (round_id, item_id, company_id, question_type, question, moe_qty, company_qty, difference_percent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [id, row.item_id, row.company_id, 'qty_difference', questionText, row.moe_qty, row.company_qty, row.difference_percent]
      );
      
      if (result.rowCount > 0) {
        questions.push(result.rows[0]);
      }
    }
    
    res.json({
      message: `${questions.length} fiche(s) question générée(s)`,
      questions: questions
    });
  } catch (err) {
    console.error('Erreur génération fiches questions:', err);
    res.status(500).json({ error: 'Impossible de générer les fiches questions' });
  }
});

export default router;
