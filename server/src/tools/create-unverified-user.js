// Script pour créer un utilisateur de test non vérifié
import 'dotenv/config';
import { query } from '../db.js';
import { hashPassword } from '../utils.hash.js';

async function createUnverifiedUser() {
  try {
    const email = 'test-unverified@example.com';
    const password = 'test1234';
    const hashedPassword = await hashPassword(password);
    
    // Supprimer si existe
    await query('DELETE FROM users WHERE email = $1', [email]);
    
    // Créer l'utilisateur non vérifié
    const result = await query(
      'INSERT INTO users (email, password_hash, role, email_verified) VALUES ($1, $2, $3, $4) RETURNING id, email, role, email_verified',
      [email, hashedPassword, 'visionneur', false]
    );
    
    console.log('✅ Utilisateur de test créé:');
    console.table(result.rows);
    console.log('\n🔑 Identifiants:');
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}`);
    console.log('\n💡 Essayez de vous connecter - vous devriez être bloqué!');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur:', err.message);
    process.exit(1);
  }
}

createUnverifiedUser();
