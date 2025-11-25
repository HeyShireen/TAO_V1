// Script pour vérifier et corriger les utilisateurs
import 'dotenv/config';
import { query } from '../db.js';

async function checkUsers() {
  try {
    const users = await query('SELECT id, email, role, email_verified FROM users ORDER BY id');
    
    console.log('📋 État des utilisateurs:');
    console.table(users.rows);
    
    // Compter les non vérifiés
    const unverified = users.rows.filter(u => !u.email_verified);
    
    if (unverified.length > 0) {
      console.log(`\n⚠️  ${unverified.length} utilisateur(s) non vérifié(s) détecté(s)`);
      console.log('\n💡 Pour corriger (mettre tous les anciens users à verified=true):');
      console.log('   node src/tools/verify-all-users.js');
    } else {
      console.log('\n✅ Tous les utilisateurs sont vérifiés');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur:', err.message);
    process.exit(1);
  }
}

checkUsers();
