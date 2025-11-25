import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../db.js';
import { hashPassword, comparePassword } from '../utils.hash.js';
import { sendVerificationEmail } from '../utils.email.js';
import { emailRateLimiter, resetEmailAttempts } from '../middleware.security.js';

const router = express.Router();

// Helper: create token
function sign(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// Register: auto-inscription publique (toujours visionneur sauf premier = admin)
router.post('/register', emailRateLimiter, async (req, res) => {
  const { email, password } = req.body;
  
  // Validation
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Format d\'email invalide' });

  const usersCount = await query('SELECT COUNT(*) FROM users');
  const count = Number(usersCount.rows[0].count);
  
  // Premier utilisateur devient automatiquement admin et vérifié, tous les autres sont visionneurs non vérifiés
  const finalRole = count === 0 ? 'admin' : 'visionneur';
  const emailVerified = count === 0; // Admin auto-vérifié

  const password_hash = await hashPassword(password);
  try {
    const result = await query(
      'INSERT INTO users (email, password_hash, role, email_verified) VALUES ($1,$2,$3,$4) RETURNING id, email, role, email_verified',
      [email, password_hash, finalRole, emailVerified]
    );
    const user = result.rows[0];
    
    // Si pas admin, envoyer email de vérification
    if (!emailVerified) {
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
      
      await query(
        'INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, verificationToken, expiresAt]
      );
      
      try {
        await sendVerificationEmail(user.email, verificationToken);
        return res.json({ 
          user: { id: user.id, email: user.email, role: user.role },
          emailSent: true,
          message: 'Compte créé. Vérifiez votre email pour activer votre compte.'
        });
      } catch (emailErr) {
        console.error('Erreur envoi email:', emailErr);
        return res.status(500).json({ error: 'Compte créé mais impossible d\'envoyer l\'email de vérification. Contactez le support.' });
      }
    }
    
    // Admin auto-connecté
    return res.json({ user, token: sign(user) });
  } catch (e) {
    console.error(e);
    return res.status(400).json({ error: 'Cet email est déjà utilisé' });
  }
});

router.post('/login', emailRateLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  const r = await query('SELECT * FROM users WHERE email=$1', [email]);
  if (r.rowCount === 0) return res.status(401).json({ error: 'Identifiants invalides' });
  const user = r.rows[0];
  const ok = await comparePassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Identifiants invalides' });
  
  // Vérifier que l'email est confirmé
  if (!user.email_verified) {
    return res.status(403).json({ 
      error: 'Votre email n\'est pas encore vérifié.',
      emailNotVerified: true,
      userId: user.id,
      email: user.email
    });
  }
  
  // Login réussi: réinitialiser les tentatives
  resetEmailAttempts(email);
  
  const token = sign(user);
  return res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
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
      'INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, verificationToken, expiresAt]
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

// Reset admin password - ONLY if no admin can login
router.post('/reset-admin', async (req, res) => {
  try {
    // 1. Vérifier s'il existe des admins
    const admins = await query('SELECT COUNT(*) FROM users WHERE role = $1', ['admin']);
    if (admins.rows[0].count === '0') {
      return res.status(400).json({ error: 'Aucun compte admin trouvé.' });
    }

    // 2. Utiliser le mot de passe du .env ou en générer un aléatoire
    const newPassword = process.env.ADMIN_PASSWORD || 'admin' + Math.random().toString(36).slice(-4);
    const password_hash = await hashPassword(newPassword);
    
    const updated = await query(`
      UPDATE users 
      SET password_hash = $1
      WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1)
      RETURNING email
    `, [password_hash]);

    // 3. Retourner le résultat
    res.json({ 
      message: 'Mot de passe admin réinitialisé',
      email: updated.rows[0].email,
      success: true
    });

  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Erreur lors de la réinitialisation' });
  }
});

export default router;
