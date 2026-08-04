# PHASE2.md — Panduan Go-Live Server Produksi

Panduan langkah-demi-langkah setup server laptop Arthakarya di kantor
Bappenas. Jalankan secara berurutan; setiap langkah ada yang dilakukan
**di server**, **di panel web**, atau **di repo**.

Runbook harian setelah go-live: [`OPS.md`](OPS.md).

---

## 0. Checklist data yang dibutuhkan

| Data | Dari | Status |
| ---- | ---- | ------ |
| Daftar unit kerja asli | Kamu (admin) | ⬜ |
| `SERVER_NAME` (hostname internal, di bawah domain terdaftar) | Kamu | ⬜ |
| `LETSENCRYPT_EMAIL` | Kamu | ⬜ |
| IP LAN laptop (statis / DHCP reservation) | Kamu | ⬜ |
| Subdomain didelegasikan ke Cloudflare (NS records) | Panel Rumaweb | ⬜ |
| Zona Cloudflare + API token (`Zone.DNS:Edit`) | Dashboard Cloudflare | ⬜ |
| NAS tujuan backup (host, user, path) + user backup | Kamu/IT kantor | ⬜ |
| Bot Telegram (token) + chat id | BotFather + kirim pesan ke bot | ⬜ |
| Registration token runner (saat setup runner) | GitHub → Settings → Actions → Runners | ⬜ |

---

## 1. Data unit kerja asli (SEBELUM first boot)

Daftar unit kerja masuk ke `db/init.sql` — dan `init.sql` hanya dieksekusi
**sekali** (saat volume database pertama dibuat). Karena itu daftar asli
harus masuk **sebelum** `docker compose up` pertama di server.

- Kirim daftar unit kerja (kode + nama) kepada pengembang (Claude) →
  diperbarui di `db/init.sql` → di-commit → ditarik server saat setup.
- Jika daftar berubah setelah go-live: tambahkan lewat migrasi baru
  (`db/migrations/002_...sql`) — jangan edit `init.sql` (tidak akan jalan lagi).

## 2. Buka akses SSH ke laptop

- Pastikan laptop bisa di-SSH dari komputer admin: `ssh user@<ip-lan-laptop>`.
- DHCP reservation / IP statis di router kantor untuk MAC laptop.
- SSH key admin dipasang ke server (`ssh-copy-id`).

## 3. Jalankan bootstrap di server

```bash
# Di server, sebagai root (clone repo dulu):
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/hrmaulana/arthakarya-app.git /opt/arthakarya
sudo bash /opt/arthakarya/scripts/server-setup.sh
```

Script menanyakan secara interaktif: `SERVER_NAME`, email, CORS,
NAS/Telegram (boleh kosong dulu), token Cloudflare, dan opsi runner.
Semua idempotent — aman dijalankan ulang.

## 4. Delegasi DNS: Rumaweb → Cloudflare (sekali)

1. **Daftar gratis di Cloudflare** (cloudflare.com), tambahkan zona
   subdomain aplikasi, mis. `arthakarya.dinas.go.id`.
2. Cloudflare memberi 2 nameserver (mis. `xxx.ns.cloudflare.com`).
3. **Di panel Rumaweb** (domain terdaftar `dinas.go.id`): buat **NS record**
   untuk `arthakarya` → kedua nameserver Cloudflare di atas.
   *(Catatan: ini hanya mendelegasikan subdomain aplikasi; seluruh domain
   utama tetap dikelola Rumaweb.)*
4. **Di Cloudflare**: zona subdomain sudah terlihat "active" (delegasi
   tersebar ± beberapa menit-jam). Tambahkan:
   - Record **A** `arthakarya` → IP LAN laptop (untuk kelengkapan;
     resolusi pengguna lewat DNS internal kantor).
   - DNS-only (ikon awan abu-abu), **jangan** proxy Cloudflare.
5. Verifikasi delegasi:
   ```bash
   dig +short NS arthakarya.dinas.go.id     # → ns*.cloudflare.com
   dig +short TXT _acme-challenge.arthakarya.dinas.go.id  # (kosong wajar)
   ```

## 5. Buat API token Cloudflare (scoped)

Dashboard Cloudflare → My Profile → **API Tokens** → *Create Token* →
template **Edit zone DNS** → pilih zona aplikasi saja → Create.
Simpan token di `secrets/cloudflare.ini` (dilakukan script setup, mode 600).

> Token ini hanya untuk DNS-01 certbot — jangan beri akses akun penuh.

## 6. Terbitkan sertifikat pertama

```bash
cd /opt/arthakarya
docker compose -f docker-compose.prod.yml run --rm certbot
```
Sukses = file cert muncul di volume `arthakarya_letsencrypt`.

## 7. Jalankan stack + ambil password admin

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs migrator   # password admin SEKALI
```
Buka `https://<SERVER_NAME>/` di browser → login admin → **ganti password
segera**. (Jika DNS internal belum resolve, uji sementara via
`curl --resolve <SERVER_NAME>:443:127.0.0.1 https://<SERVER_NAME>/api/health`.)

## 8. Bot Telegram + NAS backup

- **Telegram**: chat BotFather → `/newbot` → dapat token. Kirim satu pesan
  ke bot dari akunmu, lalu dapatkan chat id via
  `https://api.telegram.org/bot<TOKEN>/getUpdates` → `chat.id`.
  Isi `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` di `.env` server.
- **NAS**: buat user khusus `backup` di NAS (izin tulis ke
  `NAS_PATH` saja), pasang SSH key server agar rsync tanpa password:
  ```bash
  ssh-keygen -t ed25519 -f /root/.ssh/backup_nas -N ""
  ssh-copy-id -i /root/.ssh/backup_nas backup@<NAS_HOST>
  # + konfigurasi rsync memakai key tsb di scripts/backup.sh bila perlu
  ```

## 9. Backup pertama + drill restore (WAJIB)

```bash
bash /opt/arthakarya/scripts/backup.sh     # backup pertama
# lalu lakukan DRILL: ikuti OPS.md bagian 5 — restore ke Postgres cadangan,
# verifikasi jumlah data, hapus container drill. Catat tanggal drill.
```

## 10. Self-hosted runner (deploy otomatis via tag)

Jika dilewati saat setup: GitHub → repo → **Settings → Actions → Runners**
→ *New self-hosted runner* → ikuti perintah di server
(pakai user `arthakarya`, folder `/opt/actions-runner`), lalu install service:
```bash
cd /opt/actions-runner
sudo ./svc.sh install arthakarya && sudo ./svc.sh start
```
Label runner harus memuat `arthakarya` agar job deploy memakainya
(workflow `deploy.yml` menunggu label `self-hosted, linux, x64, arthakarya`).

## 11. Uji deploy via tag (release pertama)

1. CI hijau di `master`.
2. `git tag v1.0.0 && git push origin v1.0.0`
3. GitHub Actions → job Deploy hijau; buka aplikasi, pastikan masih sehat.
4. Rollback test (opsional): `git tag` tag sebelumnya → push → deploy lama.

---

## Rangkuman urutan eksekusi

1. ⬜ Daftar unit kerja asli → `db/init.sql` di-commit
2. ⬜ IP statis + SSH ke laptop jalan
3. ⬜ `server-setup.sh` di server selesai
4. ⬜ Delegasi DNS Rumaweb → Cloudflare + record A
5. ⬜ Token Cloudflare di `secrets/cloudflare.ini`
6. ⬜ Sertifikat pertama terbit
7. ⬜ `up -d` + migrasi + password admin diganti
8. ⬜ Telegram & NAS dikonfigurasi + backup pertama sukses
9. ⬜ Drill restore tercatat
10. ⬜ Runner terdaftar + release pertama via tag hijau
