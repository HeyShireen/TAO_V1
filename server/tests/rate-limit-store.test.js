/**
 * Tests du store partage de rate limiting
 * (src/app/utils/rate-limit-store.js).
 *
 * Les tests tournent sans Redis : les primitives de utils/redis.js retombent
 * alors sur leur cache memoire, ce qui est exactement le chemin de repli a
 * verifier. Un store casse se traduirait soit par une absence de limitation,
 * soit par un blocage d'utilisateurs legitimes.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { SharedRateLimitStore, sharedRateLimitStore } from '../src/app/utils/rate-limit-store.js'

/** Prefixe unique par test : les compteurs vivent dans un cache partage. */
let seq = 0
const nouveauStore = (windowMs = 60_000) => {
  seq += 1
  const store = new SharedRateLimitStore({ prefix: `test:rl:${seq}:${Date.now()}:` })
  store.init({ windowMs })
  return store
}

test('increment compte les appels successifs pour une meme cle', async () => {
  const store = nouveauStore()

  const a = await store.increment('1.2.3.4')
  const b = await store.increment('1.2.3.4')
  const c = await store.increment('1.2.3.4')

  assert.equal(a.totalHits, 1)
  assert.equal(b.totalHits, 2)
  assert.equal(c.totalHits, 3)
})

test('les cles sont comptees independamment', async () => {
  const store = nouveauStore()

  await store.increment('ip-a')
  await store.increment('ip-a')
  const b = await store.increment('ip-b')

  assert.equal(b.totalHits, 1, 'une autre cle ne doit pas heriter du compteur')
})

test('deux limiteurs avec des prefixes differents ne se melangent pas', async () => {
  const global = nouveauStore()
  const auth = nouveauStore()

  await global.increment('meme-cle')
  await global.increment('meme-cle')
  const res = await auth.increment('meme-cle')

  assert.equal(res.totalHits, 1)
})

test('resetTime annonce la fin de fenetre et reste stable pendant celle-ci', async () => {
  const store = nouveauStore(60_000)

  const premier = await store.increment('ip')
  const second = await store.increment('ip')

  const attendu = Date.now() + 60_000
  assert.ok(premier.resetTime instanceof Date)
  // Tolerance large : seule la coherence compte, pas la milliseconde.
  assert.ok(Math.abs(premier.resetTime.getTime() - attendu) < 5_000)
  assert.equal(
    second.resetTime.getTime(),
    premier.resetTime.getTime(),
    'la fenetre ne doit pas etre repoussee a chaque requete'
  )
})

test('resetKey remet le compteur a zero', async () => {
  const store = nouveauStore()

  await store.increment('ip')
  await store.increment('ip')
  await store.resetKey('ip')
  const apres = await store.increment('ip')

  assert.equal(apres.totalHits, 1)
})

test('decrement annule une requete comptee a tort et ne descend pas sous zero', async () => {
  // express-rate-limit appelle decrement quand skipSuccessfulRequests est actif
  // et que la requete a reussi.
  const store = nouveauStore()

  await store.increment('ip')
  await store.increment('ip')
  await store.decrement('ip')
  const apres = await store.increment('ip')
  assert.equal(apres.totalHits, 2)

  const vierge = nouveauStore()
  await vierge.decrement('jamais-vue')
  const premier = await vierge.increment('jamais-vue')
  assert.equal(premier.totalHits, 1, 'un decrement sur une cle inconnue ne doit pas rendre le compteur negatif')
})

test('init applique la fenetre fournie par express-rate-limit', async () => {
  const store = sharedRateLimitStore(`test:rl:init:${Date.now()}:`)
  assert.equal(store.windowMs, 60_000, 'valeur par defaut avant init')
  store.init({ windowMs: 15 * 60 * 1000 })
  assert.equal(store.windowMs, 15 * 60 * 1000)

  const res = await store.increment('ip')
  const attendu = Date.now() + 15 * 60 * 1000
  assert.ok(Math.abs(res.resetTime.getTime() - attendu) < 5_000)
})

test('pruneWindowEnds ne purge pas tant que la table reste petite', async () => {
  const store = nouveauStore()
  await store.increment('ip')
  assert.equal(store.windowEnds.size, 1)
  store.pruneWindowEnds()
  assert.equal(store.windowEnds.size, 1, 'une purge prematuree ferait perdre les fins de fenetre')
})
