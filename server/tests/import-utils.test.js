/**
 * Tests des helpers d'import (server/src/app/importers/import-utils.js).
 *
 * Ces fonctions sont le socle du matching offre <-> DPGF. Leurs seuils et leurs
 * replis etaient jusqu'ici sans aucun test : toute retouche se faisait a
 * l'aveugle. Les tests marques « PIEGE » documentent un comportement ACTUEL
 * juge dangereux, pour qu'un changement futur soit un choix explicite et non
 * une regression silencieuse.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseNumber,
  extractComment,
  isSubtotalOrTitleRow,
  buildDesignation,
  buildNum,
  splitMixedNumDesignationColumns,
  splitArticleNumAndDesignation,
  looksLikeArticleNum,
  normalizeArticleNum,
  normalizeDesignationForMatch,
  scoreDesignationMatch,
} from '../src/app/importers/import-utils.js'

/* =============== parseNumber =============== */

test('parseNumber lit les formats numeriques francais', () => {
  assert.equal(parseNumber('1 234,56'), 1234.56)   // espace comme separateur de milliers
  assert.equal(parseNumber('1.234,56'), 1234.56)   // point milliers + virgule decimale
  assert.equal(parseNumber('12,50'), 12.5)
  assert.equal(parseNumber('3.5'), 3.5)
  assert.equal(parseNumber('1 234'), 1234)
  assert.equal(parseNumber('1 234,56'), 1234.56) // espace insecable
})

test('parseNumber gere les signes, le zero et les valeurs absentes', () => {
  assert.equal(parseNumber('(123)'), -123)         // comptabilite : parentheses = negatif
  assert.equal(parseNumber('-5'), -5)
  assert.equal(parseNumber('0'), 0)                // 0 est une valeur, pas une absence
  assert.equal(parseNumber(0), 0)
  assert.equal(parseNumber(''), null)
  assert.equal(parseNumber(null), null)
  assert.equal(parseNumber(undefined), null)
  assert.equal(parseNumber('abc'), null)
  assert.equal(parseNumber('-'), null)
})

test('parseNumber retire les symboles monetaires et le pourcentage', () => {
  assert.equal(parseNumber('12,50 €'), 12.5)
  assert.equal(parseNumber('1 500 $'), 1500)
  assert.equal(parseNumber('15%'), 15)
})

test('PIEGE parseNumber : une reference textuelle devient un nombre', () => {
  // Le nettoyage retire les lettres AVANT de valider, puis un repli extrait le
  // premier nombre lisible. Une reference qui atterrit dans une colonne
  // numerique ressort donc en nombre, sans aucune alerte.
  assert.equal(parseNumber('REF-12'), -12)         // le tiret devient un signe !
  assert.equal(parseNumber('61.1.0'), 61.1)        // numero d'article tronque
  assert.equal(parseNumber('12,50 €/m2'), 12.502) // le « 2 » de m2 est absorbe
  // Consequence : un mauvais mapping de colonne ne produit pas d'erreur, il
  // produit des montants faux. A traiter avec un corpus de DPGF reelles.
})

test('extractComment ne retient que le texte non numerique', () => {
  assert.equal(extractComment('voir plan'), 'voir plan')
  assert.equal(extractComment('  '), null)
  assert.equal(extractComment(''), null)
  assert.equal(extractComment(null), null)
  assert.equal(extractComment('12,50'), null)      // un nombre n'est pas un commentaire
})

/* =============== Lignes titre / sous-total =============== */

test('isSubtotalOrTitleRow reconnait les lignes a ignorer', () => {
  assert.equal(isSubtotalOrTitleRow('Sous-total'), true)
  assert.equal(isSubtotalOrTitleRow('TOTAL'), true)
  assert.equal(isSubtotalOrTitleRow('Total lot 3'), true)
  assert.equal(isSubtotalOrTitleRow('Chapitre 2'), true)
  assert.equal(isSubtotalOrTitleRow('Lot 4 gros oeuvre'), true)
  assert.equal(isSubtotalOrTitleRow('S.T.'), true)
  assert.equal(isSubtotalOrTitleRow('Tranche conditionnelle'), true)
})

test('isSubtotalOrTitleRow laisse passer un article normal', () => {
  assert.equal(isSubtotalOrTitleRow('Cloison BA13'), false)
  assert.equal(isSubtotalOrTitleRow('Totalisateur de debit'), false) // « total » non suivi d'espace
  assert.equal(isSubtotalOrTitleRow(''), false)
  assert.equal(isSubtotalOrTitleRow(null), false)
})

/* =============== Num et designation =============== */

test('buildDesignation retient le niveau le plus profond et l indente', () => {
  // Trois colonnes de designation = trois niveaux de hierarchie DPGF.
  assert.equal(buildDesignation({ 2: 'Gros oeuvre', 3: '', 4: '' }, [2, 3, 4]), 'Gros oeuvre')
  assert.equal(buildDesignation({ 2: 'Gros oeuvre', 3: 'Cloisons', 4: '' }, [2, 3, 4]), ' Cloisons')
  assert.equal(buildDesignation({ 2: '', 3: '', 4: 'BA13' }, [2, 3, 4]), '  BA13')
  assert.equal(buildDesignation({ 2: 'Simple' }, 2), 'Simple')
  assert.equal(buildDesignation({}, [2, 3]), '')
  assert.equal(buildDesignation({ 2: 'x' }, null), '')
})

test('buildNum concatene les colonnes de numerotation', () => {
  assert.equal(buildNum({ 1: '1', 2: '2' }, [1, 2]), '12')
  assert.equal(buildNum({ 1: '1.1' }, 1), '1.1')
  assert.equal(buildNum({ 1: '', 2: '' }, [1, 2]), null)
  assert.equal(buildNum({ 1: 'x' }, null), null)
})

test('splitMixedNumDesignationColumns separe un libelle glisse dans les colonnes de numero', () => {
  // Cas courant : la colonne « N° » contient en realite le titre du chapitre.
  const res = splitMixedNumDesignationColumns({ 1: '1.1', 2: 'Cloison BA13' }, [1, 2])
  assert.equal(res.num, '1.1')
  assert.equal(res.designation, ' Cloison BA13')

  // Que des numeros : rien a separer.
  assert.equal(splitMixedNumDesignationColumns({ 1: '1', 2: '2' }, [1, 2]), null)
})

test('splitArticleNumAndDesignation isole le numero du libelle', () => {
  assert.deepEqual(splitArticleNumAndDesignation('1.2 Cloison'), { num: '1.2', designation: 'Cloison' })
  assert.deepEqual(splitArticleNumAndDesignation('12a Peinture'), { num: '12a', designation: 'Peinture' })
  assert.deepEqual(splitArticleNumAndDesignation('3'), { num: '3', designation: '' })
  assert.equal(splitArticleNumAndDesignation('Cloison seule'), null)
  assert.equal(splitArticleNumAndDesignation(''), null)

  assert.equal(looksLikeArticleNum('1.2.3'), true)
  assert.equal(looksLikeArticleNum('Cloison'), false)
})

/* =============== Normalisation pour le matching =============== */

test('normalizeArticleNum ignore separateurs, espaces et zeros de tete', () => {
  assert.equal(normalizeArticleNum('01.2'), '12')
  assert.equal(normalizeArticleNum('1.2'), '12')
  assert.equal(normalizeArticleNum('1-2'), '12')
  assert.equal(normalizeArticleNum('  1 . 2 '), '12')
  assert.equal(normalizeArticleNum(''), '')
  assert.equal(normalizeArticleNum(null), '')
})

test('PIEGE normalizeArticleNum : des articles distincts donnent la meme cle', () => {
  // Les separateurs sont supprimes sans etre remplaces : la hierarchie est
  // perdue et deux articles differents deviennent indiscernables au matching.
  assert.equal(normalizeArticleNum('1.20'), normalizeArticleNum('120'))
  assert.equal(normalizeArticleNum('10.0'), normalizeArticleNum('100'))
  assert.equal(normalizeArticleNum('1.2'), normalizeArticleNum('12'))
  // Un separateur conserve (ex. « 1-2 ») suffirait a lever l'ambiguite.
})

test('normalizeDesignationForMatch neutralise accents, apostrophes et espaces', () => {
  assert.equal(normalizeDesignationForMatch('  Béton   ARMÉ  '), 'beton arme')
  assert.equal(normalizeDesignationForMatch('L’enduit'), "l'enduit")
  assert.equal(normalizeDesignationForMatch('tirant–fil'), 'tirant-fil')
  assert.equal(normalizeDesignationForMatch(null), '')
})

test('scoreDesignationMatch note la similarite de 0 a 100', () => {
  assert.equal(scoreDesignationMatch('Cloison BA13', 'cloison ba13'), 100)      // identique apres normalisation
  assert.equal(scoreDesignationMatch('Béton armé', 'beton  arme'), 100)         // accents et espaces ignores
  assert.equal(scoreDesignationMatch('Cloison', 'Peinture'), 0)                 // rien en commun
  assert.equal(scoreDesignationMatch('', 'Cloison'), 0)
  assert.equal(scoreDesignationMatch(null, null), 0)
})

test('PIEGE scoreDesignationMatch : la regle de prefixe se declenche rarement', () => {
  // La regle « l'un est le prefixe de l'autre » exige que le plus court fasse
  // plus de 60 % du plus long. Un libelle enrichi par l'entreprise retombe donc
  // sur le score Jaccard par mots, bien plus bas que les 90 annonces.
  const score = scoreDesignationMatch('Cloison BA13', 'Cloison BA13 hydrofuge')
  assert.equal(score, 53)
  assert.ok(score < 80, 'le seuil de matching le plus permissif du code est 50')
  // A confronter aux seuils en dur du matching (50 / 80 / 90) dans smart-import.js.
})
