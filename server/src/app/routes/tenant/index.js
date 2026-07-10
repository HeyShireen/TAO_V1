import express from 'express'
import crypto from 'node:crypto'
import { authQuery, query } from '../../db.js'
import { requireAuth } from '../../middleware/auth.js'
import { requireRole } from '../../middleware/roles.js'
import { sendTenantInvitationEmail } from '../../utils/email.js'

const router = express.Router()
const ALLOWED_ROLES = new Set(['tenant_admin', 'responsable', 'visionneur', 'entreprise'])

router.use(requireAuth)
router.use(requireRole(['platform_admin', 'tenant_admin']))

router.get('/invitations', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, email, role, company_id, expires_at, accepted_at, created_at
       FROM tenant_invitations
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [req.user.active_tenant_id]
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Liste invitations:', error)
    res.status(500).json({ error: 'Impossible de récupérer les invitations' })
  }
})

router.post('/invitations', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const role = String(req.body?.role || 'visionneur')
  const companyId = req.body?.company_id ? Number(req.body.company_id) : null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email invalide' })
  if (!ALLOWED_ROLES.has(role)) return res.status(400).json({ error: 'Rôle invalide' })
  if (role === 'entreprise' && !Number.isInteger(companyId)) {
    return res.status(400).json({ error: 'Une entreprise est requise pour ce rôle' })
  }

  try {
    const existing = await authQuery('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email])
    if (existing.rowCount > 0) return res.status(409).json({ error: 'Cette adresse ne peut pas être invitée' })
    await authQuery(
      'DELETE FROM tenant_invitations WHERE lower(email) = lower($1) AND accepted_at IS NULL AND expires_at <= now()',
      [email]
    )
    const pending = await authQuery(
      'SELECT id, tenant_id FROM tenant_invitations WHERE lower(email) = lower($1) AND accepted_at IS NULL',
      [email]
    )
    if (pending.rowCount && Number(pending.rows[0].tenant_id) !== Number(req.user.active_tenant_id)) {
      return res.status(409).json({ error: 'Cette adresse possède déjà une invitation active' })
    }

    if (companyId) {
      const company = await query('SELECT 1 FROM companies WHERE id = $1', [companyId])
      if (company.rowCount === 0) return res.status(404).json({ error: 'Entreprise introuvable' })
    }

    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    const invitation = pending.rowCount
      ? await query(
          `UPDATE tenant_invitations
           SET role = $2, company_id = $3, token_hash = $4, invited_by = $5,
               expires_at = now() + interval '48 hours'
           WHERE id = $1 RETURNING id, email, role, company_id, expires_at`,
          [pending.rows[0].id, role, companyId, tokenHash, req.user.id]
        )
      : await query(
          `INSERT INTO tenant_invitations
             (tenant_id, email, role, company_id, token_hash, invited_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, now() + interval '48 hours')
           RETURNING id, email, role, company_id, expires_at`,
          [req.user.active_tenant_id, email, role, companyId, tokenHash, req.user.id]
        )

    try {
      await sendTenantInvitationEmail(email, rawToken, req.user.active_tenant_name)
    } catch (error) {
      await query('DELETE FROM tenant_invitations WHERE id = $1', [invitation.rows[0].id])
      throw error
    }
    res.status(201).json(invitation.rows[0])
  } catch (error) {
    console.error('Création invitation:', error)
    res.status(500).json({ error: 'Impossible de créer ou envoyer l\'invitation' })
  }
})

export default router
