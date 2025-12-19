// server/src/public/login.js
(function(){
  function qs(s){ return document.querySelector(s); }
  const form = qs('#login-form');
  const emailEl = qs('#login-email');
  const passEl = qs('#login-password');
  const msgEl = qs('#login-msg');
  const logo = qs('#login-logo');
  const tabLogin = qs('#tab-login');
  const tabRegister = qs('#tab-register');
  const registerForm = qs('#register-form');
  const backToLoginBtn = qs('#back-to-login');
  const registerMsg = qs('#login-msg');
  const rememberMe = qs('#remember-me');

  if (logo) {
    logo.addEventListener('error', () => { logo.style.display = 'none'; });
  }

   function showLogin(){
    form?.classList.remove('hidden');
    registerForm?.classList.add('hidden');
    tabLogin?.classList.remove('ghost');
    tabRegister?.classList.add('ghost');
    registerMsg.textContent = '';
  }

  function showRegister(){
    form?.classList.add('hidden');
    registerForm?.classList.remove('hidden');
    tabLogin?.classList.add('ghost');
    tabRegister?.classList.remove('ghost');
    registerMsg.textContent = '';
  }

  tabLogin?.addEventListener('click', showLogin);
  tabRegister?.addEventListener('click', showRegister);
  backToLoginBtn?.addEventListener('click', showLogin);

  // Prefill depuis le stockage local (si l'utilisateur a choisi de se souvenir)
  try {
    const savedEmail = localStorage.getItem('rememberedEmail');
    const savedPassword = localStorage.getItem('rememberedPassword');
    if (savedEmail && savedPassword) {
      emailEl.value = savedEmail;
      passEl.value = savedPassword;
      if (rememberMe) rememberMe.checked = true;
    }
  } catch(_){}

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
      // Option "Se souvenir" : stocker email/mdp si demandé, sinon nettoyer
      try {
        if (rememberMe?.checked) {
          localStorage.setItem('rememberedEmail', email);
          localStorage.setItem('rememberedPassword', password);
        } else {
          localStorage.removeItem('rememberedEmail');
          localStorage.removeItem('rememberedPassword');
        }
      } catch(_){ }
      // Rediriger vers l'application
      window.location.href = '/app';
    } catch (err) {
      msgEl.textContent = 'Erreur réseau';
    }
  });

  // Inscription
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    registerMsg.textContent = '';
    const email = qs('#register-email')?.value.trim();
    const password = qs('#register-password')?.value;
    const confirm = qs('#register-password-confirm')?.value;

    if (!email || !password) {
      registerMsg.textContent = 'Email et mot de passe requis';
      return;
    }
    if (password.length < 8) {
      registerMsg.textContent = 'Le mot de passe doit contenir au moins 8 caractères';
      return;
    }
    if (password !== confirm) {
      registerMsg.textContent = 'Les mots de passe ne correspondent pas';
      return;
    }

    try {
      const resp = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      const data = await resp.json();
      if (!resp.ok) {
        registerMsg.textContent = data?.error || 'Échec de l’inscription';
        return;
      }

      if (data.emailSent) {
        registerMsg.innerHTML = `
          <div style="background: #d4edda; padding: 1.5rem; border-radius: 8px; border: 2px solid #28a745; text-align: center; color:#155724;">
            <div style="font-size: 2.4rem; margin-bottom: 0.5rem;">📧</div>
            <div><strong>Compte créé</strong> — vérifiez votre boîte mail pour activer votre compte.</div>
          </div>`;
        const regEmailEl = qs('#register-email');
        const regPassEl = qs('#register-password');
        const regConfirmEl = qs('#register-password-confirm');
        if (regEmailEl && regPassEl) {
          // Pré-remplir le formulaire de connexion avec l'email/mdp saisis pour éviter de retaper
          emailEl.value = regEmailEl.value;
          passEl.value = regPassEl.value;
          if (rememberMe?.checked) {
            try {
              localStorage.setItem('rememberedEmail', regEmailEl.value);
              localStorage.setItem('rememberedPassword', regPassEl.value);
            } catch(_){ }
          }
        }
        if (regEmailEl) regEmailEl.value = '';
        if (regPassEl) regPassEl.value = '';
        if (regConfirmEl) regConfirmEl.value = '';
      } else {
        // Cas du premier admin auto-connecté
        if (data.token) {
          try { localStorage.setItem('token', data.token); } catch(_){}
        }
        window.location.href = '/app';
      }
    } catch (err) {
      registerMsg.textContent = 'Erreur réseau';
    }
  });

  // Démarrage: afficher login par défaut
  showLogin();
})();
