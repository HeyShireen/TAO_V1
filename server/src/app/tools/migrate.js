import 'dotenv/config'
import { migrateSchema } from '../db.js'

try {
  await migrateSchema()
  process.exitCode = 0
} catch (error) {
  console.error('Migration interrompue:', error)
  process.exitCode = 1
}

