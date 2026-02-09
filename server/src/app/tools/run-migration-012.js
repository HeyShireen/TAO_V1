// Exécuter la migration 012 sur la base de production
import 'dotenv/config';
import { query } from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration012() {
  console.log('\n=== MIGRATION 012: PASSWORD RESET ===\n');
  
  try {
    // Lire le fichier de migration
    const migrationPath = path.join(__dirname, '../migrations/012_add_password_reset.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📄 Migration chargée depuis:', migrationPath);
    console.log('📝 Exécution...\n');
    
    // Exécuter la migration
    await query(migrationSQL);
    
    console.log('✅ Migration 012 exécutée avec succès !');
    console.log('\n📋 Nouvelle table créée:');
    console.log('   - password_resets (tokens de réinitialisation)');
    console.log('\n🔐 Nouvelles routes disponibles:');
    console.log('   - POST /api/auth/forgot-password (demande de reset)');
    console.log('   - GET  /api/auth/reset-password/:token (formulaire)');
    console.log('   - POST /api/auth/reset-password/:token (nouveau mdp)\n');
    
  } catch (error) {
    console.error('❌ ERREUR lors de la migration:', error.message);
    console.error('\nDétails:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

runMigration012();
