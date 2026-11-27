/**
 * Tests de la detection des options a l'import
 * (`splitOptionRows` dans server/src/app/importers/options-import.js).
 *
 * POURQUOI CES TESTS
 * `splitOptionRows` est execute AVANT le matching, aussi bien pour la DPGF que
 * pour une offre entreprise. Si une ligne d'option reste dans les lignes
 * principales, elle devient un « poste ajoute par l'entreprise » parasite et
 * gonfle le montant du lot ; a l'inverse, si une ligne normale part en option,
 * elle disparait du comparatif. Cette fonction est pure : elle se teste sans
 * base de donnees ni classeur Excel.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { splitOptionRows } from '../src/app/importers/options-import.js'

const MAPPING = { num: 1, designation: 2, unit: 3, qty: 4, unit_price: 5, amount: 6 }

/** Une ligne telle que l'etape apply la fabrique (clefs = index de colonne). */
function ligne({ num = null, designation = null, unit = null, qty = null, pu = null, montant = null, rowNum = null }) {
  const row = { 1: num, 2: designation, 3: unit, 4: qty, 5: pu, 6: montant }
  if (rowNum != null) row._rowNum = rowNum
  return row
}

/** Designations des lignes restees dans le flux principal. */
function designationsPrincipales(resultat) {
  return resultat.mainRows.map((row) => row[2])
}

test("un fichier sans option laisse toutes les lignes dans le flux principal", () => {
  const dataRows = [
    ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
    ligne({ num: '1.2', designation: 'Beton de proprete', unit: 'm2', qty: 40, pu: 12, montant: 480 }),
  ]
  const resultat = splitOptionRows({ dataRows, mapping: MAPPING })

  assert.equal(resultat.mainRows.length, 2)
  assert.deepEqual(resultat.sections, [])
  assert.deepEqual(resultat.optionRowNums, [])
})

test("un titre generique OPTIONS transforme chaque ligne suivante en option distincte", () => {
  const dataRows = [
    ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
    ligne({ designation: 'OPTIONS', rowNum: 10 }),
    ligne({ num: '2.1', designation: 'Eclairage LED', unit: 'u', qty: 4, pu: 150, montant: 600, rowNum: 11 }),
    ligne({ num: '2.2', designation: 'Portail motorise', unit: 'u', qty: 1, pu: 2400, montant: 2400, rowNum: 12 }),
  ]
  const resultat = splitOptionRows({ dataRows, mapping: MAPPING })

  assert.deepEqual(designationsPrincipales(resultat), ['Terrassement'])
  assert.equal(resultat.sections.length, 2, 'une option par ligne de la zone generique')
  assert.deepEqual(resultat.sections.map((s) => s.designation), ['Eclairage LED', 'Portail motorise'])
  assert.deepEqual(resultat.sections[0].rows.map((r) => r.mt), [600])
  // Les numeros de lignes servent aux pastilles « Option » de l'apercu.
  assert.deepEqual(resultat.optionRowNums, [10, 11, 12])
})

test("un titre d'option nomme regroupe les lignes suivantes dans la meme option", () => {
  const dataRows = [
    ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
    ligne({ designation: 'Option 1 - Amenagement paysager' }),
    ligne({ num: '2.1', designation: 'Plantation arbustes', unit: 'u', qty: 20, pu: 35, montant: 700 }),
    ligne({ num: '2.2', designation: 'Arrosage automatique', unit: 'ml', qty: 80, pu: 18, montant: 1440 }),
  ]
  const resultat = splitOptionRows({ dataRows, mapping: MAPPING })

  assert.deepEqual(designationsPrincipales(resultat), ['Terrassement'])
  assert.equal(resultat.sections.length, 1)
  assert.equal(resultat.sections[0].designation, 'Option 1 - Amenagement paysager')
  assert.deepEqual(resultat.sections[0].rows.map((r) => r.designation), ['Plantation arbustes', 'Arrosage automatique'])
})

test("une ligne TOTAL referme la zone options et rend la suite au flux principal", () => {
  const dataRows = [
    ligne({ designation: 'OPTIONS' }),
    ligne({ num: '2.1', designation: 'Eclairage LED', unit: 'u', qty: 4, pu: 150, montant: 600 }),
    ligne({ designation: 'TOTAL des options' }),
    ligne({ num: '3.1', designation: 'Peinture murs', unit: 'm2', qty: 120, pu: 9, montant: 1080 }),
  ]
  const resultat = splitOptionRows({ dataRows, mapping: MAPPING })

  assert.equal(resultat.sections.length, 1)
  assert.equal(resultat.sections[0].designation, 'Eclairage LED')
  assert.deepEqual(designationsPrincipales(resultat), ['TOTAL des options', 'Peinture murs'])
})

test("hors zone, un marqueur « en option » dans le libelle suffit", () => {
  const dataRows = [
    ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
    ligne({ num: '1.2', designation: 'Puits de lumiere (en option)', unit: 'u', qty: 2, pu: 800, montant: 1600 }),
    ligne({ num: '1.3', designation: 'Beton de proprete', unit: 'm2', qty: 40, pu: 12, montant: 480 }),
  ]
  const resultat = splitOptionRows({ dataRows, mapping: MAPPING })

  assert.deepEqual(designationsPrincipales(resultat), ['Terrassement', 'Beton de proprete'])
  assert.equal(resultat.sections.length, 1)
  assert.equal(resultat.sections[0].designation, 'Puits de lumiere (en option)')
})

test("hors zone, un numero d'article typé option est reconnu et son prefixe retire", () => {
  const dataRows = [
    ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
    ligne({ num: 'O2.1', designation: 'Local velos', unit: 'm2', qty: 15, pu: 320, montant: 4800 }),
  ]
  const resultat = splitOptionRows({ dataRows, mapping: MAPPING })

  assert.deepEqual(designationsPrincipales(resultat), ['Terrassement'])
  assert.equal(resultat.sections.length, 1)
  assert.equal(resultat.sections[0].rows[0].num, '2.1', 'le prefixe O/OPT/PSE est retire du numero')
})

test("une PSE numerotee est traitee comme une option", () => {
  const dataRows = [
    ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
    ligne({ designation: 'PSE 2 : mur vegetalise', unit: 'm2', qty: 30, pu: 210, montant: 6300 }),
  ]
  const resultat = splitOptionRows({ dataRows, mapping: MAPPING })

  assert.deepEqual(designationsPrincipales(resultat), ['Terrassement'])
  assert.equal(resultat.sections.length, 1)
  assert.equal(resultat.sections[0].designation, 'PSE 2 : mur vegetalise')
})

test("un titre d'option sans aucun article ne cree pas d'option vide", () => {
  const dataRows = [
    ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
    ligne({ designation: 'Option 1 - Non chiffree' }),
  ]
  const resultat = splitOptionRows({ dataRows, mapping: MAPPING })

  assert.deepEqual(designationsPrincipales(resultat), ['Terrassement'])
  assert.deepEqual(resultat.sections, [])
})

test("un sous-total interne cloture l'option courante sans quitter la zone", () => {
  const dataRows = [
    ligne({ designation: 'Option 1 - Chauffage' }),
    ligne({ num: '2.1', designation: 'Pompe a chaleur', unit: 'u', qty: 1, pu: 9000, montant: 9000 }),
    ligne({ designation: 'Sous-total option 1' }),
    ligne({ designation: 'Option 2 - Ventilation' }),
    ligne({ num: '3.1', designation: 'VMC double flux', unit: 'u', qty: 1, pu: 4200, montant: 4200 }),
  ]
  const resultat = splitOptionRows({ dataRows, mapping: MAPPING })

  assert.equal(resultat.mainRows.length, 0)
  assert.deepEqual(resultat.sections.map((s) => s.designation), ['Option 1 - Chauffage', 'Option 2 - Ventilation'])
  assert.deepEqual(resultat.sections.map((s) => s.rows.length), [1, 1])
})

test("les lignes d'options ne restent jamais dans le flux principal", () => {
  // Regression visee : ces lignes finissaient en « postes ajoutes par
  // l'entreprise » a l'import d'une offre.
  const dataRows = [
    ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
    ligne({ designation: 'VARIANTES' }),
    ligne({ num: '2.1', designation: 'Bardage bois', unit: 'm2', qty: 60, pu: 95, montant: 5700 }),
    ligne({ num: '2.2', designation: 'Bardage zinc', unit: 'm2', qty: 60, pu: 140, montant: 8400 }),
  ]
  const resultat = splitOptionRows({ dataRows, mapping: MAPPING })

  const libellesPrincipaux = designationsPrincipales(resultat)
  assert.deepEqual(libellesPrincipaux, ['Terrassement'])
  for (const libelle of ['VARIANTES', 'Bardage bois', 'Bardage zinc']) {
    assert.ok(!libellesPrincipaux.includes(libelle), `"${libelle}" ne doit pas rester dans le flux principal`)
  }
  assert.equal(resultat.sections.length, 2)
})
