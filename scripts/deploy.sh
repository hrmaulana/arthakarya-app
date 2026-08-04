#!/usr/bin/env bash
# ============================================================
# Deploy rilis Arthakarya ke production (dijalankan DI SERVER)
# ============================================================
# - Checkout tag rilis, build image, jalankan compose production
# - Smoke test: health check + login dengan kredensial dummy
#
# Dipanggil otomatis oleh GitHub Actions (job deploy, self-hosted
# runner di server) saat tag v* di-push. Bisa juga dijalankan manual:
#   bash scripts/deploy.sh v1.0.0
#
# Rollback (kembali ke tag sebelumnya):
#   bash scripts/deploy.sh v0.9.0
set -euo pipefail

TAG="${1:?Usage: deploy.sh <tag> (mis. v1.0.0)}"

PROJECT_DIR="${PROJECT_DIR:-/opt/arthakarya}"
COMPOSE="docker compose -f ${PROJECT_DIR}/docker-compose.prod.yml"

echo "[deploy] Mulai deploy ${TAG}"

cd "${PROJECT_DIR}"

# Pastikan tag ada di remote
git fetch --tags origin
if ! git rev-parse --verify "${TAG}^{commit}" >/dev/null 2>&1; then
  echo "❌ Tag ${TAG} tidak ditemukan."
  exit 1
fi

# Checkout tag (detached HEAD — persis isi rilis)
git checkout --force "${TAG}"
git clean -fd

# Rebuild + jalankan
${COMPOSE} up -d --build

# Smoke test
echo "[deploy] Smoke test..."
sleep 10

if ! curl -fsS http://localhost/api/health >/dev/null; then
  echo "❌ Health check gagal."
  exit 1
fi

# Login dengan kredensial dummy: diharapkan 401 "Username atau password salah"
LOGIN_BODY='{"username":"smoke_test_nonexistent","password":"x"}'
if ! curl -s -X POST http://localhost/api/auth/login \
     -H 'Content-Type: application/json' -d "${LOGIN_BODY}" \
     | grep -q 'Username atau password salah'; then
  echo "❌ Smoke login gagal."
  exit 1
fi

echo "[deploy] ✅ Deploy ${TAG} selesai & sehat."
