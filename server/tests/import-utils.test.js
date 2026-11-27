/**
 * Tests des helpers d'import (server/src/app/importers/import-utils.js).
 *
 * Ces fonctions sont le socle du matching offre <-> DPGF. Leurs seuils et leurs
 * replis etaient jusqu'ici sans aucun test : toute retouche se faisait a
 * l'aveugle.
 *
 * Deux prefixes de convention :
 *  - « PIEGE » documente un comportement ACTUEL juge dangereux, pour qu'un
 *    changement futur soit un choix explicite et non une regression silencieuse ;
 *  - « PIEGE CORRIGE » documente un piege desormais ferme. Le commentaire garde
 *    la trace de l'ancien comportement et de ce qu'il cassait, pour qu'il ne soit
 *    pas reintroduit par commodite.
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
  hasConflictingSeriesMarker,
  isSameDesignationWithinTolerance,
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

test('PIEGE CORRIGE parseNumber : une reference textuelle ne devient plus un nombre', () => {
  // AVANT : le nettoyage retirait les lettres puis un repli extrayait le premier
  // nombre lisible. « REF-12 » ressortait a -12 et « 61.1.0 » a 61.1, sans la
  // moindre alerte : un mauvais mapping de colonne ne produisait pas une erreur,
  // il produisait des montants faux.
  // MAINTENANT : on ne devine plus. Ce qui n'est pas un nombre complet vaut null,
  // donc se voit comme une valeur manquante dans le constat d'import.
  assert.equal(parseNumber('REF-12'), null)
  assert.equal(parseNumber('61.1.0'), null)
  assert.equal(parseNumber('12-14'), null)       // une plage n'est pas un nombre
})

test('parseNumber accepte une unite accolee apres la valeur', () => {
  // Seule decoration toleree, parce qu'elle SUIT un nombre complet.
  assert.equal(parseNumber('12,50 €/m2'), 12.5) // le « 2 » de m2 etait absorbe : 12.502
  assert.equal(parseNumber('1500 HT'), 1500)
  assert.equal(parseNumber('3 m³'), 3)
  // Milliers separes par des points : non ambigu a partir de deux groupes.
  assert.equal(parseNumber('1.234.567'), 1234567)
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

test('buildNum fusionne les colonnes de numerotation avec un separateur', () => {
  // Deux colonnes « 1 » et « 2 » decrivent l'article 1.2, pas l'article 12 :
  // concatener sans separateur fabriquait une collision avec un vrai « 12 ».
  assert.equal(buildNum({ 1: '1', 2: '2' }, [1, 2]), '1.2')
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

test('normalizeArticleNum canonicalise separateurs, espaces et zeros de tete', () => {
  assert.equal(normalizeArticleNum('01.2'), '1.2')
  assert.equal(normalizeArticleNum('1.2'), '1.2')
  assert.equal(normalizeArticleNum('1-2'), '1.2')
  assert.equal(normalizeArticleNum('  1 . 2 '), '1.2')
  assert.equal(normalizeArticleNum(''), '')
  assert.equal(normalizeArticleNum(null), '')
})

test('PIEGE CORRIGE normalizeArticleNum : des articles distincts restent distincts', () => {
  // AVANT : les separateurs etaient supprimes sans etre remplaces, donc « 1.20 »
  // et « 120 » donnaient la meme cle. Comme le numero d'article est le critere
  // de rapprochement PRIORITAIRE (score 100), cela produisait un faux positif
  // silencieux : l'offre d'un article atterrissait sur un autre.
  assert.notEqual(normalizeArticleNum('1.20'), normalizeArticleNum('120'))
  assert.notEqual(normalizeArticleNum('10.0'), normalizeArticleNum('100'))
  assert.notEqual(normalizeArticleNum('1.2'), normalizeArticleNum('12'))
})

test('normalizeArticleNum garde equivalents les memes articles ecrits autrement', () => {
  // Le separateur est canonicalise, pas supprime : la hierarchie survit, mais la
  // forme d'ecriture du fichier source n'a plus d'importance.
  assert.equal(normalizeArticleNum('1-2'), normalizeArticleNum('1.2'))
  assert.equal(normalizeArticleNum('1 / 2'), normalizeArticleNum('1.2'))
  assert.equal(normalizeArticleNum('01.02'), normalizeArticleNum('1.2'))
  // « 1.0 » est la coercition Excel d'un « 1 », pas un sous-article.
  assert.equal(normalizeArticleNum('1.0'), '1')
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

test('PIEGE CORRIGE scoreDesignationMatch : un libelle enrichi est reconnu', () => {
  // AVANT : la regle « l'un est le prefixe de l'autre » exigeait que le plus
  // court fasse plus de 60 % du plus long, et ce cas retombait a 53 — sous le
  // seuil de lookahead le plus permissif (80). Une entreprise qui precisait un
  // libelle cassait donc l'appariement.
  // Le scoreur local de smart-import.js, lui, rendait deja 90 : c'est cette
  // version qui a ete retenue en unifiant les deux implementations.
  assert.equal(scoreDesignationMatch('Cloison BA13', 'Cloison BA13 hydrofuge'), 90)
  // Le scoreur est ASYMETRIQUE, et c'est voulu : le premier argument est la
  // reference (DPGF), le second la valeur comparee (offre) — ordre respecte par
  // tous les appelants. Dans l'autre sens, la regle « la reference commence par
  // la valeur comparee » garde sa condition de longueur (> 60 %), parce qu'un
  // libelle fortement tronque est ambigu, la ou un libelle enrichi ne l'est pas.
  assert.equal(scoreDesignationMatch('Cloison BA13 hydrofuge', 'Cloison BA13'), 53)
  // Troncature legere : la condition de longueur est satisfaite.
  assert.equal(scoreDesignationMatch('Cloison BA13 hydro', 'Cloison BA13'), 85)
})

test('scoreDesignationMatch refuse d apparier deux elements d une meme serie', () => {
  // Garde-fou anti-permutation : « Diffuseur type 1 » ne doit jamais recevoir le
  // prix de « Diffuseur type 2 ». Ce veto n'existait que dans le scoreur local de
  // smart-import.js ; il couvre desormais aussi options-import.js et la
  // reconciliation des postes ajoutes.
  assert.equal(scoreDesignationMatch('Diffuseur type 1', 'Diffuseur type 2'), 0)
  assert.equal(scoreDesignationMatch('Porte A', 'Porte B'), 0)
  assert.equal(hasConflictingSeriesMarker('Porte A', 'Porte B'), true)
  assert.equal(hasConflictingSeriesMarker('Porte A', 'Porte A'), false)
  // Un marqueur d'un autre type (chiffre vs lettre) ne declenche pas le veto.
  assert.equal(hasConflictingSeriesMarker('Porte A', 'Porte 2'), false)
})

test('isSameDesignationWithinTolerance absorbe une faute de frappe', () => {
  assert.equal(isSameDesignationWithinTolerance('Cloison BA13', 'cloison ba13'), true)
  assert.equal(isSameDesignationWithinTolerance('Beton arme', 'Beton arme '), true)
  assert.equal(isSameDesignationWithinTolerance('Cloison', 'Peinture'), false)
})
