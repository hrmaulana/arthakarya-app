# Changelog v1.1.24 — 19 Agustus 2026

## 🚀 Perf & keandalan upload SPPD (volume persisten + buffer nginx + kompresi gambar)

### Ringkasan
Proses penyimpanan dokumen di menu SPPD kadang lambat, dan file bisa hilang
setelah redeploy. Akar masalah: (1) folder upload berada di container writable
layer (overlayfs) sehingga **terhapus setiap kali container dibuat ulang** — persis
saat tiap deploy — dan tulisannya lebih lambat dari native disk; (2) nginx menulis
temp file ke disk saat meneruskan body upload besar; (3) file scan/foto besar
(5–10MB+) ditransfer utuh lewat jaringan instansi. Tiga perubahan ini mengatasinya.

### Perubahan

**Infrastruktur — `docker-compose.prod.yml`**
- Named volume `uploads` (`arthakarya_uploads`) dipasang di service
  `arthakarya_backend` pada `/var/arthakarya/uploads`.
- File SPPD & surat tugas kini **persisten antar redeploy** dan ditulis ke native
  disk volume, bukan overlayfs.
- Catatan: env `SPPD_UPLOAD_DIR` **sengaja tidak di-set**. Variabel itu dibaca
  bersama oleh dua route — `sppd.ts` (default `.../uploads/sppd`) dan
  `suratTugas.ts` (default `.../uploads/surat_tugas`) — jadi men-set-nya akan
  menggabungkan kedua jenis upload ke satu direktori. Volume di-mount di parent
  agar default masing-masing tetap menunjuk ke subdirektorinya sendiri.

**Infrastruktur — `frontend/nginx.prod.conf.template` & `frontend/nginx.conf`**
- `client_body_buffer_size 16m` ditambahkan di `location /api/`. Body upload
  ≤ 12m (batas `client_max_body_size`) kini ditahan di RAM — nginx tidak lagi
  menulis temp file ke disk saat meneruskan ke backend.

**Frontend — `frontend/src/lib/compressImage.js` (baru) & `frontend/src/pages/SppdDetail.jsx`**
- Gambar dikompres/resize di sisi klien **sebelum** upload: resize ke max 1920px
  + JPEG quality 0.72. Foto scan 5–10MB biasanya turun menjadi <500KB, sehingga
  transfer lewat jaringan instansi jauh lebih ringan & cepat.
- PDF & non-gambar dilewatkan apa adanya. Bila hasil kompresi tidak mengecilkan
  ukuran (atau proses gagal), file asli tetap dikirim — upload tidak pernah terhambat.

### ⚠️ Operasional — langkah satu-kali SEBELUM deploy
File upload yang sudah ada saat ini masih tersimpan di writable layer container
lama dan **tidak otomatis pindah** ke volume baru. Sebelum deploy berikutnya
(jalankan di server, sebelum container dibuat ulang):

```bash
# 1. BACKUP dulu (container lama masih berjalan)
mkdir -p /tmp/arthakarya-uploads-backup
docker cp arthakarya_backend:/var/arthakarya/uploads/. /tmp/arthakarya-uploads-backup/

# 2. Deploy seperti biasa (push tag → volume baru auto-created, awalnya kosong)

# 3. RESTORE ke volume baru lewat container yang baru
docker cp /tmp/arthakarya-uploads-backup/. arthakarya_backend:/var/arthakarya/uploads/

# 4. Verifikasi
docker exec arthakarya_backend ls -la /var/arthakarya/uploads
```
