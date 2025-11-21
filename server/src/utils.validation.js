// server/src/utils.validation.js
// Utilitaires de validation centralisés

export function validateRequired(value, fieldName) {
  if (!value || (typeof value === 'string' && value.trim().length === 0)) {
    throw new Error(`${fieldName} est requis`);
  }
}

export function validateMaxLength(value, maxLength, fieldName) {
  if (value && value.length > maxLength) {
    throw new Error(`${fieldName} est trop long (max ${maxLength} caractères)`);
  }
}

export function validateNumber(value, fieldName) {
  if (value !== null && value !== undefined && value !== '') {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new Error(`${fieldName} doit être un nombre valide`);
    }
    return num;
  }
  return null;
}

export function validatePositiveNumber(value, fieldName) {
  const num = validateNumber(value, fieldName);
  if (num !== null && num < 0) {
    throw new Error(`${fieldName} doit être positif`);
  }
  return num;
}

export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Email invalide');
  }
}

export function sanitizeString(value) {
  if (typeof value !== 'string') return value;
  return value.trim();
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}
