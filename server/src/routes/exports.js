// server/src/routes/exports.js
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { query } from '../db.js';
import { requireAuth } from '../middleware.auth.js';

const router = Router();

// Toutes les routes nécessitent authentification
router.use(requireAuth);

// Export Excel du récapitulatif d'un tour
router.get('/summary/:roundId', async (req, res) => {
  try {
    const { roundId } = req.params;
    const userId = req.user.id;

    // Récupérer les infos du tour et du projet
    const roundRes = await query(
      `SELECT r.*, p.name as project_name, p.reference
       FROM rounds r
       JOIN projects p ON r.project_id = p.id
       WHERE r.id = $1`,
      [roundId]
    );
    
    if (roundRes.rowCount === 0) {
      return res.status(404).json({ error: 'Tour introuvable' });
    }

    const round = roundRes.rows[0];

    // Vérifier l'accès au projet
    const accessCheck = await query(
      `SELECT 1 FROM projects p
       LEFT JOIN project_shares ps ON ps.project_id = p.id AND ps.shared_with_user_id = $2
       WHERE p.id = $1 AND (p.owner_id = $2 OR ps.shared_with_user_id IS NOT NULL OR $3 = 'admin')`,
      [round.project_id, userId, req.user.role]
    );

    if (accessCheck.rowCount === 0) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    // Récupérer les lots
    const lotsRes = await query(
      `SELECT id, code, name FROM lots WHERE project_id = $1 ORDER BY id`,
      [round.project_id]
    );
    const lots = lotsRes.rows;

    // Récupérer les entreprises actives pour ce tour
    const companiesRes = await query(
      `SELECT DISTINCT c.id, c.name
       FROM companies c
       JOIN lot_companies lc ON lc.company_id = c.id
       JOIN lots l ON l.id = lc.lot_id
       WHERE l.project_id = $1
       ORDER BY c.name`,
      [round.project_id]
    );
    const companies = companiesRes.rows;

    // Récupérer toutes les données (items MOE + offres)
    const dataRes = await query(
      `SELECT 
         i.lot_id,
         i.num,
         i.designation,
         i.unit,
         m.qty as moe_qty,
         m.unit_price as moe_pu,
         o.company_id,
         o.qty as offer_qty,
         o.unit_price as offer_pu
       FROM items i
       LEFT JOIN moe_items m ON m.item_id = i.id
       LEFT JOIN offers o ON o.item_id = i.id AND o.round_id = $1
       JOIN lots l ON l.id = i.lot_id
       WHERE l.project_id = $2
       ORDER BY i.lot_id, i.num`,
      [roundId, round.project_id]
    );

    // Organiser les données par lot
    const lotData = {};
    for (const row of dataRes.rows) {
      if (!lotData[row.lot_id]) {
        lotData[row.lot_id] = [];
      }
      let item = lotData[row.lot_id].find(it => it.num === row.num);
      if (!item) {
        item = {
          num: row.num,
          designation: row.designation,
          unit: row.unit,
          moe_qty: row.moe_qty,
          moe_pu: row.moe_pu,
          offers: {}
        };
        lotData[row.lot_id].push(item);
      }
      if (row.company_id) {
        item.offers[row.company_id] = {
          qty: row.offer_qty,
          pu: row.offer_pu
        };
      }
    }

    // Créer le workbook Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TAO';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Récapitulatif');

    // En-tête du document
    worksheet.mergeCells('A1:E1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `Récapitulatif - ${round.project_name} (Tour ${round.round_number} - ${round.name || ''})`;
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 30;

    worksheet.addRow([]);

    // En-têtes colonnes principales
    const headerRow = worksheet.addRow([
      'Lot',
      'MOE Total (€)',
      ...companies.map(c => c.name),
      'Moins-disant (€)'
    ]);

    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 25;

    // Calculer les totaux par lot
    for (const lot of lots) {
      const items = lotData[lot.id] || [];
      
      // Total MOE
      let moeTotal = 0;
      for (const item of items) {
        const qty = parseFloat(item.moe_qty) || 0;
        const pu = parseFloat(item.moe_pu) || 0;
        moeTotal += qty * pu;
      }

      // Totaux par entreprise
      const companyTotals = companies.map(company => {
        let total = 0;
        for (const item of items) {
          const offer = item.offers[company.id];
          if (offer) {
            const qty = parseFloat(offer.qty) || 0;
            const pu = parseFloat(offer.pu) || 0;
            total += qty * pu;
          }
        }
        return total || null;
      });

      // Moins-disant
      const validTotals = companyTotals.filter(t => t !== null && t > 0);
      const minTotal = validTotals.length > 0 ? Math.min(...validTotals) : null;

      const row = worksheet.addRow([
        `${lot.code || ''} ${lot.name}`.trim(),
        moeTotal,
        ...companyTotals,
        minTotal
      ]);

      // Format monétaire
      for (let col = 2; col <= 2 + companies.length; col++) {
        row.getCell(col).numFmt = '#,##0.00 €';
      }
      row.getCell(2 + companies.length + 1).numFmt = '#,##0.00 €';

      // Surligner le moins-disant
      if (minTotal !== null) {
        companyTotals.forEach((total, idx) => {
          if (total === minTotal) {
            row.getCell(3 + idx).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFD4EDDA' }
            };
            row.getCell(3 + idx).font = { bold: true };
          }
        });
      }
    }

    // Ligne de totaux généraux
    worksheet.addRow([]);
    const totalRow = worksheet.addRow(['TOTAL GÉNÉRAL']);
    totalRow.font = { bold: true, size: 12 };
    totalRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F3F3' }
    };

    // Calculer les totaux
    let moeGrandTotal = 0;
    const companyGrandTotals = companies.map(() => 0);

    for (const lot of lots) {
      const items = lotData[lot.id] || [];
      for (const item of items) {
        const qty = parseFloat(item.moe_qty) || 0;
        const pu = parseFloat(item.moe_pu) || 0;
        moeGrandTotal += qty * pu;

        companies.forEach((company, idx) => {
          const offer = item.offers[company.id];
          if (offer) {
            const offerQty = parseFloat(offer.qty) || 0;
            const offerPu = parseFloat(offer.pu) || 0;
            companyGrandTotals[idx] += offerQty * offerPu;
          }
        });
      }
    }

    totalRow.getCell(2).value = moeGrandTotal;
    totalRow.getCell(2).numFmt = '#,##0.00 €';

    companies.forEach((_, idx) => {
      totalRow.getCell(3 + idx).value = companyGrandTotals[idx];
      totalRow.getCell(3 + idx).numFmt = '#,##0.00 €';
    });

    const validGrandTotals = companyGrandTotals.filter(t => t > 0);
    const minGrandTotal = validGrandTotals.length > 0 ? Math.min(...validGrandTotals) : null;
    totalRow.getCell(3 + companies.length).value = minGrandTotal;
    totalRow.getCell(3 + companies.length).numFmt = '#,##0.00 €';

    // Ajuster les largeurs de colonnes
    worksheet.getColumn(1).width = 30;
    for (let i = 2; i <= 2 + companies.length + 1; i++) {
      worksheet.getColumn(i).width = 15;
    }

    // Bordures: appliquer sur toutes les cellules, y compris vides
    const headerCols = headerRow.cellCount; // nombre de colonnes de la table
    const lastRow = worksheet.lastRow.number;
    for (let r = 3; r <= lastRow; r++) { // à partir de la ligne d'en-tête
      for (let c = 1; c <= headerCols; c++) {
        const cell = worksheet.getCell(r, c);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      }
    }

    // Générer le fichier
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `Recap_${round.project_name.replace(/[^a-zA-Z0-9]/g, '_')}_Tour${round.round_number}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);

  } catch (err) {
    console.error('Export summary error:', err);
    res.status(500).json({ error: 'Erreur lors de l\'export' });
  }
});

// Export Excel de la comparaison des tours
router.get('/rounds-comparison/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;

    // Vérifier l'accès au projet
    const projectRes = await query(
      `SELECT p.*, 
         (p.owner_id = $2 OR EXISTS(SELECT 1 FROM project_shares WHERE project_id = p.id AND shared_with_user_id = $2) OR $3 = 'admin') as has_access
       FROM projects p
       WHERE p.id = $1`,
      [projectId, userId, req.user.role]
    );

    if (projectRes.rowCount === 0 || !projectRes.rows[0].has_access) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    const project = projectRes.rows[0];

    // Récupérer tous les tours du projet
    const roundsRes = await query(
      `SELECT id, round_number, name FROM rounds WHERE project_id = $1 ORDER BY round_number`,
      [projectId]
    );
    const rounds = roundsRes.rows;

    if (rounds.length === 0) {
      return res.status(404).json({ error: 'Aucun tour trouvé' });
    }

    // Récupérer les lots
    const lotsRes = await query(
      `SELECT id, code, name FROM lots WHERE project_id = $1 ORDER BY id`,
      [projectId]
    );
    const lots = lotsRes.rows;

    // Créer le workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Comparaison Tours');

    // Titre
    worksheet.mergeCells('A1:E1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `Comparaison des Tours - ${project.name}`;
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 30;

    worksheet.addRow([]);

    // En-têtes
    const headerRow = worksheet.addRow([
      'Lot',
      'MOE (€)',
      ...rounds.map(r => `Tour ${r.round_number}${r.name ? ` - ${r.name}` : ''} (€)`)
    ]);

    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    headerRow.height = 35;

    // Récupérer les données pour chaque lot et tour
    for (const lot of lots) {
      const rowData = [
        `${lot.code || ''} ${lot.name}`.trim()
      ];

      // MOE total
      const moeRes = await query(
        `SELECT SUM(m.qty * m.unit_price) as total
         FROM items i
         JOIN moe_items m ON m.item_id = i.id
         WHERE i.lot_id = $1`,
        [lot.id]
      );
      const moeTotal = parseFloat(moeRes.rows[0]?.total) || 0;
      rowData.push(moeTotal);

      // Total par tour (moins-disant)
      for (const round of rounds) {
        const roundRes = await query(
          `SELECT c.id, c.name, SUM(o.qty * o.unit_price) as total
           FROM companies c
           JOIN offers o ON o.company_id = c.id
           JOIN items i ON i.id = o.item_id
           WHERE i.lot_id = $1 AND o.round_id = $2
           GROUP BY c.id, c.name
           ORDER BY total`,
          [lot.id, round.id]
        );

        const minTotal = roundRes.rowCount > 0 ? parseFloat(roundRes.rows[0].total) || null : null;
        rowData.push(minTotal);
      }

      const row = worksheet.addRow(rowData);
      
      // Format monétaire
      for (let col = 2; col <= 2 + rounds.length; col++) {
        row.getCell(col).numFmt = '#,##0.00 €';
      }
    }

    // Totaux
    worksheet.addRow([]);
    const totalRow = worksheet.addRow(['TOTAL GÉNÉRAL']);
    totalRow.font = { bold: true, size: 12 };
    totalRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F3F3' }
    };

    // MOE grand total
    const moeGrandRes = await query(
      `SELECT SUM(m.qty * m.unit_price) as total
       FROM items i
       JOIN moe_items m ON m.item_id = i.id
       JOIN lots l ON l.id = i.lot_id
       WHERE l.project_id = $1`,
      [projectId]
    );
    totalRow.getCell(2).value = parseFloat(moeGrandRes.rows[0]?.total) || 0;
    totalRow.getCell(2).numFmt = '#,##0.00 €';

    // Totaux par tour
    for (let idx = 0; idx < rounds.length; idx++) {
      const roundGrandRes = await query(
        `SELECT SUM(o.qty * o.unit_price) as total
         FROM offers o
         JOIN items i ON i.id = o.item_id
         JOIN lots l ON l.id = i.lot_id
         WHERE l.project_id = $1 AND o.round_id = $2`,
        [projectId, rounds[idx].id]
      );
      totalRow.getCell(3 + idx).value = parseFloat(roundGrandRes.rows[0]?.total) || 0;
      totalRow.getCell(3 + idx).numFmt = '#,##0.00 €';
    }

    // Ajuster largeurs
    worksheet.getColumn(1).width = 30;
    for (let i = 2; i <= 2 + rounds.length; i++) {
      worksheet.getColumn(i).width = 18;
    }

    // Bordures: appliquer sur toutes les cellules, y compris vides
    const headerCols2 = headerRow.cellCount;
    const lastRow2 = worksheet.lastRow.number;
    for (let r = 3; r <= lastRow2; r++) {
      for (let c = 1; c <= headerCols2; c++) {
        const cell = worksheet.getCell(r, c);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `ComparaisonTours_${project.name.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);

  } catch (err) {
    console.error('Export rounds comparison error:', err);
    res.status(500).json({ error: 'Erreur lors de l\'export' });
  }
});

export default router;
