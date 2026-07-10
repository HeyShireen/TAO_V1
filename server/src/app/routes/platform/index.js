import express from 'express'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { authQuery, platformQuery } from '../../db.js'
import { requireAuth } from '../../middleware/auth.js'
import { requireRole } from '../../middleware/roles.js'
import { sendTenantInvitationEmail } from '../../utils/email.js'
import { cookieValue } from '../../utils/tenant.js'

const router = express.Router()
router.use(requireAuth)
router.use(requireRole('platform_admin'))

function signForTenant(user, activeTenant) {
  return jwt.sign({
    id: user.id,
    email: user.email,
    role: user.role,
    company_id: user.company_id || null,
    tenant_id: user.tenant_id,
    active_tenant_id: Number(activeTenant.id),
    active_tenant_type: activeTenant.type,
  }, process.env.JWT_SECRET, { expiresIn: '15m' })
}

async function audit(req, tenantId, action, reason, metadata = {}) {
  await platformQuery(
    `INSERT INTO platform_audit_events
       (user_id, tenant_id, action, reason, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [req.user.id, tenantId, action, reason || null, req.ip, req.get('user-agent') || null, JSON.stringify(metadata)]
  )
}

router.get('/tenants', async (_req, res) => {
  try {
    const result = await platformQuery(
      `SELECT t.id, t.slug, t.name, t.type, t.status, t.created_at,
              COUNT(u.id)::int AS user_count
       FROM tenants t LEFT JOIN users u ON u.tenant_id = t.id
       GROUP BY t.id ORDER BY t.name`
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Liste tenants:', error)
    res.status(500).json({ error: 'Impossible de récupérer les organisations' })
  }
})

router.post('/tenants', async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const slug = String(req.body?.slug || '').trim().toLowerCase()
  const adminEmail = String(req.body?.admin_email || '').trim().toLowerCase()
  if (!name || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
    return res.status(400).json({ error: 'Nom ou slug invalide' })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    return res.status(400).json({ error: 'Email administrateur invalide' })
  }

  try {
    const existing = await authQuery('SELECT 1 FROM users WHERE lower(email) = lower($1)', [adminEmail])
    if (existing.rowCount) return res.status(409).json({ error: 'Cette adresse est déjà utilisée' })
    await authQuery(
      'DELETE FROM tenant_invitations WHERE lower(email) = lower($1) AND accepted_at IS NULL AND expires_at <= now()',
      [adminEmail]
    )
    const pending = await authQuery(
      'SELECT 1 FROM tenant_invitations WHERE lower(email) = lower($1) AND accepted_at IS NULL',
      [adminEmail]
    )
    if (pending.rowCount) return res.status(409).json({ error: 'Cette adresse possède déjà une invitation active' })
    const tenantResult = await platformQuery(
      `INSERT INTO tenants (slug, name, type, status)
       VALUES ($1, $2, 'customer', 'active') RETURNING *`,
      [slug, name]
    )
    const tenant = tenantResult.rows[0]
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    await authQuery(
      `INSERT INTO tenant_invitations
         (tenant_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, 'tenant_admin', $3, $4, now() + interval '48 hours')`,
      [tenant.id, adminEmail, tokenHash, req.user.id]
    )
    try {
      await sendTenantInvitationEmail(adminEmail, rawToken, tenant.name)
    } catch (error) {
      await platformQuery('DELETE FROM tenants WHERE id = $1', [tenant.id])
      throw error
    }
    await audit(req, tenant.id, 'tenant.created', 'Création de l\'organisation', { adminEmail })
    res.status(201).json(tenant)
  } catch (error) {
    console.error('Création tenant:', error)
    if (error.code === '23505') return res.status(409).json({ error: 'Ce slug existe déjà' })
    res.status(500).json({ error: 'Impossible de créer l\'organisation' })
  }
})

router.patch('/tenants/:id/status', async (req, res) => {
  const tenantId = Number(req.params.id)
  const status = String(req.body?.status || '')
  const reason = String(req.body?.reason || '').trim()
  if (!Number.isInteger(tenantId) || !['active', 'suspended'].includes(status) || reason.length < 3) {
    return res.status(400).json({ error: 'Tenant, statut ou motif invalide' })
  }
  try {
    const result = await platformQuery(
      `UPDATE tenants SET status = $2 WHERE id = $1 AND slug NOT IN ('dmx', 'demo') RETURNING *`,
      [tenantId, status]
    )
    if (!result.rowCount) return res.status(404).json({ error: 'Organisation introuvable ou non suspendable' })
    await authQuery(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE tenant_id = $1 AND revoked_at IS NULL`,
      [tenantId]
    )
    await audit(req, tenantId, `tenant.${status}`, reason)
    res.json(result.rows[0])
  } catch (error) {
    console.error('Statut tenant:', error)
    res.status(500).json({ error: 'Impossible de modifier le statut' })
  }
})

router.post('/active-tenant', async (req, res) => {
  const tenantId = Number(req.body?.tenantId)
  const reason = String(req.body?.reason || '').trim()
  if (!Number.isInteger(tenantId) || reason.length < 3) {
    return res.status(400).json({ error: 'Tenant et motif explicite requis' })
  }
  try {
    const tenantResult = await platformQuery(
      `SELECT id, slug, name, type, status FROM tenants WHERE id = $1 AND status = 'active'`,
      [tenantId]
    )
    if (!tenantResult.rowCount) return res.status(404).json({ error: 'Organisation active introuvable' })

    const refreshToken = cookieValue(req, 'refreshToken')
    if (refreshToken) {
      await authQuery(
        `UPDATE refresh_tokens SET active_tenant_id = $3
         WHERE token = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [refreshToken, req.user.id, tenantId]
      )
    }
    await audit(req, tenantId, 'tenant.context_switched', reason, { fromTenantId: req.user.active_tenant_id })
    const newToken = signForTenant(req.user, tenantResult.rows[0])
    const isProd = process.env.NODE_ENV === 'production' || !!process.env.RENDER
    res.cookie('auth', newToken, {
      httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge: 15 * 60 * 1000,
    })
    res.json({ token: newToken, activeTenant: tenantResult.rows[0] })
  } catch (error) {
    console.error('Bascule tenant:', error)
    res.status(500).json({ error: 'Impossible de changer d\'organisation' })
  }
})

router.get('/audit', async (_req, res) => {
  try {
    const result = await platformQuery(
      `SELECT a.*, u.email, t.name AS tenant_name
       FROM platform_audit_events a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN tenants t ON t.id = a.tenant_id
       ORDER BY a.created_at DESC LIMIT 200`
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Lecture audit plateforme:', error)
    res.status(500).json({ error: 'Impossible de récupérer le journal d\'audit' })
  }
})

export default router
