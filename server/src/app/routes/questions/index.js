// server/src/routes/questions.js
import express from 'express';
import { query } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { isResponsableOrAdmin } from '../../middleware/roles.js';
import { validateRequired, ValidationError } from '../../utils/validation.js';

const router = express.Router();

router.use(requireAuth);

// Liste des fiches questions pour un tour
router.get('/round/:roundId', async (req, res) => {
  try {
    const { roundId } = req.params;
    const { status } = req.query; // Filtrer par statut optionnel
    const isEntreprise = req.user?.role === 'entreprise';
    const companyId = req.user?.company_id || null;
    
    let sql = `
      SELECT qs.*, 
        i.num, i.designation, i.unit,
        COALESCE(NULLIF(lc.display_name, ''), c.name) as company_name,
        r.name as round_name
      FROM question_sheets qs
      JOIN items i ON i.id = qs.item_id
      JOIN companies c ON c.id = qs.company_id
      LEFT JOIN lot_companies lc ON lc.lot_id = i.lot_id AND lc.company_id = qs.company_id
      JOIN rounds r ON r.id = qs.round_id
      WHERE qs.round_id = $1
    `;
    
    const params = [roundId];
    
    if (status) {
      sql += ` AND qs.status = $2`;
      params.push(status);
    }

    if (isEntreprise && companyId) {
      // Restreindre aux fiches de la propre entreprise
      if (params.length === 1) {
        sql += ` AND qs.company_id = $2`;
        params.push(companyId);
      } else if (params.length === 2) {
        sql += ` AND qs.company_id = $3`;
        params.push(companyId);
      }
    }
    
    sql += ` ORDER BY qs.created_at DESC`;
    
    const questions = await query(sql, params);
    res.json(questions.rows);
  } catch (err) {
    console.error('Erreur récupération fiches questions:', err);
    res.status(500).json({ error: 'Impossible de récupérer les fiches questions' });
  }
});

// Liste des fiches questions pour un lot
router.get('/lot/:lotId', async (req, res) => {
  try {
    const { lotId } = req.params;
    const isEntreprise = req.user?.role === 'entreprise';
    const companyId = req.user?.company_id || null;
    
    let sql = `SELECT qs.*, 
        i.num, i.designation, i.unit,
        COALESCE(NULLIF(lc.display_name, ''), c.name) as company_name,
        r.name as round_name, r.round_number
      FROM question_sheets qs
      JOIN items i ON i.id = qs.item_id
      JOIN companies c ON c.id = qs.company_id
      LEFT JOIN lot_companies lc ON lc.lot_id = i.lot_id AND lc.company_id = qs.company_id
      JOIN rounds r ON r.id = qs.round_id
      WHERE r.lot_id = $1`;
    const params = [lotId];
    if (isEntreprise && companyId) {
      sql += ` AND qs.company_id = $2`;
      params.push(companyId);
    }
    sql += ` ORDER BY r.round_number DESC, qs.created_at DESC`;
    const questions = await query(sql, params);
    
    res.json(questions.rows);
  } catch (err) {
    console.error('Erreur récupération fiches questions:', err);
    res.status(500).json({ error: 'Impossible de récupérer les fiches questions' });
  }
});

// Créer une fiche question manuelle
// Créer une fiche question manuelle (admin/responsable uniquement)
router.post('/', isResponsableOrAdmin, async (req, res) => {
  try {
    const { round_id, item_id, company_id, question } = req.body;
    
    validateRequired(round_id, 'L\'ID du tour');
    validateRequired(item_id, 'L\'ID de l\'article');
    validateRequired(company_id, 'L\'ID de l\'entreprise');
    validateRequired(question, 'La question');
    
    const result = await query(
      `INSERT INTO question_sheets 
        (round_id, item_id, company_id, question_type, question)
       VALUES ($1, $2, $3, 'manual', $4)
       RETURNING *`,
      [round_id, item_id, company_id, question]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur création fiche question:', err);
    const statusCode = err instanceof ValidationError ? 400 : 500;
    res.status(statusCode).json({ error: err.message || 'Impossible de créer la fiche question' });
  }
});

// Mettre à jour une fiche question (ajouter une réponse, changer le statut)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { response, status, response_date } = req.body;
    const isEntreprise = req.user?.role === 'entreprise';
    const companyId = req.user?.company_id || null;
    
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (response !== undefined) {
      updates.push(`response = $${paramIndex++}`);
      values.push(response);
    }
    
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    
    if (response_date !== undefined) {
      updates.push(`response_date = $${paramIndex++}`);
      values.push(response_date);
    }
    
    updates.push(`updated_at = NOW()`);
    
    if (updates.length === 1) { // Seulement updated_at
      return res.status(400).json({ error: 'Aucune modification fournie' });
    }
    
    values.push(id);
    
    // Ajouter restriction entreprise (peut uniquement répondre à ses propres fiches)
    const whereRestriction = isEntreprise && companyId ? `AND company_id = $${paramIndex + 1}` : '';
    const sql = `UPDATE question_sheets 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex} ${whereRestriction}
       RETURNING *`;
    let finalValues = values;
    if (whereRestriction) {
      finalValues = [...values, companyId];
    }
    const result = await query(sql, finalValues);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Fiche question introuvable' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur mise à jour fiche question:', err);
    res.status(500).json({ error: 'Impossible de mettre à jour la fiche question' });
  }
});

// Supprimer une fiche question (admin/responsable uniquement)
router.delete('/:id', isResponsableOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      'DELETE FROM question_sheets WHERE id = $1 RETURNING id',
      [id]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Fiche question introuvable' });
    }
    
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Erreur suppression fiche question:', err);
    res.status(500).json({ error: 'Impossible de supprimer la fiche question' });
  }
});

// Exporter les fiches questions d'un tour en PDF/Excel (à implémenter)
router.get('/round/:roundId/export', async (req, res) => {
  try {
    const { roundId } = req.params;
    const { format = 'json' } = req.query;
    const isEntreprise = req.user?.role === 'entreprise';
    const companyId = req.user?.company_id || null;
    
    let sql = `SELECT qs.*, 
        i.num, i.designation, i.unit,
        COALESCE(NULLIF(lc.display_name, ''), c.name) as company_name,
        r.name as round_name
      FROM question_sheets qs
      JOIN items i ON i.id = qs.item_id
      JOIN companies c ON c.id = qs.company_id
      LEFT JOIN lot_companies lc ON lc.lot_id = i.lot_id AND lc.company_id = qs.company_id
      JOIN rounds r ON r.id = qs.round_id
      WHERE qs.round_id = $1`;
    const params = [roundId];
    if (isEntreprise && companyId) {
      sql += ' AND qs.company_id = $2';
      params.push(companyId);
    }
    sql += ' ORDER BY company_name, i.num';
    const questions = await query(sql, params);
    
    if (format === 'json') {
      res.json(questions.rows);
    } else {
      // TODO: Implémenter export PDF/Excel
      res.status(501).json({ error: 'Format non supporté pour le moment' });
    }
  } catch (err) {
    console.error('Erreur export fiches questions:', err);
    res.status(500).json({ error: 'Impossible d\'exporter les fiches questions' });
  }
});

export default router;
