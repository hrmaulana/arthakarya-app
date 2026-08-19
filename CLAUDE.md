# CLAUDE.md — Arthakarya

Aplikasi perencanaan kegiatan & anggaran (Kedeputian PMP, Bappenas).
Stack: React 18 + Vite · Bun + Express + TypeScript · PostgreSQL 16 · Docker Compose.
Operasional/runbook: **OPS.md** — wajib dibaca untuk masalah server, deploy, backup, jaringan Bappenas.

## Perintah

- Backend: `bun test` (di `backend/`; butuh container `arthakarya_test_pg` port 5433)
- Rilis: push tag `v1.0.x` → deploy otomatis. Migrasi SQL baru = file baru di `backend/src/db/migrations/` (urut abjad, satu transaksi per file).

## Frontend Design System

Semua styling ada di **`frontend/src/index.css`** — satu-satunya sumber desain.
Tanpa Tailwind, tanpa library UI/chart (SVG inline). **Jangan menambah dependency** untuk hal yang sudah ada.

### Tema

- CSS custom properties: light di `:root`, dark di `[data-theme="dark"]` — **selalu pakai `var()`, jangan pernah hardcode hex**. Mode dipilih lewat `data-theme` di `<html>`.
- Palet: primary indigo (`--primary` #4f46e5 / #818cf8 dark), `--success/--warning/--danger/--info` masing-masing dengan varian `-subtle`. Background `--bg` (#f8fafc / #0f172a), `--surface`.
- Radius: `--radius-sm` 6px · `--radius` 10px · `--radius-lg` 14px · `--radius-xl` 20px.
- Shadow: `--shadow-xs` … `--shadow-lg`. Gradient login: `--gradient-login`.
- Tipografi: Inter + system stack; heading bold `letter-spacing: -0.3px`; label seksi uppercase 0.68rem; angka rupiah boleh `.font-mono`.

### Komponen utama (pakai yang ada, jangan buat baru)

- Tombol `.btn` (+ `-primary -secondary -ghost -danger -success -sm`), `.card`/`.card-header`, `.badge` (+ `-draft -diajukan -disetujui -ditolak -admin -operator`), form `.form-group`/`.form-control`/`.input-with-icon`, tabel `.table-wrapper` + `.table-sticky`.
- Halaman: `.page-header` (judul + aksi kanan), `.page-content`, `.stats-grid`/`.stat-card` (warna aksen: `.accent-red` dll), `.grid-2`/`.grid-3`.
- Sidebar: `.sidebar`, `.sidebar-nav a.active` (border-left 3px primary), `.theme-toggle`.
- **Level penyerapan**: `levelOf(pct)` → `<40` low (merah/danger), `40–70` mid (kuning/warning), `>70` high (hijau/success). Class `.level-low/-mid/-high` (+ `-bg`) dipakai monitoring & login slideshow.
- Login: `.login-page` split dua panel; slideshow publik `.login-slides`/`.login-slide`/`.login-dots` — data dari `GET /api/monitoring/public-summary` via **fetch langsung** (bukan axios client, halaman publik tanpa JWT).
- Monitoring: `.mon-hero` (stats + donut SVG `.donut-*`), `.unit-card`, `.bar-chart`/`.bar-track`/`.bar-fill`.

### Pola wajib

- **Dark mode**: warna baru harus punya varian dark — verifikasi di kedua mode.
- **Animasi**: CSS keyframes murni (fade/translate 0.3–0.5s); transisi masuk dengan pola `animated` state + `setTimeout(100ms)` (pola Dashboard).
- **Cetak**: halaman laporan pakai `.print-only`/`.no-print` + blok `@media print` dengan `print-color-adjust: exact` (warna kartu ikut tercetak).
- **Responsif**: ≤768px panel kiri login & grid 3 kolom collapse; sidebar jadi hamburger.

### Larangan

- Jangan tambah library chart/UI/animation — pola CSS/SVG existing sudah cukup.
- Jangan ubah var warna tanpa sinkron kedua mode.
- Jangan buat class baru kalau class existing memenuhi kebutuhan.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
