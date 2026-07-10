// server/src/utils.permissions.js
// Helpers pour vérifier les permissions sur les projets

import { query } from '../db.js';

async function isProjectAllowedInCurrentMode(projectId) {
  const project = await query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
  return project.rowCount === 1;
}

/**
 * Vérifier si un utilisateur peut voir un projet
 * - Admin: tous les projets
 * - Responsable: tous les projets
 * - Entreprise: projets où leur company est liée à un lot du projet
 * - Visionneur: seulement les projets partagés avec lui
 */
async function canViewProject(userId, projectId, userRole, userCompanyId = null) {
  if (!(await isProjectAllowedInCurrentMode(projectId))) {
    return false;
  }

  // Admin et responsable peuvent tout voir
  if (['platform_admin', 'tenant_admin', 'responsable'].includes(userRole)) {
    return true;
  }

  // Entreprise: vérifier si leur company est liée à un lot du projet
  if (userRole === 'entreprise' && userCompanyId) {
    const companyLink = await query(
      `SELECT lc.lot_id FROM lot_companies lc
       JOIN lots l ON l.id = lc.lot_id
       WHERE l.project_id = $1 AND lc.company_id = $2
       LIMIT 1`,
      [projectId, userCompanyId]
    );
    return companyLink.rows.length > 0;
  }

  // Visionneur: vérifier si le projet est partagé avec lui
  const share = await query(
    `SELECT id FROM project_shares 
     WHERE project_id = $1 AND shared_with_user_id = $2 AND can_view = true`,
    [projectId, userId]
  );

  return share.rows.length > 0;
}

/**
 * Vérifier si un utilisateur peut éditer un projet
 * - Admin: tous les projets
 * - Responsable: tous les projets
 * - Entreprise: jamais (ne peut qu'éditer ses propres offres via save-grid)
 * - Visionneur: jamais (ou uniquement si partagé avec can_edit=true)
 */
async function canEditProject(userId, projectId, userRole) {
  if (!(await isProjectAllowedInCurrentMode(projectId))) {
    return false;
  }

  // Admin et responsable peuvent tout éditer
  if (['platform_admin', 'tenant_admin', 'responsable'].includes(userRole)) {
    return true;
  }

  // Entreprise ne peut jamais éditer un projet directement
  if (userRole === 'entreprise') {
    return false;
  }

  // Visionneur: vérifier si le projet est partagé avec can_edit
  const share = await query(
    `SELECT id FROM project_shares 
     WHERE project_id = $1 AND shared_with_user_id = $2 AND can_edit = true`,
    [projectId, userId]
  );

  return share.rows.length > 0;
}

/**
 * Vérifier si un utilisateur peut supprimer un projet
 * - Admin: tous les projets
 * - Responsable: seulement les projets qu'il a créés (owner_id)
 * - Visionneur: jamais
 */
async function canDeleteProject(userId, projectId, userRole) {
  if (!(await isProjectAllowedInCurrentMode(projectId))) {
    return false;
  }

  if (userRole === 'platform_admin' || userRole === 'tenant_admin') {
    return true;
  }

  if (userRole === 'responsable') {
    // Vérifier que le responsable est le propriétaire
    const project = await query(
      'SELECT owner_id FROM projects WHERE id = $1',
      [projectId]
    );
    
    if (project.rows.length === 0) return false;
    return project.rows[0].owner_id === userId;
  }

  return false;
}

/**
 * Vérifier si un utilisateur peut partager un projet
 * - Admin: tous les projets
 * - Responsable: tous les projets
 * - Visionneur: jamais
 */
function canShareProject(userRole) {
  return ['platform_admin', 'tenant_admin', 'responsable'].includes(userRole);
}

/**
 * Obtenir la liste des projets visibles pour un utilisateur
 */
async function getVisibleProjects(userId, userRole, userCompanyId = null) {
  // Admin et responsable voient tout
  if (['platform_admin', 'tenant_admin', 'responsable'].includes(userRole)) {
    const result = await query(
      'SELECT p.* FROM projects p ORDER BY p.created_at DESC'
    );
    return result.rows;
  }

  // Entreprise: projets où leur company est liée à un lot
  if (userRole === 'entreprise' && userCompanyId) {
    const result = await query(
      `SELECT DISTINCT p.* FROM projects p
       JOIN lots l ON l.project_id = p.id
       JOIN lot_companies lc ON lc.lot_id = l.id
       WHERE lc.company_id = $1
       ORDER BY p.created_at DESC`,
      [userCompanyId]
    );
    return result.rows;
  }

  // Visionneur: seulement les projets partagés
  const result = await query(
    `SELECT p.* FROM projects p
     INNER JOIN project_shares ps ON p.id = ps.project_id
     WHERE ps.shared_with_user_id = $1 AND ps.can_view = true
     ORDER BY p.created_at DESC`,
    [userId]
  );

  return result.rows;
}

export {
  canViewProject,
  canEditProject,
  canDeleteProject,
  canShareProject,
  getVisibleProjects,
  isProjectAllowedInCurrentMode
};
