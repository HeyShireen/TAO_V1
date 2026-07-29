import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool, query, runWithDbContext } from '../../db.js';
import { hashPassword, comparePassword } from '../../utils/hash.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../../utils/email.js';
import { emailRateLimiter, resetEmailAttempts, resetAllCooldowns } from '../../middleware/security.js';
import { requireAuth, revokeToken } from '../../middleware/auth.js';
import { validatePassword } from '../../utils/validation.js';
import { honeypotValidator } from '../../middleware/honeypot.js';
import { generateRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllUserTokens, detectTokenAbusePatterns } from '../../utils/refresh-tokens.js';
import { cookieValue, isDemoHost, publicUser, sessionCookieOptions, AUTH_COOKIE_MAX_AGE, REFRESH_COOKIE_MAX_AGE } from '../../utils/tenant.js';

const router = express.Router();
router.use((req, _res, next) => runWithDbContext({ authScope: true }, () => next()));

// Helper: create token
function sign(user, activeTenantId = user.active_tenant_id || user.tenant_id) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET missing');
  return jwt.sign({
    id: Number(user.id),
    email: user.email,
    role: user.role,
    company_id: user.company_id || null,
    tenant_id: Number(user.tenant_id),
    active_tenant_id: Number(activeTenantId),
    active_tenant_type: user.active_tenant_type || user.tenant_type || null,
  }, jwtSecret, { expiresIn: '15m' });
}

// Register: auto-inscription publique avec honeypot anti-bot
router.post('/register', emailRateLimiter, honeypotValidator, async (req, res) => {
  return res.status(403).json({ error: 'La création publique de compte est désactivée. Demandez une invitation à votre administrateur.' });
});

router.post('/invitations/:token/accept', emailRateLimiter, async (req, res) => {
  const rawToken = String(req.params.token || '')
  const password = String(req.body?.password || '')
  try {
    validatePassword(password)
  } catch (error) {
    return res.status(400).json({ error: error.message })
  }
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const invitationResult = await client.query(
      `SELECT i.*, t.status AS tenant_status
       FROM tenant_invitations i JOIN tenants t ON t.id = i.tenant_id
       WHERE i.token_hash = $1 FOR UPDATE OF i`,
      [tokenHash]
    )
    if (invitationResult.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Invitation invalide' })
    }
    const invitation = invitationResult.rows[0]
    if (invitation.accepted_at || new Date(invitation.expires_at) <= new Date()) {
      await client.query('ROLLBACK')
      return res.status(410).json({ error: 'Invitation expirée ou déjà utilisée' })
    }
    if (invitation.tenant_status !== 'active') {
      await client.query('ROLLBACK')
      return res.status(403).json({ error: 'Organisation suspendue' })
    }

    const passwordHash = await hashPassword(password)
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, role, company_id, email_verified, tenant_id)
       VALUES ($1, $2, $3, $4, true, $5)
       RETURNING id, email, role, company_id, tenant_id`,
      [invitation.email, passwordHash, invitation.role, invitation.company_id, invitation.tenant_id]
    )
    await client.query('UPDATE tenant_invitations SET accepted_at = now() WHERE id = $1', [invitation.id])
    await client.query('COMMIT')
    return res.status(201).json({ user: publicUser(userResult.rows[0]), message: 'Invitation acceptée. Vous pouvez vous connecter.' })
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    if (error.code === '23505') return res.status(409).json({ error: 'Cette adresse est déjà utilisée' })
    console.error('Acceptation invitation:', error)
    return res.status(500).json({ error: 'Impossible d\'accepter l\'invitation' })
  } finally {
    await client.release()
  }
});

router.post('/login', emailRateLimiter, honeypotValidator, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    const r = await query(
      `SELECT u.*, t.slug AS tenant_slug, t.name AS tenant_name,
              t.type AS tenant_type, t.status AS tenant_status
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE lower(u.email) = lower($1)`,
      [email.trim()]
    );
    if (r.rowCount === 0) return res.status(401).json({ error: 'Identifiants invalides' });
    const user = r.rows[0];
    const ok = await comparePassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Identifiants invalides' });
    
    if (!user.email_verified) {
      return res.status(403).json({ 
        error: 'Votre email n\'est pas encore vérifié.',
        emailNotVerified: true,
        userId: user.id,
        email: user.email
      });
    }

    if (user.tenant_status !== 'active') {
      return res.status(403).json({ error: 'Organisation suspendue' });
    }
    if (isDemoHost(req) && user.tenant_type !== 'demo') {
      return res.status(403).json({ error: 'Ce compte ne peut pas se connecter à l\'espace de démonstration' });
    }
    
    await resetEmailAttempts(email);
    
    // Générer JWT court terme (15 min) + refresh token long terme (30 j)
    const token = sign(user, user.tenant_id);
    const { refreshToken } = await generateRefreshToken(user.id, null, user.tenant_id);
    
    // JWT en cookie HttpOnly
    res.cookie('auth', token, sessionCookieOptions(req, AUTH_COOKIE_MAX_AGE));

    // Refresh token en cookie HttpOnly séparé
    res.cookie('refreshToken', refreshToken, sessionCookieOptions(req, REFRESH_COOKIE_MAX_AGE));
    
    return res.json({ 
      token, 
      user: publicUser(user, {
        id: user.tenant_id,
        slug: user.tenant_slug,
        name: user.tenant_name,
        type: user.tenant_type,
        status: user.tenant_status,
      })
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Erreur serveur (login)' });
  }
});

// Déconnexion: SÉCURITÉ - Revoque le token et nettoie les cookies
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    
    // SÉCURITÉ: Révoquer le token (empêcher sa réutilisation)
    if (req.token) {
      await revokeToken(req.token);
    }
    
    // Révoquer le refresh token si présent
    const refreshToken = cookieValue(req, 'refreshToken');
    if (refreshToken) {
      try {
        await revokeRefreshToken(refreshToken);
      } catch (err) {
        console.error('Erreur révocation refresh token:', err);
      }
    }
    
    const opts = sessionCookieOptions(req);

    res.clearCookie('auth', opts);
    res.clearCookie('refreshToken', opts);
    
    console.log(`✅ Logout: Utilisateur ${req.user?.email} (ID: ${userId}) déconnecté avec succès`);
    return res.json({ ok: true, message: 'Déconnecté avec succès' });
  } catch (err) {
    console.error('Erreur logout:', err);
    return res.status(500).json({ error: 'Erreur lors de la déconnexion' });
  }
});

// Renvoyer l'email de vérification (avec cooldown)
router.post('/resend-verification', emailRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis' });
    
    // Vérifier que l'utilisateur existe et n'est pas vérifié
    const userResult = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }
    
    const user = userResult.rows[0];
    if (user.email_verified) {
      return res.status(400).json({ error: 'Cet email est déjà vérifié' });
    }
    
    // Vérifier le cooldown (dernier email envoyé il y a moins de 5 minutes)
    const lastVerification = await query(
      'SELECT created_at FROM email_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [user.id]
    );
    
    if (lastVerification.rowCount > 0) {
      const lastSent = new Date(lastVerification.rows[0].created_at);
      const now = new Date();
      const diffMinutes = (now - lastSent) / 1000 / 60;
      
      if (diffMinutes < 5) {
        const waitTime = Math.ceil(5 - diffMinutes);
        return res.status(429).json({ 
          error: `Veuillez patienter ${waitTime} minute(s) avant de renvoyer un email.`,
          cooldown: true,
          waitMinutes: waitTime
        });
      }
    }
    
    // Générer un nouveau token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    
    // Supprimer les anciens tokens non utilisés
    await query('DELETE FROM email_verifications WHERE user_id = $1', [user.id]);
    
    // Créer le nouveau token
    await query(
      'INSERT INTO email_verifications (user_id, token, expires_at, tenant_id) VALUES ($1, $2, $3, $4)',
      [user.id, verificationToken, expiresAt, user.tenant_id]
    );
    
    // Envoyer l'email
    await sendVerificationEmail(user.email, verificationToken);
    
    return res.json({ 
      message: 'Email de vérification envoyé. Consultez votre boîte mail.',
      emailSent: true
    });
  } catch (err) {
    console.error('Erreur renvoi email:', err);
    return res.status(500).json({ error: 'Impossible d\'envoyer l\'email. Réessayez plus tard.' });
  }
});

// Vérifier l'email via le token reçu par mail
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // Chercher le token de vérification
    const verification = await query(
      'SELECT * FROM email_verifications WHERE token = $1 AND verified_at IS NULL',
      [token]
    );
    
    if (verification.rowCount === 0) {
      return res.status(400).send(`
        <html><body style="font-family:Arial;text-align:center;padding:50px;">
          <h2 style="color:#dc3545;">❌ Lien invalide ou expiré</h2>
          <p>Ce lien de vérification n'est plus valide.</p>
          <a href="/" style="color:#0066cc;">Retour à la page de connexion</a>
        </body></html>
      `);
    }
    
    const verif = verification.rows[0];
    
    // Vérifier l'expiration
    if (new Date() > new Date(verif.expires_at)) {
      return res.status(400).send(`
        <html><body style="font-family:Arial;text-align:center;padding:50px;">
          <h2 style="color:#dc3545;">⌛ Lien expiré</h2>
          <p>Ce lien de vérification a expiré (valable 24h).</p>
          <p>Contactez le support pour obtenir un nouveau lien.</p>
          <a href="/" style="color:#0066cc;">Retour à la page de connexion</a>
        </body></html>
      `);
    }
    
    // Marquer l'email comme vérifié
    await query('UPDATE users SET email_verified = TRUE WHERE id = $1', [verif.user_id]);
    await query('UPDATE email_verifications SET verified_at = now() WHERE id = $1', [verif.id]);
    
    return res.send(`
      <html><body style="font-family:Arial;text-align:center;padding:50px;">
        <h2 style="color:#28a745;">✅ Email vérifié !</h2>
        <p>Votre adresse email a été confirmée avec succès.</p>
        <p>Vous pouvez maintenant vous connecter à votre compte.</p>
        <a href="/" style="background:#0066cc;color:white;padding:12px 24px;text-decoration:none;border-radius:5px;display:inline-block;margin-top:20px;">Se connecter</a>
      </body></html>
    `);
  } catch (err) {
    console.error('Erreur vérification email:', err);
    return res.status(500).send(`
      <html><body style="font-family:Arial;text-align:center;padding:50px;">
        <h2 style="color:#dc3545;">Erreur</h2>
        <p>Une erreur est survenue lors de la vérification.</p>
        <a href="/" style="color:#0066cc;">Retour à la page de connexion</a>
      </body></html>
    `);
  }
});

// Demande de réinitialisation de mot de passe (envoie un email)
router.post('/forgot-password', emailRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email requis' });
    }
    
    // Chercher l'utilisateur (silencieux si pas trouvé pour éviter l'énumération)
    const result = await query('SELECT id, email, tenant_id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    
    // Toujours retourner succès même si l'email n'existe pas (sécurité)
    if (result.rows.length === 0) {
      return res.json({ 
        message: 'Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.',
        emailSent: true
      });
    }
    
    const user = result.rows[0];
    
    // Générer un token de réinitialisation
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 heure
    
    // Supprimer les anciens tokens non utilisés pour cet user
    await query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [user.id]);
    
    // Créer le nouveau token
    await query(
      'INSERT INTO password_resets (user_id, token, expires_at, tenant_id) VALUES ($1, $2, $3, $4)',
      [user.id, resetToken, expiresAt, user.tenant_id]
    );
    
    // Envoyer l'email
    await sendPasswordResetEmail(user.email, resetToken);
    
    return res.json({ 
      message: 'Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.',
      emailSent: true
    });
    
  } catch (err) {
    console.error('Erreur forgot password:', err);
    return res.status(500).json({ error: 'Erreur lors de l\'envoi de l\'email' });
  }
});

// Afficher le formulaire de réinitialisation (HTML)
router.get('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  
  try {
    // Vérifier que le token existe et n'est pas expiré
    const result = await query(`
      SELECT pr.id, pr.user_id, pr.used_at, u.email
      FROM password_resets pr
      JOIN users u ON u.id = pr.user_id
      WHERE pr.token = $1 AND pr.expires_at > NOW()
    `, [token]);
    
    if (result.rows.length === 0) {
      return res.status(400).send(`
        <html><body style="font-family:Arial;text-align:center;padding:50px;">
          <h2 style="color:#dc3545;">❌ Lien invalide</h2>
          <p>Ce lien de réinitialisation est invalide ou a expiré.</p>
          <a href="/" style="color:#0066cc;">Retour à la page de connexion</a>
        </body></html>
      `);
    }
    
    const reset = result.rows[0];
    
    if (reset.used_at) {
      return res.status(400).send(`
        <html><body style="font-family:Arial;text-align:center;padding:50px;">
          <h2 style="color:#dc3545;">❌ Lien déjà utilisé</h2>
          <p>Ce lien a déjà été utilisé pour réinitialiser votre mot de passe.</p>
          <a href="/" style="color:#0066cc;">Retour à la page de connexion</a>
        </body></html>
      `);
    }
    
    // Afficher le formulaire
    return res.send(`
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Réinitialiser le mot de passe</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f5f5f5; padding: 50px; text-align: center; }
          .container { max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          h2 { color: #333; margin-bottom: 20px; }
          input { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
          button { width: 100%; padding: 12px; background: #0066cc; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; margin-top: 10px; }
          button:hover { background: #0052a3; }
          .error { color: #dc3545; margin-top: 10px; }
          .success { color: #28a745; margin-top: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>🔐 Nouveau mot de passe</h2>
          <p style="color:#666; margin-bottom:20px;">Compte : <strong>${reset.email}</strong></p>
          <form id="resetForm">
            <input type="password" id="password" placeholder="Nouveau mot de passe (min. 12 caracteres)" required minlength="12">
            <input type="password" id="confirmPassword" placeholder="Confirmer le mot de passe" required minlength="12">
            <p style="color:#666; font-size:0.9em; text-align:left; margin:8px 0 0;">Minimum 12 caracteres, une majuscule, un chiffre et un caractere special.</p>
            <button type="submit">Réinitialiser le mot de passe</button>
          </form>
          <div id="message"></div>
        </div>
        <script>
          document.getElementById('resetForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const message = document.getElementById('message');
            
            if (password !== confirmPassword) {
              message.innerHTML = '<p class="error">Les mots de passe ne correspondent pas</p>';
              return;
            }
            
            if (password.length < 12) {
              message.innerHTML = '<p class="error">Le mot de passe doit contenir au moins 12 caracteres</p>';
              return;
            }
            
            try {
              const response = await fetch('/api/auth/reset-password/${token}', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
              });
              
              const data = await response.json();
              
              if (response.ok) {
                message.innerHTML = '<p class="success">✅ ' + data.message + '</p>';
                setTimeout(() => { window.location.href = '/'; }, 2000);
              } else {
                message.innerHTML = '<p class="error">❌ ' + data.error + '</p>';
              }
            } catch (error) {
              message.innerHTML = '<p class="error">❌ Erreur réseau</p>';
            }
          });
        </script>
      </body>
      </html>
    `);
    
  } catch (err) {
    console.error('Erreur affichage reset form:', err);
    return res.status(500).send(`
      <html><body style="font-family:Arial;text-align:center;padding:50px;">
        <h2 style="color:#dc3545;">Erreur</h2>
        <p>Une erreur est survenue.</p>
        <a href="/" style="color:#0066cc;">Retour à la page de connexion</a>
      </body></html>
    `);
  }
});

// Réinitialiser le mot de passe (POST)
router.post('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;
  
  try {
    // Validation du mot de passe avec critères de sécurité
    try {
      validatePassword(password);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    
    // Vérifier le token
    const result = await query(`
      SELECT pr.id, pr.user_id, pr.used_at, u.email
      FROM password_resets pr
      JOIN users u ON u.id = pr.user_id
      WHERE pr.token = $1 AND pr.expires_at > NOW()
    `, [token]);
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Lien invalide ou expiré' });
    }
    
    const reset = result.rows[0];
    
    if (reset.used_at) {
      return res.status(400).json({ error: 'Ce lien a déjà été utilisé' });
    }
    
    // Hasher le nouveau mot de passe
    const password_hash = await hashPassword(password);
    
    // Mettre à jour le mot de passe
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, reset.user_id]);
    
    // Marquer le token comme utilisé
    await query('UPDATE password_resets SET used_at = NOW() WHERE id = $1', [reset.id]);
    
    // Réinitialiser les tentatives de login
    await resetEmailAttempts(reset.email);
    
    return res.json({ 
      message: 'Mot de passe réinitialisé avec succès ! Vous pouvez maintenant vous connecter.',
      success: true
    });
    
  } catch (err) {
    console.error('Erreur reset password:', err);
    return res.status(500).json({ error: 'Erreur lors de la réinitialisation' });
  }
});

// Changer son propre mot de passe (authentifié)
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    
    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Mots de passe requis' });
    }
    
    // Validation du nouveau mot de passe
    try {
      validatePassword(newPassword);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    
    // Vérifier l'ancien mot de passe
    const userResult = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }
    
    const isValid = await comparePassword(currentPassword, userResult.rows[0].password_hash);
    if (!isValid) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    }
    
    // Hasher et mettre à jour le nouveau mot de passe
    const newPasswordHash = await hashPassword(newPassword);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPasswordHash, userId]);
    
    return res.json({ 
      message: 'Mot de passe modifié avec succès',
      success: true
    });
    
  } catch (err) {
    console.error('Erreur changement mot de passe:', err);
    res.status(500).json({ error: 'Impossible de changer le mot de passe' });
  }
});

// Admin: Reset all login cooldowns
router.post('/reset-cooldowns', requireAuth, async (req, res) => {
  try {
    // Vérifier que l'utilisateur est admin
    if (req.user.role !== 'platform_admin') {
      return res.status(403).json({ error: 'Accès refusé - Admin uniquement' });
    }
    
    const result = await resetAllCooldowns();
    res.json(result);
  } catch (err) {
    console.error('Erreur reset cooldowns:', err);
    res.status(500).json({ error: 'Erreur lors de la réinitialisation' });
  }
});

// Rafraîchir le token avec les données à jour
router.post('/refresh-token', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    
    // Récupérer les données à jour de l'utilisateur
    const userResult = await query('SELECT id, email, role, company_id, tenant_id FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }
    
    const user = userResult.rows[0];
    user.active_tenant_id = req.user.active_tenant_id;
    user.active_tenant_type = req.user.active_tenant_type;
    const newToken = sign(user, req.user.active_tenant_id);
    
    return res.json({ 
      token: newToken,
      user: publicUser(user)
    });
  } catch (err) {
    console.error('Erreur rafraîchissement token:', err);
    res.status(500).json({ error: 'Impossible de rafraîchir le token' });
  }
});

// Refresh Token Endpoint: Rotation automatique des tokens
// Les tokens JWT sont courts (15 min), les refresh tokens longs (30 j)
// À appeler quand JWT expire pour obtenir un nouveau JWT sans re-login
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = cookieValue(req, 'refreshToken') || req.body.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token manquant' });
    }
    
    // Rotation du token avec détection d'abus
    const result = await rotateRefreshToken(
      refreshToken,
      req.ip,
      req.get('user-agent')
    );
    if (isDemoHost(req) && result.user.tenant_type !== 'demo') {
      return res.status(403).json({ error: 'Ce compte ne peut pas utiliser l\'espace de démonstration' });
    }
    
    // Vérifier les patterns d'abus
    const hasAbuse = await detectTokenAbusePatterns(result.user.id);
    if (hasAbuse) {
      console.warn(`⚠️ Alerte: Abus de refresh token pour utilisateur ${result.user.id}`);
      // À faire: envoyer email d'alerte
    }
    
    // Générer un nouveau JWT court terme
    const newJWT = sign(result.user, result.user.active_tenant_id);
    
    // Mettre à jour les cookies
    res.cookie('auth', newJWT, sessionCookieOptions(req, AUTH_COOKIE_MAX_AGE));
    res.cookie('refreshToken', result.newRefreshToken, sessionCookieOptions(req, REFRESH_COOKIE_MAX_AGE));
    
    return res.json({
      token: newJWT,
      refreshToken: result.newRefreshToken,
      user: publicUser(result.user, {
        id: result.user.active_tenant_id,
        slug: result.user.tenant_slug,
        name: result.user.tenant_name,
        type: result.user.tenant_type,
        status: result.user.tenant_status,
      }),
      message: 'Token rafraîchi avec succès'
    });
  } catch (err) {
    console.error('Erreur refresh token:', err.message);
    return res.status(401).json({ error: err.message || 'Refresh token invalide' });
  }
});

// Logout Everywhere: Révoquer TOUS les tokens (sécurité si compte compromis)
router.post('/logout-everywhere', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    
    // Révoquer TOUS les refresh tokens de cet utilisateur
    await revokeAllUserTokens(userId);
    
    // Révoquer le JWT actuel
    if (req.token) {
      await revokeToken(req.token);
    }
    
    const opts = sessionCookieOptions(req);

    res.clearCookie('auth', opts);
    res.clearCookie('refreshToken', opts);
    
    console.log(`🔐 Logout Everywhere: Tous les tokens utilisateur ${userId} révoqués`);
    return res.json({ 
      ok: true, 
      message: 'Déconnecté de tous les appareils. Reconnecter-vous pour continuer.'
    });
  } catch (err) {
    console.error('Erreur logout everywhere:', err);
    return res.status(500).json({ error: 'Erreur lors de la déconnexion' });
  }
});

export default router;
