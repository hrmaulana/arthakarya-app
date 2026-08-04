#!/usr/bin/env bash
# ============================================================
# Generator secret production Arthakarya
# ============================================================
# Membuat nilai acak untuk POSTGRES_PASSWORD dan JWT_SECRET, lalu
# menghasilkan file `.env` production dari .env.example.prod.
#
# Penggunaan (di server, dari root repo):
#   bash scripts/gen-secrets.sh
#
# File .env dibuat di root repo. Periksa nilai yang tersisa (GANTI_*)
# dan isi: SERVER_NAME, LETSENCRYPT_EMAIL, CORS_ORIGIN, NAS_*, TELEGRAM_*.
set -euo pipefail

cd "$(dirname "$0")/.."   # root repo

if [ -f .env ]; then
  echo "⚠️  File .env sudah ada. Hentikan agar tidak menimpa secret lama."
  echo "   (Hapus dulu jika memang ingin membuat ulang.)"
  exit 1
fi

PG_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
JWT="$(openssl rand -base64 48 | tr -d '\n')"

sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${PG_PASS}/" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|" \
    .env.example.prod > .env

chmod 600 .env

echo "✅ .env dibuat di $(pwd)/.env"
echo "   Secret acak sudah terisi: POSTGRES_PASSWORD, JWT_SECRET."
echo "   ➜ Lengkapi nilai GANTI_* yang tersisa:"
echo "     - SERVER_NAME (hostname internal, mis. arthakarya.dinas.go.id)"
echo "     - LETSENCRYPT_EMAIL"
echo "     - CORS_ORIGIN"
echo "     - NAS_* dan TELEGRAM_* (untuk backup & monitoring)"
