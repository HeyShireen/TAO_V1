// Exécuter la migration 013 sur la base de production
import 'dotenv/config';
import { query } from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration013() {
  console.log('\n=== MIGRATION 013: MODIFY ACCESS REQUESTS ===\n');
  
  try {
    // Lire le fichier de migration
    const migrationPath = path.join(__dirname, '../migrations/013_modify_access_requests_project_name.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📄 Migration chargée depuis:', migrationPath);
    console.log('📝 Exécution...\n');
    
    // Exécuter la migration
    await query(migrationSQL);
    
    console.log('✅ Migration 013 exécutée avec succès !');
    console.log('\n📋 Modifications:');
    console.log('   - Colonne project_name ajoutée (TEXT)');
    console.log('   - project_id devient nullable');
    console.log('   - Visionneurs peuvent écrire le nom du projet librement');
    console.log('   - Responsable/Admin choisit le projet lors de l\'approbation\n');
    
  } catch (error) {
    console.error('❌ ERREUR lors de la migration:', error.message);
    console.error('\nDétails:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

runMigration013();
