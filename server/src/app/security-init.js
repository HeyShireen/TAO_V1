/**
 * security-init.js
 * ==================
 * Initialisation des protections de sécurité critiques au startup
 * EXÉCUTÉ AVANT LE LANCEMENT DE L'APP
 */

console.log('\n🔒 Vérification des configurations de sécurité...\n');

// 1. VÉRIFIER JWT_SECRET
if (!process.env.JWT_SECRET) {
  console.error('❌ ERREUR CRITIQUE: JWT_SECRET non défini');
  console.error('   Ajoutez dans votre .env: JWT_SECRET=<chaîne-de-64-caractères-aléatoire>');
  process.exit(1);
}

if (process.env.JWT_SECRET === 'change-me') {
  console.error('❌ ERREUR CRITIQUE: JWT_SECRET utilise la valeur par défaut "change-me"');
  console.error('   Remplacez par une clé aléatoire sécurisée (min 32 caractères)');
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('❌ ERREUR CRITIQUE: JWT_SECRET trop court (min 32 caractères)');
  process.exit(1);
}
console.log('✅ JWT_SECRET: Valide');

// 2. VÉRIFIER DATABASE_URL
if (!process.env.DATABASE_URL) {
  console.error('❌ ERREUR CRITIQUE: DATABASE_URL non défini');
  console.error('   Exemple: DATABASE_URL=postgresql://user:password@host:5432/dbname');
  process.exit(1);
}
console.log('✅ DATABASE_URL: Défini');

// 3. VÉRIFIER ALLOWED_ORIGINS en production
if ((process.env.RENDER || process.env.NODE_ENV === 'production') && !process.env.ALLOWED_ORIGINS) {
  console.error('❌ ERREUR CRITIQUE: ALLOWED_ORIGINS non défini en production');
  console.error('   Cela ouvre votre app aux attaques CORS!');
  console.error('   Définissez: ALLOWED_ORIGINS=https://votresite.com,https://app.votresite.com');
  process.exit(1);
}

if (process.env.ALLOWED_ORIGINS) {
  const origins = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
  console.log('✅ CORS Whitelist: ' + origins.join(', '));
}

// 4. VÉRIFIER NODE_ENV
if (!process.env.NODE_ENV) {
  console.warn('⚠️  NODE_ENV non défini, défaut: development');
  process.env.NODE_ENV = 'development';
}
console.log(`✅ NODE_ENV: ${process.env.NODE_ENV}`);

// 5. VÉRIFIER EMAIL_USER et EMAIL_PASS (pour notifications)
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  console.warn('⚠️  EMAIL_USER/PASS non configurés - emails de vérification désactivés');
} else {
  console.log('✅ Email: Configuré');
}

// 6. VÉRIFIER que NODE_ENV n'est pas 'production' en dev
if (process.env.NODE_ENV === 'production' && process.env.RENDER === undefined) {
  console.warn('⚠️  Mode production sans hébergeur Render détecté');
  console.warn('   Assurez-vous que HTTPS est forcé et que tous les secrets sont sécurisés');
}

// 7. VALIDER LES VARIABLES CRITIQUES
const CRITICAL_VARS = [
  'JWT_SECRET',
  'DATABASE_URL'
];

const OPTIONAL_VARS = [
  'EMAIL_USER',
  'EMAIL_PASS',
  'ALLOWED_ORIGINS'
];

console.log('\n📋 Variables d\'environnement:');
console.log(`   Critiques (${CRITICAL_VARS.filter(v => process.env[v]).length}/${CRITICAL_VARS.length}): `, 
  CRITICAL_VARS.map(v => process.env[v] ? '✅' : '❌').join(' '));
console.log(`   Optionnelles (${OPTIONAL_VARS.filter(v => process.env[v]).length}/${OPTIONAL_VARS.length}): `,
  OPTIONAL_VARS.map(v => process.env[v] ? '✅' : '⚠️ ').join(' '));

console.log('\n🚀 Sécurité: OK\n');
