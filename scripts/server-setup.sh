#!/usr/bin/env bash
# ============================================================
# server-setup.sh — Bootstrap satu-kali server laptop Arthakarya
# ============================================================
# Dijalankan DI SERVER (laptop Bappenas) sebagai root:
#   sudo bash scripts/server-setup.sh
#
# Yang dilakukan:
#   1. Update sistem + unattended-upgrades
#   2. Install Docker + compose plugin
#   3. Firewall (ufw: 22/80/443) + fail2ban
#   4. Pengaturan daya server (matikan sleep/hibernate, lid-close = ignore)
#   5. Clone repo ke /opt/arthakarya + buat .env production (interaktif)
#   6. Buat secrets/cloudflare.ini (interaktif)
#   7. Pasang crontab (backup 02:00, cek malam 05:30, renew cert bulanan)
#   8. Opsional: pasang GitHub Actions self-hosted runner (interaktif)
#
# Sebagian besar langkah idempotent — aman dijalankan ulang.
# Panduan lengkap: PHASE2.md dan OPS.md di repo.
set -euo pipefail

# ------------------------------------------------------------
# PREFLIGHT
# ------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  echo "❌ Jalankan sebagai root: sudo bash scripts/server-setup.sh"
  exit 1
fi

if ! grep -qiE "ubuntu" /etc/os-release; then
  echo "⚠️  Script ini ditargetkan untuk Ubuntu (LTS). /etc/os-release:"
  cat /etc/os-release | head -3
  echo -n "Lanjutkan? [y/N] "
  read -r ANS
  [ "${ANS}" = "y" ] || { echo "Dibatalkan."; exit 1; }
fi

export DEBIAN_FRONTEND=noninteractive
GITHUB_REPO="hrmaulana/arthakarya-app"
PROJECT_DIR="/opt/arthakarya"

echo "=============================================================="
echo "  Setup server Arthakarya — mulai"
echo "=============================================================="

# ------------------------------------------------------------
# 1. UPDATE SISTEM + UNATTENDED-UPGRADES
# ------------------------------------------------------------
echo "[1/8] Update sistem + unattended-upgrades..."
apt-get update -qq
apt-get upgrade -y -qq

if ! dpkg -s unattended-upgrades >/dev/null 2>&1; then
  apt-get install -y -qq unattended-upgrades
fi
mkdir -p /etc/apt/apt.conf.d
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
echo "  ✅ unattended-upgrades aktif"

# ------------------------------------------------------------
# 2. DOCKER + COMPOSE PLUGIN
# ------------------------------------------------------------
echo "[2/8] Docker..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker compose version >/dev/null 2>&1 || { echo "❌ docker compose plugin tidak tersedia."; exit 1; }
echo "  ✅ Docker $(docker --version) + compose plugin"

# ------------------------------------------------------------
# 3. FIREWALL + FAIL2BAN
# ------------------------------------------------------------
echo "[3/8] Firewall (ufw) + fail2ban..."
if command -v ufw >/dev/null 2>&1; then
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow 22/tcp comment 'SSH' >/dev/null
  ufw allow 80/tcp comment 'HTTP redirect' >/dev/null
  ufw allow 443/tcp comment 'HTTPS' >/dev/null
  ufw --force enable >/dev/null
  echo "  ✅ ufw aktif (hanya 22/80/443)"
else
  echo "  ⚠️  ufw tidak ditemukan — instal manual: apt install ufw"
fi

if ! dpkg -s fail2ban >/dev/null 2>&1; then
  apt-get install -y -qq fail2ban
fi
systemctl enable --now fail2ban
echo "  ✅ fail2ban aktif"

# ------------------------------------------------------------
# 4. PENGATURAN DAYA SERVER (laptop!)
# ------------------------------------------------------------
echo "[4/8] Pengaturan daya (server-laptop tidak boleh tidur)..."
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1 || true

cat > /etc/systemd/logind.conf <<'EOF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
HandlePowerKey=ignore
EOF
systemctl restart systemd-logind || true
echo "  ✅ sleep/hibernate dimatikan; lid-close = ignore (verifikasi: systemctl status sleep.target)"

# ------------------------------------------------------------
# 5. CLONE REPO + .env PRODUCTION
# ------------------------------------------------------------
echo "[5/8] Repo + .env..."
mkdir -p /opt
if [ ! -d "${PROJECT_DIR}/.git" ]; then
  git clone "https://github.com/${GITHUB_REPO}.git" "${PROJECT_DIR}"
  echo "  ✅ Repo di-clone ke ${PROJECT_DIR}"
else
  echo "  ℹ️  Repo sudah ada di ${PROJECT_DIR} — pull master..."
  git -C "${PROJECT_DIR}" checkout master
  git -C "${PROJECT_DIR}" pull --ff-only origin master
fi

cd "${PROJECT_DIR}"

if [ ! -f .env ]; then
  bash scripts/gen-secrets.sh

  # Isi nilai interaktif (yang GANTI_*)
  read -rp "  SERVER_NAME (hostname internal, mis. arthakarya.dinas.go.id): " SERVER_NAME
  [ -n "${SERVER_NAME}" ] && sed -i "s|^SERVER_NAME=.*|SERVER_NAME=${SERVER_NAME}|" .env

  read -rp "  LETSENCRYPT_EMAIL (email admin untuk sertifikat): " LETSENCRYPT_EMAIL
  [ -n "${LETSENCRYPT_EMAIL}" ] && sed -i "s|^LETSENCRYPT_EMAIL=.*|LETSENCRYPT_EMAIL=${LETSENCRYPT_EMAIL}|" .env

  CORS_DEFAULT="https://${SERVER_NAME}"
  read -rp "  CORS_ORIGIN [${CORS_DEFAULT}]: " CORS_ORIGIN
  [ -n "${CORS_ORIGIN}" ] && sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=${CORS_ORIGIN}|" .env \
    || sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=${CORS_DEFAULT}|" .env

  # Backup & monitoring (opsional — bisa diisi belakangan)
  echo "  Backup & monitoring (boleh dikosongkan, diisi belakangan):"
  read -rp "    NAS_HOST (mis. nas.kantor.local): " NAS_HOST
  [ -n "${NAS_HOST}" ] && sed -i "s|^NAS_HOST=.*|NAS_HOST=${NAS_HOST}|" .env
  read -rp "    NAS_USER: " NAS_USER
  [ -n "${NAS_USER}" ] && sed -i "s|^NAS_USER=.*|NAS_USER=${NAS_USER}|" .env
  read -rp "    NAS_PATH (mis. /backups/arthakarya): " NAS_PATH
  [ -n "${NAS_PATH}" ] && sed -i "s|^NAS_PATH=.*|NAS_PATH=${NAS_PATH}|" .env
  read -rp "    TELEGRAM_BOT_TOKEN (dari BotFather, kosongkan jika belum): " TELEGRAM_BOT_TOKEN
  [ -n "${TELEGRAM_BOT_TOKEN}" ] && sed -i "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}|" .env
  read -rp "    TELEGRAM_CHAT_ID (id chat/bot): " TELEGRAM_CHAT_ID
  [ -n "${TELEGRAM_CHAT_ID}" ] && sed -i "s|^TELEGRAM_CHAT_ID=.*|TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}|" .env

  chmod 600 .env
  echo "  ✅ .env dibuat (periksa: cat ${PROJECT_DIR}/.env | grep -v PASSWORD -v SECRET)"
else
  echo "  ℹ️  .env sudah ada — dilewati."
fi

# ------------------------------------------------------------
# 6. SECRETS CLOUDFLARE (untuk DNS-01 certbot)
# ------------------------------------------------------------
echo "[6/8] secrets/cloudflare.ini..."
mkdir -p secrets
if [ ! -f secrets/cloudflare.ini ]; then
  echo "  Buat API token Cloudflare dulu: dashboard → My Profile → API Tokens"
  echo "  → Create Token → Template 'Edit zone DNS' → scoped ke ZONE aplikasi"
  echo "  (izin Zone.DNS:Edit saja, bukan akun penuh)."
  read -rsp "  Tempel API token (tidak akan ditampilkan): " CF_TOKEN
  echo
  if [ -n "${CF_TOKEN}" ]; then
    cat > secrets/cloudflare.ini <<EOF
# Cloudflare API token — scoped Zone.DNS:Edit untuk zona aplikasi
dns_cloudflare_api_token = ${CF_TOKEN}
EOF
    chmod 600 secrets/cloudflare.ini
    echo "  ✅ secrets/cloudflare.ini dibuat (chmod 600)"
  else
    echo "  ⚠️  Token kosong — buat file ini manual nanti."
  fi
else
  echo "  ℹ️  secrets/cloudflare.ini sudah ada."
fi

# ------------------------------------------------------------
# 7. CRONTAB (backup, cek malam, renew sertifikat)
# ------------------------------------------------------------
echo "[7/8] Crontab..."
CRON_MARK="# ARTHAKARYA-OPS"
if crontab -l 2>/dev/null | grep -q "${CRON_MARK}"; then
  echo "  ℹ️  Entri cron Arthakarya sudah ada."
else
  ( crontab -l 2>/dev/null; cat <<EOF
${CRON_MARK}
0 2 * * *  bash ${PROJECT_DIR}/scripts/backup.sh >> /var/log/arthakarya-backup.log 2>&1
30 5 * * * bash ${PROJECT_DIR}/scripts/nightly-check.sh >> /var/log/arthakarya-check.log 2>&1
0 3 1 * *  docker compose -f ${PROJECT_DIR}/docker-compose.prod.yml run --rm certbot renew >> /var/log/arthakarya-cert.log 2>&1
EOF
  ) | crontab -
  echo "  ✅ Cron terpasang (backup 02:00, cek 05:30, renew cert bulanan)"
fi

# ------------------------------------------------------------
# 8. SELF-HOSTED RUNNER GITHUB ACTIONS (opsional)
# ------------------------------------------------------------
echo "[8/8] GitHub Actions self-hosted runner..."
read -rp "  Pasang self-hosted runner sekarang? [y/N] " DO_RUNNER
if [ "${DO_RUNNER}" = "y" ]; then
  id -u arthakarya >/dev/null 2>&1 || useradd -m -s /bin/bash arthakarya
  usermod -aG docker arthakarya

  if [ ! -d /opt/actions-runner/.runner ]; then
    mkdir -p /opt/actions-runner
    cd /opt/actions-runner
    VER="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
      | grep -oP '"tag_name":\s*"v\K[^"]+')"
    curl -fsSL -o runner.tar.gz \
      "https://github.com/actions/runner/releases/download/v${VER}/actions-runner-linux-x64-${VER}.tar.gz"
    tar xzf runner.tar.gz
    rm runner.tar.gz
    chown -R arthakarya:arthakarya /opt/actions-runner

    echo "  Daftarkan runner di GitHub: repo → Settings → Actions → Runners"
    echo "  → New self-hosted runner → dapatkan Registration token."
    read -rsp "  Registration token (atau kosongkan untuk dilewati): " RUNNER_TOKEN
    echo
    if [ -n "${RUNNER_TOKEN}" ]; then
      sudo -u arthakarya ./config.sh \
        --url "https://github.com/${GITHUB_REPO}" \
        --token "${RUNNER_TOKEN}" \
        --name "arthakarya-laptop" \
        --labels "arthakarya,linux,x64,self-hosted" \
        --work _work --unattended
      ./svc.sh install arthakarya
      ./svc.sh start
      echo "  ✅ Runner terdaftar & jalan sebagai service."
    fi
  else
    echo "  ℹ️  Runner sudah terdaftar di /opt/actions-runner."
  fi
fi

# ------------------------------------------------------------
# RINGKASAN
# ------------------------------------------------------------
echo ""
echo "=============================================================="
echo "  Setup selesai. Langkah berikutnya (lihat PHASE2.md & OPS.md):"
echo "=============================================================="
echo "  1. Delegasi DNS: di panel Rumaweb buat NS record subdomain"
echo "     (mis. arthakarya.dinas.go.id) → nameserver Cloudflare;"
echo "     di Cloudflare buat zona subdomain tsb + record A → IP LAN."
echo "  2. Terbitkan sertifikat pertama:"
echo "     cd ${PROJECT_DIR}"
echo "     docker compose -f docker-compose.prod.yml run --rm certbot"
echo "  3. Jalankan stack:"
echo "     docker compose -f docker-compose.prod.yml up -d --build"
echo "  4. Ambil password admin awal (dicetak SEKALI):"
echo "     docker compose -f docker-compose.prod.yml logs migrator"
echo "  5. Uji: buka https://<SERVER_NAME> di browser, login sebagai admin,"
echo "     ganti password segera."
echo "  6. Backup pertama: bash scripts/backup.sh"
echo "  7. DRILL RESTORE — wajib (OPS.md bagian 5)."
echo "=============================================================="
