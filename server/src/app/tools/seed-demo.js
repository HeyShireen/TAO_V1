import 'dotenv/config';

import { authQuery, ensureSchema, pool, runWithTenantContext } from '../db.js';
import { hashPassword } from '../utils/hash.js';
import { sendOperationalAlert } from '../utils/email.js';

const DEMO_EMAIL = (process.env.DEMO_USER_EMAIL || 'demo@ao-link.fr').trim().toLowerCase();
const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD || 'DemoAoLink2026!';
const DEMO_REFERENCE = 'DEMO-2026-001';

if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 12) {
  console.error('DEMO_USER_PASSWORD doit etre defini et contenir au moins 12 caracteres.');
  process.exit(1);
}

async function ensureDemoUser(client) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const existing = await client.query(
    'SELECT id FROM users WHERE lower(email) = lower($1)',
    [DEMO_EMAIL]
  );

  if (existing.rowCount > 0) {
    const result = await client.query(
      `UPDATE users
       SET password_hash = $2, role = 'responsable', email_verified = true
       WHERE id = $1
       RETURNING id`,
      [existing.rows[0].id, passwordHash]
    );
    return result.rows[0].id;
  }

  const result = await client.query(
    `INSERT INTO users (email, password_hash, role, email_verified)
     VALUES ($1, $2, 'responsable', true)
     RETURNING id`,
    [DEMO_EMAIL, passwordHash]
  );
  return result.rows[0].id;
}

async function ensureCompany(client, name, color, email = null) {
  const existing = await client.query(
    'SELECT id FROM companies WHERE lower(name) = lower($1)',
    [name]
  );

  if (existing.rowCount > 0) {
    await client.query(
      'UPDATE companies SET color = COALESCE($2, color), email = COALESCE($3, email) WHERE id = $1',
      [existing.rows[0].id, color, email]
    );
    return existing.rows[0].id;
  }

  const result = await client.query(
    'INSERT INTO companies (name, color, email) VALUES ($1, $2, $3) RETURNING id',
    [name, color, email]
  );
  return result.rows[0].id;
}

async function createLot(client, projectId, { code, name, macroLot, companies, items, rounds }) {
  const lot = await client.query(
    `INSERT INTO lots (project_id, code, name, macro_lot)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [projectId, code, name, macroLot]
  );
  const lotId = lot.rows[0].id;

  for (const companyId of companies) {
    await client.query(
      'INSERT INTO lot_companies (lot_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [lotId, companyId]
    );
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const itemResult = await client.query(
      `INSERT INTO items (lot_id, num, designation, unit, position)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [lotId, item.num, item.designation, item.unit, index + 1]
    );
    const itemId = itemResult.rows[0].id;

    await client.query(
      `INSERT INTO moe_items (item_id, qty, unit_price, amount)
       VALUES ($1, $2, $3, $4)`,
      [itemId, item.moe.qty, item.moe.unitPrice, item.moe.qty * item.moe.unitPrice]
    );

    for (const offer of item.offers) {
      const companyId = companies[offer.companyIndex];
      const roundId = rounds[offer.roundNumber];
      const amount = offer.qty * offer.unitPrice;
      await client.query(
        `INSERT INTO offers (item_id, company_id, round_id, unit, qty, unit_price, amount, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [itemId, companyId, roundId, offer.unit || item.unit, offer.qty, offer.unitPrice, amount, offer.comment || null]
      );
    }

    if (item.question) {
      await client.query(
        `INSERT INTO generated_questions
          (lot_id, item_id, company_id, round_id, question_type, question_text, moe_value, offer_value, deviation_pct, status, answer)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT DO NOTHING`,
        [
          lotId,
          itemId,
          companies[item.question.companyIndex],
          rounds[item.question.roundNumber],
          item.question.type,
          item.question.text,
          item.question.moeValue,
          item.question.offerValue,
          item.question.deviationPct,
          item.question.status,
          item.question.answer || null,
        ]
      );
    }
  }

  return lotId;
}

async function addOption(client, { lotId, roundId, companyIds }) {
  const option = await client.query(
    `INSERT INTO options (lot_id, round_id, designation)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [lotId, roundId, 'Option panneaux photovoltaiques en toiture']
  );
  const optionId = option.rows[0].id;

  const rows = [
    { num: 'OP-01', designation: 'Fourniture et pose de panneaux PV 36 kWc', unit: 'ens', qty: 1, pu: 42800 },
    { num: 'OP-02', designation: 'Onduleurs, monitoring et mise en service', unit: 'ens', qty: 1, pu: 8900 },
  ];

  for (const row of rows) {
    const item = await client.query(
      `INSERT INTO option_items (option_id, num, designation, unit)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [optionId, row.num, row.designation, row.unit]
    );
    const optionItemId = item.rows[0].id;
    await client.query(
      'INSERT INTO option_item_moe (option_item_id, qty, unit_price) VALUES ($1, $2, $3)',
      [optionItemId, row.qty, row.pu]
    );

    for (const [index, companyId] of companyIds.entries()) {
      const factor = [0.96, 1.04, 1.11][index] || 1;
      await client.query(
        `INSERT INTO option_item_offers (option_item_id, company_id, round_id, qty, unit_price)
         VALUES ($1, $2, $3, $4, $5)`,
        [optionItemId, companyId, roundId, row.qty, Math.round(row.pu * factor)]
      );
    }
  }
}

async function main() {
  await ensureSchema();
  const tenantResult = await authQuery("SELECT id FROM tenants WHERE slug = 'demo' AND type = 'demo'");
  if (tenantResult.rowCount !== 1) throw new Error('Le tenant DEMO est introuvable');
  const demoTenantId = Number(tenantResult.rows[0].id);

  await runWithTenantContext({ tenantId: demoTenantId, userId: 0 }, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('aolink-demo-reset')) AS acquired");
      if (!lock.rows[0]?.acquired) throw new Error('Une réinitialisation DEMO est déjà en cours');

      const demoUserId = await ensureDemoUser(client);

      await client.query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE tenant_id = $1 AND revoked_at IS NULL',
        [demoTenantId]
      );
      await client.query('DELETE FROM projects WHERE tenant_id = $1', [demoTenantId]);
      await client.query('DELETE FROM tenant_invitations WHERE tenant_id = $1', [demoTenantId]);
      await client.query(
        'DELETE FROM users WHERE tenant_id = $1 AND id <> $2',
        [demoTenantId, demoUserId]
      );
      await client.query('DELETE FROM companies WHERE tenant_id = $1', [demoTenantId]);

    const project = await client.query(
      `INSERT INTO projects
        (name, reference, client, location, study_phase, study_date, created_by, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $6, true)
       RETURNING id`,
      [
        'Demo AO Link - Groupe scolaire Victor Hugo',
        DEMO_REFERENCE,
        'Ville de Nantes',
        'Nantes (44)',
        'Analyse des offres - consultation travaux',
        demoUserId,
      ]
    );
    const projectId = project.rows[0].id;

    const roundOpening = await client.query(
      `INSERT INTO rounds (project_id, round_number, name, description, status)
       VALUES ($1, 0, 'Ouverture des offres', 'Analyse initiale apres reception des offres', 'active')
       RETURNING id`,
      [projectId]
    );
    const roundNegotiation = await client.query(
      `INSERT INTO rounds (project_id, round_number, name, description, status)
       VALUES ($1, 1, 'Tour de negociation', 'Ajustements apres questions aux entreprises', 'active')
       RETURNING id`,
      [projectId]
    );
    const rounds = {
      0: roundOpening.rows[0].id,
      1: roundNegotiation.rows[0].id,
    };

    const companies = [
      await ensureCompany(client, 'BatiNord Construction', '#2563eb', 'contact@batinord.example'),
      await ensureCompany(client, 'Hexa Travaux', '#16a34a', 'contact@hexatravaux.example'),
      await ensureCompany(client, 'Nova Batiment', '#f97316', 'contact@novabatiment.example'),
    ];

    await createLot(client, projectId, {
      code: '01',
      name: 'Gros oeuvre',
      macroLot: 'Clos couvert',
      companies,
      rounds,
      items: [
        {
          num: '1.1',
          designation: 'Installation de chantier et base vie',
          unit: 'ens',
          moe: { qty: 1, unitPrice: 18500 },
          offers: [
            { companyIndex: 0, roundNumber: 0, qty: 1, unitPrice: 19200 },
            { companyIndex: 1, roundNumber: 0, qty: 1, unitPrice: 17800 },
            { companyIndex: 2, roundNumber: 0, qty: 1, unitPrice: 20500, comment: 'Comprend signaletique chantier' },
            { companyIndex: 0, roundNumber: 1, qty: 1, unitPrice: 18600 },
            { companyIndex: 1, roundNumber: 1, qty: 1, unitPrice: 17600 },
            { companyIndex: 2, roundNumber: 1, qty: 1, unitPrice: 19800 },
          ],
        },
        {
          num: '1.2',
          designation: 'Fondations superficielles beton arme',
          unit: 'm3',
          moe: { qty: 145, unitPrice: 310 },
          offers: [
            { companyIndex: 0, roundNumber: 0, qty: 145, unitPrice: 322 },
            { companyIndex: 1, roundNumber: 0, qty: 132, unitPrice: 305 },
            { companyIndex: 2, roundNumber: 0, qty: 168, unitPrice: 298 },
            { companyIndex: 0, roundNumber: 1, qty: 145, unitPrice: 315 },
            { companyIndex: 1, roundNumber: 1, qty: 145, unitPrice: 302 },
            { companyIndex: 2, roundNumber: 1, qty: 150, unitPrice: 294 },
          ],
          question: {
            companyIndex: 1,
            roundNumber: 0,
            type: 'qty_low',
            text: 'Merci de confirmer la quantite de fondations retenue, inferieure a la DPGF MOE.',
            moeValue: 145,
            offerValue: 132,
            deviationPct: -8.97,
            status: 'answered',
            answer: 'Quantite rectifiee au tour de negociation.',
          },
        },
        {
          num: '1.3',
          designation: 'Dallage quartz locaux communs',
          unit: 'm2',
          moe: { qty: 820, unitPrice: 58 },
          offers: [
            { companyIndex: 0, roundNumber: 0, qty: 820, unitPrice: 61 },
            { companyIndex: 1, roundNumber: 0, qty: 820, unitPrice: 54 },
            { companyIndex: 2, roundNumber: 0, qty: 820, unitPrice: 63 },
            { companyIndex: 0, roundNumber: 1, qty: 820, unitPrice: 59 },
            { companyIndex: 1, roundNumber: 1, qty: 820, unitPrice: 53 },
            { companyIndex: 2, roundNumber: 1, qty: 820, unitPrice: 60 },
          ],
        },
      ],
    });

    await createLot(client, projectId, {
      code: '02',
      name: 'CVC plomberie',
      macroLot: 'Lots techniques',
      companies,
      rounds,
      items: [
        {
          num: '2.1',
          designation: 'Pompe a chaleur air/eau double service',
          unit: 'ens',
          moe: { qty: 1, unitPrice: 76000 },
          offers: [
            { companyIndex: 0, roundNumber: 0, qty: 1, unitPrice: 81200 },
            { companyIndex: 1, roundNumber: 0, qty: 1, unitPrice: 74800 },
            { companyIndex: 2, roundNumber: 0, qty: 1, unitPrice: 78900 },
            { companyIndex: 0, roundNumber: 1, qty: 1, unitPrice: 79200 },
            { companyIndex: 1, roundNumber: 1, qty: 1, unitPrice: 73900 },
            { companyIndex: 2, roundNumber: 1, qty: 1, unitPrice: 77100 },
          ],
        },
        {
          num: '2.2',
          designation: 'Reseau ventilation double flux classes',
          unit: 'm',
          moe: { qty: 420, unitPrice: 95 },
          offers: [
            { companyIndex: 0, roundNumber: 0, qty: 420, unitPrice: 101 },
            { companyIndex: 1, roundNumber: 0, qty: 420, unitPrice: 92 },
            { companyIndex: 2, roundNumber: 0, qty: 390, unitPrice: 98 },
            { companyIndex: 0, roundNumber: 1, qty: 420, unitPrice: 98 },
            { companyIndex: 1, roundNumber: 1, qty: 420, unitPrice: 91 },
            { companyIndex: 2, roundNumber: 1, qty: 420, unitPrice: 96 },
          ],
        },
      ],
    });

    const electricityLotId = await createLot(client, projectId, {
      code: '03',
      name: 'Electricite CFO/CFA',
      macroLot: 'Lots techniques',
      companies,
      rounds,
      items: [
        {
          num: '3.1',
          designation: 'Tableau general basse tension',
          unit: 'ens',
          moe: { qty: 1, unitPrice: 34200 },
          offers: [
            { companyIndex: 0, roundNumber: 0, qty: 1, unitPrice: 35100 },
            { companyIndex: 1, roundNumber: 0, qty: 1, unitPrice: 33800 },
            { companyIndex: 2, roundNumber: 0, qty: 1, unitPrice: 36500 },
            { companyIndex: 0, roundNumber: 1, qty: 1, unitPrice: 34400 },
            { companyIndex: 1, roundNumber: 1, qty: 1, unitPrice: 33200 },
            { companyIndex: 2, roundNumber: 1, qty: 1, unitPrice: 35200 },
          ],
        },
        {
          num: '3.2',
          designation: 'Luminaires LED salles de classe',
          unit: 'u',
          moe: { qty: 186, unitPrice: 175 },
          offers: [
            { companyIndex: 0, roundNumber: 0, qty: 186, unitPrice: 182 },
            { companyIndex: 1, roundNumber: 0, qty: 186, unitPrice: 169 },
            { companyIndex: 2, roundNumber: 0, qty: 210, unitPrice: 161, comment: 'Variante avec detecteurs integres' },
            { companyIndex: 0, roundNumber: 1, qty: 186, unitPrice: 178 },
            { companyIndex: 1, roundNumber: 1, qty: 186, unitPrice: 168 },
            { companyIndex: 2, roundNumber: 1, qty: 186, unitPrice: 166 },
          ],
          question: {
            companyIndex: 2,
            roundNumber: 0,
            type: 'qty_high',
            text: 'Merci de justifier le nombre de luminaires superieur a la quantite MOE.',
            moeValue: 186,
            offerValue: 210,
            deviationPct: 12.9,
            status: 'pending',
          },
        },
      ],
    });

    await addOption(client, {
      lotId: electricityLotId,
      roundId: rounds[1],
      companyIds: companies,
    });

      await client.query('COMMIT');
      console.log('Demo commerciale prete.');
      console.log(`Utilisateur: ${DEMO_EMAIL}`);
      console.log(`Projet: ${DEMO_REFERENCE}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Erreur seed demo:', err);
      try { await sendOperationalAlert('Echec de la reinitialisation DEMO', err.stack || err.message); } catch (alertError) {
        console.error('Echec envoi alerte DEMO:', alertError.message);
      }
      process.exitCode = 1;
    } finally {
      await client.release();
    }
  });
  await pool.end();
}

main();
