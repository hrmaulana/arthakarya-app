# Line Chart Kumulatif RPD Target vs Kegiatan — Design

**Tanggal:** 2026-08-12
**Status:** Disetujui user (via brainstorming)

## Goal

Tambahkan line chart perbandingan **RPD kumulatif kegiatan** vs **RPD target kumulatif** di halaman RPD & Timeline (`/monitoring/rpd-timeline`). Mencakup: chart keseluruhan (total semua unit), selector per unit kerja, area deviasi di antara dua garis, dan chart deviasi terpisah (selisih per bulan dengan baseline nol).

## Konteks & Keputusan User

- Data sudah lengkap di `GET /api/rekap/rpd-target?tahun=YYYY`:
  `data.units[].months[]` → per bulan: `bulan`, `target`, `target_kum`, `kegiatan`, `kegiatan_kum`, `selisih` (= `target_kum − kegiatan_kum`).
  **Tanpa perubahan backend.**
- **Cakupan unit** (persetujuan user): "gambar keseluruhan dan pilih chart per unit kerja" → selector dengan opsi **"Semua Unit"** (total) + tiap unit kerja. Default = "Semua Unit".
- **Bentuk deviasi** (persetujuan user): **KEDUANYA** — (a) area bayangan di antara dua garis kumulatif, dan (b) chart deviasi terpisah: garis selisih per bulan dengan garis dasar nol.
- Tanpa library chart baru — **SVG inline** (pola donut monitoring sudah memakai SVG murni). Larangan dependency di CLAUDE.md berlaku.

## Desain UI

### Kartu baru "Grafik Kumulatif Target vs Kegiatan"

- Posisi: tepat **di atas** kartu tabel "Perbandingan Kumulatif Target vs Kegiatan".
- **Selector unit** (segmented buttons, pola seperti tombol tahun): opsi "Semua Unit" + nama unit kerja.
- Mengikuti selector **tahun** yang sudah ada di halaman (state `rpdTarget` per tahun sama).
- Terlihat untuk **semua role** (sama seperti tabel target saat ini, bukan hanya admin).
- Jika `rpdTarget.units.length === 0` → kartu tidak dirender.

### Chart 1 — Kumulatif (SVG, atas)

- Dua polyline:
  - **Target kum.** = `var(--primary)` (solid, 2.5px).
  - **Kegiatan kum.** = `var(--success)` (solid, 2.5px).
- **Area bayangan deviasi** di antara dua garis: `<path>` polygon (titik target maju lalu titik kegiatan mundur), fill translusen `color-mix(in srgb, var(--warning) 18%, var(--surface))` — konsisten dengan pola tint donut/unit-card.
- Sumbu X: bulan (label sesuai `months` import, urut naik).
- Sumbu Y: 5 tick nilai **kompak** (`M` = miliar, `jt` = juta); nilai penuh di atribut `title` (tooltip).
- Grid horizontal halus; titik data kecil (dot) di tiap bulan; legend swatch (Target / Kegiatan).

### Chart 2 — Deviasi (SVG, bawah)

- Polyline **selisih** per bulan (`target_kum − kegiatan_kum`).
- **Baseline nol**: garis putus-putus horizontal.
- Warna mengikuti konvensi halaman yang sudah ada (tabel menandai `d.selisih < 0` dengan `.level-low`):
  - selisih ≥ 0 → `var(--warning)`.
  - selisih < 0 → `var(--danger)`.
- Sumbu X sama dengan chart 1; skala Y otomatis (selalu inklusif nol).

## Komponen & File

### Baru: `frontend/src/components/RpdCumulativeChart.jsx`

Komponen presentasional, pure:

- Props: `{ months: number[], unit: { nama_unit: string, months: [{ bulan, target_kum, kegiatan_kum, selisih }] }, formatRupiah }`.
- Internal:
  - Hitung domain Y (maks semua seri yang dirender → bulatkan ke angka "nice", +15% ruang).
  - `formatCompactRupiah(n)`: ≥ 1e9 → satu desimal + `" M"`; ≥ 1e6 → `" jt"`; < 1e6 → angka bulat. Koma desimal (Indonesia), titik ribuan untuk nilai penuh.
  - Konversi data → koordinat SVG (penskalaan linear), dua `<svg>` dengan `viewBox` responsif (`width: 100%`).
  - Titik data: `<circle>` kecil; `title` = rupiah penuh.

### Ubah: `frontend/src/pages/RpdGantt.jsx`

- State `chartUnitId` (default `"total"`).
- Hitung **seri total** dari `rpdTarget.units`: per bulan sum `target_kum`, `kegiatan_kum`, `selisih` (nama unit "Semua Unit").
- Render kartu baru + selector unit + `<RpdCumulativeChart />` di atas kartu tabel perbandingan.

### Ubah: `frontend/src/index.css`

- Class CSS baru minimal (existing tidak mencakup line chart): `.line-chart`, text/axis/grid line, `.chart-legend`.
- Semua warna via `var()` — varian dark otomatis (tidak ada hex hardcode).

## Konvensi Wajib (Design System)

- **Dark mode**: setiap warna lewat `var()`; verifikasi di kedua mode.
- **Animasi**: opsional; jika ada gunakan fade-in pola `animated` + `setTimeout(100ms)`.
- **Cetak**: kartu chart ikut tercetak — blok `@media print` dengan `print-color-adjust: exact`.
- **Responsif ≤768px**: wrapper chart `overflow-x: auto` (pola Gantt) agar label bulan tetap terbaca.

## Edge Cases

- `rpdTarget.units.length === 0` → kartu tidak dirender.
- Hanya 1 bulan atau semua nilai 0 → garis datar, tetap render.
- Selisih seluruhnya negatif → chart deviasi semua di bawah nol.

## Out of Scope

- Perubahan backend/API.
- Tabel perbandingan per unit yang sudah ada tetap dipertahankan.
