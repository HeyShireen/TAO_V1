// Script pour réinitialiser le compte admin
import 'dotenv/config';
import { query } from '../db.js';

async function resetAdmin() {
  try {
    // Supprimer tous les admins
    const result = await query('DELETE FROM users WHERE role = $1 RETURNING email', ['admin']);
    
    if (result.rows.length > 0) {
      console.log('✅ Admin supprimé:', result.rows.map(r => r.email).join(', '));
      console.log('ℹ️  Redémarrez le serveur pour créer un nouvel admin avec les credentials du .env:');
      console.log(`   Email: ${process.env.ADMIN_EMAIL}`);
      console.log(`   Password: ${process.env.ADMIN_PASSWORD}`);
    } else {
      console.log('ℹ️  Aucun admin trouvé dans la base.');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur:', err.message);
    process.exit(1);
  }
}

resetAdmin();
