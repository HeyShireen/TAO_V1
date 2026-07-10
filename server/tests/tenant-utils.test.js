import test from 'node:test'
import assert from 'node:assert/strict'
import { cookieValue, configuredDemoHost, isDemoHost, publicUser } from '../src/app/utils/tenant.js'

test('le sous-domaine DEMO est compare sans le port', () => {
  const previous = process.env.DEMO_HOST
  process.env.DEMO_HOST = 'demo.ao-link.fr'
  assert.equal(configuredDemoHost(), 'demo.ao-link.fr')
  assert.equal(isDemoHost({ hostname: 'demo.ao-link.fr:443' }), true)
  assert.equal(isDemoHost({ hostname: 'ao-link.fr' }), false)
  if (previous === undefined) delete process.env.DEMO_HOST
  else process.env.DEMO_HOST = previous
})

test('les cookies sont lus sans middleware additionnel', () => {
  const req = { headers: { cookie: 'auth=abc; refreshToken=hello%20world' } }
  assert.equal(cookieValue(req, 'refreshToken'), 'hello world')
  assert.equal(cookieValue(req, 'missing'), null)
})

test('la reponse utilisateur expose les deux contextes tenant', () => {
  const result = publicUser({ id: 7, email: 'a@example.test', role: 'responsable', tenant_id: 2 }, {
    id: 3, slug: 'test', name: 'Test', type: 'customer', status: 'active',
  })
  assert.equal(result.tenant_id, 2)
  assert.equal(result.active_tenant_id, 3)
  assert.equal(result.tenant.slug, 'test')
})
