// server/src/utils.email.js
// Service d'envoi d'emails avec nodemailer

import nodemailer from 'nodemailer';

// Configuration du transporteur email
let transporter = null;

function getTransporter() {
  if (!transporter) {
    // Configuration SMTP (Gmail, SendGrid, Brevo, etc.)
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_PORT === '465', // true pour port 465, false pour autres
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Envoyer un email de vérification après inscription
 */
export async function sendVerificationEmail(email, token) {
  const verificationUrl = `${process.env.APP_URL || 'http://localhost:4000'}/api/auth/verify-email/${token}`;
  
  const mailOptions = {
    from: `"TAO Comparateur" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Confirmez votre adresse email - TAO',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Bienvenue sur TAO !</h2>
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

/**
 * Envoyer une notification aux responsables pour une demande d'accès
 */
export async function sendAccessRequestNotification(responsableEmail, visionneur, projectName, message) {
  const dashboardUrl = `${process.env.APP_URL || 'http://localhost:4000'}`;
  
  const mailOptions = {
    from: `"TAO Comparateur" <${process.env.EMAIL_USER}>`,
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
          Connectez-vous à TAO pour approuver ou rejeter cette demande.
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
    from: `"TAO Comparateur" <${process.env.EMAIL_USER}>`,
    to: visionneurEmail,
    subject: `Accès accordé - ${projectName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #28a745;">✅ Accès accordé</h2>
        <p>Votre demande d'accès au projet <strong>${projectName}</strong> a été approuvée.</p>
        <p>Vous pouvez maintenant consulter ce projet dans votre espace TAO.</p>
        
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
    from: `"TAO Comparateur" <${process.env.EMAIL_USER}>`,
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
