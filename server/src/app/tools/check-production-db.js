// Vérifier l'état de la base de données production
import 'dotenv/config';
import { query } from '../db.js';

async function checkProductionDB() {
  console.log('\n=== VÉRIFICATION BASE DE DONNÉES PRODUCTION ===\n');
  
  try {
    // 1. Vérifier la connexion
    console.log('🔌 Test connexion...');
    await query('SELECT NOW()');
    console.log('✅ Connexion OK\n');
    
    // 2. Vérifier les tables principales
    console.log('📋 Tables existantes :');
    const tables = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    tables.rows.forEach(t => console.log(`   - ${t.table_name}`));
    console.log();
    
    // 3. Vérifier colonne email_verified
    console.log('📧 Vérification colonne email_verified...');
    const emailVerifiedCol = await query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'email_verified'
    `);
    
    if (emailVerifiedCol.rows.length === 0) {
      console.log('❌ COLONNE email_verified MANQUANTE !');
      console.log('   → Exécuter: node src/app/tools/run-migration-011.js\n');
    } else {
      console.log('✅ Colonne email_verified existe');
      console.log(`   Type: ${emailVerifiedCol.rows[0].data_type}`);
      console.log(`   Default: ${emailVerifiedCol.rows[0].column_default}\n`);
    }
    
    // 4. Vérifier table email_verifications
    console.log('📧 Vérification table email_verifications...');
    const emailVerifTable = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name = 'email_verifications'
    `);
    
    if (emailVerifTable.rows.length === 0) {
      console.log('❌ TABLE email_verifications MANQUANTE !');
      console.log('   → Exécuter: node src/app/tools/run-migration-011.js\n');
    } else {
      console.log('✅ Table email_verifications existe\n');
    }
    
    // 5. Vérifier table access_requests
    console.log('🔐 Vérification table access_requests...');
    const accessReqTable = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name = 'access_requests'
    `);
    
    if (accessReqTable.rows.length === 0) {
      console.log('❌ TABLE access_requests MANQUANTE !');
      console.log('   → Exécuter: node src/app/tools/run-migration-011.js\n');
    } else {
      console.log('✅ Table access_requests existe\n');
    }
    
    // 6. Compter les utilisateurs
    console.log('👥 Utilisateurs :');
    const users = await query('SELECT id, email, role, email_verified FROM users');
    console.log(`   Total: ${users.rows.length}`);
    users.rows.forEach(u => {
      const verified = u.email_verified !== undefined ? (u.email_verified ? '✅' : '❌') : '❓';
      console.log(`   - ${u.email} (${u.role}) ${verified}`);
    });
    console.log();
    
    // 7. Vérifier variables d'environnement
    console.log('🔧 Variables d\'environnement :');
    console.log(`   NODE_ENV: ${process.env.NODE_ENV || '❌ NON DÉFINI'}`);
    console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? '✅ Défini' : '❌ NON DÉFINI'}`);
    console.log(`   JWT_SECRET: ${process.env.JWT_SECRET ? '✅ Défini' : '❌ NON DÉFINI'}`);
    console.log(`   APP_URL: ${process.env.APP_URL || '❌ NON DÉFINI'}`);
    console.log(`   EMAIL_USER: ${process.env.EMAIL_USER || '❌ NON DÉFINI'}`);
    console.log(`   EMAIL_PASS: ${process.env.EMAIL_PASS ? '✅ Défini' : '❌ NON DÉFINI'}`);
    
  } catch (error) {
    console.error('❌ ERREUR :', error.message);
    process.exit(1);
  }
  
  process.exit(0);
}

checkProductionDB();
