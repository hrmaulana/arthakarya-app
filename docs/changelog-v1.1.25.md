# Changelog v1.1.25 — 20 Agustus 2026

## ✨ Filter Unit Kerja di Daftar Kegiatan (role admin)

### Ringkasan
Admin kini dapat memfilter daftar kegiatan per **unit kerja** lewat dropdown
"Filter Unit Kerja" di halaman Daftar Kegiatan, dengan jumlah kegiatan per unit
ditampilkan di dalam dropdown (konsisten dengan pola filter Akun). Operator
**tidak terpengaruh** — mereka tetap di-scope ke unitnya sendiri oleh middleware.

### Perubahan

**Backend — `backend/src/middleware/authorize.ts`**
- `getUnitKerjaFilter()` kini menghormati query `?unit_kerja_id=` untuk admin
  (validasi numerik `Number.isInteger(id) && id > 0`; nilai tidak valid →
  diabaikan = tanpa filter). Perilaku operator tidak berubah.
- Efek samping koheren: endpoint list lain yang memakai fungsi ini (monitoring,
  sppd, surat tugas) ikut mendukung filter unit via query untuk admin — default
  tetap tanpa filter.

**Backend — `backend/src/routes/kegiatan.ts` (GET /)**
- Kueri utama tetap memakai `unitKerjaId` (filter aktif).
- Perkenalan `unitScope` = **scope penuh role** (admin → semua unit, operator →
  unit sendiri), dipakai untuk menghitung kedua opsi dropdown (`akun_options`
  dan `unit_options`) — sehingga dropdown unit tetap lengkap walau filter sedang
  aktif.
- Respons baru: `{ data, meta: { akun_options, unit_options } }`. `unit_options`
  memakai `LEFT JOIN` agar unit tanpa kegiatan tetap muncul dengan
  `jml_kegiatan = 0`.

**Frontend — `frontend/src/pages/KegiatanList.jsx`**
- State `unitFilter`/`unitOptions`; `fetchData` mengirim `?unit_kerja_id=`.
- Dropdown **"Filter Unit Kerja"** dirender hanya untuk admin; opsi berlabel
  `"{nama_unit} ({jml_kegiatan})"`.
- Teks empty-state ikut menyebut filter unit.

### Testing
- 6 test integrasi baru (admin filter unit, nilai tidak valid diabaikan,
  `meta.unit_options`, dropdown tetap lengkap saat filter aktif, scope operator,
  unit tanpa kegiatan tetap muncul) — total **90 pass / 0 fail**.
- Build frontend sukses (`vite build`).

### ⚠️ Operasional
- Tidak ada migrasi database. Tidak ada perubahan penyimpanan file/volume.
  **Tidak diperlukan langkah backup khusus** sebelum deploy.
- Rilis berjalan seperti biasa: push tag → deploy otomatis (GitHub Actions,
  self-hosted runner → `scripts/deploy.sh v1.1.25`).
