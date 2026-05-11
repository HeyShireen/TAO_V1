// server/src/public/login.js
(function(){
  function qs(s){ return document.querySelector(s); }
  const ICON_SPRITE = './assets/icons.svg#icon-';
  const icon = (name, className = '') => {
    const classes = ['icon', className].filter(Boolean).join(' ');
    return `<svg class="${classes}" aria-hidden="true"><use href="${ICON_SPRITE}${name}"></use></svg>`;
  };
  const form = qs('#login-form');
  const emailEl = qs('#login-email');
  const passEl = qs('#login-password');
  const msgEl = qs('#login-msg');
  const loginBtn = qs('#login-btn');
  const logo = qs('#login-logo');
  const tabLogin = qs('#tab-login');
  const tabRegister = qs('#tab-register');
  const registerForm = qs('#register-form');
  const backToLoginBtn = qs('#back-to-login');
  const registerMsg = qs('#login-msg');
  const rememberMe = qs('#remember-me');
  let loginCooldownTimer = null;

  function stopLoginCooldownTimer() {
    if (loginCooldownTimer) {
      clearInterval(loginCooldownTimer);
      loginCooldownTimer = null;
    }
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Se connecter';
    }
  }

  function startLoginCooldownTimer(initialSeconds) {
    let remaining = Math.max(0, Number(initialSeconds) || 0);

    stopLoginCooldownTimer();

    const render = () => {
      if (remaining <= 0) {
        stopLoginCooldownTimer();
        msgEl.textContent = 'Vous pouvez réessayer maintenant.';
        return;
      }

      if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.textContent = `Réessayer dans ${remaining}s`;
      }
      msgEl.textContent = `Compte temporairement bloqué. Temps restant : ${remaining}s`;
      remaining -= 1;
    };

    render();
    loginCooldownTimer = setInterval(render, 1000);
  }

  if (logo) {
    logo.addEventListener('error', () => { logo.style.display = 'none'; });
  }

  // Modal de vérification email après inscription
  function showVerifyEmailModalAfterRegister(email) {
    const modal = qs('#notify-modal');
    const titleEl = qs('#notify-title');
    const msgEl = qs('#notify-message');
    const okBtn = qs('#notify-ok');
    const closeBtn = qs('#notify-close');
    
    // Si le modal n'existe pas, créer une alerte simple
    if (!modal || !titleEl || !msgEl) {
      registerMsg.innerHTML = `
        <div style="background: #d4edda; padding: 1rem; border-radius: 8px; border: 2px solid #28a745; text-align: center; color:#155724;">
          <div style="margin-bottom: 0.5rem;">${icon('mail','icon-lg')}</div>
          <strong>Compte créé !</strong><br>
          Un email de confirmation a été envoyé à <strong>${email}</strong>.<br>
          Cliquez sur le lien dans l'email pour activer votre compte.
        </div>
      `;
      return;
    }

    titleEl.textContent = 'Vérification email requise';
    msgEl.innerHTML = `
      <p style="margin:0 0 12px 0;">Un email de confirmation a été envoyé à <strong>${email}</strong>.</p>
      <p style="margin:0 0 12px 0;">Cliquez sur le lien dans l'email pour activer votre compte.</p>
      <div class="row gap" style="flex-wrap:wrap;align-items:center">
        <button id="resend-verif-register" class="btn">${icon('mail')}Renvoyer l'email</button>
        <span class="muted" style="font-size:12px">Vérifiez aussi vos spams / promotions.</span>
      </div>
    `;

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    modal.classList.remove('notify-success','notify-error','notify-info');
    modal.classList.add('notify-info');
    if (okBtn) okBtn.textContent = 'Fermer';

    const close = () => { modal.classList.add('hidden'); modal.style.display='none'; };
    okBtn?.addEventListener('click', close, { once: true });
    closeBtn?.addEventListener('click', close, { once: true });
    modal.addEventListener('click', (e)=>{ if (e.target.id === 'notify-modal') close(); }, { once: true });

    qs('#resend-verif-register')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Envoi...';
      try {
        const resp = await fetch('/api/auth/resend-verification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const res = await resp.json();
        if (!resp.ok) throw new Error(res.error || 'Erreur d\'envoi');
        msgEl.innerHTML = `<p style="color:#28a745;margin:0;">${icon('check-circle')}${res.message}</p>`;
      } catch (err) {
        if (err.cooldown) {
          msgEl.innerHTML = `<p style="color:#dc3545;margin:0;">${icon('clock')}${err.message}</p>`;
        } else {
          msgEl.innerHTML = `<p style="color:#dc3545;margin:0;">${icon('x-circle')}${err.message}</p>`;
        }
        btn.disabled = false;
        btn.innerHTML = `${icon('mail')}Renvoyer l'email`;
      }
    }, { once:true });
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

    if (loginBtn?.disabled && loginCooldownTimer) {
      return;
    }

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
        if (data?.cooldown) {
          startLoginCooldownTimer(data.remainingSeconds);
          return;
        }
        msgEl.textContent = data?.error || 'Échec de la connexion';
        return;
      }
      stopLoginCooldownTimer();
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
      if (loginBtn && !loginCooldownTimer) {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Se connecter';
      }
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
        const regEmailEl = qs('#register-email');
        const regPassEl = qs('#register-password');
        const regConfirmEl = qs('#register-password-confirm');
        
        // Afficher le modal de vérification email
        showVerifyEmailModalAfterRegister(email);
        
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
  qs('#forgot-password-link')?.addEventListener('click', async (e) => {
    e.preventDefault();
    msgEl.textContent = '';

    const email = (emailEl?.value || prompt('Entrez votre adresse email pour recevoir un lien de reinitialisation :') || '').trim();
    if (!email) return;

    msgEl.textContent = 'Envoi de l\'email...';

    try {
      const resp = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email })
      });
      const data = await resp.json();

      if (!resp.ok) {
        msgEl.textContent = data?.error || 'Impossible d\'envoyer l\'email de reinitialisation';
        return;
      }

      msgEl.textContent = data?.message || 'Si un compte existe avec cet email, un lien de reinitialisation a ete envoye.';
    } catch (err) {
      msgEl.textContent = 'Erreur reseau';
    }
  });

  showLogin();
})();
