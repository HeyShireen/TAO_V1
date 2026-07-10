// Le seed est idempotent et reconstruit l'intégralité du tenant DEMO dans
// une transaction protégée par verrou. Cette entrée explicite est utilisée
// par la tâche planifiée quotidienne.
await import('./seed-demo.js')

