# Desain: Rincian Mata Anggaran Memakai Kode Akun

**Tanggal:** 2026-08-12
**Proyek:** Arthakarya (perencanaan kegiatan & anggaran, Kedeputian PMP, Bappenas)
**Status:** Disetujui (brainstorming)

## 1. Konteks & Masalah

Pada halaman **Tambah Kegiatan Baru** (`frontend/src/pages/KegiatanForm.jsx`), bagian **Rincian Mata Anggaran** (`frontend/src/components/MataAnggaranTable.jsx`) mengizinkan pengetikan bebas kolom "Nama Item". Di sistem sudah ada **kode akun** (beserta nama akun) di modul **Monitoring Anggaran** — data hasil import Excel SAKTI, tersimpan di tabel `monitoring_anggaran` (`db/migrations/003_monitoring.sql`).

**Tujuan:** item mata anggaran kegiatan hanya boleh memakai kode akun yang sudah ada di sistem — bukan teks bebas.

## 2. Kebutuhan (hasil klarifikasi)

1. Ganti input teks "Nama Item" dengan **combobox pencarian** yang memilih `kode akun — nama akun` dari sistem.
2. Daftar akun menampilkan **semua kode akun di sistem** (tidak difilter unit kerja).
3. **Semua item wajib punya kode akun** — termasuk item lama yang pernah diketik bebas: saat mengedit kegiatan lama, item tersebut harus dipilih ulang sebelum dapat disimpan.
4. Kode akun yang sama **boleh dipakai lebih dari satu kali** dalam satu kegiatan.

## 3. Keputusan Desain

- **Sumber daftar akun:** distinct `kode_akun` + `nama_akun` dari **import monitoring terbaru** (snapshot SAKTI terkini, `MAX(id)` pada `monitoring_imports`).
- **Resolve `nama_akun` di server** — client hanya mengirim `kode_akun`; server mencari `nama_akun` dan menyimpannya ke `nama_item`. Dengan begitu teks item tidak bisa dimanipulasi client dan kueri downstream (`rekap`, cetak, snapshot SPPD) yang membaca `nama_item` tetap bekerja tanpa perubahan.
- **`kode_akun` nullable di DB** agar data lama tidak rusak oleh migrasi; kewajiban hanya ditegakkan untuk penyimpanan baru (via validasi zod + resolve di route).
- **Tanpa library baru** — combobox dibuat murni React + CSS existing (`.form-control`, `var()` tema), sesuai aturan `CLAUDE.md`.
- Duplikasi kode akun dalam satu kegiatan **diizinkan** (tidak ada cek unik).

## 4. Perubahan

### 4a. Migrasi DB

File baru **`db/migrations/006_kegiatan_kode_akun.sql`** (urutan alfabet setelah `005`, satu transaksi per file — pola `backend/scripts/migrate.ts`):

```sql
-- 006_kegiatan_kode_akun.sql
-- Rincian mata anggaran kini diikat ke kode akun dari data monitoring (SAKTI).
-- kode_akun nullable: baris lama tetap aman, baris baru selalu terisi.
ALTER TABLE mata_anggaran ADD COLUMN kode_akun VARCHAR(20);
```

`nama_item` tetap ada; isinya kini `nama_akun` hasil resolve server.

### 4b. Backend

**Endpoint baru — `GET /api/reference/akun`** (di `backend/src/routes/reference.ts`, di bawah `router.use(authMiddleware)`):

```sql
SELECT DISTINCT kode_akun, nama_akun
FROM monitoring_anggaran
WHERE import_id = (SELECT MAX(id) FROM monitoring_imports)
ORDER BY kode_akun;
```

Response: `{ data: [{ kode_akun, nama_akun }, ...] }`. Belum ada import monitoring → array kosong.

**Validasi — `backend/src/validation.ts`**: ganti isi `mataAnggaranItemSchema` (client tidak lagi mengirim `nama_item`):

```ts
const mataAnggaranItemSchema = z.object({
  kode_akun: z
    .string()
    .trim()
    .min(1, "kode_akun wajib diisi.")
    .max(20, "kode_akun maksimal 20 karakter."),
  jumlah_rp: z
    .number({ invalid_type_error: "jumlah_rp harus berupa angka." })
    .int("jumlah_rp harus berupa angka bulat.")
    .min(0, "jumlah_rp tidak boleh negatif."),
  keterangan: z.string().trim().max(2000).optional().nullable(),
});
```

**Route kegiatan — `backend/src/routes/kegiatan.ts`** (POST & PUT): untuk tiap item, resolve `nama_akun` dari import monitoring terbaru; simpan `kode_akun` + `nama_item = nama_akun`. Jika `kode_akun` tidak ditemukan → **400 "Kode akun tidak ditemukan."**

```ts
async function resolveNamaAkun(kodeAkun: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT nama_akun FROM monitoring_anggaran
     WHERE kode_akun = $1
       AND import_id = (SELECT MAX(id) FROM monitoring_imports)
     LIMIT 1`,
    [kodeAkun]
  );
  return r.rows[0]?.nama_akun ?? null;
}
```

`INSERT INTO mata_anggaran (kegiatan_id, kode_akun, nama_item, jumlah_rp, keterangan)`.

**Tipe — `backend/src/types.ts`**: tambah `kode_akun?: string` ke `MataAnggaran` (null untuk baris legacy).

### 4c. Frontend

**Komponen baru — `frontend/src/components/AkunCombobox.jsx`:**
- Input `.form-control`; pilihan terpilih tampil sebagai `kode akun — nama akun`.
- Ketik → filter daftar (cocok pada kode **atau** nama); klik untuk memilih.
- Keyboard: ↑/↓ pilih, Enter konfirmasi, Esc tutup; tutup saat klik di luar.
- Mode `readOnly` → render teks polos `kode akun — nama akun`.

**`frontend/src/components/MataAnggaranTable.jsx`:**
- State tiap baris: `kode_akun`, `nama_akun` (tampil), `jumlah_rp`, `keterangan`.
- `onChange` mengirim `{ kode_akun, jumlah_rp, keterangan }` — tanpa `nama_item`.
- Baris legacy (ada `nama_item`, tidak ada `kode_akun`): tampilkan teks lama + badge peringatan "pilih ulang kode akun".
- Ambil daftar akun sekali via `useEffect` dari `GET /api/reference/akun`.

**`frontend/src/pages/KegiatanForm.jsx`:**
- Validasi submit: setiap baris wajib punya `kode_akun`.
- Daftar akun kosong (belum ada import monitoring) → alert info: "Belum ada data monitoring — import Excel SAKTI dulu di halaman Monitoring Anggaran."
- Payload: `mata_anggaran: [{ kode_akun, jumlah_rp, keterangan }]`.

**`frontend/src/index.css`:**
- Style combobox (panel, opsi, hover, state kosong) memakai `var()` tema, kedua mode (light **dan** dark), radius/shadow mengikuti design system. Tanpa library baru.

### 4d. Pengujian

`backend/tests/integration.test.ts`:
- Seed `monitoring_imports` + `monitoring_anggaran` di `beforeEach` (mis. `522111` "Belanja Barang Non Operasional", `522131` "Belanja Jasa Profesi") agar resolve bekerja; pastikan migrasi `006` ikut terpasang (test setup memakai `runMigrations`).
- Update `kegiatanPayload` → `[{ kode_akun: "522111", jumlah_rp: 500000, keterangan: "snack" }, { kode_akun: "522131", jumlah_rp: 250000 }]`; sesuaikan assert yang membaca `nama_item`/`kode_akun`.
- Test baru: `GET /api/reference/akun` (200, distinct dari import terbaru); POST kegiatan dengan `kode_akun` tidak dikenal → 400; POST tanpa `kode_akun` → 400.
- Test validasi negatif lama (mis. `nama_item: "X", jumlah_rp: -5`) diubah agar memakai `kode_akun` (fokus `jumlah_rp` negatif).

Verifikasi manual frontend: tambah kegiatan memilih kode akun → simpan → buka detail/edit → kode akun tampil & bisa diganti; cek mode gelap.

## 5. Luar Lingkup

- Tidak menambah tabel referensi akun tersendiri (memakai data monitoring yang sudah ada).
- Tidak mengubah tampilan Monitoring Anggaran.
- Tidak menegakkan filter unit kerja pada daftar akun (keputusan: tampilkan semua akun).
