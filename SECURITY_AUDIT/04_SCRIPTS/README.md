# 🧪 04_SCRIPTS - Scripts de Test

Scripts automatisés pour valider la sécurité.

---

## 📄 Fichiers dans ce dossier

### **test-security.sh** ⭐⭐⭐
- **Taille:** 250 lignes
- **Language:** Bash
- **Status:** ✅ Production-ready
- **Utilité:** Tests automatisés de sécurité

---

## 🚀 Usage

```bash
# Donner permission d'exécution
chmod +x 04_SCRIPTS/test-security.sh

# Exécuter sur local
./test-security.sh http://localhost:4000

# Exécuter sur production
./test-security.sh https://app.example.com

# Output: Security Score % + détails
```

---

## ✅ Tests Effectués (13 tests)

1. **HTTPS Redirect** - Force HTTPS en prod
2. **HSTS Header** - Security header present
3. **CSP Header** - Content Security Policy
4. **HTTP Security Headers** - X-Frame, X-Content-Type, etc.
5. **XSS Protection** - X-XSS-Protection header
6. **Clickjacking** - X-Frame-Options header
7. **Server Version** - Server header supprimé
8. **Cookie Security** - HttpOnly + Secure flags
9. **CORS Protection** - CORS correctement configuré
10. **SQL Injection** - Paramètres validés
11. **Missing Auth** - Routes protégées
12. **Rate Limiting** - Rate limits appliqués
13. **JSON Response** - Content-Type correct

---

## 📊 Output Example

```
════════════════════════════════════════════════════════
  🔒 TAO Security Test Suite
════════════════════════════════════════════════════════
Testing: http://localhost:4000

✓ PASS: HTTPS active
✓ PASS: HSTS header présent
✓ PASS: CSP header présent
✓ PASS: X-XSS-Protection header présent
✓ PASS: X-Frame-Options présent
✓ PASS: Server header supprimé
✓ PASS: Cookie HttpOnly flag présent
✓ PASS: CORS correctement configuré
✓ PASS: Protection SQL Injection active
✓ PASS: Authentification requise
✓ PASS: Rate limiting appliqué
✓ PASS: Content-Type correct
✓ PASS: JSON Response Security

════════════════════════════════════════════════════════
  📊 RÉSULTATS
════════════════════════════════════════════════════════
✓ Passed: 13
✗ Failed: 0

Score de Sécurité: 100% (13/13 tests)

✅ TOUS LES TESTS PASSÉS!
```

---

## 🎯 Quand Utiliser

- **Before deployment:** Valider que tout fonctionne
- **After changes:** Vérifier que rien n'est cassé
- **In CI/CD:** Intégrer dans pipeline
- **Regular monitoring:** Exécuter régulièrement

---

## 📋 Checklist

- [ ] Script executable (chmod +x)
- [ ] Application running
- [ ] Exécuter test-security.sh
- [ ] Tous les tests doivent passer ✅
- [ ] Score de sécurité ≥ 85%
- [ ] Aucun warning critique

---

## 💡 Tips

**Test échoue?** Consulter [../02_GUIDES/SECURITY_IMPLEMENTATION_GUIDE.md](../02_GUIDES/SECURITY_IMPLEMENTATION_GUIDE.md)

**Besoin de debug?** Utiliser `./test-security.sh -v` pour verbose mode

**Intégrer dans CI?** Ajouter à `.github/workflows/security.yml`

---

**Utiliser après:** Implémenter les codes fixes de [../03_CODE_FIXES/](../03_CODE_FIXES/)

