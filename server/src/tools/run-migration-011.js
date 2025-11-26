// Exécuter la migration 011 sur la base de production
import 'dotenv/config';
import { query } from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration011() {
  console.log('\n=== MIGRATION 011: EMAIL VERIFICATION ===\n');
  
  try {
    // Lire le fichier de migration
    const migrationPath = path.join(__dirname, '../migrations/011_add_email_verification.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📄 Migration chargée depuis:', migrationPath);
    console.log('📝 Contenu:\n');
    console.log(migrationSQL);
    console.log('\n⚠️  Êtes-vous sûr de vouloir exécuter cette migration ?');
    console.log('   Elle modifiera la base de données de production.\n');
    
    // Exécuter la migration
    console.log('🔧 Exécution de la migration...\n');
    await query(migrationSQL);
    
    console.log('✅ Migration 011 exécutée avec succès !');
    console.log('\n📋 Prochaines étapes:');
    console.log('   1. Vérifier avec: node src/tools/check-production-db.js');
    console.log('   2. Mettre à jour tous les users: node src/tools/verify-all-users.js');
    console.log('   3. Redémarrer le serveur Render\n');
    
  } catch (error) {
    console.error('❌ ERREUR lors de la migration:', error.message);
    console.error('\nDétails:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

runMigration011();
