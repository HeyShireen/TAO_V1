import express from 'express'
import ExcelJS from 'exceljs'
import { query } from '../db.js'
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, BorderStyle, UnderlineType, HeadingLevel, AlignmentType } from 'docx'
import auth from '../middleware.auth.js'

const router = express.Router()
router.use(auth)

// Export en Excel des questions pour un lot
router.get('/lot/:lotId/excel', async (req, res) => {
  try {
    const { lotId } = req.params
    const userId = req.user.id

    // Vérifier l'accès au lot
    const lotCheck = await query(
      `SELECT l.*, p.owner_id, p.id as project_id FROM lots l
       JOIN projects p ON l.project_id = p.id WHERE l.id = $1`,
      [lotId]
    )
    if (lotCheck.rowCount === 0) return res.status(404).json({ error: 'Lot introuvable' })
    const lot = lotCheck.rows[0]

    if (lot.owner_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès refusé' })
    }

    // Récupérer les questions avec détails
    const questionsRes = await query(
      `SELECT gq.*, i.num as item_num, i.designation as item_designation, 
              c.name as company_name, u.email as created_by_email
       FROM generated_questions gq
       LEFT JOIN items i ON gq.item_id = i.id
       LEFT JOIN companies c ON gq.company_id = c.id
       LEFT JOIN users u ON gq.created_by = u.id
       WHERE gq.lot_id = $1
       ORDER BY gq.created_at DESC`,
      [lotId]
    )

    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Questions')

    // En-têtes
    const headers = ['N° Item', 'Désignation', 'Entreprise', 'Type', 'Question', 'Commentaire', 'Statut', 'Date']
    worksheet.addRow(headers)

    // Format en-têtes
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF366092' } }

    // Ajouter les données
    questionsRes.rows.forEach(row => {
      worksheet.addRow([
        row.item_num || '-',
        row.item_designation || '-',
        row.company_name || '-',
        row.question_type || '-',
        row.question_text || '-',
        row.comment || '(À compléter)',
        row.status || '-',
        row.created_at ? new Date(row.created_at).toLocaleDateString('fr-FR') : '-'
      ])
    })

    // Largeurs colonnes
    worksheet.columns = [
      { width: 12 },
      { width: 25 },
      { width: 20 },
      { width: 15 },
      { width: 40 },
      { width: 30 },
      { width: 12 },
      { width: 12 }
    ]

    const buffer = await workbook.xlsx.writeBuffer()
    const filename = `Questions_Lot_${lotId}_${new Date().toISOString().split('T')[0]}.xlsx`

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(buffer)
  } catch (err) {
    console.error('Export questions error:', err)
    res.status(500).json({ error: 'Erreur lors de l\'export' })
  }
})

// Export comparaison des tours
router.get('/comparison/rounds/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params
    const userId = req.user.id

    // Vérifier l'accès au projet
    const projectCheck = await query(
      `SELECT * FROM projects WHERE id = $1 AND (owner_id = $2 OR $3 = 'admin')`,
      [projectId, userId, req.user.role]
    )
    if (projectCheck.rowCount === 0) return res.status(403).json({ error: 'Accès refusé' })
    const project = projectCheck.rows[0]

    // Récupérer tous les tours du projet
    const roundsRes = await query(
      `SELECT * FROM rounds WHERE project_id = $1 ORDER BY round_number`,
      [projectId]
    )
    const rounds = roundsRes.rows

    // Récupérer tous les lots du projet
    const lotsRes = await query(
      `SELECT id, code, name FROM lots WHERE project_id = $1 ORDER BY id`,
      [projectId]
    )
    const lots = lotsRes.rows

    // Créer le workbook
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Comparaison Tours')

    // Titre
    worksheet.mergeCells('A1:E1')
    const titleCell = worksheet.getCell('A1')
    titleCell.value = `Comparaison des Tours - ${project.name}`
    titleCell.font = { size: 16, bold: true }
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
    worksheet.getRow(1).height = 30

    worksheet.addRow([])

    // En-têtes
    const headerRow = worksheet.addRow([
      'Lot',
      'MOE (€)',
      ...rounds.map(r => `Tour ${r.round_number}${r.name ? ` - ${r.name}` : ''} (€)`)
    ])

    headerRow.font = { bold: true }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } }

    // Données pour chaque lot
    for (const lot of lots) {
      const row = [lot.name || lot.code, '']

      // MOE pour ce lot
      const moeSql = `
        SELECT COALESCE(SUM(m.qty * m.unit_price), 0) as total
        FROM moe_items m
        JOIN items i ON m.item_id = i.id
        WHERE i.lot_id = $1
      `
      const moeRes = await query(moeSql, [lot.id])
      row[1] = moeRes.rows[0].total || 0

      // Pour chaque tour, montant total des offres
      for (const round of rounds) {
        const offerSql = `
          SELECT COALESCE(SUM(o.amount), 0) as total
          FROM offers o
          JOIN items i ON o.item_id = i.id
          WHERE i.lot_id = $1 AND o.round_id = $2
        `
        const offerRes = await query(offerSql, [lot.id, round.id])
        row.push(offerRes.rows[0].total || 0)
      }

      const rowNum = worksheet.addRow(row)
      rowNum.getCell(1).alignment = { horizontal: 'left' }
      for (let c = 2; c <= row.length; c++) {
        rowNum.getCell(c).numFmt = '#,##0.00'
        rowNum.getCell(c).alignment = { horizontal: 'right' }
      }
    }

    // Format cellules
    const headerCols = 2 + rounds.length
    for (let r = 3; r <= worksheet.rowCount; r++) {
      for (let c = 1; c <= headerCols; c++) {
        const cell = worksheet.getCell(r, c)
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer()
    const filename = `ComparaisonTours_${project.name.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(buffer)

  } catch (err) {
    console.error('Export rounds comparison error:', err)
    res.status(500).json({ error: 'Erreur lors de l\'export' })
  }
})

// Générer le RAO (Rapport d'Analyse d'Offre) complet pour un projet en Word
router.get('/rao/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params
    const userId = req.user.id

    // Récupérer le projet
    const projectRes = await query(
      `SELECT * FROM projects WHERE id = $1`,
      [projectId]
    )
    if (projectRes.rowCount === 0) return res.status(404).json({ error: 'Projet introuvable' })
    const project = projectRes.rows[0]

    // Vérifier l'accès
    const accessCheck = await query(
      `SELECT 1 FROM projects WHERE id = $1 AND (owner_id = $2 OR $3 = 'admin')`,
      [projectId, userId, req.user.role]
    )
    if (accessCheck.rowCount === 0) return res.status(403).json({ error: 'Accès refusé' })

    // Récupérer tous les lots du projet
    const lotsRes = await query(
      `SELECT * FROM lots WHERE project_id = $1 ORDER BY id`,
      [projectId]
    )
    const lots = lotsRes.rows

    if (lots.length === 0) {
      return res.status(400).json({ error: 'Aucun lot trouvé pour ce projet' })
    }

    // Construire le document Word
    const children = []

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
    )

    // Boucler sur chaque lot
    for (const lot of lots) {
      // Titre 1 pour le lot
      children.push(
        new Paragraph({
          text: `Lot: ${lot.name || lot.code}`,
          heading: HeadingLevel.HEADING_1,
          bold: true,
          spacing: { before: 400, after: 300 }
        })
      )

      // Récupérer les phases avec offres pour ce lot
      const roundsRes = await query(
        `SELECT DISTINCT r.* FROM rounds r
         JOIN offers o ON o.round_id = r.id
         JOIN items i ON o.item_id = i.id
         WHERE i.lot_id = $1 AND r.project_id = $2
         ORDER BY r.round_number ASC`,
        [lot.id, projectId]
      )
      
      const rounds = roundsRes.rows

      if (rounds.length === 0) {
        children.push(
          new Paragraph({
            text: '(Aucune offre enregistrée pour ce lot)',
            italics: true,
            spacing: { after: 300 }
          })
        )
        continue
      }

      // Récupérer les entreprises pour ce lot
      const companiesRes = await query(
        `SELECT DISTINCT c.id, c.name FROM companies c
         JOIN offers o ON c.id = o.company_id
         JOIN items i ON o.item_id = i.id
         WHERE i.lot_id = $1 ORDER BY c.name`,
        [lot.id]
      )
      const companies = companiesRes.rows

      // Récupérer les articles du lot
      const itemsRes = await query(
        `SELECT i.id, i.num, i.designation, i.unit, m.qty, m.unit_price as pu, (m.qty * m.unit_price) as mt
         FROM items i
         LEFT JOIN moe_items m ON i.id = m.item_id
         WHERE i.lot_id = $1
         ORDER BY i.num`,
        [lot.id]
      )
      const items = itemsRes.rows

      // Récupérer les questions et commentaires pour ce lot
      const questionsRes = await query(
        `SELECT gq.* FROM generated_questions gq
         WHERE gq.lot_id = $1
         ORDER BY gq.question_type, gq.company_id`,
        [lot.id]
      )
      const questions = questionsRes.rows

      // Récupérer les offres par phase
      const offersRes = await query(
        `SELECT o.*, r.round_number, c.name as company_name
         FROM offers o
         JOIN items i ON o.item_id = i.id
         JOIN rounds r ON o.round_id = r.id
         JOIN companies c ON o.company_id = c.id
         WHERE i.lot_id = $1
         ORDER BY r.round_number, c.name, o.item_id`,
        [lot.id]
      )
      const offersByRound = {}
      offersRes.rows.forEach(o => {
        const key = `${o.round_number}`
        if (!offersByRound[key]) offersByRound[key] = []
        offersByRound[key].push(o)
      })

      // Boucler sur les phases/tours du lot
      for (const round of rounds) {
        // Titre 2 pour la phase
        children.push(
          new Paragraph({
            text: `Phase ${round.round_number}: ${round.name}`,
            heading: HeadingLevel.HEADING_2,
            bold: true,
            spacing: { before: 300, after: 200 }
          })
        )

        // A. Tableau Comparatif (Titre 3)
        children.push(
          new Paragraph({
            text: `A. Tableau Comparatif des Offres`,
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 150, after: 150 }
          })
        )

        // Tableau comparatif des offres
        const tableRows = [
          new TableRow({
            cells: [
              new TableCell({ children: [new Paragraph({ text: 'Article', bold: true })] }),
              new TableCell({ children: [new Paragraph({ text: 'MOE Qté', bold: true })] }),
              new TableCell({ children: [new Paragraph({ text: 'MOE PU', bold: true })] }),
              ...companies.map(c => new TableCell({ children: [new Paragraph({ text: c.name, bold: true })] }))
            ]
          })
        ]

        // Ajouter les articles avec offres
        items.forEach(item => {
          const cells = [
            new TableCell({ children: [new Paragraph({ text: `${item.num} - ${item.designation}` })] }),
            new TableCell({ children: [new Paragraph({ text: item.qty ? item.qty.toString() : '-' })] }),
            new TableCell({ children: [new Paragraph({ text: item.pu ? item.pu.toString() : '-' })] })
          ]

          companies.forEach(company => {
            const offer = (offersByRound[round.round_number] || []).find(
              o => o.item_id === item.id && o.company_id === company.id
            )
            cells.push(
              new TableCell({ 
                children: [new Paragraph({ text: offer ? `${offer.qty} x ${offer.pu}€` : '-' })] 
              })
            )
          })

          tableRows.push(new TableRow({ cells }))
        })

        children.push(
          new Table({
            rows: tableRows,
            width: { size: 100, type: 'pct' }
          }),
          new Paragraph({ text: '' })
        )

        // B. Analyse par Entreprise (Titre 3)
        children.push(
          new Paragraph({
            text: `B. Analyse par Entreprise`,
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 150 }
          })
        )

        // Fiches questions et commentaires par entreprise
        companies.forEach(company => {
          const companyQuestions = questions.filter(q => q.company_id === company.id)
          
          // Titre 4 pour chaque entreprise
          children.push(
            new Paragraph({
              text: company.name,
              heading: HeadingLevel.HEADING_4,
              spacing: { before: 150, after: 100 }
            })
          )

          if (companyQuestions.length > 0) {
            companyQuestions.forEach((q, idx) => {
              children.push(
                new Paragraph({
                  children: [
                    new TextRun({ text: `${idx + 1}. `, bold: true }),
                    new TextRun({ text: q.question_text, italic: true })
                  ],
                  spacing: { after: 50 }
                }),
                new Paragraph({
                  children: [
                    new TextRun({ text: `Commentaire: `, bold: true }),
                    new TextRun(q.comment || '(À compléter)')
                  ],
                  spacing: { after: 100 }
                })
              )
            })
          } else {
            children.push(
              new Paragraph({
                text: '(Aucune question pour cette entreprise)',
                spacing: { after: 100 }
              })
            )
          }
        })

        // C. Analyse Technique (Titre 3)
        children.push(
          new Paragraph({
            text: `C. Analyse Technique`,
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 100 }
          }),
          new Paragraph({
            text: '(À compléter par les responsables)',
            italics: true,
            spacing: { after: 200 }
          }),
          new Paragraph({ text: '' }),
          new Paragraph({ text: '' }),
          new Paragraph({ text: '' })
        )
      }
    }

    // Créer le document
    const doc = new Document({ 
      sections: [{ 
        children: children
      }] 
    })
    const buffer = await Packer.toBuffer(doc)

    const filename = `RAO_${project.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.docx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(buffer)
  } catch (err) {
    console.error('Erreur génération RAO:', err)
    res.status(500).json({ error: 'Erreur lors de la génération du RAO: ' + err.message })
  }
})

export default router
