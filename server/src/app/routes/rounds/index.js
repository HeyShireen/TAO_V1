// server/src/routes/rounds.js
import express from 'express';
import { query, pool } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { isResponsableOrAdmin } from '../../middleware/roles.js';
import { canViewProject, canEditProject } from '../../utils/permissions.js';
import { validateRequired, validateNumber, ValidationError } from '../../utils/validation.js';
import { companyScope } from '../../utils/company-scope.js';

const router = express.Router();

router.use(requireAuth);

// Lister les tours d'un projet
router.get('/project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    // SÉCURITÉ: Vérifier accès au projet
    const canView = await canViewProject(req.user.id, projectId, req.user.role, req.user.company_id || null);
    if (!canView) return res.status(403).json({ error: 'Accès refusé' });
    
    const result = await query(
      'SELECT * FROM rounds WHERE project_id = $1 ORDER BY round_number ASC',
      [projectId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur récupération tours:', err);
    res.status(500).json({ error: 'Impossible de récupérer les tours' });
  }
});

// Réordonner les tours d'un projet (maj des round_number)
router.post('/project/:projectId/order', isResponsableOrAdmin, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { order } = req.body || {};

    // SÉCURITÉ: Vérifier accès en écriture
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });

    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'Payload invalid: order[] requis' });
    }

    // Récupérer les tours existants
    const roundsRes = await query('SELECT id FROM rounds WHERE project_id = $1 ORDER BY round_number ASC, id ASC', [projectId]);
    const roundIds = roundsRes.rows.map(r => Number(r.id));

    // Filtrer les IDs au sein du projet et compléter les manquants
    const filtered = order.map(n => Number(n)).filter(n => Number.isFinite(n) && roundIds.includes(n));
    const missing = roundIds.filter(id => !filtered.includes(id));
    const finalOrder = [...filtered, ...missing];

    // Le nouvel ordre s'applique en deux passes, chacune en UNE requête au lieu
    // d'une par tour. La passe par numéros négatifs reste nécessaire : la
    // contrainte d'unicité (project_id, round_number) interdit de permuter deux
    // numéros directement.
    const orderedIds = finalOrder.map(Number).filter(Number.isFinite);
    const positions = orderedIds.map((_, i) => i);

    if (orderedIds.length > 0) {
      await query(
        `UPDATE rounds AS r
            SET round_number = -(d.ord + 1)
           FROM unnest($1::int[], $2::int[]) AS d(id, ord)
          WHERE r.id = d.id AND r.project_id = $3`,
        [orderedIds, positions, projectId]
      );
      await query(
        `UPDATE rounds AS r
            SET round_number = d.ord
           FROM unnest($1::int[], $2::int[]) AS d(id, ord)
          WHERE r.id = d.id AND r.project_id = $3`,
        [orderedIds, positions, projectId]
      );
    }

    res.json({ ok: true, order: finalOrder });
  } catch (err) {
    console.error('Erreur réordonnancement tours:', err);
    res.status(500).json({ error: 'Impossible de réordonner les tours' });
  }
});

// Lister les tours d'un projet avec statistiques agrégées (évite N requêtes côté client)
router.get('/project/:projectId/with-stats', async (req, res) => {
  try {
    const { projectId } = req.params;

    // SÉCURITÉ: Vérifier accès au projet
    const canView = await canViewProject(req.user.id, projectId, req.user.role, req.user.company_id || null);
    if (!canView) return res.status(403).json({ error: 'Accès refusé' });

    // Récupérer tous les tours du projet
    const roundsResult = await query(
      'SELECT * FROM rounds WHERE project_id = $1 ORDER BY round_number ASC',
      [projectId]
    );
    const rounds = roundsResult.rows;

    if (rounds.length === 0) {
      return res.json([]);
    }

    // Pré-calcul des counts communs (items, moe) au niveau projet
    let itemsCount = 0;
    let moeCount = 0;
    try {
      const itemsRes = await query(
        `SELECT COUNT(DISTINCT i.id) as count
         FROM items i
         JOIN lots l ON l.id = i.lot_id
         WHERE l.project_id = $1`,
        [projectId]
      );
      itemsCount = parseInt(itemsRes.rows[0]?.count || 0);
    } catch (e) { console.error('Items count error:', e.message); }
    try {
      const moeRes = await query(
        `SELECT COUNT(DISTINCT m.item_id) as count
         FROM moe_items m
         JOIN items i ON i.id = m.item_id
         JOIN lots l ON l.id = i.lot_id
         WHERE l.project_id = $1`,
        [projectId]
      );
      moeCount = parseInt(moeRes.rows[0]?.count || 0);
    } catch (e) { console.error('MOE count error:', e.message); }

    // Offres + entreprises + questions, agrégés pour TOUS les tours à la fois.
    //
    // C'était auparavant deux requêtes par tour dans une boucle séquentielle.
    // À ~17 ms de latence vers la base, un projet à plusieurs tours payait ce
    // coût à chaque affichage de la liste. Deux GROUP BY suffisent, quel que
    // soit le nombre de tours.
    const roundIds = rounds.map(r => Number(r.id)).filter(Number.isFinite);

    const offersByRound = new Map();
    const questionsByRound = new Map();

    if (roundIds.length > 0) {
      try {
        const offRes = await query(
          `SELECT round_id,
                  COUNT(*) AS total,
                  COUNT(DISTINCT company_id) AS companies
             FROM offers
            WHERE round_id = ANY($1::int[])
            GROUP BY round_id`,
          [roundIds]
        );
        for (const row of offRes.rows) {
          offersByRound.set(Number(row.round_id), {
            total: parseInt(row.total || 0, 10),
            companies: parseInt(row.companies || 0, 10),
          });
        }
      } catch (e) { console.error('Offers count error:', e.message); }

      try {
        const qRes = await query(
          `SELECT round_id,
                  COUNT(*) AS total,
                  COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending,
                  COUNT(CASE WHEN status IN ('answered', 'validated') THEN 1 END) AS answered
             FROM generated_questions
            WHERE round_id = ANY($1::int[])
            GROUP BY round_id`,
          [roundIds]
        );
        for (const row of qRes.rows) {
          questionsByRound.set(Number(row.round_id), {
            total: parseInt(row.total || 0, 10),
            pending: parseInt(row.pending || 0, 10),
            answered: parseInt(row.answered || 0, 10),
          });
        }
      } catch (e) { /* silencieux si table absente */ }
    }

    // Un tour sans offre ni question n'apparaît pas dans les agrégats : on
    // retombe alors sur des compteurs à zéro, comme avant.
    const enriched = rounds.map(r => {
      const off = offersByRound.get(Number(r.id)) || { total: 0, companies: 0 };
      const q = questionsByRound.get(Number(r.id)) || { total: 0, pending: 0, answered: 0 };
      return {
        ...r,
        stats: {
          total_items: itemsCount,
          moe_items: moeCount,
          total_offers: off.total,
          companies_count: off.companies,
          total_questions: q.total,
          pending_questions: q.pending,
          answered_questions: q.answered,
        }
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error('Erreur récupération tours avec stats:', err);
    res.status(500).json({ error: 'Impossible de récupérer les tours avec stats' });
  }
});

// Créer un nouveau tour pour un projet
router.post('/project/:projectId', isResponsableOrAdmin, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { name, description } = req.body;
    
    // SÉCURITÉ: Vérifier accès en écriture
    const canEdit = await canEditProject(req.user.id, projectId, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });
    
    validateRequired(name, 'Le nom du tour');
    
    // Trouver le prochain numéro de tour
    const maxResult = await query(
      'SELECT COALESCE(MAX(round_number), -1) + 1 as next_number FROM rounds WHERE project_id = $1',
      [projectId]
    );
    const roundNumber = maxResult.rows[0].next_number;
    
    const result = await query(
      `INSERT INTO rounds (project_id, round_number, name, description, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING *`,
      [projectId, roundNumber, name, description]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur création tour:', err);
    const statusCode = err instanceof ValidationError ? 400 : 500;
    res.status(statusCode).json({ error: err.message || 'Impossible de créer le tour' });
  }
});

// Mettre à jour un tour
router.put('/:roundId', isResponsableOrAdmin, async (req, res) => {
  try {
    const { roundId } = req.params;
    const { name, description, status } = req.body;
    
    // SÉCURITÉ: Vérifier accès en écriture
    const roundRes = await query('SELECT project_id FROM rounds WHERE id = $1', [roundId]);
    if (roundRes.rowCount === 0) return res.status(404).json({ error: 'Tour introuvable' });
    const canEdit = await canEditProject(req.user.id, roundRes.rows[0].project_id, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });
    
    const result = await query(
      `UPDATE rounds 
       SET name = $1, description = $2, status = $3
       WHERE id = $4
       RETURNING *`,
      [name, description, status, roundId]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Tour introuvable' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur mise à jour tour:', err);
    res.status(500).json({ error: 'Impossible de mettre à jour le tour' });
  }
});

// Supprimer un tour
router.delete('/:roundId', isResponsableOrAdmin, async (req, res) => {
  try {
    const { roundId } = req.params;
    
    // SÉCURITÉ: Vérifier accès en écriture
    const roundRes = await query('SELECT project_id FROM rounds WHERE id = $1', [roundId]);
    if (roundRes.rowCount === 0) return res.status(404).json({ error: 'Tour introuvable' });
    const canEdit = await canEditProject(req.user.id, roundRes.rows[0].project_id, req.user.role);
    if (!canEdit) return res.status(403).json({ error: 'Accès refusé' });
    
    await query('DELETE FROM rounds WHERE id = $1', [roundId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur suppression tour:', err);
    res.status(500).json({ error: 'Impossible de supprimer le tour' });
  }
});

// Dupliquer un tour (copier toutes les données vers un nouveau tour)
router.post('/:roundId/duplicate', isResponsableOrAdmin, async (req, res) => {
  try {
    const { roundId } = req.params;
    const { newName } = req.body;
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Récupérer le tour source
      const sourceRound = await client.query(
        'SELECT * FROM rounds WHERE id = $1',
        [roundId]
      );
      
      if (sourceRound.rowCount === 0) {
        throw new Error('Tour source introuvable');
      }
      
      const source = sourceRound.rows[0];
      const canEditSource = await canEditProject(req.user.id, source.project_id, req.user.role);
      if (!canEditSource) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Accès refusé' });
      }
      
      // Trouver le prochain numéro
      const maxResult = await client.query(
        'SELECT COALESCE(MAX(round_number), -1) + 1 as next_number FROM rounds WHERE project_id = $1',
        [source.project_id]
      );
      const newRoundNumber = maxResult.rows[0].next_number;
      
      // Créer le nouveau tour
      const newRound = await client.query(
        `INSERT INTO rounds (project_id, round_number, name, description, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING *`,
        [source.project_id, newRoundNumber, newName || `${source.name} (copie)`, source.description]
      );
      
      const newRoundId = newRound.rows[0].id;
      
      // Les items et moe_items sont partagés entre tous les tours : rien à
      // copier de ce côté. Tout ce qui est rattaché à un TOUR est en revanche
      // dupliqué ci-dessous. `round_lots` est ignorée : la table est vide et
      // n'est pas alimentée par l'application.
      //
      // 1. Offres des articles.
      
      // Copier en UNE requête toutes les offres du tour source vers le nouveau.
      //
      // C'était auparavant une requête par article du projet : sur un projet à
      // ~4 800 articles, autant d'allers-retours séquentiels, soit plus d'une
      // minute pour dupliquer un tour. La restriction au projet se fait
      // désormais par jointure.
      //
      // Toutes les colonnes sont reprises. `unit`, `amount` et
      // `offer_designation` étaient omises : le tour copié perdait l'unité de
      // presque toutes les offres — ce qui déclenche de fausses questions
      // d'incohérence d'unité —, le montant figé à l'import, et la désignation
      // propre à l'entreprise.
      const offresRes = await client.query(
        `INSERT INTO offers (item_id, company_id, round_id, unit, qty, unit_price, amount, comment, offer_designation)
         SELECT o.item_id, o.company_id, $1, o.unit, o.qty, o.unit_price, o.amount, o.comment, o.offer_designation
           FROM offers o
           JOIN items i ON i.id = o.item_id
           JOIN lots l ON l.id = i.lot_id
          WHERE l.project_id = $2
            AND o.round_id = $3`,
        [newRoundId, source.project_id, roundId]
      );

      // 2. Options du tour, qui n'étaient pas dupliquées du tout.
      //
      // La contrainte UNIQUE(lot_id, round_id, designation) garantit que le
      // couple (lot, désignation) identifie une option de façon unique au sein
      // d'un tour : c'est donc une clé de correspondance fiable entre l'ancienne
      // option et la nouvelle.
      const optionsRes = await client.query(
        `WITH src AS (
           SELECT id, lot_id, designation FROM options WHERE round_id = $2
         ), ins AS (
           INSERT INTO options (lot_id, round_id, designation)
           SELECT lot_id, $1, designation FROM src
           RETURNING id, lot_id, designation
         )
         SELECT src.id AS ancienne, ins.id AS nouvelle
           FROM ins
           JOIN src ON src.lot_id = ins.lot_id AND src.designation = ins.designation`,
        [newRoundId, roundId]
      );
      const nouvelleOptionParAncienne = new Map(
        optionsRes.rows.map(r => [Number(r.ancienne), Number(r.nouvelle)])
      );

      // 3. Lignes des options.
      //
      // Copiées une par une à dessein : `option_items` n'a ni contrainte
      // d'unicité ni colonne d'ordre permettant de recorréler de façon sûre les
      // identifiants d'un INSERT groupé, et deux lignes d'une même option
      // peuvent avoir num et désignation identiques. La duplication est une
      // action ponctuelle portant sur une centaine de lignes au plus.
      const nouvelItemParAncien = new Map();
      if (nouvelleOptionParAncienne.size > 0) {
        const itemsOptionsRes = await client.query(
          `SELECT id, option_id, num, designation, unit
             FROM option_items
            WHERE option_id = ANY($1::int[])
            ORDER BY option_id, id`,
          [[...nouvelleOptionParAncienne.keys()]]
        );
        for (const item of itemsOptionsRes.rows) {
          const nouvelleOption = nouvelleOptionParAncienne.get(Number(item.option_id));
          if (!nouvelleOption) continue;
          const ins = await client.query(
            `INSERT INTO option_items (option_id, num, designation, unit)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [nouvelleOption, item.num, item.designation, item.unit]
          );
          nouvelItemParAncien.set(Number(item.id), Number(ins.rows[0].id));
        }
      }

      // 4. MOE et offres des lignes d'options, en deux requêtes groupées.
      let optionOffresCopiees = 0;
      if (nouvelItemParAncien.size > 0) {
        const anciensItems = [...nouvelItemParAncien.keys()];
        const nouveauxItems = anciensItems.map(id => nouvelItemParAncien.get(id));

        await client.query(
          `INSERT INTO option_item_moe (option_item_id, qty, unit_price)
           SELECT m.nouveau, oim.qty, oim.unit_price
             FROM option_item_moe oim
             JOIN unnest($1::int[], $2::int[]) AS m(ancien, nouveau)
               ON m.ancien = oim.option_item_id
           ON CONFLICT (option_item_id) DO UPDATE
             SET qty = EXCLUDED.qty, unit_price = EXCLUDED.unit_price`,
          [anciensItems, nouveauxItems]
        );

        const optionOffresRes = await client.query(
          `INSERT INTO option_item_offers (option_item_id, company_id, round_id, qty, unit_price, unit)
           SELECT m.nouveau, oio.company_id, $1, oio.qty, oio.unit_price, oio.unit
             FROM option_item_offers oio
             JOIN unnest($2::int[], $3::int[]) AS m(ancien, nouveau)
               ON m.ancien = oio.option_item_id
            WHERE oio.round_id = $4
           ON CONFLICT (option_item_id, company_id, round_id) DO NOTHING`,
          [newRoundId, anciensItems, nouveauxItems, roundId]
        );
        optionOffresCopiees = Number(optionOffresRes.rowCount || 0);
      }

      // Les questions générées ne sont volontairement PAS copiées : elles
      // décrivent les écarts du tour source. Le nouveau tour les régénère après
      // réimport des offres.
      console.log('[rounds.duplicate] tour duplique', {
        sourceRoundId: Number(roundId),
        newRoundId: Number(newRoundId),
        offres: Number(offresRes.rowCount || 0),
        options: nouvelleOptionParAncienne.size,
        lignesOptions: nouvelItemParAncien.size,
        offresOptions: optionOffresCopiees,
      });


      await client.query('COMMIT');
      res.json(newRound.rows[0]);
      
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    
  } catch (err) {
    console.error('Erreur duplication tour:', err);
    res.status(500).json({ error: 'Impossible de dupliquer le tour: ' + err.message });
  }
});

// Obtenir les statistiques d'un tour
router.get('/:roundId/stats', async (req, res) => {
  try {
    const { roundId } = req.params;
    
    // Récupérer le tour pour avoir le project_id
    const roundResult = await query('SELECT project_id FROM rounds WHERE id = $1', [roundId]);
    if (roundResult.rowCount === 0) {
      return res.status(404).json({ error: 'Tour introuvable' });
    }
    const projectId = roundResult.rows[0].project_id;
    const canView = await canViewProject(req.user.id, projectId, req.user.role, req.user.company_id || null);
    if (!canView) return res.status(403).json({ error: 'Accès refusé' });
    
    // Items et MOE sont partagés au niveau projet (via les lots)
    let itemsCount = 0;
    let moeCount = 0;
    
    try {
      const itemsResult = await query(
        `SELECT COUNT(DISTINCT i.id) as count 
         FROM items i 
         JOIN lots l ON l.id = i.lot_id 
         WHERE l.project_id = $1`,
        [projectId]
      );
      itemsCount = parseInt(itemsResult.rows[0]?.count || 0);
    } catch (itemsErr) {
      console.error('Erreur comptage items:', itemsErr);
    }
    
    try {
      const moeResult = await query(
        `SELECT COUNT(DISTINCT m.item_id) as count 
         FROM moe_items m 
         JOIN items i ON i.id = m.item_id
         JOIN lots l ON l.id = i.lot_id 
         WHERE l.project_id = $1`,
        [projectId]
      );
      moeCount = parseInt(moeResult.rows[0]?.count || 0);
    } catch (moeErr) {
      console.error('Erreur comptage MOE:', moeErr);
    }
    
    // Offres sont spécifiques au tour
    let offersCount = 0;
    let companiesCount = 0;
    
    try {
      const offersResult = await query(
        'SELECT COUNT(*) as count, COUNT(DISTINCT company_id) as companies FROM offers WHERE round_id = $1',
        [roundId]
      );
      offersCount = parseInt(offersResult.rows[0]?.count || 0);
      companiesCount = parseInt(offersResult.rows[0]?.companies || 0);
    } catch (offersErr) {
      console.error('Erreur comptage offres:', offersErr);
    }
    
    // Questions (si la table existe)
    let questionsStats = { total: 0, pending: 0, answered: 0 };
    try {
      const qResult = await query(
        `SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
          COUNT(CASE WHEN status IN ('answered', 'validated') THEN 1 END) as answered
         FROM generated_questions WHERE round_id = $1`,
        [roundId]
      );
      if (qResult.rows[0]) {
        questionsStats = {
          total: parseInt(qResult.rows[0].total || 0),
          pending: parseInt(qResult.rows[0].pending || 0),
          answered: parseInt(qResult.rows[0].answered || 0)
        };
      }
    } catch (qErr) {
      console.log('Table generated_questions non disponible:', qErr.message);
    }
    
    res.json({
      total_items: itemsCount,
      moe_items: moeCount,
      total_offers: offersCount,
      companies_count: companiesCount,
      total_questions: questionsStats.total,
      pending_questions: questionsStats.pending,
      answered_questions: questionsStats.answered
    });
  } catch (err) {
    console.error('Erreur stats tour:', err);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: 'Impossible de récupérer les statistiques: ' + err.message });
  }
});

// Tableau récapitulatif des montants par lot et par entreprise
router.get('/:roundId/summary', async (req, res) => {
  try {
    const { roundId } = req.params;
    const scope = companyScope(req);
    const isEntreprise = scope.isEntreprise;
    if (scope.orphan) {
      return res.status(403).json({ error: 'Aucune entreprise associée à votre compte' });
    }

    // Récupérer le projet_id du tour
    const roundResult = await query('SELECT project_id FROM rounds WHERE id = $1', [roundId]);
    if (roundResult.rowCount === 0) {
      return res.status(404).json({ error: 'Tour introuvable' });
    }
    const projectId = roundResult.rows[0].project_id;
    const canView = await canViewProject(req.user.id, projectId, req.user.role, scope.companyId);
    if (!canView) return res.status(403).json({ error: 'Accès refusé' });

    // Récupérer tous les lots du projet
    const lotsResult = await query(
      `SELECT id, code, name, macro_lot, sort_order,
              ROW_NUMBER() OVER (ORDER BY sort_order ASC, id ASC) AS lot_order
       FROM lots
       WHERE project_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [projectId]
    );
    const lots = lotsResult.rows;
    
    // Montants du récapitulatif, agrégés en 3 requêtes pour TOUS les lots.
    //
    // La version précédente émettait 2 requêtes par lot, plus 1 par couple
    // (lot, entreprise) : sur un projet à 64 lots et ~150 associations, cela
    // faisait près de 280 allers-retours séquentiels, soit plusieurs secondes
    // d'attente à chaque affichage.
    const lotIds = lots.map(l => Number(l.id)).filter(Number.isFinite);

    const moeTotalByLot = new Map();
    const companiesByLot = new Map();
    const offerTotalByLotCompany = new Map();

    if (lotIds.length > 0) {
      const [moeRes, lotCompaniesRes, offersRes] = await Promise.all([
        query(
          `SELECT i.lot_id, COALESCE(SUM(m.amount), 0) AS total
             FROM moe_items m
             JOIN items i ON i.id = m.item_id
            WHERE i.lot_id = ANY($1::int[])
            GROUP BY i.lot_id`,
          [lotIds]
        ),
        query(
          `SELECT lc.lot_id, c.id, COALESCE(NULLIF(lc.display_name, ''), c.name) AS name
             FROM companies c
             JOIN lot_companies lc ON lc.company_id = c.id
            WHERE lc.lot_id = ANY($1::int[])
            ORDER BY lc.lot_id, lc.created_at, c.id`,
          [lotIds]
        ),
        query(
          `SELECT i.lot_id, o.company_id, COALESCE(SUM(o.qty * o.unit_price), 0) AS total
             FROM offers o
             JOIN items i ON i.id = o.item_id
            WHERE i.lot_id = ANY($1::int[]) AND o.round_id = $2
            GROUP BY i.lot_id, o.company_id`,
          [lotIds, roundId]
        ),
      ]);

      // Les colonnes NUMERIC arrivent en string via node-postgres.
      for (const row of moeRes.rows) {
        moeTotalByLot.set(Number(row.lot_id), parseFloat(row.total) || 0);
      }
      for (const row of lotCompaniesRes.rows) {
        const key = Number(row.lot_id);
        if (!companiesByLot.has(key)) companiesByLot.set(key, []);
        companiesByLot.get(key).push({ id: row.id, name: row.name });
      }
      for (const row of offersRes.rows) {
        offerTotalByLotCompany.set(
          `${Number(row.lot_id)}:${Number(row.company_id)}`,
          parseFloat(row.total) || 0
        );
      }
    }

    const summary = lots.map(lot => {
      const lotId = Number(lot.id);
      const companyTotals = (companiesByLot.get(lotId) || [])
        // Une entreprise ne voit que ses propres montants.
        .filter(company => scope.allows(company.id))
        .map(company => ({
          company_id: company.id,
          company_name: company.name,
          // Absent de l'agrégat = aucune offre sur ce lot : total à 0, comme avant.
          total: offerTotalByLotCompany.get(`${lotId}:${Number(company.id)}`) || 0,
        }));

      return {
        lot_id: lot.id,
        lot_order: Number(lot.lot_order),
        lot_code: lot.code,
        lot_name: lot.name,
        macro_lot: lot.macro_lot,
        moe_total: isEntreprise ? null : (moeTotalByLot.get(lotId) || 0),
        companies: companyTotals,
      };
    });


    // Pour rôle entreprise: on ne renvoie pas les deltas MOE, juste leurs propres montants (MOE déjà masqué)
    res.json({ lots: summary });
  } catch (err) {
    console.error('Erreur récupération récapitulatif:', err);
    res.status(500).json({ error: 'Impossible de récupérer le récapitulatif' });
  }
});

// Comparaison des montants entre tous les tours d'un projet
router.get('/project/:projectId/compare', async (req, res) => {
  try {
    const { projectId } = req.params;
    const scope = companyScope(req);
    const isEntreprise = scope.isEntreprise;
    if (scope.orphan) {
      return res.status(403).json({ error: 'Aucune entreprise associée à votre compte' });
    }

    // SÉCURITÉ: Vérifier accès au projet
    const canView = await canViewProject(req.user.id, projectId, req.user.role, scope.companyId);
    if (!canView) return res.status(403).json({ error: 'Accès refusé' });

    // Récupérer tous les tours du projet
    const roundsResult = await query(
      'SELECT id, name, round_number FROM rounds WHERE project_id = $1 ORDER BY round_number ASC, id ASC',
      [projectId]
    );
    const rounds = roundsResult.rows;
    
    if (rounds.length === 0) {
      return res.json({ lots: [], rounds: [] });
    }
    
    // Récupérer tous les lots du projet
    const lotsResult = await query(
      `SELECT id, code, name, macro_lot, sort_order,
              ROW_NUMBER() OVER (ORDER BY sort_order ASC, id ASC) AS lot_order
       FROM lots
       WHERE project_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [projectId]
    );
    const lots = lotsResult.rows;
    
    // Montants par lot ET par tour, agrégés en 3 requêtes.
    //
    // La version précédente faisait 1 requête par lot, plus 2 par couple
    // (lot, tour) : sur 64 lots et 13 tours, environ 1 700 allers-retours
    // séquentiels, soit une trentaine de secondes à ~17 ms de latence.
    //
    // Les totaux par tour et les totaux par entreprise restent deux agrégats
    // distincts : le premier couvre toutes les offres du lot, le second
    // seulement les entreprises associées au lot. C'est précisément l'écart
    // entre les deux que le diagnostic [AMOUNT-DIAG] ci-dessous surveille.
    const lotIds = lots.map(l => Number(l.id)).filter(Number.isFinite);
    const roundIds = rounds.map(r => Number(r.id)).filter(Number.isFinite);

    const moeTotalByLot = new Map();
    const roundTotalByLotRound = new Map();
    const companyRowsByLotRound = new Map();

    if (lotIds.length > 0 && roundIds.length > 0) {
      const [moeRes, roundRes, companiesRes] = await Promise.all([
        query(
          `SELECT i.lot_id, COALESCE(SUM(m.amount), 0) AS total
             FROM moe_items m
             JOIN items i ON i.id = m.item_id
            WHERE i.lot_id = ANY($1::int[])
            GROUP BY i.lot_id`,
          [lotIds]
        ),
        query(
          `SELECT i.lot_id, o.round_id, COALESCE(SUM(o.qty * o.unit_price), 0) AS total
             FROM offers o
             JOIN items i ON i.id = o.item_id
            WHERE i.lot_id = ANY($1::int[]) AND o.round_id = ANY($2::int[])
            GROUP BY i.lot_id, o.round_id`,
          [lotIds, roundIds]
        ),
        // Les entreprises associées au lot apparaissent même sans offre, avec un
        // total à 0 : d'où le produit lot_companies × tours puis la jointure
        // externe sur les totaux déjà agrégés.
        query(
          `WITH totaux AS (
             SELECT i.lot_id, o.round_id, o.company_id,
                    SUM(o.qty * o.unit_price) AS total
               FROM offers o
               JOIN items i ON i.id = o.item_id
              WHERE i.lot_id = ANY($1::int[]) AND o.round_id = ANY($2::int[])
              GROUP BY i.lot_id, o.round_id, o.company_id
           )
           SELECT lc.lot_id,
                  r.round_id,
                  c.id AS company_id,
                  COALESCE(NULLIF(lc.display_name, ''), c.name) AS company_name,
                  COALESCE(t.total, 0) AS total
             FROM lot_companies lc
             JOIN companies c ON c.id = lc.company_id
             CROSS JOIN unnest($2::int[]) AS r(round_id)
             LEFT JOIN totaux t
                    ON t.lot_id = lc.lot_id
                   AND t.round_id = r.round_id
                   AND t.company_id = c.id
            WHERE lc.lot_id = ANY($1::int[])${scope.sqlAnd('c.id')}
            ORDER BY lc.lot_id, r.round_id, company_name`,
          [lotIds, roundIds]
        ),
      ]);

      // Colonnes NUMERIC : node-postgres les rend en string.
      for (const row of moeRes.rows) {
        moeTotalByLot.set(Number(row.lot_id), parseFloat(row.total) || 0);
      }
      for (const row of roundRes.rows) {
        roundTotalByLotRound.set(
          `${Number(row.lot_id)}:${Number(row.round_id)}`,
          parseFloat(row.total) || 0
        );
      }
      for (const row of companiesRes.rows) {
        const key = `${Number(row.lot_id)}:${Number(row.round_id)}`;
        if (!companyRowsByLotRound.has(key)) companyRowsByLotRound.set(key, []);
        companyRowsByLotRound.get(key).push({
          company_id: row.company_id,
          company_name: row.company_name,
          total: parseFloat(row.total) || 0,
        });
      }
    }

    const summary = lots.map(lot => {
      const lotId = Number(lot.id);
      const roundTotals = {};
      const companiesByRound = {};

      for (const round of rounds) {
        const key = `${lotId}:${Number(round.id)}`;
        const roundTotal = roundTotalByLotRound.get(key) || 0;
        const companies = companyRowsByLotRound.get(key) || [];

        roundTotals[round.id] = roundTotal;
        companiesByRound[round.id] = companies;

        const companiesSum = companies.reduce((acc, company) => acc + Number(company.total || 0), 0);
        const diff = Math.abs(roundTotal - companiesSum);
        if (diff > 0.01) {
          console.warn('[AMOUNT-DIAG][rounds.compare] Incohérence total lot/tour vs somme entreprises', {
            projectId: Number(projectId),
            lotId,
            roundId: Number(round.id),
            roundTotal,
            companiesSum,
            diff,
            companiesCount: companies.length,
            companies: companies.map(c => ({ id: Number(c.company_id), total: Number(c.total || 0) }))
          });
        }
      }

      return {
        lot_id: lot.id,
        lot_order: Number(lot.lot_order),
        lot_code: lot.code,
        lot_name: lot.name,
        macro_lot: lot.macro_lot,
        moe_total: isEntreprise ? null : (moeTotalByLot.get(lotId) || 0),
        round_totals: roundTotals,
        companies_by_round: companiesByRound,
      };
    });


    res.json({ lots: summary, rounds });
  } catch (err) {
    console.error('Erreur comparaison tours:', err);
    res.status(500).json({ error: 'Impossible de récupérer la comparaison' });
  }
});

export default router;

