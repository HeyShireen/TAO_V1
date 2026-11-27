/**
 * Tests de la restriction « entreprise » (src/app/utils/company-scope.js).
 *
 * C'est la logique qui empeche une entreprise de voir les donnees d'une autre.
 * Un oubli ne produit aucune erreur visible, seulement une fuite : ces tests
 * valent donc plus que leur longueur ne le suggere.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { companyScope, normalizeCompanyId, assertSqlColumn } from '../src/app/utils/company-scope.js'

const reqEntreprise = (companyId) => ({ user: { role: 'entreprise', company_id: companyId } })
const reqResponsable = () => ({ user: { role: 'responsable', company_id: null } })

test('un role non-entreprise n est jamais restreint', () => {
  for (const role of ['platform_admin', 'tenant_admin', 'responsable', 'visionneur']) {
    const scope = companyScope({ user: { role, company_id: null } })
    assert.equal(scope.isEntreprise, false)
    assert.equal(scope.restricted, false)
    assert.equal(scope.orphan, false)
    assert.equal(scope.sqlAnd('o.company_id'), '', 'aucun filtre SQL ne doit etre ajoute')
    assert.equal(scope.allows(42), true, 'doit pouvoir voir toutes les entreprises')
  }
})

test('une entreprise rattachee est restreinte a sa societe', () => {
  const scope = companyScope(reqEntreprise(7))
  assert.equal(scope.isEntreprise, true)
  assert.equal(scope.companyId, 7)
  assert.equal(scope.restricted, true)
  assert.equal(scope.orphan, false)
  assert.equal(scope.allows(7), true)
  assert.equal(scope.allows('7'), true, 'un id transmis en chaine doit etre accepte')
  assert.equal(scope.allows(8), false, 'une autre entreprise doit etre refusee')
  assert.equal(scope.allows(null), false)
})

test('un compte entreprise sans societe est signale orphelin, jamais non filtre', () => {
  // Cas anormal : il doit mener a un refus explicite cote route. Le piege serait
  // de retomber sur « pas de filtre », donc un acces total.
  for (const valeur of [null, undefined, '', 0, -1, 'abc', 1.5]) {
    const scope = companyScope(reqEntreprise(valeur))
    assert.equal(scope.orphan, true, `company_id=${JSON.stringify(valeur)} doit etre orphelin`)
    assert.equal(scope.restricted, false)
    assert.equal(scope.sqlAnd('o.company_id'), '', 'pas de fragment SQL avec un id inexploitable')
    assert.equal(scope.allows(1), false, 'un orphelin ne doit rien voir')
  }
})

test('sqlAnd produit un fragment avec un entier valide', () => {
  const scope = companyScope(reqEntreprise(12))
  assert.equal(scope.sqlAnd('o.company_id'), ' AND o.company_id = 12')
  assert.equal(scope.sqlAnd('company_id'), ' AND company_id = 12')
})

test('sqlAndOwnOrShared laisse passer les lignes sans entreprise', () => {
  // items.source_company_id : NULL = article de la DPGF (visible par tous),
  // renseigne = poste ajoute par une entreprise.
  const scope = companyScope(reqEntreprise(3))
  assert.equal(
    scope.sqlAndOwnOrShared('i.source_company_id'),
    ' AND (i.source_company_id IS NULL OR i.source_company_id = 3)'
  )
  assert.equal(companyScope(reqResponsable()).sqlAndOwnOrShared('i.source_company_id'), '')
})

test('un nom de colonne non conforme est refuse bruyamment', () => {
  const scope = companyScope(reqEntreprise(5))
  for (const mauvais of ['o.company_id; DROP TABLE items', '1=1', '', null, 'a b', 'o..x']) {
    assert.throws(() => scope.sqlAnd(mauvais), /Nom de colonne SQL invalide/)
  }
  // Un scope non restreint sort avant la validation : pas de fragment, pas d erreur.
  assert.equal(companyScope(reqResponsable()).sqlAnd('n importe quoi'), '')
})

test('normalizeCompanyId n accepte que des entiers positifs', () => {
  assert.equal(normalizeCompanyId(5), 5)
  assert.equal(normalizeCompanyId('5'), 5)
  assert.equal(normalizeCompanyId(0), null)
  assert.equal(normalizeCompanyId(-3), null)
  assert.equal(normalizeCompanyId(2.5), null)
  assert.equal(normalizeCompanyId(''), null)
  assert.equal(normalizeCompanyId(null), null)
  assert.equal(normalizeCompanyId(undefined), null)
  assert.equal(normalizeCompanyId('abc'), null)
})

test('assertSqlColumn accepte les references simples et qualifiees', () => {
  assert.equal(assertSqlColumn('company_id'), 'company_id')
  assert.equal(assertSqlColumn('o.company_id'), 'o.company_id')
  assert.equal(assertSqlColumn('_x1.y_2'), '_x1.y_2')
  assert.throws(() => assertSqlColumn('o.company_id, 1'), /invalide/)
})

test('un utilisateur absent est traite comme non-entreprise', () => {
  for (const req of [{}, { user: null }, { user: {} }, undefined]) {
    const scope = companyScope(req)
    assert.equal(scope.isEntreprise, false)
    assert.equal(scope.restricted, false)
    assert.equal(scope.orphan, false)
  }
})
