// server/src/public/login.js
(function(){
  function qs(s){ return document.querySelector(s); }
  const form = qs('#login-form');
  const emailEl = qs('#login-email');
  const passEl = qs('#login-password');
  const msgEl = qs('#login-msg');
  const logo = qs('#login-logo');

  if (logo) {
    logo.addEventListener('error', () => { logo.style.display = 'none'; });
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    msgEl.textContent = '';
    const email = emailEl.value.trim();
    const password = passEl.value;

    if (!email || !password) {
      msgEl.textContent = 'Email et mot de passe requis';
      return;
    }

    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // pour cookie HttpOnly
        body: JSON.stringify({ email, password })
      });
      const data = await resp.json();
      if (!resp.ok) {
        msgEl.textContent = data?.error || 'Échec de la connexion';
        return;
      }
      // Compat SPA actuelle: stocker aussi le token localStorage
      if (data.token) {
        try { localStorage.setItem('token', data.token); } catch(_){}
      }
      // Rediriger vers l'application
      window.location.href = '/app';
    } catch (err) {
      msgEl.textContent = 'Erreur réseau';
    }
  });
})();
