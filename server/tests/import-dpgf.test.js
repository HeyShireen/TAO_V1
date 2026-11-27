/**
 * Tests du moteur d'import de la DPGF (MOE)
 * (`runImportWithRows` en mode `dpgf`, server/src/app/importers/smart-import.js).
 *
 * L'import DPGF cree la trame du lot : c'est lui qui decide quels articles
 * existent, dans quel ordre, et avec quelles valeurs MOE. Une regression ici se
 * propage a tout le reste (comparatif, fiches questions, exports) sans erreur
 * visible. Il n'etait couvert par aucun test.
 *
 * Les requetes SQL sont jouees par le double de tests/helpers/faux-pg-import.js :
 * pas de base de donnees, pas de classeur Excel.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { runImportWithRows } from '../src/app/importers/smart-import.js'
import { creerDoubleConnexion, MAPPING, ligne } from './helpers/faux-pg-import.js'

const LOT_ID = 7

/** Lance un import DPGF sur le double de connexion. */
function importerDpgf({ lignes, articles = [], importOperation = 'replace', detectOptions = true, roundId = null, tourExistant = null }) {
  const { client, etat } = creerDoubleConnexion({ articles, tourExistant })
  const resultat = runImportWithRows({
    mode: 'dpgf',
    lotId: LOT_ID,
    roundId,
    dataRows: lignes,
    mapping: MAPPING,
    importOperation,
    detectOptions,
    client,
  })
  return { resultat, etat }
}

/* =============== Lot vide : creation de la trame =============== */

test('sur un lot vide, chaque ligne devient un article avec ses valeurs MOE', async () => {
  const { resultat, etat } = importerDpgf({
    lignes: [
      ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
      ligne({ num: '1.2', designation: 'Beton de proprete', unit: 'm2', qty: 40, pu: 12, montant: 480 }),
    ],
  })
  const r = await resultat

  assert.equal(r.itemsImported, 2)
  assert.equal(r.itemsUpdated, 0)
  assert.deepEqual(etat.articlesCrees.map((a) => a.num), ['1.1', '1.2'])
  assert.deepEqual(etat.articlesCrees.map((a) => a.position), [1, 2])
  assert.deepEqual(etat.articlesCrees.map((a) => a.unit), ['m3', 'm2'])
  assert.deepEqual(etat.moe.map((m) => [m.qty, m.pu, m.montant]), [[10, 25, 250], [40, 12, 480]])
  assert.equal(etat.requetes.at(-1), 'COMMIT')
})

test("les lignes de sous-total et de titre de chapitre ne deviennent pas des articles", async () => {
  const { resultat, etat } = importerDpgf({
    lignes: [
      ligne({ designation: 'Chapitre 1 - Gros oeuvre' }),
      ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
      ligne({ designation: 'Sous-total gros oeuvre', montant: 250 }),
      ligne({ designation: 'TOTAL lot 1', montant: 250 }),
    ],
  })
  const r = await resultat

  assert.equal(r.itemsImported, 1)
  assert.deepEqual(etat.articlesCrees.map((a) => a.designation), ['Terrassement'])
})

test('une ligne sans numero ni designation est ignoree', async () => {
  const { resultat, etat } = importerDpgf({
    lignes: [
      ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
      ligne({ unit: 'm3' }),
      ligne({ num: '1.2', designation: 'Beton de proprete', unit: 'm2', qty: 40, pu: 12, montant: 480 }),
    ],
  })
  const r = await resultat

  assert.equal(r.itemsImported, 2)
  assert.deepEqual(etat.articlesCrees.map((a) => a.designation), ['Terrassement', 'Beton de proprete'])
})

test("la position d'un article suit la ligne du fichier, pas le compteur d'articles crees", async () => {
  // Ligne 1 ignoree (titre) : « Terrassement » est la 2e ligne, donc position 2.
  const { resultat, etat } = importerDpgf({
    lignes: [
      ligne({ designation: 'Chapitre 1 - Gros oeuvre' }),
      ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
    ],
  })
  await resultat

  assert.deepEqual(etat.articlesCrees.map((a) => a.position), [2])
})

test('un texte saisi dans une cellule de valeur devient un commentaire MOE', async () => {
  const { resultat, etat } = importerDpgf({
    lignes: [
      ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 'a chiffrer', montant: 250 }),
    ],
  })
  await resultat

  assert.equal(etat.moe[0].qty, 10)
  assert.match(String(etat.moe[0].commentaire), /chiffrer/i)
})

/* =============== Lot deja peuple : rafraichissement de la trame =============== */

test("sur un lot deja peuple, un article de meme numero est mis a jour, pas duplique", async () => {
  const { resultat, etat } = importerDpgf({
    articles: [
      { id: 11, num: '1.1', designation: 'Terrassement', unit: 'm3', position: 1 },
      { id: 12, num: '1.2', designation: 'Beton de proprete', unit: 'm2', position: 2 },
    ],
    lignes: [
      ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 12, pu: 26, montant: 312 }),
      ligne({ num: '1.2', designation: 'Beton de proprete', unit: 'm2', qty: 40, pu: 12, montant: 480 }),
    ],
  })
  const r = await resultat

  assert.equal(r.itemsUpdated, 2)
  assert.equal(r.itemsImported, 0)
  assert.deepEqual(etat.articlesCrees, [])
  assert.deepEqual(etat.articlesMisAJour.map((a) => a.id), [11, 12])
  assert.deepEqual(etat.moe.map((m) => [m.itemId, m.qty]), [[11, 12], [12, 40]])
})

test("un article nouveau dans le fichier est ajoute a la trame existante", async () => {
  const { resultat, etat } = importerDpgf({
    articles: [{ id: 11, num: '1.1', designation: 'Terrassement', unit: 'm3', position: 1 }],
    lignes: [
      ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
      ligne({ num: '1.2', designation: 'Beton de proprete', unit: 'm2', qty: 40, pu: 12, montant: 480 }),
    ],
  })
  const r = await resultat

  assert.equal(r.itemsUpdated, 1)
  assert.equal(r.itemsImported, 1)
  assert.deepEqual(etat.articlesCrees.map((a) => a.num), ['1.2'])
})

test("un article renumerote mais au libelle identique est reconnu, pas recree", async () => {
  const { resultat, etat } = importerDpgf({
    articles: [{ id: 11, num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', position: 1 }],
    lignes: [
      ligne({ num: '2.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
    ],
  })
  const r = await resultat

  assert.equal(r.itemsUpdated, 1)
  assert.deepEqual(etat.articlesCrees, [])
  assert.equal(etat.articlesMisAJour[0].num, '2.1', 'le nouveau numero est enregistre')
})

test("le mode replace supprime les articles absents du fichier", async () => {
  const { resultat, etat } = importerDpgf({
    importOperation: 'replace',
    articles: [
      { id: 11, num: '1.1', designation: 'Terrassement', unit: 'm3', position: 1 },
      { id: 12, num: '1.2', designation: 'Article disparu', unit: 'm2', position: 2 },
    ],
    lignes: [ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 })],
  })
  await resultat

  const suppressions = etat.requetes.filter((q) => q.startsWith('DELETE FROM items'))
  assert.equal(suppressions.length, 2, 'postes ajoutes orphelins puis articles DPGF non touches')
  assert.ok(suppressions.some((q) => q.includes('source_company_id IS NULL')))
})

// Contrat volontaire, a ne pas confondre avec l'import d'offre : pour la DPGF,
// `importOperation` est IGNORE et la trame est toujours rafraichie (le front
// envoie d'ailleurs toujours `replace` en mode DPGF). Si ce test echoue, c'est
// qu'un mode « update » a ete introduit cote DPGF : il faut alors verifier que
// l'interface le propose explicitement, car la suppression d'articles entraine
// en cascade les offres et les fiches questions.
test("le mode update ne protege pas la DPGF : la trame est toujours rafraichie", async () => {
  const { resultat, etat } = importerDpgf({
    importOperation: 'update',
    articles: [
      { id: 11, num: '1.1', designation: 'Terrassement', unit: 'm3', position: 1 },
      { id: 12, num: '1.2', designation: 'Article absent du fichier', unit: 'm2', position: 2 },
    ],
    lignes: [ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 })],
  })
  const r = await resultat

  assert.equal(r.itemsUpdated, 1)
  assert.equal(
    etat.requetes.filter((q) => q.startsWith('DELETE FROM items')).length,
    2,
    'la DPGF supprime les articles non touches, quel que soit importOperation'
  )
})

/* =============== Options =============== */

test("un fichier ne contenant que des options ne touche pas aux articles existants", async () => {
  const { resultat, etat } = importerDpgf({
    articles: [{ id: 11, num: '1.1', designation: 'Terrassement', unit: 'm3', position: 1 }],
    lignes: [
      ligne({ designation: 'OPTIONS' }),
      ligne({ num: '2.1', designation: 'Eclairage LED', unit: 'u', qty: 4, pu: 150, montant: 600 }),
    ],
  })
  const r = await resultat

  assert.equal(r.itemsImported, 0)
  assert.equal(r.itemsUpdated, 0)
  assert.deepEqual(etat.articlesCrees, [])
  assert.deepEqual(etat.requetes.filter((q) => q.startsWith('DELETE FROM items')), [])
  assert.equal(r.optionsDetected, 1)
})

test("des options detectees sans aucun tour sont signalees et non importees", async () => {
  const { resultat, etat } = importerDpgf({
    roundId: null,
    tourExistant: null,
    lignes: [
      ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
      ligne({ designation: 'OPTIONS' }),
      ligne({ num: '2.1', designation: 'Eclairage LED', unit: 'u', qty: 4, pu: 150, montant: 600 }),
    ],
  })
  const r = await resultat

  assert.equal(r.optionsDetected, 1)
  assert.equal(r.optionsCreated, 0)
  assert.ok(
    r.warnings.some((w) => /aucun tour/i.test(w)),
    `un avertissement doit signaler les options ignorees : ${JSON.stringify(r.warnings)}`
  )
  // La ligne d'option ne doit pas avoir ete creee comme article de la DPGF.
  assert.deepEqual(etat.articlesCrees.map((a) => a.designation), ['Terrassement'])
})

// Avec la detection desactivee, plus rien ne distingue une zone d'options : le
// titre « OPTIONS » lui-meme devient un article sans valeurs. C'est le prix
// assume de la case decochee, pas un oubli.
test("detection desactivee : les lignes d'options redeviennent des articles ordinaires", async () => {
  const { resultat, etat } = importerDpgf({
    detectOptions: false,
    lignes: [
      ligne({ num: '1.1', designation: 'Terrassement', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
      ligne({ designation: 'OPTIONS' }),
      ligne({ num: '2.1', designation: 'Eclairage LED', unit: 'u', qty: 4, pu: 150, montant: 600 }),
    ],
  })
  const r = await resultat

  assert.equal(r.optionsDetected, 0)
  assert.deepEqual(etat.articlesCrees.map((a) => a.designation), ['Terrassement', 'OPTIONS', 'Eclairage LED'])
})
