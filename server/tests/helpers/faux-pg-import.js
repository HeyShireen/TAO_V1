/**
 * Double de connexion PostgreSQL pour les tests d'import
 * (import-offer.test.js, import-dpgf.test.js).
 *
 * `runImportWithRows` accepte une connexion injectee : on lui passe cet objet,
 * qui joue les requetes SQL de l'import et enregistre ce qui serait ecrit. Aucun
 * acces a la base n'a lieu.
 *
 * REGLE IMPORTANTE : toute requete inconnue leve une erreur. Si une
 * modification de l'import ajoute une requete, les tests echouent
 * explicitement au lieu de valider un comportement non verifie. Il faut alors
 * declarer la nouvelle requete ici, en decidant ce qu'elle doit renvoyer.
 *
 * Ce fichier n'est pas un test : `npm test` ne charge que `tests/*.test.js`.
 */

/**
 * @param {Object} options
 * @param {Object[]} options.articles - Articles DPGF deja en base pour le lot
 * @param {Object[]} options.entreprises - Lignes de `companies` existantes
 * @param {string|null} options.modeleEcart - Modele de commentaire « montant incoherent »
 * @param {number} options.offresExistantes - rowCount simule de la purge des offres
 * @param {number|null} options.tourExistant - Tour renvoye a `resolveRoundIdForLot`
 */
export function creerDoubleConnexion({
  articles = [],
  entreprises = [],
  modeleEcart = null,
  offresExistantes = 0,
  tourExistant = null,
} = {}) {
  const etat = {
    requetes: [],
    entreprises: entreprises.map((e) => ({ ...e })),
    articles: articles.map((a) => ({ ...a })),
    offres: [],             // offres ecrites (upsert emule)
    articlesAjoutes: [],    // postes ajoutes par une entreprise
    articlesCrees: [],      // articles DPGF crees (mode dpgf)
    articlesMisAJour: [],   // articles DPGF mis a jour (mode dpgf update)
    moe: [],                // lignes moe_items ecrites
    suppressionsOffres: 0,
    suppressionsArticles: 0,
    liberee: false,
    prochainIdEntreprise: 501,
    prochainIdArticle: 901,
  };

  const client = {
    async query(texte, params = []) {
      const sql = String(texte).replace(/\s+/g, ' ').trim();
      etat.requetes.push(sql);

      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) return { rows: [], rowCount: 0 };

      /* ---------- Entreprise ---------- */
      if (sql.startsWith('SELECT id FROM companies WHERE lower(name)')) {
        const cherche = String(params[0] ?? '').toLowerCase();
        const trouvee = etat.entreprises.find((e) => String(e.name).toLowerCase() === cherche);
        return { rows: trouvee ? [{ id: trouvee.id }] : [], rowCount: trouvee ? 1 : 0 };
      }
      if (sql.startsWith('INSERT INTO companies')) {
        const creee = { id: etat.prochainIdEntreprise++, name: params[0] };
        etat.entreprises.push(creee);
        return { rows: [{ id: creee.id }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO lot_companies')) return { rows: [], rowCount: 1 };

      /* ---------- Lecture des articles ---------- */
      if (sql.startsWith('SELECT COUNT(*) FROM items WHERE lot_id')) {
        const total = etat.articles.filter((a) => a.sourceCompanyId == null).length;
        return { rows: [{ count: String(total) }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT id, num, designation, unit, position FROM items')
        || sql.startsWith('SELECT id, num, designation, position FROM items')) {
        const lignes = etat.articles
          .filter((a) => a.sourceCompanyId == null)
          .map((a) => ({ ...a }));
        return { rows: lignes, rowCount: lignes.length };
      }
      // Rapprochement des postes ajoutes avec la DPGF (reconcileAddedItemsWithDpgf)
      if (sql.startsWith('SELECT id, num, designation FROM items WHERE lot_id') && sql.includes('IS NULL')) {
        const ids = new Set((params[1] || []).map(Number));
        const lignes = etat.articles
          .filter((a) => a.sourceCompanyId == null && ids.has(Number(a.id)))
          .map(({ id, num, designation }) => ({ id, num, designation }));
        return { rows: lignes, rowCount: lignes.length };
      }
      if (sql.startsWith('SELECT id, num, designation, source_company_id FROM items')) {
        const lignes = etat.articles
          .filter((a) => a.sourceCompanyId != null)
          .map(({ id, num, designation, sourceCompanyId }) => ({ id, num, designation, source_company_id: sourceCompanyId }));
        return { rows: lignes, rowCount: lignes.length };
      }

      /* ---------- Configuration projet / lot ---------- */
      if (sql.startsWith('SELECT CASE')) {
        return { rows: [{ offer_amount_mismatch_comment: modeleEcart }], rowCount: 1 };
      }
      if (sql.includes('FROM rounds') || sql.includes('FROM round_lots')) {
        return { rows: tourExistant ? [{ id: tourExistant }] : [], rowCount: tourExistant ? 1 : 0 };
      }

      /* ---------- Purges ---------- */
      if (sql.startsWith('DELETE FROM offers o USING items i')) {
        etat.suppressionsOffres += 1;
        etat.offres = [];
        return { rows: [], rowCount: offresExistantes };
      }
      if (sql.startsWith('DELETE FROM items')) {
        etat.suppressionsArticles += 1;
        return { rows: [], rowCount: 0 };
      }

      /* ---------- Ecritures articles ---------- */
      if (sql.startsWith('SELECT COALESCE(MAX(position), 0)')) {
        const max = etat.articles.reduce((m, a) => Math.max(m, Number(a.position || 0)), 0);
        return { rows: [{ max_pos: max }], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE items SET num')) {
        const maj = { id: params[0], num: params[1], designation: params[2], unit: params[3], position: params[4] };
        etat.articlesMisAJour.push(maj);
        const existant = etat.articles.find((a) => Number(a.id) === Number(maj.id));
        if (existant) Object.assign(existant, { num: maj.num ?? existant.num, designation: maj.designation || existant.designation, position: maj.position });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO items')) {
        // Deux formes : article DPGF (5 parametres) et poste ajoute (7).
        const estPosteAjoute = params.length > 5;
        const cree = {
          id: etat.prochainIdArticle++,
          lotId: params[0],
          num: params[1],
          designation: params[2],
          unit: params[3],
          position: params[4],
          sourceCompanyId: estPosteAjoute ? params[5] : null,
          parentItemId: estPosteAjoute ? params[6] : null,
        };
        if (estPosteAjoute) etat.articlesAjoutes.push(cree);
        else etat.articlesCrees.push(cree);
        etat.articles.push({ ...cree });
        return { rows: [{ id: cree.id }], rowCount: 1 };
      }

      /* ---------- Ecritures valeurs ---------- */
      if (sql.startsWith('INSERT INTO moe_items')) {
        const ligne = { itemId: params[0], qty: params[1], pu: params[2], montant: params[3], commentaire: params[4] };
        const index = etat.moe.findIndex((m) => m.itemId === ligne.itemId);
        if (index >= 0) etat.moe[index] = ligne;
        else etat.moe.push(ligne);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO offers')) {
        const offre = {
          itemId: params[0],
          companyId: params[1],
          roundId: params[2],
          unit: params[3],
          qty: params[4],
          pu: params[5],
          montant: params[6],
          commentaire: params[7],
          designationEntreprise: params.length > 8 ? params[8] : null,
        };
        // ON CONFLICT (item_id, company_id, round_id) DO UPDATE
        const index = etat.offres.findIndex(
          (o) => o.itemId === offre.itemId && o.companyId === offre.companyId && o.roundId === offre.roundId
        );
        if (index >= 0) etat.offres[index] = offre;
        else etat.offres.push(offre);
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Requete non prevue par le double de test : ${sql}`);
    },
    release() { etat.liberee = true; },
  };

  return { client, etat };
}

/** Mapping de colonnes utilise par les tests d'import. */
export const MAPPING = { num: 1, designation: 2, unit: 3, qty: 4, unit_price: 5, amount: 6 };

/** Une ligne de fichier telle que l'etape apply la fabrique (clefs = colonnes). */
export function ligne({ num = null, designation = null, unit = null, qty = null, pu = null, montant = null, rowNum = null } = {}) {
  const row = { 1: num, 2: designation, 3: unit, 4: qty, 5: pu, 6: montant };
  if (rowNum != null) row._rowNum = rowNum;
  return row;
}
