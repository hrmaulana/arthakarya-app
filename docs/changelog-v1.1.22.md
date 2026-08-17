# Changelog v1.1.22 — 17 Agustus 2026

## 🐛 Perbaikan: upload file >1MB gagal ("Gagal menyimpan Surat Tugas")

### Ringkasan
Upload PDF surat tugas >1MB gagal dengan pesan generik **"Gagal menyimpan Surat Tugas."** di UI.
Akar masalah: batas body default nginx (**1MB**) lebih kecil dari batas upload backend (**10MB**, multer).
Nginx menolak body lebih dulu dengan `413 Request Entity Too Large` sebelum mencapai backend, dan respons 413
berupa halaman HTML (tanpa JSON `error`) sehingga frontend menampilkan pesan fallback.

### Perubahan

**Nginx — `frontend/nginx.prod.conf.template` & `frontend/nginx.conf`**
- Tambah `client_max_body_size 12m;` — cukup untuk file 10MB + overhead multipart.
- Berlaku untuk **semua** endpoint upload: Surat Tugas & Undangan, dokumen pertanggungjawaban SPPD,
  import monitoring, dan import RPD target.
- Efektif setelah container frontend di-restart (template diproses `envsubst` saat start).
