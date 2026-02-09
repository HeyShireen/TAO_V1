// Script pour changer le mot de passe admin
import 'dotenv/config';
import { query } from '../db.js';
import { hashPassword } from '../utils/hash.js';

async function changeAdminPassword() {
  try {
    const newPassword = process.argv[2] || 'Admin123!';
    
    // Hasher le nouveau mot de passe
    const hashedPassword = await hashPassword(newPassword);
    
    // Mettre à jour le mot de passe admin
    const result = await query(
      'UPDATE users SET password_hash = $1 WHERE role = $2 RETURNING email',
      [hashedPassword, 'admin']
    );
    
    if (result.rows.length > 0) {
      console.log('✅ Mot de passe admin changé pour:', result.rows[0].email);
      console.log('ℹ️  Nouveau mot de passe:', newPassword);
    } else {
      console.log('❌ Aucun admin trouvé dans la base.');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur:', err.message);
    process.exit(1);
  }
}

changeAdminPassword();
