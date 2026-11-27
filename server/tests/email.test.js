/**
 * Tests du service d'envoi d'emails (src/app/utils/email.js).
 *
 * L'enjeu : l'adresse d'EXPÉDITION etait figee sur EMAIL_USER a neuf endroits.
 * Avec un fournisseur comme Brevo, l'identifiant de connexion n'est PAS une
 * adresse valide (`9xxxxx@smtp-brevo.com`) : les messages seraient rejetes.
 * `mailFrom()` est donc le point de bascule, et merite d'etre verrouille.
 *
 * Aucun email n'est envoye : seules des fonctions pures sont exercees.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mailFrom, isEmailConfigured } from '../src/app/utils/email.js'

/** Execute une fonction avec un environnement temporaire, puis restaure. */
function avecEnv(variables, fn) {
  const sauvegarde = {}
  for (const [cle, valeur] of Object.entries(variables)) {
    sauvegarde[cle] = process.env[cle]
    if (valeur === undefined) delete process.env[cle]
    else process.env[cle] = valeur
  }
  try {
    return fn()
  } finally {
    for (const [cle, valeur] of Object.entries(sauvegarde)) {
      if (valeur === undefined) delete process.env[cle]
      else process.env[cle] = valeur
    }
  }
}

test('mailFrom utilise EMAIL_FROM quand il est defini', () => {
  avecEnv({ EMAIL_FROM: 'AO Link <contact@ao-link.fr>', EMAIL_USER: '9xxxxx@smtp-brevo.com' }, () => {
    assert.equal(mailFrom(), 'AO Link <contact@ao-link.fr>')
  })
})

test('mailFrom habille une adresse nue du nom de l application', () => {
  avecEnv({ EMAIL_FROM: 'contact@ao-link.fr', EMAIL_USER: 'autre@exemple.fr' }, () => {
    assert.equal(mailFrom(), '"AO Link" <contact@ao-link.fr>')
  })
})

test('mailFrom retombe sur EMAIL_USER sans EMAIL_FROM', () => {
  // Compatibilite avec les configurations Gmail existantes, ou l'identifiant
  // de connexion EST l'adresse d'expedition.
  avecEnv({ EMAIL_FROM: undefined, EMAIL_USER: 'moi@gmail.com' }, () => {
    assert.equal(mailFrom(), '"AO Link" <moi@gmail.com>')
  })
})

test('mailFrom ignore un EMAIL_FROM vide ou en blancs', () => {
  for (const valeur of ['', '   ']) {
    avecEnv({ EMAIL_FROM: valeur, EMAIL_USER: 'moi@gmail.com' }, () => {
      assert.equal(mailFrom(), '"AO Link" <moi@gmail.com>')
    })
  }
})

test('PIEGE : l identifiant SMTP Brevo ne doit jamais servir d expediteur', () => {
  // Sans EMAIL_FROM, la configuration Brevo produit une adresse d'expedition
  // invalide. Le test documente ce que donne l'oubli, pour que la cause soit
  // identifiable si des emails sont rejetes.
  avecEnv({ EMAIL_FROM: undefined, EMAIL_USER: '9xxxxx@smtp-brevo.com' }, () => {
    const expediteur = mailFrom()
    assert.match(expediteur, /smtp-brevo\.com/)
    assert.ok(
      expediteur.includes('smtp-brevo.com'),
      'EMAIL_FROM est obligatoire avec Brevo : cet expediteur serait refuse'
    )
  })
})

test('isEmailConfigured exige identifiant ET mot de passe', () => {
  avecEnv({ EMAIL_USER: 'a@b.fr', EMAIL_PASS: 'secret' }, () => {
    assert.equal(isEmailConfigured(), true)
  })
  avecEnv({ EMAIL_USER: 'a@b.fr', EMAIL_PASS: undefined }, () => {
    assert.equal(isEmailConfigured(), false)
  })
  avecEnv({ EMAIL_USER: undefined, EMAIL_PASS: 'secret' }, () => {
    assert.equal(isEmailConfigured(), false)
  })
})
