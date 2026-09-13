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

# Pastikan .git writable oleh runner. Kadang .git/FETCH_HEAD terkunci
# setelah checkout tag oleh user berbeda — tanpa ini git fetch gagal.
chmod -R u+w .git 2>/dev/null || true

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
# Hapus file untracked, kecuali .env (tidak di-git, tapi wajib ada)
git clean -fd --exclude=.env

# Rebuild + jalankan
# Build semua image dulu supaya error kompilasi ketahuan awal.
${COMPOSE} build
# Start semua service. Migrator mungkin exit 1 (false-positive),
# tapi dengan condition: service_started, backend tetap jalan.
${COMPOSE} up -d

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

# Restart SSH reverse tunnel agar VPS publik dapet container baru
systemctl restart arthakarya-tunnel || echo "[deploy] ⚠️ Tunnel restart gagal (tidak kritis)."

echo "[deploy] ✅ Deploy ${TAG} selesai & sehat."
