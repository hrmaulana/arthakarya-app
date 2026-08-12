# Redesign Line Chart RPD — Satu Chart Gabungan ala shadcn — Design

**Tanggal:** 2026-08-12
**Status:** Disetujui user (via brainstorming)

## Goal

Rombak tampilan chart kumulatif RPD di halaman `/monitoring/rpd-timeline` dari **dua chart terpisah** (kumulatif + deviasi, garis polyline lurus) menjadi **satu chart gabungan** bergaya desain shadcn (https://ui.shadcn.com/charts/line): garis **melengkung halus** (smoothed), grid hanya horizontal putus-putus, tanpa garis sumbu, titik data bulat, legend di atas, dan **tooltip hover** yang menampilkan nilai tiap seri.

## Konteks & Keputusan User

- Fitur chart saat ini (commit `62d8f88`, sudah di master) berisi dua `<svg>`:
  1. Chart kumulatif: polyline Target + polyline Kegiatan + area bayangan deviasi.
  2. Chart deviasi terpisah: garis selisih per bulan dengan baseline nol.
- User tidak puas dengan desain: "deviasi dari RPD dijadikan satu chart dan chartnya smoothed seperti design shadcn".
- **Keputusan bentuk deviasi** (persetujuan user, memilih opsi "Band antar garis + tooltip"):
  - **Satu chart** total (chart deviasi terpisah **DIHAPUS**).
  - Dua garis kumulatif yang **smoothed**: Target (`var(--primary)`, indigo) dan Kegiatan (`var(--success)`, hijau).
  - **Band deviasi**: area di antara dua garis diisi tipis (`color-mix(in srgb, var(--warning) 18%, var(--surface))`) — representasi visual selisih `target_kum − kegiatan_kum`.
  - **Tooltip hover** (fitur signature shadcn): garis panduan vertikal + active dot di kedua garis + kotak tooltip berisi **Target**, **Kegiatan**, **Selisih** per bulan (nilai rupiah penuh).
- Data tetap dari `GET /api/rekap/rpd-target?tahun=YYYY` → `data.units[].months[]` (`bulan`, `target_kum`, `kegiatan_kum`, `selisih`). **Tanpa perubahan backend.**
- Tanpa library chart baru — **SVG inline murni** (larangan dependency di CLAUDE.md berlaku).

## Desain UI

### Kartu "Grafik Kumulatif Target vs Kegiatan"

- Posisi & selector unit **tetap seperti sekarang** (kartu di atas tabel "Perbandingan Kumulatif Target vs Kegiatan", selector "Semua Unit" + tiap unit, default "Semua Unit", mengikuti selector tahun).
- Isi kartu berubah dari dua chart menjadi **satu `<svg>`** + legend + tooltip.

### Satu chart gabungan (SVG)

- **Dua garis smoothed**:
  - Target kum. = `var(--primary)`, stroke 2.5.
  - Kegiatan kum. = `var(--success)`, stroke 2.5.
- **Smoothing**: path generator `smoothPath(pts)` — konversi **Catmull-Rom → cubic Bézier** (control point offset `(p[i+1] − p[i−1]) / 6`), menghasilkan kurva mulus setara `type="natural"` Recharts yang dipakai shadcn. Garis & band pakai path ini (bukan polyline).
- **Band deviasi**: path tertutup = kurva Target maju + kurva Kegiatan mundur, fill `color-mix(in srgb, var(--warning) 18%, var(--surface))`.
- **Grid ala shadcn**: hanya garis horizontal, putus-putus halus (`stroke-dasharray` kecil, warna `var(--surface-hover)`), `vertical={false}`.
- **Tanpa garis sumbu & tanpa tick line**; label bulan (sumbu X) + label nilai kompak `formatCompactRupiah` (sumbu Y, 5 tick) tetap.
- **Titik data**: `<circle>` r=4, fill warna garis masing-masing; saat hover r=6 (activeDot), stroke `var(--bg)` 2px supaya menonjol.
- **Legend di atas** (pola shadcn, bukan lagi di bawah): baris fleksibel dot bulat kecil (8px) + label muted — Target (`var(--primary)`), Kegiatan (`var(--success)`), Deviasi (swatch band `color-mix(in srgb, var(--warning) 30%, var(--surface))`).

### Tooltip hover

- **Overlay interaksi**: `<rect>` transparan selebar plot area, `onMouseMove`/`onMouseLeave` → state `hoverIdx` (index bulan terdekat dari koordinat kursor).
- Saat hover:
  - Garis panduan vertikal putus-putus di `x` bulan terpilih.
  - Active dot r=6 di kedua garis pada bulan itu.
  - Kotak tooltip `<foreignObject>` + `<div>` berisi per bulan: bulan (label Indonesia), baris Target / Kegiatan / **Selisih** — tiap baris: dot warna + label + nilai rupiah penuh (`formatRupiah`), nilai `font-variant-numeric: tabular-nums`.
  - Posisi kotak ikut kursor, **flip kiri/kanan** saat kursor di tepi chart (jaga dalam plot area).
- Tooltip hanya tampil saat hover — tidak ikut tercetak.

## Komponen & File

### Ubah: `frontend/src/components/RpdCumulativeChart.jsx`

Rombak dari 2 `<svg>` → **1 `<svg>`**:

- Props tetap `{ unit, formatRupiah }`; `unit.months` = `[{ bulan, target_kum, kegiatan_kum, selisih }]`.
- Pertahankan: `formatCompactRupiah`, `niceCeil`, `YGrid`, `XLabels`, `Plot` (wrapper `overflow-x: auto` + `viewBox`).
- **Baru**: `smoothPath(pts)` (Catmull-Rom → Bézier), `areaD` band dari dua kurva smoothed, state `hoverIdx` (`useState`), overlay rect + tooltip `foreignObject`.
- **Hapus**: chart deviasi kedua (variabel `devMax/devY/devColor`, elemen chart 2, `<h4>` "Deviasi Target − Kegiatan").
- Ekspor tetap: default `RpdCumulativeChart`, named `formatCompactRupiah`.

### Ubah: `frontend/src/pages/RpdGantt.jsx`

- **Nyaris tidak berubah**: kartu, selector unit, `chartTotal`/`chartUnit`, dan `<RpdCumulativeChart unit={...} formatRupiah={...} />` tetap.
- Tidak ada teks/elemen ekstra yang menyebut "chart deviasi terpisah".

### Ubah: `frontend/src/index.css`

- **Pertahankan**: `.line-chart`, `.grid-line`, `.axis-text`, `.deviation-area`, `.chart-legend`, `.legend-swatch`.
- **Baru** (semua via `var()` + varian dark):
  - `.chart-hover-line` — garis panduan hover: `stroke: var(--text-muted)`, dasharray halus.
  - `.chart-tooltip` — kotak tooltip: `background: var(--surface)`, `border: 1px solid var(--border)`, `border-radius: var(--radius)`, `box-shadow: var(--shadow-md)`, padding ~0.5–0.65rem, `font-size: 0.75rem`.
  - `.tooltip-row` (flex, gap kecil, align center), `.tooltip-dot` (8px bulat), `.tooltip-value` (`margin-left: auto`, `font-weight: 600`, `font-variant-numeric: tabular-nums`).
  - Animasi fade-in tooltip ~0.15s (CSS keyframes, konsisten pola design system).

## Konvensi Wajib (Design System)

- **Dark mode**: setiap warna lewat `var()` — verifikasi di kedua mode.
- **Animasi**: tooltip fade-in singkat; tidak mengubah pola `animated`+`setTimeout` yang lain.
- **Cetak**: band & garis ikut tercetak — `.line-chart` sudah punya `print-color-adjust: exact`; tooltip interaktif tidak dicetak.
- **Responsif ≤768px**: wrapper chart `overflow-x: auto` tetap (`min-width` svg) agar label bulan terbaca.

## Edge Cases

- `rpdTarget.units.length === 0` → kartu tidak dirender (logika di `RpdGantt.jsx` sudah ada).
- Hanya 1 bulan atau semua nilai 0 → garis datar, tetap render.
- `selisih` seluruhnya negatif → band tetap tampil (band = antar dua garis, tak peduli tanda).
- Kursor di luar plot area / mouse leave → tooltip hilang (`hoverIdx = null`).

## Out of Scope

- Perubahan backend/API.
- Selector unit, selector tahun, tabel "Perbandingan Kumulatif Target vs Kegiatan" — dipertahankan.
- Tambahan library chart/UI.
