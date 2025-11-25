// Script pour activer l'admin et vérifier son état
import 'dotenv/config';
import { query } from '../db.js';

async function fixAdmin() {
  try {
    // Vérifier l'état actuel
    const check = await query('SELECT id, email, role, email_verified FROM users WHERE role = $1', ['admin']);
    
    if (check.rows.length === 0) {
      console.log('❌ Aucun admin trouvé');
      process.exit(1);
    }
    
    console.log('📋 Admin actuel:');
    console.table(check.rows);
    
    // Activer l'email si nécessaire
    if (!check.rows[0].email_verified) {
      await query('UPDATE users SET email_verified = true WHERE role = $1', ['admin']);
      console.log('✅ email_verified mis à true');
    } else {
      console.log('✅ Email déjà vérifié');
    }
    
    console.log('\n🔑 Identifiants de connexion:');
    console.log('   Email: admin@example.com');
    console.log('   Password: Admin123!');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur:', err.message);
    process.exit(1);
  }
}

fixAdmin();
