/**
 * Tests de l'etape « preview » de l'import Excel
 * (server/src/app/importers/smart-import.js).
 *
 * previewExcel ne touche pas la base : il lit un classeur, devine la ligne
 * d'en-tete puis propose un mapping de colonnes. C'est donc testable en
 * construisant des classeurs en memoire avec exceljs.
 *
 * Ces tests verrouillent le durcissement de la detection d'en-tete : elle se
 * fait desormais sur le MEILLEUR mapping obtenu, et non sur la premiere ligne
 * comptant au moins 3 cellules remplies.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { previewExcel, loadWorkbook } from '../src/app/importers/smart-import.js'

/** Construit un .xlsx en memoire a partir d'un tableau de lignes. */
async function xlsxBuffer(rows, sheetName = 'DPGF') {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName)
  for (const row of rows) ws.addRow(row)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

const EN_TETE_COMPLET = ['N°', 'Désignation', 'Unité', 'Quantité', 'Prix unitaire', 'Montant']

/* =============== Detection de la ligne d'en-tete =============== */

test('previewExcel detecte l en-tete et mappe les six colonnes d une DPGF propre', async () => {
  const buffer = await xlsxBuffer([
    EN_TETE_COMPLET,
    ['1.1', 'Cloison BA13', 'm2', 120, 25.5, 3060],
    ['1.2', 'Peinture', 'm2', 80, 12, 960],
  ])

  const preview = await previewExcel({ buffer })

  assert.equal(preview.headerRow, 1)
  assert.equal(preview.totalRows, 2)
  assert.deepEqual(preview.suggestedMapping, {
    num: 1, designation: [2], unit: 3, qty: 4, unit_price: 5, amount: 6,
  })
})

test('previewExcel ignore un bloc de titre place au-dessus de l en-tete', async () => {
  // Regression : l'ancienne heuristique « premiere ligne avec >= 3 cellules »
  // retenait cette ligne de titre. Le mapping ressortait vide et la vraie ligne
  // d'en-tete etait importee comme un article.
  const buffer = await xlsxBuffer([
    ['Projet', 'Residence Les Tilleuls', 'Mars 2026'],
    [],
    EN_TETE_COMPLET,
    ['1.1', 'Cloison BA13', 'm2', 120, 25.5, 3060],
  ])

  const preview = await previewExcel({ buffer })

  assert.equal(preview.headerRow, 3, 'l en-tete doit etre la ligne 3, pas le bloc de titre')
  assert.equal(preview.headers[0].name, 'N°')
  assert.equal(Object.keys(preview.suggestedMapping).length, 6)
  assert.equal(preview.totalRows, 1, 'la ligne d en-tete ne doit pas compter comme une donnee')
})

test('previewExcel retient l en-tete le mieux reconnu meme precede de plusieurs lignes parasites', async () => {
  const buffer = await xlsxBuffer([
    ['Maitre d ouvrage', 'Ville de Test', '', ''],
    ['Affaire', 'A-2026-014', 'Phase', 'DCE'],
    ['Etabli le', '12/03/2026', '', ''],
    EN_TETE_COMPLET,
    ['1', 'Terrassement', 'm3', 10, 30, 300],
  ])

  const preview = await previewExcel({ buffer })

  assert.equal(preview.headerRow, 4)
  assert.equal(preview.suggestedMapping.qty, 4)
  assert.equal(preview.suggestedMapping.amount, 6)
})

test('previewExcel respecte la ligne d en-tete imposee par l utilisateur', async () => {
  const buffer = await xlsxBuffer([
    EN_TETE_COMPLET,
    ['1.1', 'Cloison', 'm2', 10, 5, 50],
    ['Autre', 'En-tete', 'bidon', 'x', 'y', 'z'],
  ])

  // L'utilisateur force la ligne 3 : son choix prime sur la detection.
  const preview = await previewExcel({ buffer, headerRow: 3 })

  assert.equal(preview.headerRow, 3)
  assert.equal(preview.headers[1].name, 'En-tete')
})

/* =============== Auto-detection du mapping =============== */

test('previewExcel reconnait les en-tetes abreges, dont l unite notee U', async () => {
  const buffer = await xlsxBuffer([
    ['No', 'Libelle', 'U', 'Qte', 'PU', 'Mt'],
    ['1', 'Cloison', 'm2', 10, 5, 50],
  ])

  const preview = await previewExcel({ buffer })

  assert.deepEqual(preview.suggestedMapping, {
    num: 1, designation: [2], unit: 3, qty: 4, unit_price: 5, amount: 6,
  })
})

test('previewExcel ne confond pas un en-tete long avec un pattern court', async () => {
  // Les patterns courts (pu, mt, q, u...) n'ont le droit de matcher qu'en mot
  // entier : « Cumul » ne doit pas devenir l'unite, ni « Recapitulatif » le PU.
  const buffer = await xlsxBuffer([
    ['N°', 'Désignation', 'Cumul', 'Recapitulatif', 'Quantité', 'Prix unitaire'],
    ['1', 'Cloison', 1, 2, 10, 5],
  ])

  const preview = await previewExcel({ buffer })

  assert.equal(preview.suggestedMapping.unit, undefined, '« Cumul » ne doit pas etre pris pour l unite')
  assert.equal(preview.suggestedMapping.qty, 5)
  assert.equal(preview.suggestedMapping.unit_price, 6)
})

test('previewExcel expose les colonnes sans en-tete pour un mapping manuel', async () => {
  // Fichier mal forme : les colonnes de prix n'ont pas d'en-tete. On ne peut pas
  // les deviner, mais elles doivent rester visibles dans l'ecran de mapping.
  const buffer = await xlsxBuffer([
    ['N°', 'Désignation', 'Unité'],
    ['1.1', 'Cloison', 'm2'],
    ['1.2', 'Peinture', 'm2', 80, 12, 960],
  ])

  const preview = await previewExcel({ buffer })

  assert.ok(preview.headers.length >= 6, 'les colonnes apparues plus bas doivent etre listees')
  assert.equal(preview.headers[3].name, 'Col 4 (vide)')
  assert.equal(preview.suggestedMapping.qty, undefined, 'aucun en-tete : pas de devinette')
})

/* =============== Format de fichier =============== */

test('loadWorkbook refuse un .xls OLE2 avec un message explicite', async () => {
  // Signature OLE2 d'un classeur Excel 97-2003, renomme en .xlsx par erreur.
  const ole2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00])
  await assert.rejects(() => loadWorkbook(ole2), /\.xls/)
})

test('loadWorkbook refuse un fichier qui n est pas un classeur', async () => {
  await assert.rejects(() => loadWorkbook(Buffer.from('ceci est un texte, pas un classeur')))
})
