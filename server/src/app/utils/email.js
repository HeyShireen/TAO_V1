// server/src/app/utils/email.js
// Service d'envoi d'emails — SOURCE UNIQUE du transporteur SMTP.
//
// `routes/exports/index.js` en entretenait une copie conforme ; tout passe
// désormais par ce module, pour qu'un changement de fournisseur se fasse en un
// seul endroit.

import nodemailer from 'nodemailer';

// Configuration du transporteur email
let transporter = null;

/**
 * Transporteur SMTP mutualisé.
 *
 * Entièrement piloté par l'environnement, donc compatible avec n'importe quel
 * fournisseur. Pour Brevo :
 *   EMAIL_HOST=smtp-relay.brevo.com
 *   EMAIL_PORT=587
 *   EMAIL_USER=<identifiant SMTP Brevo, du type 9xxxxx@smtp-brevo.com>
 *   EMAIL_PASS=<clé SMTP>
 *   EMAIL_FROM="AO Link <contact@votredomaine.fr>"   <-- indispensable
 *
 * ⚠️ Chez Brevo, l'identifiant SMTP n'est PAS une adresse d'expédition valide.
 * Sans `EMAIL_FROM`, les messages partiraient avec cet identifiant en
 * expéditeur et seraient rejetés. C'est la raison d'être de `mailFrom()`.
 */
export function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_PORT === '465', // true pour port 465, false pour autres
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      // Optimisations de performance
      pool: true,              // Réutilise les connexions SMTP (évite reconnexion à chaque email)
      maxConnections: 3,       // Max 3 connexions simultanées
      maxMessages: 100,        // Max 100 messages par connexion avant renouvellement
      connectionTimeout: 10000, // 10s timeout connexion
      greetingTimeout: 10000,  // 10s timeout greeting SMTP
      socketTimeout: 30000,    // 30s timeout socket
    });
  }
  return transporter;
}

/**
 * Adresse d'expédition des messages.
 *
 * `EMAIL_FROM` d'abord (seule valeur correcte dès que l'identifiant SMTP n'est
 * pas une adresse réelle), sinon repli sur `EMAIL_USER` pour ne rien casser des
 * configurations existantes de type Gmail.
 *
 * Une valeur contenant déjà un chevron (« Nom <adresse> ») est reprise telle
 * quelle ; une adresse nue est habillée du nom de l'application.
 */
export function mailFrom() {
  const configure = (process.env.EMAIL_FROM || '').trim();
  if (configure) return configure.includes('<') ? configure : `"AO Link" <${configure}>`;
  return `"AO Link" <${process.env.EMAIL_USER}>`;
}

/** L'envoi d'emails est-il configuré ? */
export function isEmailConfigured() {
  return Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

/**
 * Envoyer un email de vérification après inscription
 */
export async function sendVerificationEmail(email, token) {
  const verificationUrl = `${process.env.APP_URL || 'http://localhost:4000'}/api/auth/verify-email/${token}`;
  
  const mailOptions = {
    from: mailFrom(),
    to: email,
    subject: 'Confirmez votre adresse email - AO Link',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Bienvenue sur AO Link !</h2>
        <p>Merci de vous être inscrit. Pour activer votre compte, veuillez confirmer votre adresse email en cliquant sur le lien ci-dessous :</p>
        <p style="margin: 30px 0;">
          <a href="${verificationUrl}" style="background: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Confirmer mon email
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">
          Ou copiez ce lien dans votre navigateur :<br>
          <a href="${verificationUrl}">${verificationUrl}</a>
        </p>
        <p style="color: #666; font-size: 14px; margin-top: 40px;">
          Ce lien est valable pendant 24 heures.<br>
          Si vous n'avez pas créé de compte, ignorez cet email.
        </p>
      </div>
    `,
  };

  try {
    await getTransporter().sendMail(mailOptions);
    console.log('✅ Email de vérification envoyé à', email);
  } catch (error) {
    console.error('❌ Erreur envoi email:', error);
    throw new Error('Impossible d\'envoyer l\'email de vérification');
  }
}

export async function sendTenantInvitationEmail(email, token, tenantName) {
  const invitationUrl = `${process.env.APP_URL || 'http://localhost:4000'}/login?invitation=${encodeURIComponent(token)}`;
  const safeTenantName = String(tenantName).replace(/[<>&"']/g, '');
  await getTransporter().sendMail({
    from: mailFrom(),
    to: email,
    subject: `Invitation AO Link - ${safeTenantName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <h2>Invitation AO Link</h2>
        <p>Vous êtes invité à rejoindre l'espace <strong>${safeTenantName}</strong>.</p>
        <p><a href="${invitationUrl}" style="background:#0066cc;color:white;padding:12px 24px;text-decoration:none;border-radius:5px">Accepter l'invitation</a></p>
        <p style="color:#666;font-size:14px">Cette invitation expire dans 48 heures.</p>
      </div>`,
  });
}

export async function sendOperationalAlert(subject, message) {
  const recipient = process.env.ALERT_EMAIL || process.env.PLATFORM_ADMIN_EMAIL;
  if (!recipient || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) return false;
  const safeMessage = String(message).replace(/[<>&]/g, '');
  await getTransporter().sendMail({
    from: mailFrom(),
    to: recipient,
    subject: `[AO Link] ${subject}`,
    text: safeMessage,
  });
  return true;
}

/**
 * Envoyer une notification aux responsables pour une demande d'accès
 */
export async function sendAccessRequestNotification(responsableEmail, visionneur, projectName, message) {
  const dashboardUrl = `${process.env.APP_URL || 'http://localhost:4000'}`;
  
  const mailOptions = {
    from: mailFrom(),
    to: responsableEmail,
    subject: `Nouvelle demande d'accès - ${projectName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Nouvelle demande d'accès</h2>
        <p><strong>${visionneur.email}</strong> souhaite accéder au projet <strong>${projectName}</strong>.</p>
        
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Message :</strong></p>
          <p style="margin: 10px 0 0 0;">${message || 'Aucun message'}</p>
        </div>
        
        <p style="margin: 30px 0;">
          <a href="${dashboardUrl}" style="background: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Gérer les demandes
          </a>
        </p>
        
        <p style="color: #666; font-size: 14px;">
          Connectez-vous à AO Link pour approuver ou rejeter cette demande.
        </p>
      </div>
    `,
  };

  try {
    await getTransporter().sendMail(mailOptions);
    console.log('✅ Notification envoyée à', responsableEmail);
  } catch (error) {
    console.error('❌ Erreur envoi notification:', error);
    // Ne pas bloquer la demande si l'email échoue
  }
}

/**
 * Notifier un visionneur que sa demande a été approuvée
 */
export async function sendAccessApprovedEmail(visionneurEmail, projectName) {
  const dashboardUrl = `${process.env.APP_URL || 'http://localhost:4000'}`;
  
  const mailOptions = {
    from: mailFrom(),
    to: visionneurEmail,
    subject: `Accès accordé - ${projectName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #28a745;">✅ Accès accordé</h2>
        <p>Votre demande d'accès au projet <strong>${projectName}</strong> a été approuvée.</p>
        <p>Vous pouvez maintenant consulter ce projet dans votre espace AO Link.</p>
        
        <p style="margin: 30px 0;">
          <a href="${dashboardUrl}" style="background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Accéder au projet
          </a>
        </p>
      </div>
    `,
  };

  try {
    await getTransporter().sendMail(mailOptions);
    console.log('✅ Email d\'approbation envoyé à', visionneurEmail);
  } catch (error) {
    console.error('❌ Erreur envoi email:', error);
  }
}

/**
 * Notifier un visionneur que sa demande a été rejetée
 */
export async function sendAccessRejectedEmail(visionneurEmail, projectName, reason) {
  const mailOptions = {
    from: mailFrom(),
    to: visionneurEmail,
    subject: `Demande d'accès refusée - ${projectName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc3545;">❌ Demande refusée</h2>
        <p>Votre demande d'accès au projet <strong>${projectName}</strong> n'a pas été approuvée.</p>
        
        ${reason ? `
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 0;"><strong>Raison :</strong></p>
            <p style="margin: 10px 0 0 0;">${reason}</p>
          </div>
        ` : ''}
        
        <p style="color: #666;">
          Pour plus d'informations, contactez le responsable du projet.
        </p>
      </div>
    `,
  };

  try {
    await getTransporter().sendMail(mailOptions);
    console.log('✅ Email de rejet envoyé à', visionneurEmail);
  } catch (error) {
    console.error('❌ Erreur envoi email:', error);
  }
}

/**
 * Envoyer un email de réinitialisation de mot de passe
 */
export async function sendPasswordResetEmail(email, token) {
  const resetUrl = `${process.env.APP_URL || 'http://localhost:4000'}/api/auth/reset-password/${token}`;
  
  const mailOptions = {
    from: mailFrom(),
    to: email,
    subject: 'Réinitialisation de votre mot de passe - AO Link',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0066cc;">🔐 Réinitialisation de mot de passe</h2>
        <p>Vous avez demandé à réinitialiser votre mot de passe sur <strong>AO Link</strong>.</p>
        
        <p>Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe :</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" 
             style="background: #0066cc; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
            Réinitialiser mon mot de passe
          </a>
        </div>
        
        <p style="color: #666; font-size: 0.9em;">
          Ce lien est valable pendant <strong>1 heure</strong>.
        </p>
        
        <p style="color: #999; font-size: 0.85em; border-top: 1px solid #eee; padding-top: 15px; margin-top: 30px;">
          Si vous n'avez pas demandé cette réinitialisation, ignorez cet email. Votre mot de passe actuel reste inchangé.
        </p>
      </div>
    `,
  };

  try {
    await getTransporter().sendMail(mailOptions);
    console.log('✅ Email de réinitialisation envoyé à', email);
  } catch (error) {
    console.error('❌ Erreur envoi email:', error);
    throw error;
  }
}
