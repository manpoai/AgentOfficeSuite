#!/bin/bash
# ASuite health check — verifies all services are running
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

check() {
  local name=$1 url=$2
  if curl -sf --max-time 5 "$url" > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} $name"
    return 0
  else
    echo -e "  ${RED}✗${NC} $name ($url)"
    return 1
  fi
}

echo "ASuite Service Health Check"
echo "==========================="

failed=0

check "Mattermost"  "http://localhost:8065/api/v4/system/ping" || ((failed++))
check "Outline"      "http://localhost:3000/api/info"           || ((failed++))
check "Plane API"    "http://localhost:8000/api/v1/health/"     || ((failed++))
check "Baserow"      "http://localhost:8280/api/_health/"        || ((failed++))
check "Dex"          "http://localhost:5556/dex/.well-known/openid-configuration" || ((failed++))
check "MinIO"        "http://localhost:9000/minio/health/live"  || ((failed++))
check "Gateway"      "http://localhost:4000/api/me"             || ((failed++)) # will 401 but that's OK
check "Shell"        "http://localhost:3101"                     || ((failed++))

echo ""
if [ $failed -eq 0 ]; then
  echo -e "${GREEN}All services healthy!${NC}"
else
  echo -e "${RED}$failed service(s) not responding${NC}"
  exit 1
fi
