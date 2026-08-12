# Spesifikasi Desain — Target RPD Bulanan

Tanggal: 2026-08-12
Modul: RPD & Timeline Anggaran (`RpdGantt`)
Status: Disetujui (desain), menunggu rencana implementasi

## Konteks & Masalah

Halaman **RPD & Timeline Anggaran** menampilkan rencana penarikan dana per bulan yang
dihitung dari data kegiatan (`kegiatan.tanggal` + SUM `mata_anggaran.jumlah_rp`).
Saat ini angka tersebut hanya total per bulan untuk **semua unit digabung**.

Kedeputian PMP memiliki **target RPD Bulanan per unit kerja** (Sesdep, PEMPMP, PFMSK,
PHKEI, P4T, SITALA) dalam bentuk tabel unit × bulan, yang dikelola di Excel dan diperbarui
berkala. Target ini perlu tampil di aplikasi dan **dibandingkan** dengan rencana kegiatan
yang ada, agar terlihat kesenjangan (selisih) antara target dan rencana kegiatan per bulan.

## Tujuan

1. Meng-import data **Target RPD Bulanan per unit per bulan** dari file Excel, dan
   memungkinkan pembaruan melalui upload Excel baru.
2. Menampilkan data target **selaras dengan agregasi per bulan di tampilan RPD**,
   per unit kerja.
3. Menampilkan **kumulatif target** berdampingan dengan **kumulatif kegiatan** per unit
   per bulan, beserta **selisih**-nya.

## Bukan Tujuan (Non-Goals)

- Tidak mengubah cara perhitungan RPD kegiatan yang sudah ada (`/rekap/rpd-bulanan`).
- Tidak menyentuh modul Monitoring Anggaran (realisasi).
- Tidak menambah library frontend/backend baru (pakai `xlsx` & `multer` yang sudah ada).

## Terminologi

- **Target RPD Bulanan**: nilai nominal (Rp) target penarikan per unit kerja per bulan,
  bersumber dari Excel.
- **Kegiatan per bulan (RPD)**: total anggaran kegiatan (`mata_anggaran.jumlah_rp`) yang
  `kegiatan.tanggal`-nya berada pada bulan tersebut.
- **Kumulatif**: jumlah berjalan (running sum) dalam tahun bersangkutan sampai bulan
  itu; bulan di luar rentang import (sebelum bulan pertama) dianggap 0.
- **Selisih**: kumulatif target − kumulatif kegiatan.

## Konstrain Global (dari CLAUDE.md & pola kode)

- Frontend: semua styling di `frontend/src/index.css`, pakai class existing
  (`.card`, `.card-header`, `.table-wrapper`, `.table-sticky`, `.form-group`,
  `.form-control`, `.btn`, `.badge`, `.page-header`). Jangan tambah library.
- Dark mode: hanya `var(--...)`, jangan hardcode hex; verifikasi kedua mode.
- Cetak: gunakan pola `.print-only`/`.no-print` + `@media print` yang sudah ada.
- Backend: Express + TypeScript + Zod + pg. Pola route:
  `router.use(authMiddleware)`, `getUnitKerjaFilter`, `logger.error`, `res.json({ data })`.
- Upload Excel: `multer` + `xlsx` (sudah dependency backend).
- Migrasi: file baru di `backend/src/db/migrations/` (urut abjad, satu transaksi per file),
  dijalankan via `bun run migrate`.

---

## 1. Data Model (Migrasi)

File: `backend/src/db/migrations/007_rpd_target.sql`

### Tabel `rpd_target_imports` — snapshot satu kali upload

```sql
CREATE TABLE rpd_target_imports (
  id          SERIAL PRIMARY KEY,
  filename    TEXT NOT NULL,
  tahun       INTEGER NOT NULL,
  periode     TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_rows  INTEGER NOT NULL DEFAULT 0
);
```

### Tabel `rpd_target` — nilai per (unit, bulan) dalam satu import

```sql
CREATE TABLE rpd_target (
  id            SERIAL PRIMARY KEY,
  import_id     INTEGER NOT NULL REFERENCES rpd_target_imports(id) ON DELETE CASCADE,
  unit_kerja_id INTEGER NOT NULL REFERENCES unit_kerja(id),
  bulan         INTEGER NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  nilai         BIGINT NOT NULL DEFAULT 0,
  UNIQUE (import_id, unit_kerja_id, bulan)
);
```

Aturan:
- **Import terbaru** = baris `rpd_target` dengan `import_id = MAX(id)` dari
  `rpd_target_imports` untuk tahun yang sama.
- Re-upload = buat snapshot baru + hapus-sisip barisnya; snapshot lama tetap utuh
  sebagai riwayat (tidak dihapus).
- Satu import dianggap mencakup **satu tahun** (kolom bulan dalam tahun tersebut).

---

## 2. Format File Excel (Import)

Satu sheet, satu tabel unit × bulan:

| (kolom 1) Unit | Agustus | September | Oktober | November | Desember |
|---|---|---|---|---|---|
| Sesdep | 1631593430 | 1767977731 | 1857553515 | 2062464974 | 712477230 |
| PEMPMP | 1366862538 | 1481118080 | … | … | … |
| … | … | … | … | … | … |

Spesifikasi parse:
- **Baris header** (baris pertama): sel pertama = judul kolom unit (diabaikan), sel
  berikutnya = bulan. Bulan dikenali dari **nama bulan Indonesia** (Agustus, September,
  …), singkatan (Agu, Sep, Okt, Nov, Des), atau angka 1–12. Urutan header menentukan
  urutan kolom.
- **Sel unit** (kolom 1 tiap baris data): cocokkan ke `unit_kerja` lewat `kode_unit`
  dulu, lalu `nama_unit`. Baris dengan unit yang **tidak dikenal** → error 400,
  proses dibatalkan seluruhnya (tidak ada sebagian import).
- **Sel nilai**: bilangan bulat ≥ 0 (rupiah). Kosong dianggap 0. Non-angka / negatif →
  error 400 dengan sebutan sel.
- Tahun ditentukan oleh field form `tahun` (bukan dari file).

---

## 3. Backend

Perluas `backend/src/routes/rekap.ts`.

### 3.1 `POST /api/rekap/rpd-target/import`

- Autentikasi + **role admin** (pola yang sama dengan import Monitoring).
- Body: `multipart/form-data` — `file` (.xlsx), `tahun` (angka, wajib), `periode` (opsional).
- Alur:
  1. Parse file via `xlsx` sesuai format Bagian 2.
  2. Validasi semua baris/kolom; bila ada yang tidak valid → `400` dengan pesan spesifik.
  3. Dalam **satu transaksi**: insert `rpd_target_imports` → insert baris-baris
     `rpd_target`. Gagal → rollback.
- Response sukses: `200` `{ data: { import_id, total_rows, tahun } }` (pola `res.json`
  existing, konsisten dengan route lain).
- Error: `400` validasi/format, `403` non-admin, `401` belum login, `500` umum
  (pesan via `logger.error`).

### 3.2 `GET /api/rekap/rpd-target?tahun=YYYY`

- Autentikasi (semua user login). Terapkan `getUnitKerjaFilter` — admin melihat semua
  unit; operator hanya unitnya (konsisten dengan RPD).
- Alur:
  1. Ambil import terbaru untuk `tahun` (jika ada).
  2. Ambil target per (unit, bulan) dari import tersebut.
  3. Ambil kegiatan per (unit, bulan): group `kegiatan` per `unit_kerja_id` +
     `EXTRACT(MONTH FROM tanggal)` untuk tahun bersangkutan, SUM `mata_anggaran.jumlah_rp`
     — dibatasi unit yang ada di import.
  4. Komputasi kumulatif berjalan (urut bulan naik) + selisih per (unit, bulan).
- Response:
  ```json
  {
    "data": {
      "tahun": 2026,
      "months": [8, 9, 10, 11, 12],
      "units": [
        {
          "unit_kerja_id": 1,
          "kode_unit": "SESDEP",
          "nama_unit": "Sesdep",
          "months": [
            { "bulan": 8, "target": 1631593430, "target_kum": 1631593430,
              "kegiatan": 0, "kegiatan_kum": 0, "selisih": 1631593430 }
          ]
        }
      ]
    }
  }
  ```
- Bila tidak ada import untuk tahun itu → `{ data: { tahun, months: [], units: [] } }`.
- Bulan tanpa nilai dianggap 0 (kumulatif tetap dihitung).

---

## 4. Frontend

Perluas `frontend/src/pages/RpdGantt.jsx` (halaman RPD & Timeline).

Struktur baru (setelah kartu "Rencana Penarikan Dana Bulanan"):

1. **Kartu upload (admin only)** — pola MonitoringAnggaran:
   - `input type="file"` (.xlsx), `input type="number"` tahun (praisi tahun aktif halaman),
     `input` periode opsional, tombol "⏫ Import".
   - Submit → `client.post("/rekap/rpd-target/import", FormData)` → pesan sukses/gagal,
     lalu refetch data target.
2. **Tabel "Target RPD Bulanan per Unit"**:
   - Baris = unit (dari import terbaru), kolom = bulan (dari `months`), isi =
     `formatRupiah(target)`, baris **Total** di bawah.
   - State kosong (belum ada import): pesan "Belum ada target RPD. Upload Excel dulu."
3. **Perbandingan kumulatif — satu kartu per unit** (`Bulan | Target | Target Kum. |
   Kegiatan | Kegiatan Kum. | Selisih`):
   - Baris = bulan dalam rentang; kolom sesuai definisi Bagian 3.2.
   - Nilai kosong tampil `0` / `—` sesuai konteks; gunakan `.font-mono` untuk angka rupiah.
   - Boleh diberi tanda visual selisih negatif (mis. class `level-low`/`-danger`).
4. Data target di-fetch bersamaan dengan data RPD existing:
   `client.get("/rekap/rpd-target", { params: { tahun } })`, dibawah `Promise.all`
   dengan `rpd-bulanan` & `timeline` yang sudah ada.

Tidak ada perubahan layout halaman yang sudah ada selain penambahan seksi.

---

## 5. Error Handling & Keamanan

| Kasus | Perilaku |
|---|---|
| Upload non-admin | 403 |
| File bukan .xlsx / sheet kosong | 400 "File Excel tidak valid" |
| Unit di Excel tidak dikenal | 400 "Unit 'X' tidak ditemukan" (proses batal) |
| Nilai bukan angka / negatif | 400 "Sel B3 harus angka ≥ 0" |
| `tahun` bukan angka / kosong | 400 "tahun wajib diisi" |
| GET tanpa `tahun` | default tahun berjalan (pola RPD existing) |
| Query error | 500 + `logger.error` |

---

## 6. Testing

### Backend (`backend/tests/integration.test.ts` — bun:test, DB test port 5433)
- `POST import` sukses: parse file contoh (unit×bulan), snapshot tersimpan, `GET` mengembalikan
  nilai & kumulatif yang benar.
- Re-upload (import kedua) → yang terbaru menang; riwayat import lama tidak hilang.
- Unit tidak dikenal → `400`.
- Nilai non-angka / negatif / bulan tidak valid → `400`.
- Non-admin → `403`.
- `GET` tanpa data → `months: [], units: []`; bulan kosong → dihitung 0 dan kumulatif tetap.
- `GET` dengan `getUnitKerjaFilter` (operator) → hanya unitnya.

### Frontend
- `bun run build` (di `frontend/`) pass.
- Verifikasi manual browser: upload Excel, tabel target tampil, perbandingan kumulatif
  benar, state kosong, dark mode, cetak halaman RPD.

---

## 7. Pertanyaan Terbuka (di-defer)

- Format persis file Excel (nama sheet, baris header, bentuk nama bulan) perlu
  dikonfirmasi dengan contoh file riil saat implementasi.
- Penampilan selisih negatif: cukup warna/tanda, atau perlu kolom % — bisa disesuaikan
  saat implementasi tanpa mengubah data.
