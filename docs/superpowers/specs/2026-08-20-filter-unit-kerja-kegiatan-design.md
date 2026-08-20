# Desain — Filter Unit Kerja di Daftar Kegiatan (Role Admin)

- **Tanggal**: 2026-08-20
- **Status**: Disetujui untuk implementasi
- **Project**: ArthaKarya — aplikasi perencanaan kegiatan & anggaran (Kedeputian PMP, Bappenas)

## Ringkasan

Di halaman **Daftar Kegiatan** (`frontend/src/pages/KegiatanList.jsx`), admin melihat kegiatan
seluruh unit. Saat ini admin hanya bisa memfilter berdasarkan **status** dan **akun**. Fitur ini
menambahkan dropdown **"Filter Unit Kerja"** (khusus admin) yang memfilter daftar per unit kerja,
dengan jumlah kegiatan per unit di dalam dropdown (konsisten dengan filter Akun yang menampilkan
`(jml)`).

Operator **tidak terpengaruh** — mereka sudah di-scope ke unitnya sendiri oleh middleware, dan
dropdown tidak dirender untuk mereka.

## Konteks Saat Ini

- `GET /api/kegiatan` (`backend/src/routes/kegiatan.ts`) menerima query `status`, `kode_akun`,
  `sort`, `order`. Scoping unit dilakukan via `getUnitKerjaFilter(req)` dari
  `backend/src/middleware/authorize.ts`: admin → `null` (tanpa filter), operator → `unit_kerja_id`
  sendiri.
- `meta.akun_options` dikirim untuk dropdown filter akun (`{ kode_akun, nama_akun, jml_kegiatan }`).
- Frontend memakai `useOutletContext()` untuk `user` (role), dan sudah memiliki pola filter
  server-side + `fetchData` berbasis `useCallback`.

## Pendekatan Dipilih

**Pendekatan A — filter server-side, logika scope di `getUnitKerjaFilter` (bersama).**
Alasan: home alami untuk logika scope, perubahan kecil, efek additif (default tanpa filter),
dan konsisten dengan pola filter status/akun yang sudah ada.

## Desain Detail

### 1. Backend — `backend/src/middleware/authorize.ts`

Modifikasi `getUnitKerjaFilter()`: admin menghormati query `?unit_kerja_id=` bila angka valid.
Perilaku operator tidak berubah.

```ts
export function getUnitKerjaFilter(req: Request): { unitKerjaId: number | null } {
  if (!req.user) return { unitKerjaId: null };
  if (req.user.role === "admin") {
    // Admin dapat memfilter per unit via ?unit_kerja_id= (validasi numerik).
    const q = req.query.unit_kerja_id;
    if (typeof q === "string" && q !== "") {
      const id = Number(q);
      if (Number.isInteger(id) && id > 0) return { unitKerjaId: id };
    }
    return { unitKerjaId: null };
  }
  return { unitKerjaId: req.user.unit_kerja_id };
}
```

Efek samping yang disengaja: endpoint list lain yang memakai `getUnitKerjaFilter` (monitoring,
sppd, surat tugas) ikut mendukung filter unit via query untuk admin. Tidak ada UI baru di sana
untuk sekarang — kemampuan tambahan yang koheren, default tetap tanpa filter.

### 2. Backend — `backend/src/routes/kegiatan.ts` (GET /)

- Query utama tetap memakai `unitKerjaId` (kini dapat ter-filter untuk admin).
- Perkenalkan `unitScope` = **scope penuh role** (admin → `null`, operator → `unit_kerja_id`
  sendiri), **bukan** filter yang sedang aktif. `unitScope` dipakai untuk menghitung kedua opsi
  dropdown (`akun_options` dan `unit_options`) supaya:
  - dropdown unit selalu menampilkan **semua** unit (bisa berpindah walau sudah memilih satu), dan
  - perilaku `akun_options` identik dengan kondisi sekarang (tidak terpengaruh filter unit baru).
- Tambah `meta.unit_options`:

```sql
SELECT uk.id, uk.nama_unit, COUNT(DISTINCT k.id) AS jml_kegiatan
FROM unit_kerja uk
LEFT JOIN kegiatan k ON k.unit_kerja_id = uk.id
-- [jika unitScope !== null: WHERE k.unit_kerja_id = $n]
GROUP BY uk.id, uk.nama_unit
ORDER BY uk.nama_unit
```

Respons menjadi: `{ data, meta: { akun_options, unit_options } }`.

### 3. Frontend — `frontend/src/pages/KegiatanList.jsx`

- State baru: `unitFilter` (string kosong = semua) dan `unitOptions` (dari `meta.unit_options`).
- `fetchData`: `if (unitFilter) params.unit_kerja_id = unitFilter;`; `unitFilter` ditambahkan ke
  deps `useCallback`.
- Dropdown **"Filter Unit Kerja"** dirender hanya bila `user?.role === "admin"`:
  - opsi default `"Semua Unit"` (value `""`),
  - opsi per unit: `"{nama_unit} ({jml_kegiatan})"` dengan `value={id}`.
- Teks empty-state diperbarui agar ikut menyebut filter unit (mis. `statusFilter || akunFilter ||
  unitFilter`).

### 4. Data Flow

```
Admin pilih unit X di dropdown
  → fetchData() → GET /api/kegiatan?unit_kerja_id=X&...
  → getUnitKerjaFilter: admin + query valid → unitKerjaId = X
  → SQL: AND k.unit_kerja_id = X
  → meta.unit_options dihitung dengan unitScope (admin = semua unit, tetap lengkap)
  → tabel + mini-dashboard menampilkan hanya kegiatan unit X
```

Mini-dashboard (Total Kegiatan/Anggaran/Akun) mengikuti hasil filter — konsisten dengan perilaku
filter status/akun yang sudah ada.

### 5. Error Handling

- `unit_kerja_id` query yang tidak valid (bukan angka/≤0) → diabaikan, perilaku = tanpa filter
  (di-thread oleh validasi `Number.isInteger(id) && id > 0` di `getUnitKerjaFilter`).
- Unit tidak ditemukan / tak punya kegiatan → hasil kosong + pesan empty-state; tidak error.

## Testing (TDD — RED → GREEN)

Semua di `backend/tests/integration.test.ts` (pola `api(...)` + seeding 2 unit yang sudah ada):

1. **Admin filter unit**: buat 1 kegiatan di unit 1 dan 1 di unit 2; `GET /api/kegiatan?unit_kerja_id=2`
   (token admin) → semua baris `unit_kerja_id === 2`, tidak ada baris unit 1.
2. **`meta.unit_options`**: untuk admin, berisi `id`, `nama_unit`, `jml_kegiatan`; jumlah unit = 2
   dengan count sesuai kegiatan ter-seed.
3. **Regression**: test "operator hanya melihat kegiatan unitnya sendiri" tetap hijau;
   admin tanpa query tetap melihat semua unit.

Jalankan: `bun test --timeout 60000` (backend).

## File yang Berubah

| File | Perubahan |
|------|-----------|
| `backend/src/middleware/authorize.ts` | `getUnitKerjaFilter` hormati `?unit_kerja_id=` untuk admin |
| `backend/src/routes/kegiatan.ts` | Tambah `unitScope` + `meta.unit_options`; query options pakai `unitScope` |
| `frontend/src/pages/KegiatanList.jsx` | State `unitFilter`/`unitOptions`, dropdown admin, param fetch, teks empty-state |
| `backend/tests/integration.test.ts` | Test admin filter unit + unit_options |

Tidak ada migrasi DB, tidak ada perubahan route/URL.

## Non-Goals

- Tidak menambah filter unit untuk role operator (sudah ter-scope).
- Tidak menambah UI filter unit di halaman lain (monitoring, sppd, dsb.) — hanya Daftar Kegiatan.
- Tidak menambah pagination/penyimpanan preferensi filter.
