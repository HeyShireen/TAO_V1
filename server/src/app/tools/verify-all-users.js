// Mettre email_verified=true pour tous les utilisateurs existants
import 'dotenv/config';
import { query } from '../db.js';

async function verifyAllUsers() {
  console.log('\n=== VÉRIFICATION DE TOUS LES UTILISATEURS ===\n');
  
  try {
    // Lister les users actuels
    const users = await query('SELECT id, email, role, email_verified FROM users');
    console.log(`📊 Utilisateurs trouvés: ${users.rows.length}\n`);
    
    if (users.rows.length === 0) {
      console.log('ℹ️  Aucun utilisateur à vérifier.');
      process.exit(0);
    }
    
    users.rows.forEach(u => {
      const status = u.email_verified ? '✅ Déjà vérifié' : '❌ Non vérifié';
      console.log(`   ${u.email} (${u.role}) - ${status}`);
    });
    
    // Compter ceux qui ne sont pas vérifiés
    const unverified = users.rows.filter(u => !u.email_verified);
    
    if (unverified.length === 0) {
      console.log('\n✅ Tous les utilisateurs sont déjà vérifiés !');
      process.exit(0);
    }
    
    console.log(`\n🔧 Mise à jour de ${unverified.length} utilisateur(s)...\n`);
    
    // Mettre à jour tous les users existants
    const result = await query(`
      UPDATE users 
      SET email_verified = true 
      WHERE email_verified = false OR email_verified IS NULL
      RETURNING id, email, role
    `);
    
    console.log(`✅ ${result.rows.length} utilisateur(s) mis à jour :\n`);
    result.rows.forEach(u => {
      console.log(`   ✓ ${u.email} (${u.role})`);
    });
    
    console.log('\n🎉 Tous les utilisateurs existants peuvent maintenant se connecter !');
    
  } catch (error) {
    console.error('❌ ERREUR:', error.message);
    process.exit(1);
  }
  
  process.exit(0);
}

verifyAllUsers();
