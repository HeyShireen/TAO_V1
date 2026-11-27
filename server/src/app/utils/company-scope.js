/**
 * Restriction « entreprise » : source unique de vérité.
 *
 * Le rôle `entreprise` ne doit voir que les données de SA société, et jamais les
 * données MOE. Jusqu'ici ce contrôle était recopié à la main dans chaque
 * handler (`const isEntreprise = req.user?.role === 'entreprise'`, puis un
 * filtre `company_id` écrit au cas par cas, parfois interpolé dans la requête
 * SQL). Chaque nouvelle route devait refaire la gymnastique, et un oubli ne
 * produit aucune erreur : juste une fuite de données entre entreprises.
 *
 * Ce module centralise la décision et fournit un fragment SQL sûr.
 */

const ENTREPRISE_ROLE = 'entreprise';

/**
 * Décrit la restriction applicable à la requête courante.
 *
 * @param {{user?: {role?: string, company_id?: number|string|null}}} req
 * @returns {{
 *   isEntreprise: boolean,
 *   companyId: number|null,
 *   restricted: boolean,
 *   orphan: boolean,
 *   allows: (candidateId: unknown) => boolean,
 *   sqlAnd: (column: string) => string,
 * }}
 */
export function companyScope(req) {
  const isEntreprise = req?.user?.role === ENTREPRISE_ROLE;
  const companyId = normalizeCompanyId(req?.user?.company_id);

  // `restricted` : il faut filtrer ET on dispose d'un identifiant exploitable.
  const restricted = isEntreprise && companyId !== null;
  // `orphan` : compte entreprise sans société rattachée. Cas anormal qui doit
  // mener a un refus explicite, jamais a un accès non filtré.
  const orphan = isEntreprise && companyId === null;

  return {
    isEntreprise,
    companyId,
    restricted,
    orphan,

    /** L'utilisateur a-t-il le droit de voir cette entreprise ? */
    allows(candidateId) {
      if (!isEntreprise) return true;
      if (companyId === null) return false;
      return normalizeCompanyId(candidateId) === companyId;
    },

    /**
     * Fragment SQL `AND <column> = <id>` ou chaîne vide.
     *
     * L'identifiant est un entier déjà validé, jamais du texte issu de la
     * requête HTTP : l'interpolation est donc sûre. Le nom de colonne est
     * également validé, pour qu'un appel maladroit échoue bruyamment au lieu de
     * composer du SQL arbitraire.
     */
    sqlAnd(column) {
      if (!restricted) return '';
      assertSqlColumn(column);
      return ` AND ${column} = ${companyId}`;
    },

    /**
     * Variante pour une colonne où NULL signifie « ne rattache la ligne à
     * aucune entreprise, donc visible par toutes ».
     *
     * Cas type : `items.source_company_id` — NULL pour un article de la DPGF,
     * renseigné pour un poste ajouté par une entreprise. Une entreprise voit
     * les articles DPGF et ses propres postes, pas ceux des concurrents.
     */
    sqlAndOwnOrShared(column) {
      if (!restricted) return '';
      assertSqlColumn(column);
      return ` AND (${column} IS NULL OR ${column} = ${companyId})`;
    },
  };
}

/** Normalise un identifiant d'entreprise en entier positif, sinon null. */
export function normalizeCompanyId(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * N'autorise qu'une référence de colonne simple (`o.company_id`, `company_id`).
 * Empêche qu'un nom de colonne construit dynamiquement serve de vecteur
 * d'injection.
 */
export function assertSqlColumn(column) {
  if (typeof column !== 'string' || !/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i.test(column)) {
    throw new Error(`Nom de colonne SQL invalide: ${String(column)}`);
  }
  return column;
}
