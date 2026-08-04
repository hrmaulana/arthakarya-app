#!/usr/bin/env bash
# ============================================================
# Pemeriksaan kesehatan malam Arthakarya → notifikasi Telegram
# ============================================================
# Cek: (1) container sehat, (2) backup terbaru ada & wajar,
#      (3) ruang disk, (4) kesehatan SSD (smartctl), (5) suhu CPU.
# Kirim notifikasi Telegram HANYA jika ada masalah.
#
# Cron (host): 30 5 * * *  root  bash /opt/arthakarya/scripts/nightly-check.sh
set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="docker compose -f ${PROJECT_DIR}/docker-compose.prod.yml"

# shellcheck disable=SC1091
source "${PROJECT_DIR}/.env"

notify() {  # $1 = teks
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" -d "text=${1}" >/dev/null 2>&1 || true
  fi
}

PROBLEMS=""

# --- 1. Container sehat -------------------------------------------------
UNHEALTHY="$(${COMPOSE} ps --format '{{.Name}} {{.Status}}' 2>/dev/null | grep -vE 'Up |running' || true)"
if [ -n "${UNHEALTHY}" ]; then
  PROBLEMS="${PROBLEMS}
⚠️ Container bermasalah:
${UNHEALTHY}"
fi

# --- 2. Backup terbaru ---------------------------------------------------
BACKUP_DIR="${BACKUP_DIR:-/var/backups/arthakarya}"
LATEST="$(ls -1t "${BACKUP_DIR}"/arthakarya-*.sql.gz 2>/dev/null | head -1 || true)"
if [ -z "${LATEST}" ]; then
  PROBLEMS="${PROBLEMS}
🔴 TIDAK ADA backup sama sekali di ${BACKUP_DIR}"
else
  LATEST_AGE_SEC=$(( $(date +%s) - $(stat -c %Y "${LATEST}") ))
  LATEST_SIZE="$(stat -c %s "${LATEST}")"
  if [ "${LATEST_AGE_SEC}" -gt $((26 * 3600)) ]; then
    PROBLEMS="${PROBLEMS}
🟡 Backup terbaru berumur lebih dari 26 jam: $(basename "${LATEST}")"
  fi
  if [ "${LATEST_SIZE}" -lt 1048576 ]; then
    PROBLEMS="${PROBLEMS}
🔴 Backup terbaru terlalu kecil (<1MB): $(basename "${LATEST}") (${LATEST_SIZE} bytes)"
  fi
fi

# --- 3. Ruang disk -------------------------------------------------------
USAGE="$(df -P / | awk 'NR==2 {print $5}' | tr -d '%')"
if [ -n "${USAGE}" ] && [ "${USAGE}" -gt 90 ]; then
  PROBLEMS="${PROBLEMS}
🔴 Disk ${USAGE}% penuh (ambang 90%)"
elif [ -n "${USAGE}" ] && [ "${USAGE}" -gt 80 ]; then
  PROBLEMS="${PROBLEMS}
🟡 Disk ${USAGE}% (ambang peringatan 80%)"
fi

# --- 4. Kesehatan SSD (smartctl, jika tersedia) ---------------------------
if command -v smartctl >/dev/null 2>&1; then
  for dev in $(ls /dev/sd? /dev/nvme0n1 2>/dev/null); do
    HEALTH="$(smartctl -H "${dev}" 2>/dev/null | grep -Eo 'PASSED|FAILED' | head -1)"
    if [ "${HEALTH}" = "FAILED" ]; then
      PROBLEMS="${PROBLEMS}
🔴 SSD ${dev} gagal health check (smartctl)"
    fi
  done
fi

# --- 5. Suhu CPU (lm-sensors, jika tersedia) ------------------------------
if command -v sensors >/dev/null 2>&1; then
  TEMP="$(sensors 2>/dev/null | grep -oE '[0-9]{2,3}\.[0-9]°C' | sort -t. -k1 -n | tail -1)"
  TEMP_NUM="$(echo "${TEMP}" | grep -oE '[0-9]+' | head -1)"
  if [ -n "${TEMP_NUM}" ] && [ "${TEMP_NUM}" -gt 80 ]; then
    PROBLEMS="${PROBLEMS}
🔴 Suhu CPU tinggi: ${TEMP}"
  fi
fi

# --- Kirim hasil ----------------------------------------------------------
if [ -n "${PROBLEMS}" ]; then
  MSG="🚨 Arthakarya — MASALAH TERDETEKSI (cek malam)
${PROBLEMS}"
  notify "${MSG}"
  echo "${MSG}"
  exit 1
else
  echo "[nightly-check] ✅ Semua sehat."
fi
