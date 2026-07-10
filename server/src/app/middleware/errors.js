// server/src/middleware.errors.js
// Middleware centralisé de gestion d'erreurs

export class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Ressource') {
    super(`${resource} introuvable`, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Non autorisé') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Accès interdit') {
    super(message, 403);
  }
}

// Middleware global de gestion d'erreurs
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  let { statusCode = 500, message } = err;

  // Erreurs PostgreSQL
  if (err.code === '23505') {
    statusCode = 409;
    message = 'Cette entrée existe déjà';
  } else if (err.code === '23503') {
    statusCode = 400;
    message = 'Référence invalide';
  } else if (err.code === '23502') {
    statusCode = 400;
    message = 'Champ requis manquant';
  }

  // Logs détaillés en développement uniquement
  if (process.env.NODE_ENV !== 'production') {
    console.error('Erreur:', {
      statusCode,
      message: err.message,
      stack: err.stack,
      code: err.code
    });
  } else {
    // En production, logger sans exposer les détails
    console.error(`[${statusCode}] ${message}`);
  }

  // Ne pas exposer les détails techniques en production
  const response = {
    error: statusCode < 500 || err.isOperational 
      ? message 
      : 'Une erreur interne est survenue'
  };

  // Ajouter la stack trace en développement
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

// Wrapper pour les routes async (évite les try/catch répétitifs)
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
