// Script pour réinitialiser la migration 017
import { query } from '../db.js';

async function resetMigration017() {
  try {
    console.log('🔄 Réinitialisation de la migration 017...');
    
    // 1. Supprimer les tables options si elles existent
    console.log('   Suppression des tables options...');
    await query('DROP TABLE IF EXISTS public.option_item_offers CASCADE;');
    await query('DROP TABLE IF EXISTS public.option_item_moe CASCADE;');
    await query('DROP TABLE IF EXISTS public.option_items CASCADE;');
    await query('DROP TABLE IF EXISTS public.options CASCADE;');
    
    // 2. Supprimer la trace de migration
    console.log('   Suppression de la trace de migration...');
    await query(`DELETE FROM public.migrations WHERE name = '017_add_options.sql';`);
    
    console.log('✅ Migration 017 réinitialisée. Redémarrez le serveur pour relancer la migration.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur:', err.message);
    process.exit(1);
  }
}

resetMigration017();
