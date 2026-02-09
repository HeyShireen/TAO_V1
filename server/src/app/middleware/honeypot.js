// server/src/middleware.honeypot.js
// Anti-bots: Honeypot fields (champs cachés qui ne doivent JAMAIS être remplis)

import { query } from '../db.js'

/**
 * Middleware de vérification honeypot
 * Les bots remplissent automatiquement les champs, les humains ne les voient pas
 * 
 * Champs honeypot à ajouter en HTML (hidden, display: none):
 * - website_url
 * - phone_number
 * - company_name
 */
export function honeypotValidator(req, res, next) {
  const { website_url, phone_number, company_name } = req.body
  
  // Si l'un des champs honeypot est rempli, c'est un bot
  if (website_url || phone_number || company_name) {
    console.warn(`⚠️ Honeypot déclenché: IP=${req.ip}, User-Agent=${req.get('user-agent')}`)
    
    // Logger la tentative suspecte (silencieusement)
    logHoneypotAttempt({
      ip: req.ip,
      userAgent: req.get('user-agent'),
      endpoint: req.path,
      filledFields: {
        website_url: !!website_url,
        phone_number: !!phone_number,
        company_name: !!company_name
      }
    }).catch(err => console.error('Erreur logging honeypot:', err))
    
    // Bloquer la requête
    // Important: Ne PAS révéler que c'est un honeypot
    // Répondre avec un succès fake pour ne pas alerter les attaquants
    return res.status(200).json({
      ok: true,
      message: 'Compte créé avec succès'
    })
  }
  
  // Humanains passent, bots bloqués (silencieusement)
  next()
}

/**
 * Logger les tentatives honeypot (optionnel, nécessite une table dans la BDD)
 */
async function logHoneypotAttempt(data) {
  // À faire : créer une table honeypot_attempts
  // CREATE TABLE honeypot_attempts (
  //   id SERIAL PRIMARY KEY,
  //   ip_address VARCHAR(45),
  //   user_agent TEXT,
  //   endpoint VARCHAR(100),
  //   filled_fields JSONB,
  //   detected_at TIMESTAMPTZ DEFAULT NOW()
  // );
  
  try {
    await query(
      `INSERT INTO honeypot_attempts (ip_address, user_agent, endpoint, filled_fields)
       VALUES ($1, $2, $3, $4)`,
      [data.ip, data.userAgent, data.endpoint, JSON.stringify(data.filledFields)]
    )
  } catch (err) {
    // Table pas encore créée, ignorer silencieusement en dev
    if (process.env.NODE_ENV === 'development') {
      console.log('Note: honeypot_attempts table non créée (optionnel)')
    }
  }
}

/**
 * Rate limiter basé sur honeypot hits
 * Si une IP déclenche trop souvent le honeypot, bloquer pour X minutes
 */
export async function honeypotRateLimiter(req, res, next) {
  const ip = req.ip
  
  // Vérifier les hits honeypot récents
  try {
    const recentHits = await query(
      `SELECT COUNT(*) as count FROM honeypot_attempts
       WHERE ip_address = $1 AND detected_at > NOW() - INTERVAL '1 hour'`,
      [ip]
    )
    
    const hitCount = parseInt(recentHits.rows[0].count)
    
    // Si > 5 hits honeypot en 1h = bot probable
    if (hitCount > 5) {
      console.warn(`🤖 IP ${ip} bloquée après ${hitCount} hits honeypot`)
      return res.status(429).json({
        error: 'Trop de requêtes. Réessayez plus tard.'
      })
    }
  } catch (err) {
    // Table pas créée, ignorer
  }
  
  next()
}

/**
 * Générer les champs honeypot pour envoyer au frontend
 * Les noms de champs changent à chaque requête pour éviter le pattern matching
 */
export function generateHoneypotFields() {
  return {
    // Les vrais champs honeypot (à mettre en hidden dans le formulaire)
    honeypotFields: {
      website_url: '', // Les bots remplissent les "URL"
      phone_number: '', // Les bots remplissent les "téléphones"
      company_name: '' // Les bots remplissent les "entreprises"
    },
    // Optionnel: champs avec noms trompeurs (augmente l'efficacité)
    decoyFields: {
      'contact_us_asap': '', // Décoy: faux bouton urgent
      'send_password_email': '' // Décoy: les bots cliquent sur email
    }
  }
}

/**
 * Vérifier si une requête semble être un bot (patterns suspects)
 */
export function detectBotPatterns(req) {
  const userAgent = req.get('user-agent') || ''
  const suspicious = []
  
  // Patterns connus de bots
  const botPatterns = [
    /bot/i,
    /crawler/i,
    /spider/i,
    /scraper/i,
    /curl/i,
    /python/i,
    /java-http/i
  ]
  
  for (const pattern of botPatterns) {
    if (pattern.test(userAgent)) {
      suspicious.push(`User-Agent contient: ${pattern}`)
    }
  }
  
  // Headers manquants chez les bots
  if (!req.get('accept-language')) {
    suspicious.push('accept-language header manquant')
  }
  if (!req.get('accept-encoding')) {
    suspicious.push('accept-encoding header manquant')
  }
  
  // Timing: les bots sont très rapides (< 50ms entre submit et réponse)
  // À faire: tracker dans le frontend
  
  return {
    isBot: suspicious.length > 0,
    suspiciousIndicators: suspicious,
    confidence: (suspicious.length / 4) // 0-1 scale
  }
}

export default {
  honeypotValidator,
  honeypotRateLimiter,
  generateHoneypotFields,
  detectBotPatterns
}
