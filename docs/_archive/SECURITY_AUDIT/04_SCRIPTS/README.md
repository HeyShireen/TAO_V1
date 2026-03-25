# ðŸ§ª 04_SCRIPTS - Scripts de Test

Scripts automatisÃ©s pour valider la sÃ©curitÃ©.

---

## ðŸ“„ Fichiers dans ce dossier

### **test-security.sh** â­â­â­
- **Taille:** 250 lignes
- **Language:** Bash
- **Status:** âœ… Production-ready
- **UtilitÃ©:** Tests automatisÃ©s de sÃ©curitÃ©

---

## ðŸš€ Usage

```bash
# Donner permission d'exÃ©cution
chmod +x 04_SCRIPTS/test-security.sh

# ExÃ©cuter sur local
./test-security.sh http://localhost:4000

# ExÃ©cuter sur production
./test-security.sh https://app.example.com

# Output: Security Score % + dÃ©tails
```

---

## âœ… Tests EffectuÃ©s (13 tests)

1. **HTTPS Redirect** - Force HTTPS en prod
2. **HSTS Header** - Security header present
3. **CSP Header** - Content Security Policy
4. **HTTP Security Headers** - X-Frame, X-Content-Type, etc.
5. **XSS Protection** - X-XSS-Protection header
6. **Clickjacking** - X-Frame-Options header
7. **Server Version** - Server header supprimÃ©
8. **Cookie Security** - HttpOnly + Secure flags
9. **CORS Protection** - CORS correctement configurÃ©
10. **SQL Injection** - ParamÃ¨tres validÃ©s
11. **Missing Auth** - Routes protÃ©gÃ©es
12. **Rate Limiting** - Rate limits appliquÃ©s
13. **JSON Response** - Content-Type correct

---

## ðŸ“Š Output Example

```
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  ðŸ”’ AO Link Security Test Suite
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Testing: http://localhost:4000

âœ“ PASS: HTTPS active
âœ“ PASS: HSTS header prÃ©sent
âœ“ PASS: CSP header prÃ©sent
âœ“ PASS: X-XSS-Protection header prÃ©sent
âœ“ PASS: X-Frame-Options prÃ©sent
âœ“ PASS: Server header supprimÃ©
âœ“ PASS: Cookie HttpOnly flag prÃ©sent
âœ“ PASS: CORS correctement configurÃ©
âœ“ PASS: Protection SQL Injection active
âœ“ PASS: Authentification requise
âœ“ PASS: Rate limiting appliquÃ©
âœ“ PASS: Content-Type correct
âœ“ PASS: JSON Response Security

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  ðŸ“Š RÃ‰SULTATS
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
âœ“ Passed: 13
âœ— Failed: 0

Score de SÃ©curitÃ©: 100% (13/13 tests)

âœ… TOUS LES TESTS PASSÃ‰S!
```

---

## ðŸŽ¯ Quand Utiliser

- **Before deployment:** Valider que tout fonctionne
- **After changes:** VÃ©rifier que rien n'est cassÃ©
- **In CI/CD:** IntÃ©grer dans pipeline
- **Regular monitoring:** ExÃ©cuter rÃ©guliÃ¨rement

---

## ðŸ“‹ Checklist

- [ ] Script executable (chmod +x)
- [ ] Application running
- [ ] ExÃ©cuter test-security.sh
- [ ] Tous les tests doivent passer âœ…
- [ ] Score de sÃ©curitÃ© â‰¥ 85%
- [ ] Aucun warning critique

---

## ðŸ’¡ Tips

**Test Ã©choue?** Consulter [../02_GUIDES/SECURITY_IMPLEMENTATION_GUIDE.md](../02_GUIDES/SECURITY_IMPLEMENTATION_GUIDE.md)

**Besoin de debug?** Utiliser `./test-security.sh -v` pour verbose mode

**IntÃ©grer dans CI?** Ajouter Ã  `.github/workflows/security.yml`

---

**Utiliser aprÃ¨s:** ImplÃ©menter les codes fixes de [../03_CODE_FIXES/](../03_CODE_FIXES/)

