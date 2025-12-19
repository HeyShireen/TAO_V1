// server/src/routes/auth-secured.js
// VERSION SÉCURISÉE DE auth.js AVEC TOUTES LES CORRECTIONS

import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../db.js';
import { hashPassword, comparePassword } from '../utils.hash.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../utils.email.js';
import { requireAuth } from '../middleware.auth.js';
import {
  authLimiter,
  passwordResetLimiter,
  emailVerificationLimiter,
  validateEmail,
  validatePasswordStrength,
  tokenBlacklist,
  generateCsrfToken,
  validateCsrfToken,
  logSecurityEvent,
  auditLog
} from '../middleware.security-fixes.js';

const router = express.Router();

// Helper: Créer JWT sécurisé
function sign(user) {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email, 
      role: user.role, 
      company_id: user.company_id || null,
      iat: Math.floor(Date.now() / 1000) // Timestamp de création
    },
    process.env.JWT_SECRET,
    { 
      expiresIn: '7d',
      algorithm: 'HS512' // ✅ Algorithme sécurisé explicite
    }
  );
}

// ============================================================================
// 1. REGISTRATION - SÉCURISÉ
// ============================================================================
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, password, company_id } = req.body;

    // Validation stricte
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    try {
      validateEmail(email);
      validatePasswordStrength(password);
    } catch (err) {
      logSecurityEvent('WARN', 'INVALID_REGISTRATION', { email, reason: err.message });
      return res.status(400).json({ error: err.message });
    }

    // Vérifier doublon
    const existing = await query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (existing.rowCount > 0) {
      logSecurityEvent('WARN', 'REGISTRATION_DUPLICATE_EMAIL', { email });
      return res.status(409).json({ error: 'Cet email est déjà utilisé' });
    }

    // Premier utilisateur = admin, autres = visionneur
    const usersCount = await query('SELECT COUNT(*) FROM users');
    const count = Number(usersCount.rows[0].count);
    const finalRole = count === 0 ? 'admin' : 'visionneur';
    const emailVerified = count === 0;

    // Hash sécurisé du mot de passe
    const password_hash = await hashPassword(password);

    // Créer utilisateur
    const result = await query(
      `INSERT INTO users (email, password_hash, role, email_verified, company_id) 
       VALUES ($1,$2,$3,$4,$5) 
       RETURNING id, email, role, email_verified, company_id`,
      [email.toLowerCase().trim(), password_hash, finalRole, emailVerified, company_id || null]
    );

    const user = result.rows[0];

    // Si pas admin, envoyer email de vérification
    if (!emailVerified) {
      try {
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await query(
          `INSERT INTO email_verifications (user_id, token, expires_at) 
           VALUES ($1, $2, $3)`,
          [user.id, verificationToken, expiresAt]
        );

        await sendVerificationEmail(user.email, verificationToken);
        
        logSecurityEvent('INFO', 'USER_REGISTERED', { userId: user.id, email });
        
        return res.status(201).json({
          message: 'Compte créé. Vérifiez votre email pour l\'activer.',
          emailSent: true,
          user: { id: user.id, email: user.email, role: user.role }
        });
      } catch (emailErr) {
        console.error('Email error:', emailErr);
        return res.status(500).json({ 
          error: 'Compte créé mais email non envoyé. Contactez le support.' 
        });
      }
    }

    // Admin auto-connecté
    const token = sign(user);
    res.cookie('auth', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', // ✅ Sécurité renforcée
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    logSecurityEvent('INFO', 'ADMIN_REGISTERED', { userId: user.id });
    return res.status(201).json({ user, token });

  } catch (err) {
    console.error('Register error:', err);
    logSecurityEvent('ERROR', 'REGISTRATION_ERROR', { error: err.message });
    return res.status(500).json({ error: 'Erreur lors de l\'enregistrement' });
  }
});

// ============================================================================
// 2. LOGIN - SÉCURISÉ
// ============================================================================
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    // Lookup utilisateur (case-insensitive)
    const result = await query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    if (result.rowCount === 0) {
      logSecurityEvent('WARN', 'LOGIN_USER_NOT_FOUND', { email: email.toLowerCase() });
      // ✅ Message vague pour ne pas révéler si email existe
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const user = result.rows[0];

    // Vérifier mot de passe
    const passwordMatch = await comparePassword(password, user.password_hash);
    if (!passwordMatch) {
      logSecurityEvent('WARN', 'LOGIN_INVALID_PASSWORD', { userId: user.id });
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    // Vérifier email confirmé
    if (!user.email_verified) {
      logSecurityEvent('WARN', 'LOGIN_EMAIL_NOT_VERIFIED', { userId: user.id });
      return res.status(403).json({
        error: 'Votre email n\'est pas encore vérifié.',
        emailNotVerified: true,
        userId: user.id,
        email: user.email
      });
    }

    // ✅ Login réussi
    const token = sign(user);
    
    res.cookie('auth', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    logSecurityEvent('INFO', 'USER_LOGIN', { userId: user.id, email: user.email });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        company_id: user.company_id || null
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    logSecurityEvent('ERROR', 'LOGIN_ERROR', { error: err.message });
    return res.status(500).json({ error: 'Erreur lors de la connexion' });
  }
});

// ============================================================================
// 3. LOGOUT - AVEC TOKEN REVOCATION
// ============================================================================
router.post('/logout', requireAuth, async (req, res) => {
  try {
    // Révoquer le token
    const token = req.headers.authorization?.slice(7);
    if (token) {
      const decoded = jwt.decode(token);
      if (decoded?.exp) {
        tokenBlacklist.revoke(token, decoded.exp * 1000);
      }
    }

    // Effacer le cookie
    res.clearCookie('auth', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    });

    auditLog(req, 'LOGOUT', 'user', req.user.id);
    logSecurityEvent('INFO', 'USER_LOGOUT', { userId: req.user.id });

    return res.json({ ok: true, message: 'Déconnecté' });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ error: 'Erreur lors de la déconnexion' });
  }
});

// ============================================================================
// 4. VÉRIFICATION D'EMAIL
// ============================================================================
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;

    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).send(`
        <html><body style="font-family:Arial;text-align:center;padding:50px;">
          <h2 style="color:#dc3545;">❌ Lien invalide</h2>
        </body></html>
      `);
    }

    const verification = await query(
      `SELECT * FROM email_verifications 
       WHERE token = $1 AND verified_at IS NULL AND expires_at > now()`,
      [token]
    );

    if (verification.rowCount === 0) {
      logSecurityEvent('WARN', 'INVALID_VERIFICATION_TOKEN', { token: token.slice(0, 8) });
      return res.status(400).send(`
        <html><body style="font-family:Arial;text-align:center;padding:50px;">
          <h2 style="color:#dc3545;">❌ Lien expiré</h2>
        </body></html>
      `);
    }

    const { user_id } = verification.rows[0];

    // Marquer comme vérifié
    await query(
      `UPDATE email_verifications SET verified_at = now() WHERE user_id = $1`,
      [user_id]
    );

    await query(
      `UPDATE users SET email_verified = true WHERE id = $1`,
      [user_id]
    );

    logSecurityEvent('INFO', 'EMAIL_VERIFIED', { userId: user_id });

    return res.send(`
      <html><body style="font-family:Arial;text-align:center;padding:50px;">
        <h2 style="color:#28a745;">✅ Email vérifié!</h2>
        <p>Vous pouvez maintenant vous connecter.</p>
        <a href="/login" style="color:#0066cc;">Aller à la connexion</a>
      </body></html>
    `);
  } catch (err) {
    console.error('Email verification error:', err);
    return res.status(500).send('<h2>Erreur lors de la vérification</h2>');
  }
});

// ============================================================================
// 5. FORGOT PASSWORD - SÉCURISÉ
// ============================================================================
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email requis' });
    }

    const user = await query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    // ✅ Message identique même si user existe (sécurité)
    if (user.rowCount === 0) {
      logSecurityEvent('INFO', 'FORGOT_PASSWORD_USER_NOT_FOUND', { email });
      return res.json({ 
        message: 'Si cet email existe, un lien de reset sera envoyé.' 
      });
    }

    const userId = user.rows[0].id;

    // Générer token reset
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 heure

    await query(
      `INSERT INTO password_resets (user_id, token, expires_at) 
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3`,
      [userId, resetToken, expiresAt]
    );

    await sendPasswordResetEmail(email, resetToken);

    logSecurityEvent('INFO', 'PASSWORD_RESET_REQUESTED', { userId });

    return res.json({ 
      message: 'Si cet email existe, un lien de reset sera envoyé.' 
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: 'Erreur lors de la demande' });
  }
});

// ============================================================================
// 6. RESET PASSWORD
// ============================================================================
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ error: 'Token invalide' });
    }

    try {
      validatePasswordStrength(password);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Chercher token de reset valide
    const reset = await query(
      `SELECT * FROM password_resets 
       WHERE token = $1 AND expires_at > now() AND used_at IS NULL`,
      [token]
    );

    if (reset.rowCount === 0) {
      logSecurityEvent('WARN', 'INVALID_PASSWORD_RESET_TOKEN', {});
      return res.status(400).json({ error: 'Lien expiré ou invalide' });
    }

    const { user_id } = reset.rows[0];

    // Hash nouveau mot de passe
    const password_hash = await hashPassword(password);

    // Mettre à jour
    await query(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [password_hash, user_id]
    );

    // Marquer token comme utilisé
    await query(
      `UPDATE password_resets SET used_at = now() WHERE token = $1`,
      [token]
    );

    // Révoquer tous les tokens de cet utilisateur
    // (l'obliger à se reconnecter)
    logSecurityEvent('INFO', 'PASSWORD_RESET_COMPLETED', { userId: user_id });

    return res.json({ 
      message: 'Mot de passe réinitialisé. Veuillez vous reconnecter.' 
    });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Erreur lors de la réinitialisation' });
  }
});

// ============================================================================
// 7. REFRESH TOKEN (optional, pour améliorer la sécurité)
// ============================================================================
router.post('/refresh', requireAuth, async (req, res) => {
  try {
    const user = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);

    if (user.rowCount === 0) {
      return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }

    const newToken = sign(user.rows[0]);

    res.cookie('auth', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({ token: newToken });
  } catch (err) {
    console.error('Refresh error:', err);
    return res.status(500).json({ error: 'Erreur lors du refresh' });
  }
});

// ============================================================================
// 8. GET CSRF TOKEN
// ============================================================================
router.get('/csrf-token', (req, res) => {
  const csrfToken = generateCsrfToken(req.user?.id || req.sessionID);
  res.json({ csrfToken });
});

export default router;
