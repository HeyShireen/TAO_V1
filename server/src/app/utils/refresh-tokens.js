// server/src/utils.refresh-tokens.js
// Gestion des refresh tokens avec rotation et détection d'abus

import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { query } from '../db.js'

/**
 * Génère un refresh token unique et le stocke en DB
 * @param {number} userId - ID utilisateur
 * @param {string} family - Groupe de tokens (détecte réutilisations)
 * @returns {object} { refreshToken, family, expiresIn }
 */
export async function generateRefreshToken(userId, family = null) {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresIn = 30 * 24 * 60 * 60 * 1000 // 30 jours
  const expiresAt = new Date(Date.now() + expiresIn)
  
  // Si pas de family fournie, en créer une nouvelle (premier login)
  const tokenFamily = family || crypto.randomUUID()
  
  const result = await query(
    `INSERT INTO refresh_tokens (user_id, token, family, expires_at, rotation_count)
     VALUES ($1, $2, $3, $4, 0)
     RETURNING token, family, expires_at`,
    [userId, token, tokenFamily, expiresAt]
  )
  
  return {
    refreshToken: result.rows[0].token,
    family: result.rows[0].family,
    expiresIn: expiresIn / 1000 // En secondes
  }
}

/**
 * Valide et utilise un refresh token (rotation)
 * Détecte les tentatives de réutilisation suspectes
 * @param {string} token - Refresh token
 * @param {string} ipAddress - IP client (pour audit)
 * @param {string} userAgent - User agent (pour audit)
 * @returns {object} { user, newRefreshToken, family } ou error
 */
export async function rotateRefreshToken(token, ipAddress, userAgent) {
  // 1. Récupérer le token en DB
  const tokenRes = await query(
    `SELECT id, user_id, family, expires_at, revoked_at, rotation_count
     FROM refresh_tokens
     WHERE token = $1`,
    [token]
  )
  
  if (tokenRes.rowCount === 0) {
    throw new Error('Refresh token invalide ou expiré')
  }
  
  const refreshTokenRecord = tokenRes.rows[0]
  
  // 2. Vérifications de sécurité
  if (refreshTokenRecord.revoked_at) {
    throw new Error('Refresh token révoqué')
  }
  
  if (new Date(refreshTokenRecord.expires_at) < new Date()) {
    throw new Error('Refresh token expiré')
  }
  
  // 3. Détecter les abus : deux utilisations simultanées = token compromise
  const recentRotations = await query(
    `SELECT COUNT(*) as count
     FROM refresh_tokens
     WHERE family = $1 AND user_id = $2 AND created_at > NOW() - INTERVAL '10 seconds'`,
    [refreshTokenRecord.family, refreshTokenRecord.user_id]
  )
  
  if (parseInt(recentRotations.rows[0].count) > 1) {
    // Rotation suspecte détectée = réutilisation du même token
    // Révoquer TOUS les tokens de cette famille (compromise)
    await query(
      `UPDATE refresh_tokens
       SET revoked_at = NOW()
       WHERE family = $1 AND user_id = $2`,
      [refreshTokenRecord.family, refreshTokenRecord.user_id]
    )
    
    // Logger la tentative suspecte
    await query(
      `INSERT INTO suspicious_token_attempts (user_id, token_family, ip_address, user_agent)
       VALUES ($1, $2, $3, $4)`,
      [refreshTokenRecord.user_id, refreshTokenRecord.family, ipAddress, userAgent]
    )
    
    throw new Error('Tentative de réutilisation de token détectée. Tous les tokens révoqués. Reconnexion requise.')
  }
  
  // 4. Révoquer l'ancien token
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
    [refreshTokenRecord.id]
  )
  
  // 5. Générer un nouveau token de la même famille (rotation)
  const newToken = crypto.randomBytes(32).toString('hex')
  const expiresIn = 30 * 24 * 60 * 60 * 1000 // 30 jours
  const expiresAt = new Date(Date.now() + expiresIn)
  
  const newTokenRes = await query(
    `INSERT INTO refresh_tokens (user_id, token, family, expires_at, rotation_count)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING token`,
    [refreshTokenRecord.user_id, newToken, refreshTokenRecord.family, expiresAt, refreshTokenRecord.rotation_count + 1]
  )
  
  // 6. Récupérer les données utilisateur pour nouveau JWT
  const userRes = await query(
    `SELECT id, email, role FROM users WHERE id = $1`,
    [refreshTokenRecord.user_id]
  )
  
  return {
    user: userRes.rows[0],
    newRefreshToken: newTokenRes.rows[0].token,
    family: refreshTokenRecord.family
  }
}

/**
 * Révoque un refresh token (logout)
 */
export async function revokeRefreshToken(token) {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token = $1`,
    [token]
  )
}

/**
 * Révoque TOUS les refresh tokens d'un utilisateur (logout partout)
 */
export async function revokeAllUserTokens(userId) {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  )
}

/**
 * Nettoie les tokens expirés (à lancer périodiquement)
 * À faire : cron job quotidien
 */
export async function cleanupExpiredTokens() {
  const result = await query(
    `DELETE FROM refresh_tokens WHERE expires_at < NOW()`
  )
  console.log(`🧹 Nettoyage: ${result.rowCount} refresh tokens expirés supprimés`)
}

/**
 * Détecte les tentatives d'abus et alerte
 */
export async function detectTokenAbusePatterns(userId) {
  const suspiciousAttempts = await query(
    `SELECT COUNT(*) as count FROM suspicious_token_attempts
     WHERE user_id = $1 AND attempted_at > NOW() - INTERVAL '1 hour'`,
    [userId]
  )
  
  const count = parseInt(suspiciousAttempts.rows[0].count)
  
  if (count >= 3) {
    console.warn(`⚠️ ALERTE: ${count} tentatives suspectes pour l'utilisateur ${userId} en 1 heure`)
    // À faire : envoyer email d'alerte
    return true
  }
  
  return false
}
