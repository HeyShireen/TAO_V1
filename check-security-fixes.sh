#!/bin/bash

# ============================================================================
# 🔒 VÉRIFICATION DES CORRECTIONS DE SÉCURITÉ CRITIQUES
# ============================================================================
# Script pour valider que toutes les corrections critiques sont en place

echo "🔍 Vérification des corrections de sécurité..."
echo ""

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

CHECKS_PASSED=0
CHECKS_FAILED=0

# Fonction pour vérifier un fichier
check_file() {
  local file=$1
  local pattern=$2
  local name=$3
  
  if [ ! -f "$file" ]; then
    echo -e "${RED}❌ Fichier introuvable: $file${NC}"
    ((CHECKS_FAILED++))
    return 1
  fi
  
  if grep -q "$pattern" "$file"; then
    echo -e "${GREEN}✅ $name${NC}"
    ((CHECKS_PASSED++))
    return 0
  else
    echo -e "${RED}❌ $name NON TROUVÉ${NC}"
    ((CHECKS_FAILED++))
    return 1
  fi
}

echo "=== 🔐 VÉRIFICATIONS DES 6 CORRECTIFS CRITIQUES ==="
echo ""

# 1. CORS - Whitelist stricte
echo "1️⃣  CORS Protection..."
check_file "server/src/server.js" "ALLOWED_ORIGINS doit être défini en production" "CORS: Whitelist stricte en production"
echo ""

# 2. JWT Blacklist
echo "2️⃣  JWT Token Revocation..."
check_file "server/src/middleware.auth.js" "revokeToken" "JWT: Fonction de revocation du token"
check_file "server/src/middleware.auth.js" "tokenBlacklist" "JWT: Token blacklist global"
echo ""

# 3. Password Validation - 12 caractères minimum
echo "3️⃣  Password Strength..."
check_file "server/src/utils.validation.js" "password.length < 12" "Password: Minimum 12 caractères"
check_file "server/src/routes/users.js" "password.length < 12" "User Route: Password 12 caractères"
echo ""

# 4. Logout sécurisé
echo "4️⃣  Secure Logout..."
check_file "server/src/routes/auth.js" "revokeToken" "Logout: Token revocation"
check_file "server/src/routes/auth.js" "requireAuth" "Logout: Authentification requise"
echo ""

# 5. Security Init
echo "5️⃣  Security Initialization..."
check_file "server/src/security-init.js" "JWT_SECRET" "Security Init: Validation JWT_SECRET"
check_file "server/src/server.js" "security-init.js" "Server: Import security-init"
echo ""

# 6. Email Validation
echo "6️⃣  Email Validation..."
check_file "server/src/utils.validation.js" "emailRegex" "Email: Validation regex"
check_file "server/src/routes/auth.js" "validateEmail" "Auth: Email validation"
echo ""

echo "=== 📊 RÉSUMÉ DES VÉRIFICATIONS ==="
echo ""
echo -e "✅ Vérifications passées: ${GREEN}$CHECKS_PASSED${NC}"
echo -e "❌ Vérifications échouées: ${RED}$CHECKS_FAILED${NC}"
echo ""

if [ $CHECKS_FAILED -eq 0 ]; then
  echo -e "${GREEN}🎉 TOUTES LES CORRECTIONS CRITIQUES SONT EN PLACE!${NC}"
  echo ""
  echo "📝 Prochaines étapes:"
  echo "   1. Configurer .env avec ALLOWED_ORIGINS"
  echo "   2. Tester: npm start"
  echo "   3. Lancer: ./test-security.sh"
  exit 0
else
  echo -e "${RED}⚠️  CERTAINES CORRECTIONS MANQUENT${NC}"
  echo ""
  echo "❌ Fichiers à corriger:"
  grep -r "password.length < 6" server/src/ 2>/dev/null || true
  exit 1
fi
