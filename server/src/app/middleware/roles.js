// server/src/middleware.roles.js
// Middleware pour gérer les rôles et permissions

const ROLES = {
  ADMIN: 'admin',
  RESPONSABLE: 'responsable',
  VISIONNEUR: 'visionneur'
};

// Hiérarchie des rôles (admin > responsable > visionneur)
const ROLE_HIERARCHY = {
  admin: 3,
  responsable: 2,
  visionneur: 1
};

/**
 * Middleware pour vérifier le rôle de l'utilisateur
 * @param {string|string[]} allowedRoles - Rôle(s) autorisé(s)
 * @returns {Function} Middleware Express
 */
function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentification requise' });
    }

    const userRole = req.user.role || 'visionneur';
    
    // Vérifier si le rôle de l'utilisateur est dans la liste autorisée
    if (roles.includes(userRole)) {
      return next();
    }

    return res.status(403).json({ 
      error: 'Accès refusé - Permissions insuffisantes',
      required: roles,
      current: userRole
    });
  };
}

/**
 * Vérifier si un utilisateur a au moins un certain niveau de rôle
 * @param {string} userRole - Rôle de l'utilisateur
 * @param {string} minimumRole - Rôle minimum requis
 * @returns {boolean}
 */
function hasRoleLevel(userRole, minimumRole) {
  const userLevel = ROLE_HIERARCHY[userRole] || 0;
  const requiredLevel = ROLE_HIERARCHY[minimumRole] || 0;
  return userLevel >= requiredLevel;
}

/**
 * Vérifier si l'utilisateur est admin
 */
function isAdmin(req, res, next) {
  return requireRole(ROLES.ADMIN)(req, res, next);
}

/**
 * Vérifier si l'utilisateur est au moins responsable
 */
function isResponsableOrAdmin(req, res, next) {
  return requireRole([ROLES.ADMIN, ROLES.RESPONSABLE])(req, res, next);
}

export {
  ROLES,
  requireRole,
  hasRoleLevel,
  isAdmin,
  isResponsableOrAdmin
};
