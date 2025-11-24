// server/src/routes/question-config.js
import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware.auth.js';

const router = express.Router();
router.use(requireAuth);

// ========== Configuration Projet ==========

// Obtenir la config des questions pour un projet
router.get('/project/:projectId', async (req, res) => {
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
router.put('/project/:projectId', async (req, res) => {
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
router.get('/lot/:lotId/thresholds', async (req, res) => {
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
router.put('/lot/:lotId/thresholds', async (req, res) => {
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
router.post('/lot/:lotId/generate', async (req, res) => {
  try {
    const { lotId } = req.params;
    const { roundId } = req.body;
    
    if (!roundId) {
      return res.status(400).json({ error: 'roundId requis' });
    }
    
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
             ON CONFLICT (lot_id, item_id, company_id, question_type) 
             DO UPDATE SET 
               question_text = EXCLUDED.question_text,
               moe_value = EXCLUDED.moe_value,
               offer_value = EXCLUDED.offer_value,
               deviation_pct = EXCLUDED.deviation_pct,
               round_id = EXCLUDED.round_id`,
            [lotId, offer.item_id, offer.company_id, questions.question_qty_low, moe.qty, offer.qty, qtyDev, roundId]
          );
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'qty_low' });
        } else if (qtyDev > Math.abs(thresholds.qty_high_threshold)) {
          // Quantité haute
          await query(
            `INSERT INTO generated_questions 
              (lot_id, item_id, company_id, question_type, question_text, moe_value, offer_value, deviation_pct, round_id)
             VALUES ($1, $2, $3, 'qty_high', $4, $5, $6, $7, $8)
             ON CONFLICT (lot_id, item_id, company_id, question_type) 
             DO UPDATE SET 
               question_text = EXCLUDED.question_text,
               moe_value = EXCLUDED.moe_value,
               offer_value = EXCLUDED.offer_value,
               deviation_pct = EXCLUDED.deviation_pct,
               round_id = EXCLUDED.round_id`,
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
             ON CONFLICT (lot_id, item_id, company_id, question_type) 
             DO UPDATE SET 
               question_text = EXCLUDED.question_text,
               moe_value = EXCLUDED.moe_value,
               offer_value = EXCLUDED.offer_value,
               deviation_pct = EXCLUDED.deviation_pct,
               round_id = EXCLUDED.round_id`,
            [lotId, offer.item_id, offer.company_id, questions.question_price_low, moe.unit_price, offer.unit_price, priceDev, roundId]
          );
          generated.push({ item_id: offer.item_id, company_id: offer.company_id, type: 'price_low' });
        } else if (priceDev > Math.abs(thresholds.price_high_threshold)) {
          // Prix haut
          await query(
            `INSERT INTO generated_questions 
              (lot_id, item_id, company_id, question_type, question_text, moe_value, offer_value, deviation_pct, round_id)
             VALUES ($1, $2, $3, 'price_high', $4, $5, $6, $7, $8)
             ON CONFLICT (lot_id, item_id, company_id, question_type) 
             DO UPDATE SET 
               question_text = EXCLUDED.question_text,
               moe_value = EXCLUDED.moe_value,
               offer_value = EXCLUDED.offer_value,
               deviation_pct = EXCLUDED.deviation_pct,
               round_id = EXCLUDED.round_id`,
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
    
    if (company_id) {
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
    
    // Import dynamique de xlsx
    const xlsx = await import('xlsx');
    
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
    
    if (company_id) {
      sql += ` AND gq.company_id = $${params.length + 1}`;
      params.push(company_id);
    }
    
    sql += ` ORDER BY c.name, i.num, gq.question_type`;
    
    const result = await query(sql, params);
    const questions = result.rows;
    
    if (questions.length === 0) {
      return res.status(404).json({ error: 'Aucune fiche question à exporter' });
    }
    
    // Préparer les données pour Excel
    const excelData = questions.map(q => {
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
      
      return {
        'Projet': q.project_name,
        'Lot': q.lot_name,
        'Entreprise': q.company_name,
        'Article N°': q.num || '',
        'Désignation': q.designation || '',
        'Unité': q.unit || '',
        'Type': typeLabel,
        'Question': q.question_text,
        'Écart (%)': q.deviation_pct ? Number(q.deviation_pct).toFixed(2) : '',
        'Valeur MOE': q.moe_value || '',
        'Valeur Offre': q.offer_value || '',
        'Réponse': q.answer || '',
        'Statut': statusLabel,
        'Créée le': q.created_at ? new Date(q.created_at).toLocaleString('fr-FR') : '',
        'Répondue le': q.answered_at ? new Date(q.answered_at).toLocaleString('fr-FR') : ''
      };
    });
    
    // Créer le workbook
    const ws = xlsx.utils.json_to_sheet(excelData);
    
    // Ajuster la largeur des colonnes
    const colWidths = [
      { wch: 20 }, // Projet
      { wch: 15 }, // Lot
      { wch: 20 }, // Entreprise
      { wch: 10 }, // Article N°
      { wch: 40 }, // Désignation
      { wch: 10 }, // Unité
      { wch: 15 }, // Type
      { wch: 50 }, // Question
      { wch: 12 }, // Écart
      { wch: 12 }, // Valeur MOE
      { wch: 12 }, // Valeur Offre
      { wch: 40 }, // Réponse
      { wch: 12 }, // Statut
      { wch: 18 }, // Créée le
      { wch: 18 }  // Répondue le
    ];
    ws['!cols'] = colWidths;
    
    // Styliser les en-têtes (première ligne)
    const range = xlsx.utils.decode_range(ws['!ref']);
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = xlsx.utils.encode_cell({ r: 0, c: col });
      if (!ws[cellAddress]) continue;
      
      ws[cellAddress].s = {
        font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 },
        fill: { fgColor: { rgb: "4472C4" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } }
        }
      };
    }
    
    // Formater les cellules de données
    for (let row = range.s.r + 1; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = xlsx.utils.encode_cell({ r: row, c: col });
        if (!ws[cellAddress]) continue;
        
        // Bordures pour toutes les cellules
        ws[cellAddress].s = {
          border: {
            top: { style: "thin", color: { rgb: "D3D3D3" } },
            bottom: { style: "thin", color: { rgb: "D3D3D3" } },
            left: { style: "thin", color: { rgb: "D3D3D3" } },
            right: { style: "thin", color: { rgb: "D3D3D3" } }
          },
          alignment: { vertical: "top", wrapText: true }
        };
        
        // Format numérique pour les colonnes de valeurs
        if (col === 8) { // Écart %
          ws[cellAddress].z = '0.00"%"';
          ws[cellAddress].s.alignment.horizontal = "right";
        } else if (col === 9 || col === 10) { // Valeur MOE / Offre
          ws[cellAddress].z = '#,##0.00';
          ws[cellAddress].s.alignment.horizontal = "right";
        }
        
        // Coloration selon le statut (colonne 12)
        if (col === 12) {
          const status = ws[cellAddress].v;
          if (status === 'En attente') {
            ws[cellAddress].s.fill = { fgColor: { rgb: "FFF3CD" } }; // Jaune
          } else if (status === 'Répondue') {
            ws[cellAddress].s.fill = { fgColor: { rgb: "D1E7DD" } }; // Vert
          } else if (status === 'Ignorée') {
            ws[cellAddress].s.fill = { fgColor: { rgb: "F8D7DA" } }; // Rouge
          }
        }
        
        // Coloration selon l'écart (colonne 8)
        if (col === 8 && ws[cellAddress].v) {
          const ecartValue = parseFloat(ws[cellAddress].v);
          const ecartAbs = Math.abs(ecartValue);
          if (ecartAbs > 20) {
            ws[cellAddress].s.fill = { fgColor: { rgb: "FFCCCC" } }; // Rouge clair
            ws[cellAddress].s.font = { color: { rgb: "CC0000" }, bold: true };
          } else if (ecartAbs > 10) {
            ws[cellAddress].s.fill = { fgColor: { rgb: "FFE5CC" } }; // Orange clair
            ws[cellAddress].s.font = { color: { rgb: "CC6600" } };
          }
        }
        
        // Coloration selon le type (colonne 6)
        if (col === 6) {
          const type = ws[cellAddress].v;
          if (type === 'Quantité Basse' || type === 'Quantité Haute') {
            ws[cellAddress].s.fill = { fgColor: { rgb: "E7F3FF" } }; // Bleu clair
          } else if (type === 'Prix Bas' || type === 'Prix Haut') {
            ws[cellAddress].s.fill = { fgColor: { rgb: "FFF0E7" } }; // Orange très clair
          }
        }
      }
    }
    
    // Figer la première ligne
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    
    // Hauteur de la première ligne (en-têtes)
    ws['!rows'] = [{ hpt: 30 }];
    
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Fiches Questions');
    
    // Générer le buffer Excel
    const buffer = xlsx.write(wb, { 
      type: 'buffer', 
      bookType: 'xlsx',
      cellStyles: true 
    });
    
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
