export const DEMO_RESET_MESSAGE = 'Environnement de démonstration : toutes les données saisies ici seront supprimées chaque jour à 03:00, heure de Paris.'

export function configuredDemoHost() {
  return (process.env.DEMO_HOST || 'demo.ao-link.fr').trim().toLowerCase().split(':')[0]
}

export function isDemoHost(req) {
  const host = String(req.hostname || req.get?.('host') || '').trim().toLowerCase().split(':')[0]
  return host === configuredDemoHost()
}

export function cookieValue(req, name) {
  const cookies = String(req.headers?.cookie || '').split(';')
  const pair = cookies.map(value => value.trim()).find(value => value.startsWith(`${name}=`))
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null
}

// Options des cookies de session (`auth` et `refreshToken`).
// Le drapeau Secure doit suivre le protocole réellement vu par le navigateur, pas
// NODE_ENV : sur le VPS servi en HTTP simple, `secure: true` fait silencieusement
// jeter le cookie par le navigateur. Le refreshToken n'est alors jamais stocké et
// la session meurt sans recours à l'expiration du JWT (15 min).
// `trust proxy` étant activé en production, req.secure vaut bien true derrière
// nginx TLS (X-Forwarded-Proto) et false en HTTP direct.
export function sessionCookieOptions(req, maxAge = null) {
  const options = {
    httpOnly: true,
    secure: req?.secure === true,
    sameSite: 'lax',
    path: '/',
  }
  return maxAge === null ? options : { ...options, maxAge }
}

export const AUTH_COOKIE_MAX_AGE = 15 * 60 * 1000            // 15 minutes, aligné sur le JWT
export const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000 // 30 jours

export function publicUser(user, activeTenant = null) {
  const activeTenantId = Number(activeTenant?.id || user.active_tenant_id || user.tenant_id)
  return {
    id: Number(user.id),
    email: user.email,
    role: user.role,
    company_id: user.company_id ? Number(user.company_id) : null,
    tenant_id: Number(user.tenant_id),
    active_tenant_id: activeTenantId,
    active_tenant_type: activeTenant?.type || user.active_tenant_type || user.tenant_type || null,
    tenant: activeTenant ? {
      id: Number(activeTenant.id),
      slug: activeTenant.slug,
      name: activeTenant.name,
      type: activeTenant.type,
      status: activeTenant.status,
    } : undefined,
  }
}
