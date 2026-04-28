export function isDemoMode() {
  return process.env.DEMO_MODE === 'true';
}

export function demoModeMiddleware(req, res, next) {
  if (!isDemoMode()) return next();

  // In demo mode, keep the app explorable while preventing destructive API calls.
  if (req.method === 'DELETE' && req.path.startsWith('/api/')) {
    return res.status(403).json({
      error: 'Action non disponible en mode demo',
      demoMode: true,
    });
  }

  return next();
}
