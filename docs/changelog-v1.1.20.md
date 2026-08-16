# Changelog v1.1.20 — 16 Agustus 2026

## 🏷️ Daftar Kegiatan: Filter & Sort Akun + Mini Dashboard

### Ringkasan
Menambahkan kemampuan **filter dan sort berdasarkan Kode Akun** pada halaman Daftar Kegiatan, plus **mini dashboard** yang menampilkan ringkasan jumlah akun teralokasi. Fitur ini melengkapi kewajiban pengisian Kode Akun yang sudah berjalan sejak v1.1.19.

### Perubahan

**Backend — `backend/src/routes/kegiatan.ts`**
- `GET /api/kegiatan` mendukung query param baru:
  - `?kode_akun=` — filter kegiatan yang memakai kode akun tertentu (via `EXISTS`)
  - `?sort=&order=` — urutkan berdasarkan `tanggal` / `akun` / `anggaran` / `nama`, arah `asc` / `desc`
- Response list kini menyertakan per kegiatan:
  - `akun_list` — array kode akun yang dipakai (agregat `array_agg` DISTINCT)
  - `jml_akun` — jumlah akun unik per kegiatan
- Response menambah `meta.akun_options` — daftar kode akun + nama akun (dari import monitoring terbaru) + jumlah kegiatan, untuk dropdown filter
- Scoping unit kerja (operator) tetap berlaku untuk data & opsi akun

**Frontend — `frontend/src/pages/KegiatanList.jsx`**
- **Mini dashboard** (stat cards): Total Kegiatan · Total Anggaran · Akun Teralokasi (jumlah akun unik dari kegiatan yang tampil)
- **Filter Akun** — dropdown berisi kode akun yang terpakai, lengkap dengan nama akun & jumlah kegiatan
- **Urutkan** — Tanggal terbaru/terlama, Kode Akun A→Z / Z→A, Anggaran terbesar/terkecil
- Kolom **Akun** baru di tabel: badge kode akun per kegiatan (maks 3 tampil, sisanya `+N`)

**CSS — `frontend/src/index.css`**
- `.akun-cell` untuk tata letak badge kode akun (flex-wrap)

### Catatan
- Tidak ada migrasi DB baru — kolom `kode_akun` sudah ada sejak migrasi 006
- Backward compatible: response lama tetap berjalan, param baru opsional
- Deploy: v1.1.20 ✅ (sudah live via GitHub Actions)
