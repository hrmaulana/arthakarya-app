#!/usr/bin/env bash
# ============================================================
# Backup harian database Arthakarya
# ============================================================
# - pg_dump + gzip ke $BACKUP_DIR (host)
# - Retensi: 14 harian + 4 mingguan + 3 bulanan
# - Kirim salinan ke NAS kantor via rsync (jika NAS_* diisi di .env)
# - Notifikasi Telegram jika gagal (jika TELEGRAM_* diisi)
#
# Cron (host): 0 2 * * *  root  bash /opt/arthakarya/scripts/backup.sh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="docker compose -f ${PROJECT_DIR}/docker-compose.prod.yml"

# Muat konfigurasi dari .env production
# shellcheck disable=SC1091
source "${PROJECT_DIR}/.env"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/arthakarya}"
RETENTION_DAILY=14
RETENTION_WEEKLY=4
RETENTION_MONTHLY=3

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/arthakarya-${STAMP}.sql.gz"

notify() {
  # $1 = teks pesan
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      -d "text=${1}" >/dev/null 2>&1 || true
  fi
}

echo "[backup] Mulai ${STAMP}"

# 1. Dump database
mkdir -p "${BACKUP_DIR}"
${COMPOSE} exec -T arthakarya_db \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  | gzip > "${BACKUP_FILE}"

# 2. Verifikasi ukuran file (> 1MB = bukan dump kosong)
SIZE="$(stat -c %s "${BACKUP_FILE}")"
if [ "${SIZE}" -lt 1048576 ]; then
  echo "[backup] ❌ File backup terlalu kecil (${SIZE} bytes) — kemungkinan gagal."
  notify "🔴 Arthakarya: backup GAGAL — file ${BACKUP_FILE} hanya ${SIZE} bytes"
  exit 1
fi
echo "[backup] ✅ ${BACKUP_FILE} (${SIZE} bytes)"

# 3. Retensi — klasifikasi per file (terbaru → tertua):
#    bulanan (tanggal 1) dipertahankan 3, mingguan (Minggu) 4, harian 14;
#    sisanya dihapus.
MONTHLY_KEPT=0
WEEKLY_KEPT=0
DAILY_KEPT=0
while IFS= read -r f; do
  base="$(basename "${f}")"          # arthakarya-YYYYMMDD-HHMMSS.sql.gz
  datepart="${base#arthakarya-}"     # YYYYMMDD-HHMMSS.sql.gz
  datepart="${datepart%%-*}"         # YYYYMMDD
  y="${datepart:0:4}"; m="${datepart:4:2}"; d="${datepart:6:2}"
  dow="$(date -d "${y}-${m}-${d}" +%u)"   # 7 = Minggu
  if [ "${d}" = "01" ] && [ "${MONTHLY_KEPT}" -lt "${RETENTION_MONTHLY}" ]; then
    MONTHLY_KEPT=$((MONTHLY_KEPT + 1)); continue
  fi
  if [ "${dow}" = "7" ] && [ "${WEEKLY_KEPT}" -lt "${RETENTION_WEEKLY}" ]; then
    WEEKLY_KEPT=$((WEEKLY_KEPT + 1)); continue
  fi
  if [ "${DAILY_KEPT}" -lt "${RETENTION_DAILY}" ]; then
    DAILY_KEPT=$((DAILY_KEPT + 1)); continue
  fi
  rm -f "${f}"
  echo "[backup] retensi: hapus ${base}"
done < <(ls -1 "${BACKUP_DIR}"/arthakarya-*.sql.gz 2>/dev/null | sort -r)

# 4. Kirim ke NAS (off-server — WAJIB agar backup benar-benar aman)
if [ -n "${NAS_HOST:-}" ] && [ -n "${NAS_USER:-}" ] && [ -n "${NAS_PATH:-}" ]; then
  if rsync -a --timeout=120 "${BACKUP_DIR}/" "${NAS_USER}@${NAS_HOST}:${NAS_PATH}/"; then
    echo "[backup] ✅ Salinan terkirim ke NAS ${NAS_HOST}:${NAS_PATH}"
    notify "🟢 Arthakarya: backup OK (${SIZE} bytes) + salinan NAS terkirim"
  else
    echo "[backup] ❌ rsync ke NAS gagal — backup lokal tetap tersimpan"
    notify "🟡 Arthakarya: backup lokal OK (${SIZE} bytes) tapi KIRIM NAS GAGAL"
    exit 1
  fi
else
  echo "[backup] ⚠️  NAS belum dikonfigurasi — backup hanya lokal. Isi NAS_* di .env!"
  notify "🟡 Arthakarya: backup lokal OK (${SIZE} bytes) — NAS BELUM dikonfigurasi"
fi

echo "[backup] Selesai."
