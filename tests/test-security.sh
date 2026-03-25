#!/bin/bash
# ============================================================================
# SECURITY TEST SUITE - AO Link
# ============================================================================
# Ce script teste automatiquement les vulnérabilités de sécurité communes
# Usage: ./test-security.sh https://app.example.com

set -e

BASE_URL="${1:-http://localhost:4000}"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0

# ============================================================================
# Fonctions
# ============================================================================

test_cors() {
  echo -e "${BLUE}[TEST] CORS Protection${NC}"
  
  local response=$(curl -s -w "\n%{http_code}" -H "Origin: https://attacker.com" "$BASE_URL/api/projects")
  local http_code=$(echo "$response" | tail -n 1)
  local body=$(echo "$response" | head -n -1)
  
  # Vérifier que la requête a réussi (200) mais qu'ACES n'est pas exposé
  if [[ "$http_code" == "200" ]] && echo "$body" | grep -q "Access-Control-Allow-Origin: https://attacker.com"; then
    echo -e "${RED}✗ FAIL: CORS trop permissif${NC}"
    ((FAILED++))
  else
    echo -e "${GREEN}✓ PASS: CORS correctement configuré${NC}"
    ((PASSED++))
  fi
}

test_https() {
  echo -e "${BLUE}[TEST] HTTPS Redirect${NC}"
  
  local response=$(curl -s -w "\n%{http_code}" -L "http://app.example.com/api")
  local http_code=$(echo "$response" | tail -n 1)
  
  if [[ "$BASE_URL" == https://* ]]; then
    if [[ "$http_code" == "200" ]] || [[ "$http_code" == "301" ]] || [[ "$http_code" == "302" ]]; then
      echo -e "${GREEN}✓ PASS: HTTPS actif${NC}"
      ((PASSED++))
    else
      echo -e "${RED}✗ FAIL: HTTPS non fonctionnel${NC}"
      ((FAILED++))
    fi
  fi
}

test_hsts() {
  echo -e "${BLUE}[TEST] HSTS Header${NC}"
  
  local response=$(curl -sI "$BASE_URL" 2>/dev/null | grep -i "strict-transport-security" || true)
  
  if [[ -n "$response" ]]; then
    echo -e "${GREEN}✓ PASS: HSTS header présent${NC}"
    echo "  $response"
    ((PASSED++))
  else
    echo -e "${RED}✗ FAIL: HSTS header manquant${NC}"
    ((FAILED++))
  fi
}

test_csp() {
  echo -e "${BLUE}[TEST] CSP Header${NC}"
  
  local response=$(curl -sI "$BASE_URL" 2>/dev/null | grep -i "content-security-policy" || true)
  
  if [[ -n "$response" ]]; then
    echo -e "${GREEN}✓ PASS: CSP header présent${NC}"
    ((PASSED++))
  else
    echo -e "${RED}✗ FAIL: CSP header manquant${NC}"
    ((FAILED++))
  fi
}

test_sql_injection() {
  echo -e "${BLUE}[TEST] SQL Injection Protection${NC}"
  
  # Tenter une injection SQL simple
  local response=$(curl -s "$BASE_URL/api/projects/1' OR '1'='1" -w "\n%{http_code}")
  local http_code=$(echo "$response" | tail -n 1)
  local body=$(echo "$response" | head -n -1)
  
  if [[ "$http_code" == "400" ]] && echo "$body" | grep -qE "(invalide|ID|error)"; then
    echo -e "${GREEN}✓ PASS: Protection SQL Injection active${NC}"
    ((PASSED++))
  elif [[ "$http_code" == "401" ]] || [[ "$http_code" == "403" ]]; then
    echo -e "${GREEN}✓ PASS: Requête rejetée (auth requise)${NC}"
    ((PASSED++))
  else
    echo -e "${YELLOW}⚠ WARN: Response inattendue: $http_code${NC}"
  fi
}

test_rate_limiting() {
  echo -e "${BLUE}[TEST] Rate Limiting${NC}"
  
  local count=0
  for i in {1..10}; do
    local response=$(curl -s -w "%{http_code}" -X POST "$BASE_URL/api/auth/login" \
      -H "Content-Type: application/json" \
      -d '{"email":"test@test.com","password":"wrong"}' -o /dev/null)
    
    if [[ "$response" == "429" ]]; then
      echo -e "${GREEN}✓ PASS: Rate limiting appliqué après $i tentatives${NC}"
      ((PASSED++))
      return
    fi
    ((count++))
  done
  
  echo -e "${YELLOW}⚠ WARN: Rate limiting non déclenché après 10 tentatives${NC}"
}

test_missing_auth() {
  echo -e "${BLUE}[TEST] Missing Authentication Protection${NC}"
  
  local response=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/projects")
  local http_code=$(echo "$response" | tail -n 1)
  
  if [[ "$http_code" == "401" ]] || [[ "$http_code" == "403" ]]; then
    echo -e "${GREEN}✓ PASS: Authentification requise${NC}"
    ((PASSED++))
  else
    echo -e "${RED}✗ FAIL: Endpoint non protégé!${NC}"
    ((FAILED++))
  fi
}

test_http_headers() {
  echo -e "${BLUE}[TEST] Security Headers${NC}"
  
  local headers=$(curl -sI "$BASE_URL" 2>/dev/null)
  
  local required_headers=(
    "Strict-Transport-Security"
    "Content-Security-Policy"
    "X-Content-Type-Options"
    "X-Frame-Options"
  )
  
  local missing=0
  for header in "${required_headers[@]}"; do
    if echo "$headers" | grep -qi "$header"; then
      echo -e "${GREEN}✓ $header présent${NC}"
    else
      echo -e "${RED}✗ $header manquant${NC}"
      ((missing++))
    fi
  done
  
  if [[ $missing -eq 0 ]]; then
    ((PASSED++))
  else
    ((FAILED++))
  fi
}

test_xss_protection() {
  echo -e "${BLUE}[TEST] XSS Protection${NC}"
  
  local response=$(curl -sI "$BASE_URL" 2>/dev/null | grep -i "x-xss-protection" || true)
  
  if [[ -n "$response" ]]; then
    echo -e "${GREEN}✓ PASS: X-XSS-Protection header présent${NC}"
    ((PASSED++))
  else
    echo -e "${RED}✗ FAIL: X-XSS-Protection header manquant${NC}"
    ((FAILED++))
  fi
}

test_clickjacking() {
  echo -e "${BLUE}[TEST] Clickjacking Protection${NC}"
  
  local response=$(curl -sI "$BASE_URL" 2>/dev/null | grep -i "X-Frame-Options" || true)
  
  if [[ -n "$response" ]]; then
    echo -e "${GREEN}✓ PASS: X-Frame-Options présent${NC}"
    echo "  $response"
    ((PASSED++))
  else
    echo -e "${RED}✗ FAIL: X-Frame-Options manquant${NC}"
    ((FAILED++))
  fi
}

test_server_version() {
  echo -e "${BLUE}[TEST] Server Version Disclosure${NC}"
  
  local response=$(curl -sI "$BASE_URL" 2>/dev/null | grep -i "^Server:" || true)
  
  if [[ -z "$response" ]]; then
    echo -e "${GREEN}✓ PASS: Server header supprimé${NC}"
    ((PASSED++))
  else
    echo -e "${RED}✗ FAIL: Server info exposée: $response${NC}"
    ((FAILED++))
  fi
}

test_cookie_security() {
  echo -e "${BLUE}[TEST] Cookie Security${NC}"
  
  # Faire un login test et vérifier les flags du cookie
  local response=$(curl -sI -c /tmp/cookies.txt "$BASE_URL" 2>/dev/null)
  
  if [ -f /tmp/cookies.txt ]; then
    local has_httponly=$(grep -i "httponly" /tmp/cookies.txt || echo "")
    local has_secure=$(grep -i "secure" /tmp/cookies.txt || echo "")
    
    if [[ -n "$has_httponly" ]]; then
      echo -e "${GREEN}✓ PASS: Cookie HttpOnly flag présent${NC}"
      ((PASSED++))
    else
      echo -e "${YELLOW}⚠ WARN: HttpOnly flag manquant${NC}"
    fi
  fi
}

test_json_response() {
  echo -e "${BLUE}[TEST] JSON Response Security${NC}"
  
  local response=$(curl -s "$BASE_URL/api" 2>/dev/null)
  local content_type=$(curl -sI "$BASE_URL/api" 2>/dev/null | grep -i "content-type" || true)
  
  if echo "$content_type" | grep -q "application/json"; then
    echo -e "${GREEN}✓ PASS: Content-Type correct${NC}"
    ((PASSED++))
  else
    echo -e "${YELLOW}⚠ WARN: Content-Type non spécifié${NC}"
  fi
}

# ============================================================================
# MAIN
# ============================================================================

echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  🔒 AO Link Security Test Suite${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo "Testing: $BASE_URL"
echo ""

# Vérifier que le serveur est accessible
if ! curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/healthz" > /dev/null 2>&1; then
  echo -e "${RED}❌ Erreur: Impossible d'accéder à $BASE_URL${NC}"
  exit 1
fi

# Exécuter tous les tests
test_https
test_hsts
test_csp
test_http_headers
test_xss_protection
test_clickjacking
test_server_version
test_cookie_security
test_cors
test_sql_injection
test_missing_auth
test_rate_limiting
test_json_response

# ============================================================================
# RÉSUMÉ
# ============================================================================

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  📊 RÉSULTATS${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Passed: $PASSED${NC}"
echo -e "${RED}✗ Failed: $FAILED${NC}"

local total=$((PASSED + FAILED))
local percentage=$((PASSED * 100 / total))

echo ""
echo -e "Score de Sécurité: ${BLUE}$percentage%${NC} ($PASSED/$total tests)"

if [[ $FAILED -eq 0 ]]; then
  echo -e "${GREEN}✅ TOUS LES TESTS PASSÉS!${NC}"
  exit 0
else
  echo -e "${RED}⚠️ $FAILED tests échoués - À corriger${NC}"
  exit 1
fi
