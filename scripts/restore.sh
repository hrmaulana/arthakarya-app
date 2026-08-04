#!/usr/bin/env bash
# ============================================================
# Restore database Arthakarya dari backup
# ============================================================
# Penggunaan:
#   bash scripts/restore.sh /path/ke/arthakarya-20260804-020000.sql.gz
#
# ⚠️  MENIMPA seluruh data di database arthakarya dengan isi backup.
#     Pastikan backup yang dipilih benar. Prosedur lengkap + drill:
#     lihat OPS.md → "Restore Backup (Drill)".
set -euo pipefail

FILE="${1:-}"
if [ -z "${FILE}" ] || [ ! -f "${FILE}" ]; then
  echo "Usage: bash scripts/restore.sh <file-backup.sql.gz>"
  echo "Contoh: bash scripts/restore.sh /var/backups/arthakarya/arthakarya-20260804-020000.sql.gz"
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="docker compose -f ${PROJECT_DIR}/docker-compose.prod.yml"

# shellcheck disable=SC1091
source "${PROJECT_DIR}/.env"

echo "⚠️  RESTORE DATABASE — data saat ini di '${POSTGRES_DB}' akan DIGANTI dengan isi:"
echo "    ${FILE}"
echo -n "Ketik 'RESTORE' untuk melanjutkan: "
read -r CONFIRM
if [ "${CONFIRM}" != "RESTORE" ]; then
  echo "Dibatalkan."
  exit 1
fi

echo "[restore] Menyalakan database dulu jika belum jalan..."
${COMPOSE} up -d arthakarya_db
${COMPOSE} exec -T arthakarya_db pg_isready -U "${POSTGRES_USER}" >/dev/null

echo "[restore] Menjalankan restore..."
gunzip -c "${FILE}" | ${COMPOSE} exec -T arthakarya_db \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1

echo "[restore] ✅ Restore selesai."
echo "[restore] Verifikasi: docker compose -f ${PROJECT_DIR}/docker-compose.prod.yml exec -T arthakarya_db psql -U ${POSTGRES_USER} -d ${POSTGRES_DB} -c 'SELECT COUNT(*) FROM kegiatan;'"
