# Changelog v1.1.21 — 17 Agustus 2026

## 🐛 Perbaikan: "Gagal mengajukan pertanggungjawaban" di modul SPPD

### Ringkasan
Memperbaiki error 500 saat operator mengajukan pertanggungjawaban SPPD (tombol **"Ajukan Pertanggungjawaban"**).
Akar masalah: kolom `sppd_approval.keputusan` berjenis `VARCHAR(20)` terlalu sempit untuk nilai
`'diajukan_pertanggungjawaban'` (27 karakter) yang di-INSERT endpoint
`POST /api/sppd/:id/ajukan-pertanggungjawaban`. Migrasi 005 menambah nilai tersebut ke CHECK constraint
tapi tidak melebarkan kolomnya → INSERT gagal → transaksi rollback → popup error.

### Perubahan

**Database — `db/migrations/008_sppd_approval_keputusan_widen.sql`**
- `ALTER TABLE sppd_approval ALTER COLUMN keputusan TYPE VARCHAR(40)` — melebarkan kolom agar
  nilai 27 karakter muat. Diterapkan otomatis oleh migrator saat deploy.

**Tes — `backend/tests/integration.test.ts`**
- Blok `SPPD — pertanggungjawaban` baru (4 kasus):
  - Operator mengajukan SPPD berstatus `dilaksanakan` → `200` & status jadi `pertanggungjawaban`
  - SPPD tanpa dokumen `sppd_cap` → `400`
  - SPPD bukan status `dilaksanakan` → `400`
  - Operator lain mencoba mengajukan → `403`
- Kasus pertama ini gagal sebelum migrasi 008 (`500`, `value too long for type character varying(20)`)
  dan lulus setelahnya — mengunci perbaikan agar tidak regresi.
