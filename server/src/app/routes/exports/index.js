// server/src/routes/exports.js
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, BorderStyle, UnderlineType, HeadingLevel, AlignmentType } from 'docx';
import { query } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';

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
       WHERE p.id = $1 AND (p.owner_id = $2 OR ps.shared_with_user_id IS NOT NULL OR $3 IN ('admin', 'responsable'))`,
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
async function handleRoundsComparison(req, res) {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;
    const isEntreprise = req.user?.role === 'entreprise';
    const companyId = req.user?.company_id;
    const roundFromId = Number(req.query.round_from || req.query.roundFromId || req.query.from);
    const roundToId = Number(req.query.round_to || req.query.roundToId || req.query.to);
    const showAnalysis = Number.isFinite(roundFromId) && Number.isFinite(roundToId) && roundFromId !== roundToId;

    // Vérifier l'accès au projet
    const projectRes = await query(
      `SELECT p.*, 
         (p.owner_id = $2 OR EXISTS(SELECT 1 FROM project_shares WHERE project_id = p.id AND shared_with_user_id = $2) OR $3 IN ('admin', 'responsable')) as has_access
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

    // Récupérer les lots (tri numérique par code)
    const lotsRes = await query(
      `SELECT id, code, name FROM lots WHERE project_id = $1
       ORDER BY CASE WHEN code ~ '^[0-9]+' THEN CAST(SUBSTRING(code FROM '^[0-9]+') AS INTEGER) ELSE 999999 END, code, name`,
      [projectId]
    );
    const lots = lotsRes.rows;

    // Totaux MOE par lot (non entreprise seulement)
    const moeTotals = new Map();
    if (!isEntreprise) {
      const moeRes = await query(
        `SELECT i.lot_id, COALESCE(SUM(m.qty * m.unit_price), 0) as total
         FROM items i
         LEFT JOIN moe_items m ON m.item_id = i.id
         JOIN lots l ON l.id = i.lot_id
         WHERE l.project_id = $1
         GROUP BY i.lot_id`,
        [projectId]
      );
      for (const row of moeRes.rows) {
        moeTotals.set(row.lot_id, parseFloat(row.total) || 0);
      }
    }

    // Offres par lot / tour / entreprise
    const offersParams = [projectId];
    let offersWhere = '';
    if (isEntreprise && companyId) {
      offersParams.push(companyId);
      offersWhere = 'AND o.company_id = $2';
    }
    const offersRes = await query(
      `SELECT i.lot_id, o.round_id, o.company_id, c.name as company_name,
              COALESCE(SUM(o.qty * o.unit_price), 0) as total
       FROM offers o
       JOIN items i ON i.id = o.item_id
       JOIN rounds r ON r.id = o.round_id
       JOIN companies c ON c.id = o.company_id
       JOIN lot_companies lc ON lc.company_id = o.company_id AND lc.lot_id = i.lot_id
       WHERE r.project_id = $1
       ${offersWhere}
       GROUP BY i.lot_id, o.round_id, o.company_id, c.name`,
      offersParams
    );

    const offersByLotRoundCompany = new Map();
    const companiesByLot = new Map();
    const bestPriceByLotRound = new Map();

    for (const row of offersRes.rows) {
      const lotId = row.lot_id;
      const roundId = row.round_id;
      const compId = row.company_id;
      const total = parseFloat(row.total) || 0;
      const key = `${lotId}:${roundId}:${compId}`;
      const roundKey = `${lotId}:${roundId}`;

      offersByLotRoundCompany.set(key, total);

      if (!companiesByLot.has(lotId)) {
        companiesByLot.set(lotId, new Map());
      }
      companiesByLot.get(lotId).set(compId, row.company_name);

      const best = bestPriceByLotRound.get(roundKey);
      if (best === undefined || total < best) {
        bestPriceByLotRound.set(roundKey, total);
      }
    }

    // Récupérer toutes les entreprises assignées aux lots (y compris sans offres)
    const lotCompaniesParams = [projectId];
    let lcWhere = '';
    if (isEntreprise && companyId) {
      lotCompaniesParams.push(companyId);
      lcWhere = 'AND c.id = $2';
    }
    const lotCompaniesRes = await query(
      `SELECT lc.lot_id, c.id as company_id, c.name as company_name
       FROM lot_companies lc
       JOIN companies c ON c.id = lc.company_id
       JOIN lots l ON l.id = lc.lot_id
       WHERE l.project_id = $1 ${lcWhere}
       ORDER BY c.name`,
      lotCompaniesParams
    );
    for (const row of lotCompaniesRes.rows) {
      if (!companiesByLot.has(row.lot_id)) {
        companiesByLot.set(row.lot_id, new Map());
      }
      if (!companiesByLot.get(row.lot_id).has(row.company_id)) {
        companiesByLot.get(row.lot_id).set(row.company_id, row.company_name);
      }
    }

    // Créer le workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Comparaison Tours');

    const perRoundCols = isEntreprise ? 1 : 3;
    const analysisCols = showAnalysis ? 3 : 0;
    const totalCols = 1 + (isEntreprise ? 0 : 1) + (rounds.length * perRoundCols) + analysisCols;
    const currencyFmt = '#,##0.00 €';
    const deltaCurrencyFmt = '+#,##0.00 €;-#,##0.00 €;0.00 €';
    const deltaPercentFmt = '+0.0%;-0.0%;0.0%';

    // Titre
    worksheet.mergeCells(1, 1, 1, totalCols);
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `Comparaison des Tours - ${project.name}`;
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 30;

    worksheet.addRow([]);

    // En-têtes (2 lignes, comme l'interface)
    const headerRow1 = worksheet.addRow([]);
    const headerRow2 = worksheet.addRow([]);
    headerRow1.height = 30;
    headerRow2.height = 30;

    let col = 1;
    worksheet.mergeCells(headerRow1.number, col, headerRow2.number, col);
    headerRow1.getCell(col).value = 'Lot';
    col += 1;

    if (!isEntreprise) {
      worksheet.mergeCells(headerRow1.number, col, headerRow2.number, col);
      headerRow1.getCell(col).value = 'MOE (€)';
      col += 1;
    }

    for (const round of rounds) {
      const startCol = col;
      const endCol = col + perRoundCols - 1;
      worksheet.mergeCells(headerRow1.number, startCol, headerRow1.number, endCol);
      headerRow1.getCell(startCol).value = `Tour ${round.round_number}${round.name ? ` - ${round.name}` : ''}`;

      headerRow2.getCell(col).value = 'Montant (€)';
      if (!isEntreprise) {
        headerRow2.getCell(col + 1).value = 'Ecart (€)';
        headerRow2.getCell(col + 2).value = 'Ecart (%)';
      }
      col += perRoundCols;
    }

    if (showAnalysis) {
      const startCol = col;
      const endCol = col + 2;
      worksheet.mergeCells(headerRow1.number, startCol, headerRow1.number, endCol);
      headerRow1.getCell(startCol).value = 'Analyse';
      headerRow2.getCell(col).value = 'Delta Montant';
      headerRow2.getCell(col + 1).value = 'Delta %';
      headerRow2.getCell(col + 2).value = 'Tendance';
    }

    for (let c = 1; c <= totalCols; c++) {
      const cell1 = headerRow1.getCell(c);
      const cell2 = headerRow2.getCell(c);
      [cell1, cell2].forEach(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' }
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      });
    }

    let totalMoe = 0;
    const totalsByRound = {};
    rounds.forEach(r => { totalsByRound[r.id] = 0; });

    for (const lot of lots) {
      const lotLabel = `${lot.code || ''} ${lot.name}`.trim();
      const moeTotal = moeTotals.get(lot.id) || 0;

      const lotRow = worksheet.addRow([]);
      lotRow.getCell(1).value = lotLabel;
      lotRow.font = { bold: true };
      lotRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F3F3' } };

      let currentCol = 2;
      if (!isEntreprise) {
        lotRow.getCell(currentCol).value = moeTotal;
        lotRow.getCell(currentCol).numFmt = currencyFmt;
        totalMoe += moeTotal;
        currentCol += 1;
      }

      for (const round of rounds) {
        const roundKey = `${lot.id}:${round.id}`;
        const bestPrice = bestPriceByLotRound.get(roundKey);
        if (bestPrice !== undefined) {
          lotRow.getCell(currentCol).value = bestPrice;
          lotRow.getCell(currentCol).numFmt = currencyFmt;
          totalsByRound[round.id] += bestPrice;
        }
        currentCol += 1;

        if (!isEntreprise) {
          if (bestPrice !== undefined) {
            const ecart = bestPrice - moeTotal;
            lotRow.getCell(currentCol).value = ecart;
            lotRow.getCell(currentCol).numFmt = deltaCurrencyFmt;
            currentCol += 1;

            const pct = moeTotal > 0 ? ecart / moeTotal : 0;
            lotRow.getCell(currentCol).value = pct;
            lotRow.getCell(currentCol).numFmt = deltaPercentFmt;
            currentCol += 1;
          } else {
            currentCol += 2;
          }
        }
      }

      if (showAnalysis) {
        const fromTotal = bestPriceByLotRound.get(`${lot.id}:${roundFromId}`) || 0;
        const toTotal = bestPriceByLotRound.get(`${lot.id}:${roundToId}`) || 0;
        const delta = toTotal - fromTotal;
        const deltaPct = fromTotal > 0 ? delta / fromTotal : 0;
        lotRow.getCell(currentCol).value = delta;
        lotRow.getCell(currentCol).numFmt = deltaCurrencyFmt;
        lotRow.getCell(currentCol + 1).value = deltaPct;
        lotRow.getCell(currentCol + 1).numFmt = deltaPercentFmt;
        lotRow.getCell(currentCol + 2).value = delta < 0 ? 'DOWN' : (delta > 0 ? 'UP' : 'SAME');
      }

      const companiesMap = companiesByLot.get(lot.id) || new Map();
      const companies = Array.from(companiesMap.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

      for (const company of companies) {
        const companyRow = worksheet.addRow([]);
        companyRow.getCell(1).value = company.name;
        companyRow.getCell(1).alignment = { indent: 1 };

        let cCol = 2;
        if (!isEntreprise) {
          companyRow.getCell(cCol).value = '-';
          cCol += 1;
        }

        for (const round of rounds) {
          const amount = offersByLotRoundCompany.get(`${lot.id}:${round.id}:${company.id}`) || 0;
          companyRow.getCell(cCol).value = amount;
          companyRow.getCell(cCol).numFmt = currencyFmt;
          cCol += 1;

          if (!isEntreprise) {
            const ecart = amount - moeTotal;
            companyRow.getCell(cCol).value = ecart;
            companyRow.getCell(cCol).numFmt = deltaCurrencyFmt;
            cCol += 1;

            const pct = moeTotal > 0 ? ecart / moeTotal : 0;
            companyRow.getCell(cCol).value = pct;
            companyRow.getCell(cCol).numFmt = deltaPercentFmt;
            cCol += 1;
          }
        }

        if (showAnalysis) {
          const fromAmount = offersByLotRoundCompany.get(`${lot.id}:${roundFromId}:${company.id}`) || 0;
          const toAmount = offersByLotRoundCompany.get(`${lot.id}:${roundToId}:${company.id}`) || 0;
          const delta = toAmount - fromAmount;
          const deltaPct = fromAmount > 0 ? delta / fromAmount : 0;
          companyRow.getCell(cCol).value = delta;
          companyRow.getCell(cCol).numFmt = deltaCurrencyFmt;
          companyRow.getCell(cCol + 1).value = deltaPct;
          companyRow.getCell(cCol + 1).numFmt = deltaPercentFmt;
          companyRow.getCell(cCol + 2).value = delta < 0 ? 'DOWN' : (delta > 0 ? 'UP' : 'SAME');
        }
      }
    }

    // Totaux
    worksheet.addRow([]);
    const totalRow = worksheet.addRow([]);
    totalRow.getCell(1).value = 'TOTAL GENERAL';
    totalRow.font = { bold: true, size: 12 };
    totalRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F3F3' }
    };

    let tCol = 2;
    if (!isEntreprise) {
      totalRow.getCell(tCol).value = totalMoe;
      totalRow.getCell(tCol).numFmt = currencyFmt;
      tCol += 1;
    }

    for (const round of rounds) {
      const total = totalsByRound[round.id] || 0;
      totalRow.getCell(tCol).value = total;
      totalRow.getCell(tCol).numFmt = currencyFmt;
      tCol += 1;

      if (!isEntreprise) {
        const ecart = total - totalMoe;
        totalRow.getCell(tCol).value = ecart;
        totalRow.getCell(tCol).numFmt = deltaCurrencyFmt;
        tCol += 1;

        const pct = totalMoe > 0 ? ecart / totalMoe : 0;
        totalRow.getCell(tCol).value = pct;
        totalRow.getCell(tCol).numFmt = deltaPercentFmt;
        tCol += 1;
      }
    }

    if (showAnalysis) {
      const fromTotal = totalsByRound[roundFromId] || 0;
      const toTotal = totalsByRound[roundToId] || 0;
      const delta = toTotal - fromTotal;
      const deltaPct = fromTotal > 0 ? delta / fromTotal : 0;
      totalRow.getCell(tCol).value = delta;
      totalRow.getCell(tCol).numFmt = deltaCurrencyFmt;
      totalRow.getCell(tCol + 1).value = deltaPct;
      totalRow.getCell(tCol + 1).numFmt = deltaPercentFmt;
      totalRow.getCell(tCol + 2).value = delta < 0 ? 'DOWN' : (delta > 0 ? 'UP' : 'SAME');
    }

    // Ajuster largeurs
    worksheet.getColumn(1).width = 30;
    for (let i = 2; i <= totalCols; i++) {
      worksheet.getColumn(i).width = 16;
    }

    // Bordures: appliquer sur toutes les cellules, y compris vides
    const lastRow2 = worksheet.lastRow.number;
    for (let r = headerRow1.number; r <= lastRow2; r++) {
      for (let c = 1; c <= totalCols; c++) {
        const cell = worksheet.getCell(r, c);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      }
    }

    // --- Onglet Simulation (si données fournies en POST) ---
    const simulationData = req.body?.simulations;
    const simulationRoundId = Number(req.body?.simulationRoundId);
    const selectedOptionIds = (req.body?.selectedOptions || []).map(Number).filter(Number.isFinite);

    if (Array.isArray(simulationData) && simulationData.length > 0 && Number.isFinite(simulationRoundId)) {
      // Calculer les totaux d'offres par lot/entreprise pour le tour de simulation
      const simOffersRes = await query(
        `SELECT i.lot_id, o.company_id, c.name as company_name,
                COALESCE(SUM(o.qty * o.unit_price), 0) as total
         FROM offers o
         JOIN items i ON i.id = o.item_id
         JOIN companies c ON c.id = o.company_id
         JOIN lot_companies lc ON lc.company_id = o.company_id AND lc.lot_id = i.lot_id
         WHERE o.round_id = $1 AND i.lot_id = ANY($2::int[])
         GROUP BY i.lot_id, o.company_id, c.name`,
        [simulationRoundId, lots.map(l => l.id)]
      );

      const simOffersByLotCompany = new Map();
      const allCompanyNames = new Map();
      for (const row of simOffersRes.rows) {
        const key = `${row.lot_id}:${row.company_id}`;
        simOffersByLotCompany.set(key, parseFloat(row.total) || 0);
        allCompanyNames.set(Number(row.company_id), row.company_name);
      }

      // Calculer les totaux des options sélectionnées par lot/entreprise
      const optionTotalsByLotCompany = new Map();
      if (selectedOptionIds.length > 0) {
        const optRes = await query(
          `SELECT o.lot_id, oio.company_id, SUM(oio.qty * oio.unit_price) as total
           FROM option_item_offers oio
           JOIN option_items oi ON oi.id = oio.option_item_id
           JOIN options o ON o.id = oi.option_id
           WHERE oio.round_id = $1 AND o.id = ANY($2::int[])
           GROUP BY o.lot_id, oio.company_id`,
          [simulationRoundId, selectedOptionIds]
        );
        for (const row of optRes.rows) {
          const key = `${row.lot_id}:${row.company_id}`;
          optionTotalsByLotCompany.set(key, (optionTotalsByLotCompany.get(key) || 0) + (parseFloat(row.total) || 0));
        }
      }

      // Fonction pour obtenir le total d'une entreprise sur un lot (offres + options)
      function getCompanyLotTotal(lotId, compId) {
        const base = simOffersByLotCompany.get(`${lotId}:${compId}`) || 0;
        const opt = optionTotalsByLotCompany.get(`${lotId}:${compId}`) || 0;
        return base + opt;
      }

      const simSheet = workbook.addWorksheet('Simulation');
      const simPerCol = isEntreprise ? 1 : 2;
      const simTotalCols = 1 + (isEntreprise ? 0 : 1) + (simulationData.length * simPerCol);

      // Titre
      simSheet.mergeCells(1, 1, 1, simTotalCols);
      const simTitleCell = simSheet.getCell('A1');
      simTitleCell.value = `Simulation - ${project.name}`;
      simTitleCell.font = { size: 16, bold: true };
      simTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      simSheet.getRow(1).height = 30;
      simSheet.addRow([]);

      // En-têtes (2 lignes)
      const simHeaderRow1 = simSheet.addRow([]);
      const simHeaderRow2 = simSheet.addRow([]);
      simHeaderRow1.height = 30;
      simHeaderRow2.height = 30;

      let sCol = 1;
      simSheet.mergeCells(simHeaderRow1.number, sCol, simHeaderRow2.number, sCol);
      simHeaderRow1.getCell(sCol).value = 'Lot';
      sCol += 1;

      if (!isEntreprise) {
        simSheet.mergeCells(simHeaderRow1.number, sCol, simHeaderRow2.number, sCol);
        simHeaderRow1.getCell(sCol).value = 'MOE (€)';
        sCol += 1;
      }

      for (const sim of simulationData) {
        const startCol = sCol;
        const endCol = sCol + simPerCol - 1;
        simSheet.mergeCells(simHeaderRow1.number, startCol, simHeaderRow1.number, endCol);
        simHeaderRow1.getCell(startCol).value = sim.name || 'Simulation';
        simHeaderRow2.getCell(sCol).value = 'Montant (€)';
        if (!isEntreprise) {
          simHeaderRow2.getCell(sCol + 1).value = 'Entreprise';
        }
        sCol += simPerCol;
      }

      // Style des en-têtes
      for (let c = 1; c <= simTotalCols; c++) {
        [simHeaderRow1.getCell(c), simHeaderRow2.getCell(c)].forEach(cell => {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        });
      }

      const simTotalBySim = simulationData.map(() => 0);

      for (const lot of lots) {
        const lotLabel = `${lot.code || ''} ${lot.name}`.trim();
        const moeTotal = moeTotals.get(lot.id) || 0;
        const simRow = simSheet.addRow([]);
        simRow.getCell(1).value = lotLabel;

        let cIdx = 2;
        if (!isEntreprise) {
          simRow.getCell(cIdx).value = moeTotal;
          simRow.getCell(cIdx).numFmt = currencyFmt;
          cIdx += 1;
        }

        simulationData.forEach((sim, simIdx) => {
          const selections = sim.selections || {};
          const lotIdStr = String(lot.id);
          const hasExplicit = lotIdStr in selections;
          const selectedValue = hasExplicit ? selections[lotIdStr] : sim.defaultCompanyId;
          const selectedCompanyId = (selectedValue === 0 || selectedValue === null || selectedValue === undefined) ? null : Number(selectedValue);

          let amount = null;
          let companyName = 'MOE';

          if (selectedCompanyId) {
            const compTotal = getCompanyLotTotal(lot.id, selectedCompanyId);
            if (compTotal > 0) {
              amount = compTotal;
              companyName = allCompanyNames.get(selectedCompanyId) || `Entreprise ${selectedCompanyId}`;
            } else {
              amount = moeTotal > 0 ? moeTotal : null;
              companyName = 'MOE (pas d\'offre)';
            }
          } else {
            amount = moeTotal > 0 ? moeTotal : null;
            companyName = 'MOE';
          }

          simRow.getCell(cIdx).value = amount;
          simRow.getCell(cIdx).numFmt = currencyFmt;
          if (!isEntreprise) {
            simRow.getCell(cIdx + 1).value = companyName;
          }
          cIdx += simPerCol;

          if (amount !== null) {
            simTotalBySim[simIdx] += amount;
          }
        });
      }

      // Ligne totaux
      simSheet.addRow([]);
      const simTotalRow = simSheet.addRow([]);
      simTotalRow.getCell(1).value = 'TOTAL';
      simTotalRow.font = { bold: true, size: 12 };
      simTotalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F3F3' } };

      let tIdx = 2;
      if (!isEntreprise) { tIdx += 1; }
      simulationData.forEach((sim, simIdx) => {
        simTotalRow.getCell(tIdx).value = simTotalBySim[simIdx];
        simTotalRow.getCell(tIdx).numFmt = currencyFmt;
        tIdx += simPerCol;
      });

      // Largeurs
      simSheet.getColumn(1).width = 30;
      for (let i = 2; i <= simTotalCols; i++) {
        simSheet.getColumn(i).width = 18;
      }

      // Bordures
      const simLastRow = simSheet.lastRow.number;
      for (let r = simHeaderRow1.number; r <= simLastRow; r++) {
        for (let c = 1; c <= simTotalCols; c++) {
          simSheet.getCell(r, c).border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        }
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
}
router.get('/rounds-comparison/:projectId', handleRoundsComparison);
router.post('/rounds-comparison/:projectId', handleRoundsComparison);

// Générer le RAO (Rapport d'Analyse d'Offre) complet pour un projet en Word
router.get('/rao/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;

    // Récupérer le projet
    const projectRes = await query(
      `SELECT * FROM projects WHERE id = $1`,
      [projectId]
    );
    if (projectRes.rowCount === 0) return res.status(404).json({ error: 'Projet introuvable' });
    const project = projectRes.rows[0];

    // Vérifier l'accès
    const accessCheck = await query(
      `SELECT 1 FROM projects WHERE id = $1 AND (owner_id = $2 OR $3 IN ('admin', 'responsable'))`,
      [projectId, userId, req.user.role]
    );
    if (accessCheck.rowCount === 0) return res.status(403).json({ error: 'Accès refusé' });

    // Récupérer tous les lots du projet
    const lotsRes = await query(
      `SELECT id, code, name FROM lots WHERE project_id = $1 ORDER BY id`,
      [projectId]
    );
    const lots = lotsRes.rows;

    if (lots.length === 0) {
      return res.status(400).json({ error: 'Aucun lot trouvé pour ce projet' });
    }

    // Récupérer les phases/tours du projet
    const roundsRes = await query(
      `SELECT * FROM rounds WHERE project_id = $1 ORDER BY round_number ASC`,
      [projectId]
    );
    const rounds = roundsRes.rows;

    if (rounds.length === 0) {
      return res.status(400).json({ error: 'Aucune phase créée pour ce projet' });
    }

    // Récupérer les entreprises ayant déposé une offre sur le projet (toutes phases confondues)
    const companiesRes = await query(
      `SELECT DISTINCT c.id, c.name
       FROM companies c
       JOIN offers o ON o.company_id = c.id
       JOIN items i ON i.id = o.item_id
       JOIN rounds r ON r.id = o.round_id
       WHERE r.project_id = $1
       ORDER BY c.name`,
      [projectId]
    );
    const companies = companiesRes.rows;

    // Totaux MOE par lot
    const moeTotals = {};
    const moeRes = await query(
      `SELECT i.lot_id, m.qty, m.unit_price
       FROM items i
       LEFT JOIN moe_items m ON m.item_id = i.id
       WHERE i.lot_id = ANY($1::int[])`,
      [lots.map(l => l.id)]
    );
    moeRes.rows.forEach(r => {
      const qty = Number(r.qty) || 0;
      const pu = Number(r.unit_price) || 0;
      moeTotals[r.lot_id] = (moeTotals[r.lot_id] || 0) + qty * pu;
    });

    // Offres par phase / entreprise / lot
    const offersRes = await query(
      `SELECT o.company_id, o.round_id, o.amount, i.lot_id
       FROM offers o
       JOIN items i ON i.id = o.item_id
       JOIN rounds r ON r.id = o.round_id
       WHERE r.project_id = $1`,
      [projectId]
    );
    const offersByRoundCompanyLot = {};
    offersRes.rows.forEach(o => {
      if (!offersByRoundCompanyLot[o.round_id]) offersByRoundCompanyLot[o.round_id] = {};
      if (!offersByRoundCompanyLot[o.round_id][o.company_id]) offersByRoundCompanyLot[o.round_id][o.company_id] = {};
      offersByRoundCompanyLot[o.round_id][o.company_id][o.lot_id] = (offersByRoundCompanyLot[o.round_id][o.company_id][o.lot_id] || 0) + Number(o.amount || 0);
    });

    // Questions par lot / entreprise
    const questionsRes = await query(
      `SELECT gq.*,
        CASE WHEN gq.option_item_id IS NOT NULL THEN
          CASE WHEN oi.num IS NULL OR oi.num = '' THEN '' ELSE 'O' || oi.num END
          ELSE i.num END AS num,
        CASE WHEN gq.option_item_id IS NOT NULL
          THEN COALESCE(o.designation || ' — ' || oi.designation, oi.designation)
          ELSE i.designation END AS designation,
        COALESCE(i.unit, oi.unit) AS unit
       FROM generated_questions gq
       JOIN lots l ON l.id = gq.lot_id
       LEFT JOIN items i ON i.id = gq.item_id
       LEFT JOIN option_items oi ON oi.id = gq.option_item_id
       LEFT JOIN options o ON o.id = oi.option_id
       WHERE l.project_id = $1
       ORDER BY gq.question_type, gq.company_id, (gq.option_item_id IS NOT NULL), COALESCE(i.num, oi.num)`,
      [projectId]
    );
    const questions = questionsRes.rows;

    // Construire le document Word
    const children = [];

    // Titre principal (Titre 1)
    children.push(
      new Paragraph({
        text: `RAO - Rapport d'Analyse d'Offre`,
        heading: HeadingLevel.HEADING_1,
        bold: true,
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: `Projet: ${project.name}`,
        alignment: AlignmentType.CENTER,
        spacing: { after: 50 }
      }),
      new Paragraph({
        text: `Date: ${new Date().toLocaleDateString('fr-FR')}`,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      })
    );

    const fmtMoney = v => Number.isFinite(v) ? `${v.toFixed(2)} €` : '-';

    // Boucler sur chaque phase/tour
    for (const round of rounds) {
      // Titre Phase (Heading 2)
      children.push(
        new Paragraph({
          text: `Phase ${round.round_number}: ${round.name || ''}`,
          heading: HeadingLevel.HEADING_2,
          bold: true,
          spacing: { before: 300, after: 200 }
        })
      );

      // Tableau récapitulatif global : Lot × Entreprises
      children.push(
        new Paragraph({
          text: `Tableau Récapitulatif`,
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 150, after: 100 }
        })
      );

      const recapRows = [
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ text: 'Lot', bold: true })] }),
            new TableCell({ children: [new Paragraph({ text: 'MOE Total (€)', bold: true })] }),
            ...companies.map(c => new TableCell({ children: [new Paragraph({ text: c.name, bold: true })] }))
          ]
        })
      ];

      lots.forEach(lot => {
        recapRows.push(
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ text: lot.name || lot.code || `Lot ${lot.id}` })] }),
              new TableCell({ children: [new Paragraph({ text: fmtMoney(moeTotals[lot.id] || 0) })] }),
              ...companies.map(c => {
                const offer = offersByRoundCompanyLot[round.id]?.[c.id]?.[lot.id];
                return new TableCell({ children: [new Paragraph({ text: fmtMoney(offer) })] });
              })
            ]
          })
        );
      });

      children.push(
        new Table({ rows: recapRows, width: { size: 100, type: 'pct' } }),
        new Paragraph({ text: '' })
      );

      // Pour chaque entreprise : récap offre + fiche questions + analyse technique
      companies.forEach(company => {
        // Titre entreprise (Heading 3)
        children.push(
          new Paragraph({
            text: company.name,
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 150 }
          })
        );

        // A. Récap de l'offre (tableau Lot/MOE/Offre)
        children.push(
          new Paragraph({
            text: `A. Récapitulatif de l'offre`,
            heading: HeadingLevel.HEADING_4,
            spacing: { before: 100, after: 100 }
          })
        );

        const offerRows = [
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ text: 'Lot', bold: true })] }),
              new TableCell({ children: [new Paragraph({ text: 'MOE Total (€)', bold: true })] }),
              new TableCell({ children: [new Paragraph({ text: 'Offre (€)', bold: true })] })
            ]
          })
        ];

        lots.forEach(lot => {
          const offer = offersByRoundCompanyLot[round.id]?.[company.id]?.[lot.id];
          offerRows.push(
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ text: lot.name || lot.code || `Lot ${lot.id}` })] }),
                new TableCell({ children: [new Paragraph({ text: fmtMoney(moeTotals[lot.id] || 0) })] }),
                new TableCell({ children: [new Paragraph({ text: fmtMoney(offer) })] })
              ]
            })
          );
        });

        children.push(
          new Table({ rows: offerRows, width: { size: 100, type: 'pct' } }),
          new Paragraph({ text: '' })
        );

        // B. Fiche questions
        children.push(
          new Paragraph({
            text: `B. Fiche Questions`,
            heading: HeadingLevel.HEADING_4,
            spacing: { before: 150, after: 100 }
          })
        );

        const companyQuestions = questions.filter(q => q.company_id === company.id);
        if (companyQuestions.length > 0) {
          const questionRows = [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ text: 'N°', bold: true })] }),
                new TableCell({ children: [new Paragraph({ text: 'Article', bold: true })] }),
                new TableCell({ children: [new Paragraph({ text: 'Question', bold: true })] }),
                new TableCell({ children: [new Paragraph({ text: 'Commentaire', bold: true })] })
              ]
            })
          ];

          companyQuestions.forEach((q, idx) => {
            const articleText = `${q.num ?? ''}${q.designation ? ` — ${q.designation}` : ''}`.trim();
            questionRows.push(
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: `${idx + 1}` })] }),
                  new TableCell({ children: [new Paragraph({ text: articleText || '-' })] }),
                  new TableCell({ children: [new Paragraph({ text: q.question_text || '-' })] }),
                  new TableCell({ children: [new Paragraph({ text: q.comment || '(À compléter)' })] })
                ]
              })
            );
          });

          children.push(
            new Table({ rows: questionRows, width: { size: 100, type: 'pct' } }),
            new Paragraph({ text: '' })
          );
        } else {
          children.push(
            new Paragraph({
              text: '(Aucune question pour cette entreprise)',
              spacing: { after: 100 }
            })
          );
        }

        // C. Analyse technique
        children.push(
          new Paragraph({
            text: `C. Analyse Technique`,
            heading: HeadingLevel.HEADING_4,
            spacing: { before: 150, after: 100 }
          }),
          new Paragraph({
            text: '(À compléter par les responsables)',
            italics: true,
            spacing: { after: 200 }
          }),
          new Paragraph({ text: '' }),
          new Paragraph({ text: '' })
        );
      });
    }

    // Créer le document
    const doc = new Document({ 
      sections: [{ 
        children: children
      }] 
    });
    const buffer = await Packer.toBuffer(doc);

    const filename = `RAO_${project.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Erreur génération RAO:', err);
    res.status(500).json({ error: 'Erreur lors de la génération du RAO: ' + err.message });
  }
});

export default router;
