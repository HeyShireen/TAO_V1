// server/src/routes/question-config.js
import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware.auth.js';

const router = express.Router();
router.use(requireAuth);

// Autoriser uniquement admin ou responsable pour la configuration et la génération
function requireManager(req, res, next) {
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'responsable') {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  next();
}

// ========== Configuration Projet ==========

// Obtenir la config des questions pour un projet
router.get('/project/:projectId', requireManager, async (req, res) => {
  try {
    const { projectId } = req.params;
    
    let config = await query(
      'SELECT * FROM project_question_config WHERE project_id = $1',
      [projectId]
    );
    
    // Si pas de config, créer avec valeurs par défaut
    if (config.rowCount === 0) {
      config = await query(
        `INSERT INTO project_question_config (project_id) 
         VALUES ($1) RETURNING *`,
        [projectId]
      );
    }
    
    res.json(config.rows[0]);
  } catch (err) {
    console.error('Erreur récupération config projet:', err);
    res.status(500).json({ error: 'Impossible de récupérer la configuration' });
  }
});

// Mettre à jour la config des questions pour un projet
router.put('/project/:projectId', requireManager, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { question_qty_low, question_qty_high, question_price_low, question_price_high } = req.body;
    
    const result = await query(
      `INSERT INTO project_question_config 
        (project_id, question_qty_low, question_qty_high, question_price_low, question_price_high, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (project_id) 
       DO UPDATE SET 
         question_qty_low = EXCLUDED.question_qty_low,
         question_qty_high = EXCLUDED.question_qty_high,
         question_price_low = EXCLUDED.question_price_low,
         question_price_high = EXCLUDED.question_price_high,
         updated_at = now()
       RETURNING *`,
      [projectId, question_qty_low, question_qty_high, question_price_low, question_price_high]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur mise à jour config projet:', err);
    res.status(500).json({ error: 'Impossible de mettre à jour la configuration' });
  }
});

// ========== Configuration Lot (seuils) ==========

// Obtenir les seuils pour un lot
router.get('/lot/:lotId/thresholds', requireManager, async (req, res) => {
  try {
    const { lotId } = req.params;
    
    let config = await query(
      'SELECT * FROM lot_threshold_config WHERE lot_id = $1',
      [lotId]
    );
    
    // Si pas de config, créer avec valeurs par défaut (10%)
    if (config.rowCount === 0) {
      config = await query(
        `INSERT INTO lot_threshold_config (lot_id) 
         VALUES ($1) RETURNING *`,
        [lotId]
      );
    }
    
    res.json(config.rows[0]);
  } catch (err) {
    console.error('Erreur récupération seuils lot:', err);
    res.status(500).json({ error: 'Impossible de récupérer les seuils' });
  }
});

// Mettre à jour les seuils pour un lot
router.put('/lot/:lotId/thresholds', requireManager, async (req, res) => {
  try {
    const { lotId } = req.params;
    const { qty_low_threshold, qty_high_threshold, price_low_threshold, price_high_threshold } = req.body;
    
    const result = await query(
      `INSERT INTO lot_threshold_config 
        (lot_id, qty_low_threshold, qty_high_threshold, price_low_threshold, price_high_threshold, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (lot_id) 
       DO UPDATE SET 
         qty_low_threshold = EXCLUDED.qty_low_threshold,
         qty_high_threshold = EXCLUDED.qty_high_threshold,
         price_low_threshold = EXCLUDED.price_low_threshold,
         price_high_threshold = EXCLUDED.price_high_threshold,
         updated_at = now()
       RETURNING *`,
      [lotId, qty_low_threshold, qty_high_threshold, price_low_threshold, price_high_threshold]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur mise à jour seuils lot:', err);
    res.status(500).json({ error: 'Impossible de mettre à jour les seuils' });
  }
});

// ========== Génération et gestion des fiches questions ==========

// Générer les fiches questions pour un lot et un tour
router.post('/lot/:lotId/generate', requireManager, async (req, res) => {
  try {
    const { lotId } = req.params;
    const { round_id } = req.body;
    
    if (!round_id) {
      return res.status(400).json({ error: 'round_id requis' });
    }
    const roundId = round_id;
    
    // 1. Récupérer les seuils du lot
    const thresholdsRes = await query(
      'SELECT * FROM lot_threshold_config WHERE lot_id = $1',
      [lotId]
    );
    const thresholds = thresholdsRes.rows[0] || {
      qty_low_threshold: 10,
      qty_high_threshold: 10,
      price_low_threshold: 10,
      price_high_threshold: 10
    };
    
    // 2. Récupérer les questions du projet
    const lotRes = await query('SELECT project_id FROM lots WHERE id = $1', [lotId]);
    if (lotRes.rowCount === 0) {
      return res.status(404).json({ error: 'Lot introuvable' });
    }
    const projectId = lotRes.rows[0].project_id;
    
    const questionsRes = await query(
      'SELECT * FROM project_question_config WHERE project_id = $1',
      [projectId]
    );
    const questions = questionsRes.rows[0] || {
      question_qty_low: 'Pourquoi la quantité est-elle inférieure à la MOE ?',
      question_qty_high: 'Pourquoi la quantité est-elle supérieure à la MOE ?',
      question_price_low: 'Pourquoi le prix unitaire est-il inférieur à la MOE ?',
      question_price_high: 'Pourquoi le prix unitaire est-il supérieur à la MOE ?'
    };
    
    // 3. Récupérer les items, MOE et offres
    const itemsRes = await query(
      'SELECT * FROM items WHERE lot_id = $1',
      [lotId]
    );
    const items = itemsRes.rows;
    
    const moeRes = await query(
      'SELECT * FROM moe_items WHERE item_id = ANY($1::int[])',
      [items.map(i => i.id)]
    );
    const moeByItem = new Map(moeRes.rows.map(m => [m.item_id, m]));
    
    const offersRes = await query(
      'SELECT * FROM offers WHERE item_id = ANY($1::int[]) AND round_id = $2',
      [items.map(i => i.id), roundId]
    );
    
    // 4. Générer les questions
    const generated = [];
    for (const offer of offersRes.rows) {
      const moe = moeByItem.get(offer.item_id);
      if (!moe) continue;
      
      // Vérifier écart quantité
      if (moe.qty != null && offer.qty != null && moe.qty !== 0) {
        const qtyDev = ((offer.qty - moe.qty) / moe.qty) * 100;
        
        if (qtyDev < -Math.abs(thresholds.qty_low_threshold)) {
          // Quantité basse
          await query(
            `INSERT INTO generated_questions 
              (lot_id, item_id, company_id, question_type, question_text, moe_value, offer_value, deviation_pct, round_id)
             VALUES ($1, $2, $3, 'qty_low', $4, $5, $6, $7, $8)
             ON CONFLICT (round_id, lot_id, item_id, company_id, question_type) 
             DO UPDATE SET 
               question_text = EXCLUDED.question_text,
               moe_value = EXCLUDED.moe_value,
               offer_value = EXCLUDED.offer_value,
               deviation_pct = EXCLUDED.deviation_pct`,
            [lotId, offer.item_id, offer.company_id, questions.question_qty_low, moe.qty, offer.qty, qtyDev, roundId]
          );
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'qty_low' });
        } else if (qtyDev > Math.abs(thresholds.qty_high_threshold)) {
          // Quantité haute
          await query(
            `INSERT INTO generated_questions 
              (lot_id, item_id, company_id, question_type, question_text, moe_value, offer_value, deviation_pct, round_id)
             VALUES ($1, $2, $3, 'qty_high', $4, $5, $6, $7, $8)
             ON CONFLICT (round_id, lot_id, item_id, company_id, question_type) 
             DO UPDATE SET 
               question_text = EXCLUDED.question_text,
               moe_value = EXCLUDED.moe_value,
               offer_value = EXCLUDED.offer_value,
               deviation_pct = EXCLUDED.deviation_pct`,
            [lotId, offer.item_id, offer.company_id, questions.question_qty_high, moe.qty, offer.qty, qtyDev, roundId]
          );
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'qty_high' });
        }
      }
      
      // Vérifier écart prix
      if (moe.unit_price != null && offer.unit_price != null && moe.unit_price !== 0) {
        const priceDev = ((offer.unit_price - moe.unit_price) / moe.unit_price) * 100;
        
        if (priceDev < -Math.abs(thresholds.price_low_threshold)) {
          // Prix bas
          await query(
            `INSERT INTO generated_questions 
              (lot_id, item_id, company_id, question_type, question_text, moe_value, offer_value, deviation_pct, round_id)
             VALUES ($1, $2, $3, 'price_low', $4, $5, $6, $7, $8)
             ON CONFLICT (round_id, lot_id, item_id, company_id, question_type) 
             DO UPDATE SET 
               question_text = EXCLUDED.question_text,
               moe_value = EXCLUDED.moe_value,
               offer_value = EXCLUDED.offer_value,
               deviation_pct = EXCLUDED.deviation_pct`,
            [lotId, offer.item_id, offer.company_id, questions.question_price_low, moe.unit_price, offer.unit_price, priceDev, roundId]
          );
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'price_low' });
        } else if (priceDev > Math.abs(thresholds.price_high_threshold)) {
          // Prix haut
          await query(
            `INSERT INTO generated_questions 
              (lot_id, item_id, company_id, question_type, question_text, moe_value, offer_value, deviation_pct, round_id)
             VALUES ($1, $2, $3, 'price_high', $4, $5, $6, $7, $8)
             ON CONFLICT (round_id, lot_id, item_id, company_id, question_type) 
             DO UPDATE SET 
               question_text = EXCLUDED.question_text,
               moe_value = EXCLUDED.moe_value,
               offer_value = EXCLUDED.offer_value,
               deviation_pct = EXCLUDED.deviation_pct`,
            [lotId, offer.item_id, offer.company_id, questions.question_price_high, moe.unit_price, offer.unit_price, priceDev, roundId]
          );
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'price_high' });
        }
      }
    }
    
    res.json({ generated: generated.length, questions: generated });
  } catch (err) {
    console.error('Erreur génération fiches questions:', err);
    res.status(500).json({ error: 'Impossible de générer les fiches questions' });
  }
});

// Liste des fiches questions d'un lot et d'un tour
router.get('/lot/:lotId', async (req, res) => {
  try {
    const { lotId } = req.params;
    const { status, company_id, round_id } = req.query;
    const isEntreprise = req.user?.role === 'entreprise';
    
    let sql = `
      SELECT gq.*, 
        i.num, i.designation, i.unit,
        c.name as company_name
      FROM generated_questions gq
      JOIN items i ON i.id = gq.item_id
      JOIN companies c ON c.id = gq.company_id
      WHERE gq.lot_id = $1
    `;
    
    const params = [lotId];
    
    if (round_id) {
      sql += ` AND gq.round_id = $${params.length + 1}`;
      params.push(round_id);
    }
    
    if (status) {
      sql += ` AND gq.status = $${params.length + 1}`;
      params.push(status);
    }
    
    // Si utilisateur entreprise, forcer le filtre sur sa company_id
    if (isEntreprise && req.user?.company_id) {
      sql += ` AND gq.company_id = $${params.length + 1}`;
      params.push(req.user.company_id);
    } else if (company_id) {
      sql += ` AND gq.company_id = $${params.length + 1}`;
      params.push(company_id);
    }
    
    sql += ` ORDER BY c.name, i.num, gq.question_type`;
    
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur récupération fiches questions:', err);
    res.status(500).json({ error: 'Impossible de récupérer les fiches questions' });
  }
});

// Mettre à jour une fiche question (réponse, statut)
router.put('/question/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { answer, status } = req.body;
    const isEntreprise = req.user?.role === 'entreprise';
    
    // Si entreprise, vérifier que la question lui appartient
    if (isEntreprise && req.user?.company_id) {
      const checkResult = await query(
        'SELECT company_id FROM generated_questions WHERE id = $1',
        [id]
      );
      if (checkResult.rowCount === 0) {
        return res.status(404).json({ error: 'Fiche question introuvable' });
      }
      if (checkResult.rows[0].company_id !== req.user.company_id) {
        return res.status(403).json({ error: 'Accès refusé - Cette question ne vous appartient pas' });
      }
    }
    
    const result = await query(
      `UPDATE generated_questions 
       SET answer = $1, status = $2, answered_at = CASE WHEN $2 = 'answered' THEN now() ELSE answered_at END
       WHERE id = $3
       RETURNING *`,
      [answer, status, id]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Fiche question introuvable' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur mise à jour fiche question:', err);
    res.status(500).json({ error: 'Impossible de mettre à jour la fiche question' });
  }
});

// Supprimer une fiche question
router.delete('/question/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const isEntreprise = req.user?.role === 'entreprise';
    
    // Si entreprise, vérifier que la question lui appartient
    if (isEntreprise && req.user?.company_id) {
      const checkResult = await query(
        'SELECT company_id FROM generated_questions WHERE id = $1',
        [id]
      );
      if (checkResult.rowCount === 0) {
        return res.status(404).json({ error: 'Fiche question introuvable' });
      }
      if (checkResult.rows[0].company_id !== req.user.company_id) {
        return res.status(403).json({ error: 'Accès refusé - Cette question ne vous appartient pas' });
      }
    }
    
    await query('DELETE FROM generated_questions WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur suppression fiche question:', err);
    res.status(500).json({ error: 'Impossible de supprimer la fiche question' });
  }
});

// Export Excel des fiches questions
router.get('/lot/:lotId/export-excel', async (req, res) => {
  try {
    const { lotId } = req.params;
    const { status, company_id, round_id } = req.query;
    const isEntreprise = req.user?.role === 'entreprise';
    
    // Import dynamique de exceljs pour une meilleure mise en forme
    const ExcelJS = (await import('exceljs')).default;
    
    // Récupérer les données
    let sql = `
      SELECT gq.*, 
        i.num, i.designation, i.unit,
        c.name as company_name,
        l.name as lot_name,
        p.name as project_name
      FROM generated_questions gq
      JOIN items i ON i.id = gq.item_id
      JOIN companies c ON c.id = gq.company_id
      JOIN lots l ON l.id = gq.lot_id
      JOIN projects p ON p.id = l.project_id
      WHERE gq.lot_id = $1
    `;
    
    const params = [lotId];
    
    if (round_id) {
      sql += ` AND gq.round_id = $${params.length + 1}`;
      params.push(round_id);
    }
    
    if (status) {
      sql += ` AND gq.status = $${params.length + 1}`;
      params.push(status);
    }
    
    // Si utilisateur entreprise, forcer le filtre sur sa company_id
    if (isEntreprise && req.user?.company_id) {
      sql += ` AND gq.company_id = $${params.length + 1}`;
      params.push(req.user.company_id);
    } else if (company_id) {
      sql += ` AND gq.company_id = $${params.length + 1}`;
      params.push(company_id);
    }
    
    sql += ` ORDER BY c.name, i.num, gq.question_type`;
    
    const result = await query(sql, params);
    const questions = result.rows;
    
    if (questions.length === 0) {
      return res.status(404).json({ error: 'Aucune fiche question à exporter' });
    }
    
    // Grouper les questions par entreprise
    const questionsByCompany = new Map();
    questions.forEach(q => {
      if (!questionsByCompany.has(q.company_id)) {
        questionsByCompany.set(q.company_id, {
          name: q.company_name,
          questions: []
        });
      }
      questionsByCompany.get(q.company_id).questions.push(q);
    });
    
    // Créer le workbook avec ExcelJS
    const workbook = new ExcelJS.Workbook();
    
    // Créer un onglet par entreprise
    for (const [companyId, companyData] of questionsByCompany) {
      // Nom de l'onglet (limité à 31 caractères pour Excel)
      let sheetName = companyData.name.substring(0, 31);
      
      const worksheet = workbook.addWorksheet(sheetName);
      
      // Définir les colonnes avec largeurs (sans la colonne Entreprise)
      worksheet.columns = [
        { header: 'Projet', key: 'project', width: 20 },
        { header: 'Lot', key: 'lot', width: 15 },
        { header: 'Article N°', key: 'num', width: 12 },
        { header: 'Désignation', key: 'designation', width: 40 },
        { header: 'Unité', key: 'unit', width: 10 },
        { header: 'Type', key: 'type', width: 18 },
        { header: 'Question', key: 'question', width: 50 },
        { header: 'Écart (%)', key: 'deviation', width: 12 },
        { header: 'Valeur MOE', key: 'moe_value', width: 14 },
        { header: 'Valeur Offre', key: 'offer_value', width: 14 },
        { header: 'Réponse', key: 'answer', width: 40 },
        { header: 'Statut', key: 'status', width: 14 },
        { header: 'Créée le', key: 'created', width: 18 },
        { header: 'Répondue le', key: 'answered', width: 18 }
      ];
      
      // Styliser l'en-tête
      const headerRow = worksheet.getRow(1);
      headerRow.height = 25;
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      headerRow.border = {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' }
      };
      
      // Ajouter les données pour cette entreprise
      companyData.questions.forEach(q => {
        const typeLabel = {
          'qty_low': 'Quantité Basse',
          'qty_high': 'Quantité Haute',
          'price_low': 'Prix Bas',
          'price_high': 'Prix Haut'
        }[q.question_type] || q.question_type;
        
        const statusLabel = {
          'pending': 'En attente',
          'answered': 'Répondue',
          'dismissed': 'Ignorée'
        }[q.status] || q.status;
        
        const row = worksheet.addRow({
          project: q.project_name,
          lot: q.lot_name,
          num: q.num || '',
          designation: q.designation || '',
          unit: q.unit || '',
          type: typeLabel,
          question: q.question_text,
          deviation: q.deviation_pct ? Number(q.deviation_pct) : null,
          moe_value: q.moe_value || '',
          offer_value: q.offer_value || '',
          answer: q.answer || '',
          status: statusLabel,
          created: q.created_at ? new Date(q.created_at) : '',
          answered: q.answered_at ? new Date(q.answered_at) : ''
        });
        
        // Appliquer les styles de base
        row.alignment = { vertical: 'top', wrapText: true };
        row.border = {
          top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
        };
        
        // Colonne Écart (%) - Format et coloration selon la valeur
        const deviationCell = row.getCell(8);
        if (q.deviation_pct) {
          deviationCell.numFmt = '0.00"%"';
          deviationCell.alignment = { horizontal: 'right', vertical: 'top' };
          const ecartAbs = Math.abs(Number(q.deviation_pct));
          if (ecartAbs > 20) {
            deviationCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } };
            deviationCell.font = { color: { argb: 'FFCC0000' }, bold: true };
          } else if (ecartAbs > 10) {
            deviationCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE5CC' } };
            deviationCell.font = { color: { argb: 'FFCC6600' } };
          }
        }
        
        // Colonnes Valeur MOE et Valeur Offre - Format numérique
        const moeCell = row.getCell(9);
        const offerCell = row.getCell(10);
        if (q.moe_value) {
          moeCell.numFmt = '#,##0.00';
          moeCell.alignment = { horizontal: 'right', vertical: 'top' };
        }
        if (q.offer_value) {
          offerCell.numFmt = '#,##0.00';
          offerCell.alignment = { horizontal: 'right', vertical: 'top' };
        }
        
        // Colonne Type - Coloration selon le type
        const typeCell = row.getCell(6);
        if (typeLabel === 'Quantité Basse' || typeLabel === 'Quantité Haute') {
          typeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F3FF' } };
        } else if (typeLabel === 'Prix Bas' || typeLabel === 'Prix Haut') {
          typeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF0E7' } };
        }
        
        // Colonne Statut - Coloration selon le statut
        const statusCell = row.getCell(12);
        if (statusLabel === 'En attente') {
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
        } else if (statusLabel === 'Répondue') {
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1E7DD' } };
        } else if (statusLabel === 'Ignorée') {
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
        }
        
        // Colonnes dates - Format date
        const createdCell = row.getCell(13);
        const answeredCell = row.getCell(14);
        if (q.created_at) {
          createdCell.numFmt = 'dd/mm/yyyy hh:mm';
        }
        if (q.answered_at) {
          answeredCell.numFmt = 'dd/mm/yyyy hh:mm';
        }
      });
      
      // Figer la première ligne
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    }
    
    // Générer le buffer Excel
    const buffer = await workbook.xlsx.writeBuffer();
    
    // Envoyer le fichier
    const filename = `Fiches_Questions_Lot_${lotId}_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
    
  } catch (err) {
    console.error('Erreur export Excel:', err);
    res.status(500).json({ error: 'Impossible d\'exporter les fiches questions' });
  }
});

export default router;
