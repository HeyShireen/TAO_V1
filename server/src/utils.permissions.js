// server/src/utils.permissions.js
// Helpers pour vérifier les permissions sur les projets

import { query } from './db.js';

/**
 * Vérifier si un utilisateur peut voir un projet
 * - Admin: tous les projets
 * - Responsable: tous les projets
 * - Visionneur: seulement les projets partagés avec lui
 */
async function canViewProject(userId, projectId, userRole) {
  // Admin et responsable peuvent tout voir
  if (userRole === 'admin' || userRole === 'responsable') {
    return true;
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
 * - Visionneur: jamais (ou uniquement si partagé avec can_edit=true)
 */
async function canEditProject(userId, projectId, userRole) {
  // Admin et responsable peuvent tout éditer
  if (userRole === 'admin' || userRole === 'responsable') {
    return true;
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
  if (userRole === 'admin') {
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
  return userRole === 'admin' || userRole === 'responsable';
}

/**
 * Obtenir la liste des projets visibles pour un utilisateur
 */
async function getVisibleProjects(userId, userRole) {
  // Admin et responsable voient tout
  if (userRole === 'admin' || userRole === 'responsable') {
    const result = await query(
      'SELECT * FROM projects ORDER BY created_at DESC'
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
  getVisibleProjects
};
