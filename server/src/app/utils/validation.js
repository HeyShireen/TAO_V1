// server/src/utils.validation.js
// Utilitaires de validation centralisés

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

export function validateRequired(value, fieldName) {
  if (!value || (typeof value === 'string' && value.trim().length === 0)) {
    throw new ValidationError(`${fieldName} est requis`);
  }
}

export function validateMaxLength(value, maxLength, fieldName) {
  if (value && value.length > maxLength) {
    throw new ValidationError(`${fieldName} est trop long (max ${maxLength} caractères)`);
  }
}

export function validateNumber(value, fieldName) {
  if (value !== null && value !== undefined && value !== '') {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new ValidationError(`${fieldName} doit être un nombre valide`);
    }
    return num;
  }
  return null;
}

export function validatePositiveNumber(value, fieldName) {
  const num = validateNumber(value, fieldName);
  if (num !== null && num < 0) {
    throw new ValidationError(`${fieldName} doit être positif`);
  }
  return num;
}

export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new ValidationError('Email invalide');
  }
}

export function sanitizeString(value) {
  if (typeof value !== 'string') return value;
  return value.trim();
}

export function validatePassword(password) {
  // SÉCURITÉ: Minimum 12 caractères (NIST 2023 guidelines)
  if (!password || password.length < 12) {
    throw new ValidationError('Le mot de passe doit contenir au minimum 12 caractères');
  }
  
  if (password.length > 128) {
    throw new ValidationError('Le mot de passe est trop long (max 128 caractères)');
  }
  
  // Vérifier la présence d'au moins une majuscule
  if (!/[A-Z]/.test(password)) {
    throw new ValidationError('Le mot de passe doit contenir au moins une lettre majuscule');
  }
  
  // Vérifier la présence d'au moins un chiffre
  if (!/[0-9]/.test(password)) {
    throw new ValidationError('Le mot de passe doit contenir au moins un chiffre');
  }
  
  // Vérifier la présence d'au moins un caractère spécial
  if (!/[!@#$%^&*()_+\-=\[\]{};':",./<>?]/.test(password)) {
    throw new ValidationError('Le mot de passe doit contenir au moins un caractère spécial (!@#$%^&*...)');
  }
  
  return true;
}
