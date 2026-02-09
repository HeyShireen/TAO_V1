// Fichier temporaire pour montrer la correction
// Dans server.js, l'ordre des routes doit être:

// 1. Routes spécifiques AVANT express.static
app.get('/', (_req, res) => {
  res.sendFile(homeFile)
})

app.get('/login', loginCsp, (_req, res) => {
  res.sendFile(loginFile)
})

app.get('/app', (req, res) => {
  const token = getTokenFromCookie(req)
  if (!isValidJwt(token)) return res.redirect('/login')
  res.sendFile(appFile)
})

// 2. PUIS express.static pour les assets (CSS, JS, images)
app.use(express.static(publicDir, { index: false }))

// 3. Catch-all à la fin
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Route API introuvable' })
  res.status(404).send('Page non trouvée')
})
