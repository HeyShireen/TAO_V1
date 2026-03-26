// ecosystem.config.cjs — Configuration PM2
// Usage : pm2 start ecosystem.config.cjs
// Docs  : https://pm2.keymetrics.io/docs/usage/application-declaration/

module.exports = {
  apps: [
    // ──────────────────────────────────────────────────────────────────────────
    // Application principale TAO
    // ──────────────────────────────────────────────────────────────────────────
    {
      name: 'tao-app',
      script: 'src/app/server.js',
      cwd: '/home/tao/TAO/TAO_V1/server/',
      interpreter: 'node',
      instances: 1,         // Augmenter si plusieurs CPU disponibles
      exec_mode: 'fork',    // Passer à 'cluster' si instances > 1
      autorestart: true,
      watch: false,         // Ne pas utiliser watch en production
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Les autres variables sont dans /home/tao/TAO/TAO_V1/server/.env
      },
      // Logs
      out_file: '/var/log/tao-app.log',
      error_file: '/var/log/tao-app-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // Serveur webhook de déploiement
    // ──────────────────────────────────────────────────────────────────────────
    {
      name: 'tao-webhook',
      script: 'webhook.js',
      cwd: '/home/tao/TAO/TAO_V1/server/',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '128M',
      env: {
        NODE_ENV: 'production',
        WEBHOOK_PORT: 9000,
        WEBHOOK_SECRET: '',   // ← À remplir ou charger depuis .env.webhook
        WEBHOOK_BRANCH: 'main',
        DEPLOY_SCRIPT: '/home/tao/TAO/TAO_V1/server/deploy.sh',
      },
      out_file: '/var/log/tao-webhook.log',
      error_file: '/var/log/tao-webhook-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
