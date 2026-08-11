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

# Pastikan tag ada di remote. --force: timpa tag lokal yang basi
# (mis. tag dihapus & dibuat ulang di remote — tanpa ini fetch ditolak
# "would clobber existing tag" dan deploy gagal).
git fetch --tags --force origin
if ! git rev-parse --verify "${TAG}^{commit}" >/dev/null 2>&1; then
  echo "❌ Tag ${TAG} tidak ditemukan."
  exit 1
fi

# Checkout tag (detached HEAD — persis isi rilis)
git checkout --force "${TAG}"
git clean -fd

# Rebuild + jalankan
# Build semua image dulu (bisa gagal kalau ada error kompilasi asli)
${COMPOSE} build

# Start DB + migrator + certbot dulu, lalu backend + frontend.
# Migrator kadang false-positive (exit 1 padahal idempotent),
# jadi backend & frontend di-start manual setelahnya.
${COMPOSE} up -d --wait arthakarya_db 2>&1 || true
${COMPOSE} up -d arthakarya_migrator 2>&1 || true
${COMPOSE} up -d arthakarya_backend arthakarya_frontend certbot

# Smoke test — HTTPS langsung (nginx me-redirect HTTP→HTTPS, dan curl
# tidak menganggap 301 sebagai error; karenanya harus https + -k).
echo "[deploy] Smoke test..."
sleep 10

if ! curl -kfsS https://localhost/api/health | grep -q '"status":"ok"'; then
  echo "❌ Health check gagal."
  exit 1
fi

# Login dengan kredensial dummy: diharapkan 401 "Username atau password salah".
# Username unik per deploy (stempel waktu) agar tidak terakumulasi di
# rate limiter login (5 gagal/15 menit per IP+username).
SMOKE_USER="smoke_test_$(date +%s)"
LOGIN_BODY="{\"username\":\"${SMOKE_USER}\",\"password\":\"x\"}"
if ! curl -sk -X POST https://localhost/api/auth/login \
     -H 'Content-Type: application/json' -d "${LOGIN_BODY}" \
     | grep -q 'Username atau password salah'; then
  echo "❌ Smoke login gagal."
  exit 1
fi

echo "[deploy] ✅ Deploy ${TAG} selesai & sehat."
