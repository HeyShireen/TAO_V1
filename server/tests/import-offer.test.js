/**
 * Tests du moteur d'import d'une offre entreprise
 * (`runImportWithRows` dans server/src/app/importers/smart-import.js).
 *
 * POURQUOI CES TESTS
 * L'import est la zone la plus souvent cassee par des modifications qui n'ont
 * rien a voir avec lui : le matching sequentiel, la resolution de l'entreprise
 * et le mode replace/update n'etaient couverts par AUCUN test. Les primitives
 * (parseNumber, scoreDesignationMatch...) sont testees dans
 * import-utils.test.js ; ici on verrouille leur ORCHESTRATION : quelle ligne du
 * fichier entreprise atterrit sur quel article de la DPGF, laquelle devient un
 * poste ajoute, laquelle est ignoree, et ce qui est ecrit en base.
 *
 * COMMENT, SANS BASE DE DONNEES
 * `runImportWithRows` accepte une connexion injectee (`client`). On lui passe un
 * double de test qui joue les quelques requetes SQL de l'import et enregistre
 * les ecritures. Le double REFUSE toute requete qu'il ne connait pas : si une
 * modification ajoute une requete a l'import, ces tests echouent explicitement
 * au lieu de valider un comportement non verifie. Dans ce cas, declarer la
 * nouvelle requete dans tests/helpers/faux-pg-import.js.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { runImportWithRows } from '../src/app/importers/smart-import.js'
import { creerDoubleConnexion, MAPPING, ligne } from './helpers/faux-pg-import.js'

const LOT_ID = 7
const ROUND_ID = 3

/** DPGF de reference : trois articles dans l'ordre des positions. */
function articlesDpgf() {
  return [
    { id: 11, num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', position: 1 },
    { id: 12, num: '1.2', designation: 'Beton de proprete', unit: 'm2', position: 2 },
    { id: 13, num: '1.3', designation: 'Ferraillage des semelles', unit: 'kg', position: 3 },
  ]
}

/** Lance un import d'offre sur le double de connexion. */
function importerOffre({ lignes, articles = articlesDpgf(), entreprises = [], companyId = null, companyName = null, importOperation = 'replace', modeleEcart = null, offresExistantes = 0, detectOptions = true }) {
  const { client, etat } = creerDoubleConnexion({ articles, entreprises, modeleEcart, offresExistantes })
  const resultat = runImportWithRows({
    mode: 'offer',
    lotId: LOT_ID,
    roundId: ROUND_ID,
    companyId,
    companyName,
    dataRows: lignes,
    mapping: MAPPING,
    importOperation,
    detectOptions,
    client,
  })
  return { resultat, etat }
}

/* =============== Resolution de l'entreprise =============== */

test("l'identifiant d'entreprise fourni est utilise sans toucher a la table companies", async () => {
  const { resultat, etat } = importerOffre({
    companyId: 42,
    lignes: [ligne({ num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 10, pu: 25, montant: 250 })],
  })
  const r = await resultat

  assert.equal(r.companyId, 42)
  assert.equal(r.companyCreated, false)
  const requetesEntreprise = etat.requetes.filter(
    (q) => q.startsWith('SELECT id FROM companies') || q.startsWith('INSERT INTO companies')
  )
  assert.deepEqual(requetesEntreprise, [], "la table companies ne doit pas etre consultee ni modifiee")
  assert.equal(etat.offres[0].companyId, 42)
})

test("un nom d'entreprise deja connu est retrouve quelles que soient la casse et les espaces", async () => {
  const { resultat, etat } = importerOffre({
    entreprises: [{ id: 77, name: 'BTP Durand' }],
    companyName: '  btp durand  ',
    lignes: [ligne({ num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 10, pu: 25, montant: 250 })],
  })
  const r = await resultat

  assert.equal(r.companyId, 77)
  assert.equal(r.companyCreated, false)
  assert.equal(etat.entreprises.length, 1, "aucune entreprise ne doit etre creee en doublon")
})

// Garde-fou de la correction V2.1.9 : la creation de l'entreprise etait
// conditionnee par le mode `replace`. Or le front envoie `update` par defaut
// pour une offre, donc tout premier import sous un nouveau nom repondait
// « Impossible de resoudre l'entreprise » (400).
test("un nom d'entreprise inconnu cree l'entreprise, meme en mode update", async () => {
  const { resultat, etat } = importerOffre({
    companyName: 'Nouvelle Entreprise',
    importOperation: 'update',
    lignes: [ligne({ num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 10, pu: 25, montant: 250 })],
  })
  const r = await resultat

  assert.equal(r.companyCreated, true)
  assert.equal(r.companyId, 501)
  assert.equal(etat.entreprises.at(-1).name, 'Nouvelle Entreprise')
  assert.equal(etat.offres[0].companyId, 501)
})

test("un import d'offre sans entreprise ni identifiant est refuse avant toute requete", () => {
  const { client, etat } = creerDoubleConnexion({ articles: articlesDpgf() })
  assert.throws(
    () => runImportWithRows({
      mode: 'offer',
      lotId: LOT_ID,
      roundId: ROUND_ID,
      dataRows: [ligne({ num: '1.1', designation: 'Terrassement en pleine masse', qty: 1, pu: 1, montant: 1 })],
      mapping: MAPPING,
      client,
    }),
    /Entreprise requise/
  )
  assert.equal(etat.requetes.length, 0)
})

test('la connexion injectee est laissee a son appelant', async () => {
  const { resultat, etat } = importerOffre({
    companyId: 42,
    lignes: [ligne({ num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 10, pu: 25, montant: 250 })],
  })
  await resultat
  assert.equal(etat.liberee, false)
})

/* =============== Matching sequentiel =============== */

test('trois lignes alignees sur la DPGF ecrivent trois offres sur les bons articles', async () => {
  const { resultat, etat } = importerOffre({
    companyId: 42,
    lignes: [
      ligne({ num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
      ligne({ num: '1.2', designation: 'Beton de proprete', unit: 'm2', qty: 40, pu: 12, montant: 480 }),
      ligne({ num: '1.3', designation: 'Ferraillage des semelles', unit: 'kg', qty: 300, pu: 2, montant: 600 }),
    ],
  })
  const r = await resultat

  assert.equal(r.matched, 3)
  assert.equal(r.addedPostsCount, 0)
  assert.equal(r.unmatchedDpgfCount, 0)
  assert.deepEqual(etat.offres.map((o) => o.itemId), [11, 12, 13])
  assert.deepEqual(etat.offres.map((o) => o.qty), [10, 40, 300])
  assert.deepEqual(etat.offres.map((o) => o.montant), [250, 480, 600])
  assert.equal(etat.articlesAjoutes.length, 0)
  assert.equal(etat.requetes.at(-1), 'COMMIT')
})

test("une ligne absente de la DPGF devient un poste ajoute sans decaler les articles suivants", async () => {
  const { resultat, etat } = importerOffre({
    companyId: 42,
    lignes: [
      ligne({ num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
      ligne({ num: '1.2', designation: 'Beton de proprete', unit: 'm2', qty: 40, pu: 12, montant: 480 }),
      // Poste propre a l'entreprise, intercale :
      ligne({ num: '1.2.1', designation: 'Rabattement de nappe phreatique', unit: 'fft', qty: 1, pu: 900, montant: 900 }),
      ligne({ num: '1.3', designation: 'Ferraillage des semelles', unit: 'kg', qty: 300, pu: 2, montant: 600 }),
    ],
  })
  const r = await resultat

  assert.equal(r.matched, 3, 'les trois articles DPGF restent servis')
  assert.equal(r.addedPostsCount, 1)
  assert.equal(r.addedPosts[0].designation, 'Rabattement de nappe phreatique')

  // Le poste ajoute est cree en fin de lot, rattache a l'entreprise.
  assert.equal(etat.articlesAjoutes.length, 1)
  assert.equal(etat.articlesAjoutes[0].sourceCompanyId, 42)
  assert.equal(etat.articlesAjoutes[0].position, 4)

  // L'article DPGF suivant a bien recu sa valeur, et non celle du poste ajoute.
  const offre13 = etat.offres.find((o) => o.itemId === 13)
  assert.equal(offre13.qty, 300)
  assert.equal(offre13.montant, 600)
})

// Garde-fou de la correction V2.1.10 : une ligne « TOTAL » chiffree finissait
// en poste ajoute et gonflait le montant du lot.
test("une ligne de total chiffree est ignoree et ne devient pas un poste ajoute", async () => {
  const { resultat, etat } = importerOffre({
    companyId: 42,
    lignes: [
      ligne({ num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
      ligne({ designation: 'TOTAL lot 1', montant: 250 }),
      ligne({ num: '1.2', designation: 'Beton de proprete', unit: 'm2', qty: 40, pu: 12, montant: 480 }),
    ],
  })
  const r = await resultat

  assert.equal(r.addedPostsCount, 0, 'une ligne de total ne doit jamais devenir un article')
  assert.equal(etat.articlesAjoutes.length, 0)
  assert.deepEqual(etat.offres.map((o) => o.itemId), [11, 12])
  assert.ok(
    r.warnings.some((w) => /total ou de titre de chapitre/i.test(w)),
    `un avertissement doit signaler la ligne ignoree : ${JSON.stringify(r.warnings)}`
  )
})

test("une ligne sans aucune valeur est sautee sans faire avancer le curseur DPGF", async () => {
  const { resultat, etat } = importerOffre({
    companyId: 42,
    lignes: [
      ligne({ num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
      ligne({ designation: 'Prix non remis a ce stade' }),
      ligne({ num: '1.2', designation: 'Beton de proprete', unit: 'm2', qty: 40, pu: 12, montant: 480 }),
    ],
  })
  const r = await resultat

  assert.equal(r.skipped, 1)
  assert.equal(r.matched, 2)
  assert.deepEqual(etat.offres.map((o) => o.itemId), [11, 12])
})

test("les articles DPGF non couverts par l'offre sont remontes", async () => {
  const { resultat } = importerOffre({
    companyId: 42,
    lignes: [ligne({ num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 10, pu: 25, montant: 250 })],
  })
  const r = await resultat

  assert.equal(r.unmatchedDpgfCount, 2)
  assert.deepEqual(r.unmatchedDpgf.map((i) => i.num), ['1.2', '1.3'])
  assert.ok(r.warnings.some((w) => /n'ont pas ete couverts|n'ont pas été couverts/.test(w)))
})

/* =============== replace vs update =============== */

test('le mode replace purge les offres et les postes ajoutes de cette entreprise', async () => {
  const { resultat, etat } = importerOffre({
    companyId: 42,
    importOperation: 'replace',
    offresExistantes: 2,
    lignes: [ligne({ num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 10, pu: 25, montant: 250 })],
  })
  const r = await resultat

  assert.equal(etat.suppressionsOffres, 1)
  assert.equal(etat.suppressionsArticles, 1)
  assert.equal(r.clearedExistingOffers, 2)
})

test("le mode update ne supprime rien et n'ajoute pas de poste entreprise", async () => {
  const { resultat, etat } = importerOffre({
    companyId: 42,
    importOperation: 'update',
    lignes: [
      ligne({ num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
      ligne({ num: '9.9', designation: 'Poste hors DPGF', unit: 'fft', qty: 1, pu: 500, montant: 500 }),
    ],
  })
  const r = await resultat

  assert.equal(etat.suppressionsOffres, 0, 'update ne doit jamais supprimer les offres existantes')
  assert.equal(etat.suppressionsArticles, 0)
  assert.equal(r.clearedExistingOffers, 0)
  assert.equal(r.addedPostsCount, 0, 'update ne cree pas de poste ajoute')
  assert.equal(etat.articlesAjoutes.length, 0)
  assert.deepEqual(etat.offres.map((o) => o.itemId), [11])
})

/* =============== Coherence des montants =============== */

test('un montant incoherent avec quantite x PU est conserve, commente et signale', async () => {
  const { resultat, etat } = importerOffre({
    companyId: 42,
    modeleEcart: 'Montant incoherent : {{montant_total}} au lieu de {{montant_calcule}}.',
    lignes: [ligne({ num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 2, pu: 100, montant: 250 })],
  })
  const r = await resultat

  assert.equal(r.amountMismatchCount, 1)
  assert.equal(etat.offres[0].montant, 250, 'le montant du fichier est conserve tel quel')
  assert.match(etat.offres[0].commentaire, /Montant incoherent/)
  assert.ok(r.warnings.some((w) => /incoherence montant|incohérence montant/i.test(w)))
})

// Contrat volontaire : une colonne Montant mappee mais vide n'est pas inventee a
// l'import. Les consommateurs (comparatif, exports) retombent sur quantite x PU
// — ne pas « corriger » l'un sans l'autre.
test('une colonne Montant mappee mais vide laisse le montant a NULL, sans ecart signale', async () => {
  const { resultat, etat } = importerOffre({
    companyId: 42,
    lignes: [ligne({ num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 3, pu: 50 })],
  })
  const r = await resultat

  assert.equal(r.amountMismatchCount, 0)
  assert.equal(etat.offres[0].qty, 3)
  assert.equal(etat.offres[0].pu, 50)
  assert.equal(etat.offres[0].montant, null)
  assert.equal(etat.offres[0].commentaire, null)
})

test("sans colonne Montant du tout, l'import calcule quantite x PU", async () => {
  const { client, etat } = creerDoubleConnexion({ articles: articlesDpgf() })
  await runImportWithRows({
    mode: 'offer',
    lotId: LOT_ID,
    roundId: ROUND_ID,
    companyId: 42,
    dataRows: [ligne({ num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 3, pu: 50 })],
    mapping: { num: 1, designation: 2, unit: 3, qty: 4, unit_price: 5 },
    client,
  })

  assert.equal(etat.offres[0].montant, 150)
})

// Garde-fou de la correction V2.1.10 : deux lignes de l'offre visant le meme
// article DPGF s'ecrasaient en silence (ON CONFLICT DO UPDATE).
test('deux lignes visant le meme article DPGF sont signalees', async () => {
  const { resultat, etat } = importerOffre({
    companyId: 42,
    lignes: [
      ligne({ num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 10, pu: 25, montant: 250 }),
      ligne({ num: '1.1', designation: 'Terrassement en pleine masse', unit: 'm3', qty: 11, pu: 25, montant: 275 }),
    ],
  })
  const r = await resultat

  const offres11 = etat.offres.filter((o) => o.itemId === 11)
  assert.equal(offres11.length, 1, 'une seule offre par article et par entreprise')
  assert.equal(offres11[0].qty, 11, 'la derniere valeur lue est conservee')
  assert.ok(
    r.warnings.some((w) => /deja renseigne|déjà renseigné/i.test(w)),
    `un avertissement doit signaler l'ecrasement : ${JSON.stringify(r.warnings)}`
  )
})

/* =============== Desinformation / erreurs =============== */

test("importer une offre sur un lot sans DPGF echoue et annule la transaction", async () => {
  const { client, etat } = creerDoubleConnexion({ articles: [] })
  await assert.rejects(
    runImportWithRows({
      mode: 'offer',
      lotId: LOT_ID,
      roundId: ROUND_ID,
      companyId: 42,
      dataRows: [ligne({ num: '1.1', designation: 'Terrassement en pleine masse', qty: 1, pu: 1, montant: 1 })],
      mapping: MAPPING,
      client,
    }),
    /ne contient aucun article/
  )
  assert.equal(etat.requetes.at(-1), 'ROLLBACK')
  assert.equal(etat.offres.length, 0)
})

test("un import d'offre sans tour est refuse", () => {
  assert.throws(
    () => runImportWithRows({
      mode: 'offer',
      lotId: LOT_ID,
      roundId: null,
      companyId: 42,
      dataRows: [ligne({ num: '1.1', designation: 'Terrassement', qty: 1, pu: 1, montant: 1 })],
      mapping: MAPPING,
    }),
    /Round ID requis/
  )
})

test('un fichier sans aucune ligne de donnees est refuse', () => {
  assert.throws(
    () => runImportWithRows({
      mode: 'offer',
      lotId: LOT_ID,
      roundId: ROUND_ID,
      companyId: 42,
      dataRows: [],
      mapping: MAPPING,
    }),
    /Aucune donnee a importer|Aucune donnée à importer/
  )
})
