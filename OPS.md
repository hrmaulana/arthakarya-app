# OPS.md — Runbook Operasional Arthakarya (Production)

Dokumen operasional untuk server produksi Arthakarya di kantor Bappenas.
**Bacalah dokumen ini lengkap minimal sekali**, terutama bagian Restore
Backup — saat terjadi darurat bukan waktunya belajar.

---

## 1. Arsitektur & Topologi

```
Browser pengguna (jaringan Bappenas)
        │ HTTPS (443)
        ▼
┌─────────────────────────┐
│ nginx (frontend)        │  container: arthakarya_frontend
│ SPA + proxy /api →      │  port host: 80 → 443 (redirect)
│ → backend (internal)    │
└────────────┬────────────┘
             │ docker network (internal, port backend TIDAK terbuka ke host)
┌────────────▼────────────┐
│ Backend Bun + Express   │  container: arthakarya_backend
└────────────┬────────────┘
┌────────────▼────────────┐
│ PostgreSQL 16           │  container: arthakarya_db (volume arthakarya_pgdata_prod)
└─────────────────────────┘
```

- **Host**: laptop bekas (16 GB RAM, 1 TB SSD, Ubuntu LTS) di jaringan Bappenas.
- **IP**: statis / DHCP reservation. DNS internal: `SERVER_NAME` → IP LAN laptop.
- **TLS**: Let's Encrypt (DNS-01 via Cloudflare, subdomain didelegasikan),
  renewal otomatis via cron host.
- **SSE `/api/rekap/events`** (live refresh halaman RPD): nginx proxy `/api` harus
  **menonaktifkan buffering** untuk endpoint ini agar event terkirim instan —
  tambah `proxy_buffering off;` (atau per-route `location /api/rekap/events {
  proxy_buffering off; }`) di konfigurasi nginx frontend. Endpoint sudah mengirim
  header `X-Accel-Buffering: no` + ping keepalive tiap 25 dtk, dan `retry: 3000`
  di sisi klien EventSource. Hub broadcast in-memory hanya menjangkau satu proses
  server (single-instance — sesuai arsitektur saat ini).
- **Data**: hanya di volume Docker `arthakarya_pgdata_prod` + backup di
  `/var/backups/arthakarya` + salinan harian di NAS kantor.

---

## 2. File & Lokasi Penting di Server

| Path | Isi |
| ---- | --- |
| `/opt/arthakarya` | Clone repo (deploy via tag) |
| `/opt/arthakarya/.env` | **Semua secret produksi** (chmod 600, root) |
| `/opt/arthakarya/secrets/cloudflare.ini` | Kredensial API Cloudflare (chmod 600) |
| `/opt/arthakarya/docker-compose.prod.yml` | Stack produksi |
| `/opt/arthakarya/scripts/` | backup.sh, restore.sh, deploy.sh, nightly-check.sh |
| `/var/backups/arthakarya/` | Backup harian (retensi 14/4/3) |
| `/root/.ssh/` | SSH key server + key deploy backup ke NAS |

Crontab host (root) — `crontab -e`:
```
0 2 * * *  bash /opt/arthakarya/scripts/backup.sh >> /var/log/arthakarya-backup.log 2>&1
30 5 * * * bash /opt/arthakarya/scripts/nightly-check.sh >> /var/log/arthakarya-check.log 2>&1
0 3 1 * *  docker compose -f /opt/arthakarya/docker-compose.prod.yml run --rm certbot renew >> /var/log/arthakarya-cert.log 2>&1
```

---

## 3. Deploy Rilis (Normal)

Deploy otomatis via tag + self-hosted runner (GitHub Actions):

1. Pastikan CI hijau di branch `master` (test backend + build frontend).
2. Buat tag rilis dan push:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. GitHub Actions menjalankan `scripts/deploy.sh v1.0.0` **di server**
   (self-hosted runner): checkout tag → `docker compose up -d --build` →
   smoke test (health + login dummy). Sukses = hijau di Actions.

**Deploy manual** (jika runner bermasalah):
```bash
cd /opt/arthakarya
bash scripts/deploy.sh v1.0.0
```

**Aturan**: rilis hanya lewat tag. Jangan pernah `git pull` + `up -d`
di server di luar prosedur ini.

---

## 4. Rollback

Kembalikan ke tag sebelumnya (image lama dibangun ulang dari tag itu):

```bash
cd /opt/arthakarya
bash scripts/deploy.sh v0.9.0     # tag sebelumnya
```

Rollback **database** (jika rilis membawa migrasi yang bermasalah):
1. Pulihkan dari backup sebelum rilis — lihat bagian 5.
2. Rilis berikutnya harus memperbaiki migrasinya (migrasi yang sudah
   tercatat di `schema_migrations` tidak akan dijalankan ulang).

---

## 5. Backup & Restore (Drill WAJIB)

### Backup (otomatis)
- **Jadwal**: tiap malam 02:00 (cron host → `scripts/backup.sh`).
- **Isi**: `pg_dump` + gzip → `/var/backups/arthakarya/`.
- **Retensi**: 14 harian + 4 mingguan (Minggu) + 3 bulanan (tanggal 1).
- **Off-server**: salinan di-rsync ke NAS kantor tiap malam.
- **Cek**: lihat `/var/log/arthakarya-backup.log` dan notifikasi Telegram.

### Verifikasi backup (mingguan)
```bash
gzip -t /var/backups/arthakarya/arthakarya-*.sql.gz   # integritas file
ls -la /var/backups/arthakarya | head
```

### Restore (DARURAT — latihan minimal sekali per kuartal)
```bash
cd /opt/arthakarya
bash scripts/restore.sh /var/backups/arthakarya/arthakarya-YYYYMMDD-HHMMSS.sql.gz
```
Script meminta konfirmasi `RESTORE`, menyalakan DB, lalu restore penuh.

**Drill restore yang benar** (untuk membuktikan backup bisa dipakai):
1. Jalankan Postgres cadangan terpisah (port beda):
   ```bash
   docker run --rm -d --name drill_pg -p 5433:5432 \
     -e POSTGRES_USER=arthakarya -e POSTGRES_PASSWORD=x -e POSTGRES_DB=arthakarya \
     postgres:16-alpine
   ```
2. Restore ke DB drill:
   ```bash
   gunzip -c /var/backups/arthakarya/arthakarya-XXXX.sql.gz |
     docker exec -i drill_pg psql -U arthakarya -d arthakarya
   ```
3. Verifikasi: `SELECT COUNT(*) FROM kegiatan;` — cocokkan dengan catatan
   jumlah data harian (atau bandingkan dengan log backup).
4. Hapus container drill: `docker rm -f drill_pg`.

> Jika drill gagal, backup dianggap tidak ada. Perbaiki sebelum percaya diri.

---

## 6. Akun Admin

### Admin awal (first boot)
Password admin dicetak **sekali** oleh service migrator:
```bash
docker compose -f /opt/arthakarya/docker-compose.prod.yml logs migrator
```
Catat username + password, lalu **ganti segera** via menu Ganti Password.

### Lupa password admin
Admin lain bisa reset via menu Manajemen User. Jika **semua** admin lupa:
```bash
docker compose -f /opt/arthakarya/docker-compose.prod.yml exec -T arthakarya_db \
  psql -U arthakarya -d arthakarya -c \
  "UPDATE users SET password_hash = '$2a$12$...' WHERE username = 'admin'"
```
(Ganti hash dengan bcrypt dari password baru — generate lewat
`bun -e "console.log(await Bun.password.hash('password-baru', {algorithm:'bcrypt', cost:12}))"`)

---

## 7. Sertifikat TLS

- **Terbitan pertama**: `docker compose -f /opt/arthakarya/docker-compose.prod.yml run --rm certbot`
  (membutuhkan delegasi subdomain → Cloudflare sudah aktif + `secrets/cloudflare.ini` valid).
- **Renewal**: cron bulanan (lihat crontab di atas) — `certbot renew`.
- **Cek masa berlaku**:
  ```bash
  docker compose -f /opt/arthakarya/docker-compose.prod.yml exec arthakarya_frontend \
    openssl x509 -in /etc/letsencrypt/live/<SERVER_NAME>/fullchain.pem -noout -dates
  ```
- Sertifikat baru otomatis terpakai setelah nginx restart (reload container frontend).

---

## 8. Monitoring & Notifikasi

- **`scripts/nightly-check.sh`** (05:30 tiap hari): cek container sehat,
  backup terbaru < 26 jam & > 1MB, disk < 90%, kesehatan SSD (smartctl),
  suhu CPU (< 80°C). Kirim **Telegram hanya jika ada masalah**.
- **Log**: `docker compose -f .../docker-compose.prod.yml logs -f <service>`
  (backend memakai structured JSON).
- **Kanal notifikasi**: bot Telegram (token + chat id di `.env`).

---

## 9. Troubleshooting

| Gejala | Cek | Solusi |
| ------ | --- | ------ |
| Situs tidak bisa diakses | `docker compose -f .../docker-compose.prod.yml ps` | `up -d` service yang Down |
| API 502 dari nginx | backend mati? `docker logs arthakarya_backend` | restart backend |
| Login gagal semua user | DB naik? `pg_isready` di container | `docker compose ... up -d arthakarya_db` |
| Disk penuh | `df -h /` | Hapus image lama `docker image prune -a`, cek `/var/backups` |
| Sertifikat kadaluarsa | cron cert jalan? `certbot certificates` | Jalankan renewal manual |
| Smartctl FAILED | `smartctl -H /dev/sdX` | **Segerakan restore drill + pindah server** — disk sedang sekarat |
| Backend CPU tinggi terus | `docker stats` | Restart backend; cek log |
| Server tidak responsif | Remote ke IP lain / cek power | Laptop tidur? Cek `systemctl suspend`; pastikan lid-close = do nothing |

### Server tidur (penyebab #1 server-laptop mati mendadak)
```bash
# Harus sudah dikonfigurasi di setup — verifikasi:
gsettings get org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type
# dan pastikan pengaturan "lid close" = do nothing (tanpa GUI: logind.conf)
cat /etc/systemd/logind.conf | grep -E "HandleLidSwitch"
```

---

## 10. Secret & Kebijakan

- Semua secret di `.env` server (root only) — **tidak pernah** di commit.
- `secrets/cloudflare.ini` — token API Cloudflare scoped ke satu zona,
  hanya izin `Zone.DNS:Edit` (bukan akun penuh).
- SSH server: key-only, root login via password dimatikan.
- Kebijakan password: minimal 8 karakter; JWT berlaku 8 jam;
  login dibatasi 5 gagal/15 menit per IP+username.
- Rotasi: `JWT_SECRET` diganti → semua user harus login ulang.
  Ganti `POSTGRES_PASSWORD` perlu update `.env` + volume config.
- **Laporan insiden**: jika ada dugaan kebocoran, ganti `JWT_SECRET`,
  reset semua password, dan audit log backend.

---

## 11. Kondisi Khusus Jaringan Bappenas (ditemukan saat go-live)

Jaringan kantor ini mewajibkan beberapa penyesuaian yang SUDAH terpasang
— jangan di-remove tanpa tahu konsekuensinya:

1. **Internet langsung diblokir; proxy wajib** (`proxy.bappenas.go.id:8080`):
   - `docker-compose.prod.yml` memakai `HTTP_PROXY/HTTPS_PROXY` dari `.env`
     untuk build image (npm/bun) dan service certbot.
   - Runner GitHub Actions butuh proxy di `/opt/actions-runner/.env`
     (http_proxy/https_proxy/NO_PROXY) — tanpa ini runner tidak bisa connect.
   - Port 22/443 keluar diblokir: semua koneksi git ke GitHub lewat
     **corkscrew** (lihat `~/.ssh/config` user `hrmaulana` dan `arthakarya`).
2. **NTP (UDP 123) diblokir** — jam server disinkronkan dari header `Date`
   GitHub oleh cron `ARTHAKARYA-CLOCK` tiap jam. ⚠️ Jam server yang salah
   membuat runner GitHub Actions gagal ("token not valid until...") —
   gejala: runner offline. Cek: `date -u` vs waktu nyata.
3. **Healthcheck backend memakai `wget -Y off`** — busybox wget mengabaikan
   `no_proxy`; tanpa flag ini healthcheck lewat proxy dan dapat 503 BlueCoat
   → backend dianggap unhealthy.
4. **Smoke test deploy memakai `https://localhost -k`** — nginx me-redirect
   HTTP→HTTPS (301); curl tidak menganggap 301 sebagai error.
5. Pemilik file: repo `/opt/arthakarya`, `.env`, dan `secrets/` adalah
   user **`arthakarya`** (deploy runner). Operasi git manual pakai
   `sudo -u arthakarya git -C /opt/arthakarya ...`.

## 12. Akses Remote via Tunnel VPS Publik

Aplikasi bisa diakses dari luar Bappenas lewat tunnel VPS publik:

| Hostname | Jalur | Untuk |
| -------- | ----- | ----- |
| `https://keuanganppn1.cloud` | LAN langsung | Pengguna di dalam kantor |
| `https://remote.keuanganppn1.cloud` | VPS `202.155.16.55` → tunnel → laptop | Pengguna di luar kantor |

**Cara kerja:** service `arthakarya-tunnel` (systemd di laptop) menjalankan
`autossh` dengan reverse tunnel `VPS:443 → laptop:443`, koneksi keluar lewat
corkscrew → proxy Bappenas (outbound — tidak perlu buka port inbound).
Trafik diteruskan sebagai byte TLS mentah — **VPS tidak melihat data
terdekripsi** (enkripsi ujung-ke-ujung browser ↔ laptop).

**Komponen:**
- Laptop: `/etc/systemd/system/arthakarya-tunnel.service` (autossh,
  auto-reconnect, `Restart=always`), key `/root/.ssh/vps_tunnel`,
  `~/.ssh/config` host `vps` (corkscrew).
- VPS (`root@202.155.16.55`, Ubuntu 24.04, 2 GB): `GatewayPorts yes` di
  sshd; listener `0.0.0.0:443` = tunnel.
- Sertifikat laptop mencakup `keuanganppn1.cloud` **dan**
  `remote.keuanganppn1.cloud` (renewal otomatis mencakup keduanya).
- DNS: `remote.keuanganppn1.cloud` A → `202.155.16.55` (Cloudflare).

**Operasional:**
- Cek tunnel: `systemctl status arthakarya-tunnel` (laptop);
  dari VPS: `curl -sk https://127.0.0.1:443/api/health`.
- Saat reboot laptop: service aktif otomatis (enabled).
- ⚠️ `remote.keuanganppn1.cloud` praktis terbuka ke internet — proteksi
  yang ada (HTTPS wajib, rate limit login, password min 8) adalah
  pertahanan utamanya. Monitor log login gagal via Telegram jika dicurigai.
- VPS sudah **key-only** (password login dimatikan) — detail: §15.

## 13. Checklist Setup Server (satu kali, saat go-live)

- [ ] Ubuntu LTS terpasang, `unattended-upgrades` aktif
- [ ] IP statis / DHCP reservation; DNS internal `SERVER_NAME` → IP laptop
- [ ] SSH key-only (password login off), ufw: 22, 80, 443 saja
- [ ] fail2ban aktif (SSH)
- [ ] Pengaturan daya: never sleep, lid close = do nothing
- [ ] Docker + compose plugin terpasang
- [ ] Clone repo di `/opt/arthakarya`, `.env` dibuat (gen-secrets.sh)
- [ ] `secrets/cloudflare.ini` + delegasi subdomain ke Cloudflare
- [ ] Sertifikat pertama terbit (certbot run)
- [ ] `docker compose -f docker-compose.prod.yml up -d --build`
- [ ] Migrasi jalan + password admin awal dicatat & diganti
- [ ] Backup pertama sukses + salinan NAS sukses
- [ ] **Drill restore** dilakukan & tercatat
- [ ] Self-hosted runner GitHub Actions terdaftar (label arthakarya)
- [ ] Crontab host terpasang (backup, nightly-check, renew cert)
- [ ] Bot Telegram dikonfigurasi + uji kirim

## 14. Monitoring Anggaran (Import Excel SAKTI)

Fitur v1.0.6+: dashboard penyerapan anggaran dari file Excel SAKTI.

- **Alur**: admin upload `.xlsx` di halaman `/monitoring` (menu Monitoring
  Anggaran) → backend parse sheet **"Data Detail"** → simpan ke PostgreSQL.
- **Tabel**: `monitoring_imports` (riwayat upload: file, periode, uploader,
  jumlah baris) + `monitoring_anggaran` (baris detail: hierarki
  program→akun + pagu/realisasi). Sisa & persentase dihitung di query.
- **Semantik**: satu upload = satu snapshot. API membaca import **terbaru**
  (MAX id); upload baru menggantikan tampilan, riwayat lama tersimpan.
- **Kolom wajib** sheet "Data Detail": Kode/Nama Program, Kegiatan, Output,
  SubOutput, Komponen, SubKomponen, Akun, `Unit Kerja`, `Pagu Revisi`,
  `Realisasi Periode Lalu`, `Realisasi Periode Ini`, `Realisasi sd Periode`.
  Kolom lain diabaikan.
- **Pemetaan unit**: nama unit di Excel dicocokkan otomatis ke `unit_kerja`
  via token overlap ("PEMPMP" ↔ "Direktorat PEMPMP"). Ada unit tak dikenal
  → import **ditolak** beserta daftar nama unitnya.
- **Endpoint**:
  - `POST /api/monitoring/import` (admin; multipart field `file` + opsional `periode`)
  - `GET /api/monitoring/latest | /summary | /detail` (auth; operator hanya unitnya)
  - `GET /api/monitoring/public-summary` (**tanpa auth** — hanya total
    agregat, untuk slideshow halaman login)
- **Periode bulanan**: saat file baru tersedia (mis. periode berikutnya),
  upload lagi. Riwayat lama tetap telusuri di `monitoring_imports`.
- File sumber di mesin dev: `anggaran.xlsx` di root repo (**gitignored** —
  jangan di-commit).

## 15. VPS Publik (Tunnel) — Key-Only

Dikunci 2026-08-05. Login root via password **dimatikan**:

- `PasswordAuthentication no` di `/etc/ssh/sshd_config` **DAN** di
  `/etc/ssh/sshd_config.d/50-cloud-init.conf` — keduanya harus konsisten
  (sshd memakai kemunculan pertama; drop-in cloud-init mengalahkan baris
  bawah di sshd_config).
- `PermitRootLogin prohibit-password` (root hanya via kunci).
- Kunci yang diizinkan:
  - `C:\Users\PMP\.ssh\id_ed25519` (mesin admin — fingerprint
    `SHA256:B9yof8+IS03aeR3eQBNuteFT3siOaDlk7jP3Go6oA3M`)
  - `/root/.ssh/vps_tunnel` di laptop (tunnel autossh — tidak terpengaruh)
- ⚠️ **Jangan hilangkan kunci private** `id_ed25519` — tanpa kunci, VPS
  tidak bisa diakses lagi sama sekali (tidak ada jalur password).
  Simpan salinan di tempat aman.
- Backup config lama: `/etc/ssh/sshd_config.bak.YYYYMMDD` di VPS.
- Verifikasi cepat: `ssh -o PreferredAuthentications=none root@202.155.16.55`
  → harus menampilkan `Permission denied (publickey)` (password tidak
  ditawarkan).
