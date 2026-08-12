# Redesign Line Chart RPD ala shadcn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rombak chart kumulatif RPD dari dua chart terpisah menjadi **satu chart gabungan ala shadcn**: dua garis smoothed (Target & Kegiatan), band deviasi di antaranya, legend di atas, dan tooltip hover yang menampilkan Target/Kegiatan/Selisih per bulan.

**Architecture:** Frontend-only, tanpa perubahan backend/API. Komponen `RpdCumulativeChart.jsx` dirombak dari 2 `<svg>` (polyline lurus) menjadi **1 `<svg>`** dengan kurva Catmull-Rom → cubic Bézier (smoothing) dan tooltip hover via `<foreignObject>`. Halaman `RpdGantt.jsx` **tidak diubah**. Class CSS baru di `index.css`.

**Tech Stack:** React 18 + Vite (SVG inline murni — tanpa library chart/UI). Build: `bun run build` (Vite). Tanpa test runner frontend.

## Global Constraints

- **Bash CWD = `backend/`** — untuk git & build gunakan path relatif: `git add ../frontend/...`, `cd ../frontend && bun run build`.
- **Tanpa perubahan backend** dan **tanpa perubahan `RpdGantt.jsx`** (kartu, selector unit, `chartTotal`/`chartUnit` tetap).
- **Tanpa library chart/UI baru** — SVG inline murni (larangan dependency di CLAUDE.md).
- **Semua warna via `var()`** — jangan pernah hardcode hex; verifikasi varian dark (`[data-theme="dark"]`).
- Warna seri: Target = `var(--primary)` (indigo), Kegiatan = `var(--success)` (hijau), band deviasi = `color-mix(in srgb, var(--warning) 18%, var(--surface))`, active-dot stroke = `var(--bg)`.
- Grid hanya horizontal putus-putus; **tanpa garis sumbu**; label bulan & nilai kompak (`formatCompactRupiah`) tetap.
- Legend di **atas** chart (bukan bawah). Tooltip hanya tampil saat hover — tidak ikut cetak.
- **Cetak**: `.line-chart`/`.chart-legend` ikut tercetak (`print-color-adjust: exact`).
- **Responsif ≤768px**: wrapper `overflow-x: auto` + `min-width` svg tetap (label bulan terbaca).
- **Verifikasi**: frontend tidak punya test runner → bukti = `bun run build` sukses + checklist manual di browser (dijalankan user). Tidak ada langkah test palsu.
- Jangan pernah menambahkan `frontend/bun.lock` atau `frontend/vite.config.worktree.js` ke git (untracked, milik lingkungan).
- Ikuti desain spec: `docs/superpowers/specs/2026-08-12-rpd-line-chart-shadcn-redesign-design.md`.

---

### Task 1: Rombak `RpdCumulativeChart.jsx` jadi satu chart gabungan

**Files:**
- Modify: `frontend/src/components/RpdCumulativeChart.jsx`

**Interfaces:**
- Consumes: `unit = { unit_kerja_id, nama_unit, months: [{ bulan, target_kum, kegiatan_kum, selisih }] }`; `formatRupiah` dari `useOutletContext` (output `Intl.NumberFormat("id-ID", {style:"currency", currency:"IDR", minimumFractionDigits:0})` → mis. `Rp 1.631.593.430`).
- Produces: default export `RpdCumulativeChart({ unit, formatRupiah })`; named export `formatCompactRupiah` (dipertahankan).
- Class CSS yang dipakai JSX (Task 2 menyediakan yang belum ada): `.chart-legend`, `.legend-swatch`, `.line-chart`, `.grid-line`, `.axis-text`, `.deviation-area`, `.chart-hover-line`, `.chart-tooltip`, `.tooltip-month`, `.tooltip-row`, `.tooltip-dot`, `.tooltip-value`.

- [ ] **Step 1: Tulis ulang seluruh isi file**

Ganti seluruh isi `frontend/src/components/RpdCumulativeChart.jsx` dengan kode berikut (satu `<svg>`, dua garis smoothed, band deviasi, legend di atas, tooltip hover):

```jsx
// Line chart kumulatif Target vs Kegiatan — SATU chart gabungan ala shadcn.
// SVG murni (tanpa library). Dua garis di-smoothed (Catmull-Rom → cubic Bézier),
// band deviasi di antara dua garis, tooltip hover (garis panduan + active dot +
// kotak Target/Kegiatan/Selisih). Warna semua via var() (dark mode siap).
//
// Props:
//   unit: { unit_kerja_id, nama_unit, months: [{ bulan, target_kum, kegiatan_kum, selisih }] }
//   formatRupiah: (n) => string  — formatter rupiah penuh dari useOutletContext
import React, { useState } from "react";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

const W = 720;             // viewBox width
const H = 260;             // tinggi chart
const M = { top: 16, right: 16, bottom: 30, left: 62 }; // margin
const TIP_W = 200;         // lebar kotak tooltip (unit viewBox)
const TIP_H = 104;         // tinggi kotak tooltip

// Format rupiah kompak untuk label sumbu: "1,6 M" (miliar), "400 jt" (juta),
// sisanya angka bulat. Nilai penuh selalu ada di tooltip.
export function formatCompactRupiah(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e9) {
    const v = (abs / 1e9).toFixed(1).replace(/\.0$/, "").replace(".", ",");
    return `${sign}${v} M`;
  }
  if (abs >= 1e6) {
    const v = abs / 1e6;
    const r = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
    const s = Number.isInteger(r) ? String(r) : r.toFixed(1).replace(".", ",");
    return `${sign}${s} jt`;
  }
  return `${sign}${Math.round(abs).toLocaleString("id-ID")}`;
}

// Bulatkan ke atas ke angka "nice" (1/2/2.5/5 × 10^k) — untuk domain sumbu Y.
function niceCeil(v) {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const f = v / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * base;
}

// Segmen cubic Bézier dari titik ke titik (tanpa "M" awal) — dipakai menyambung
// path band. Kurva di-smoothed Catmull-Rom → Bézier, halus seperti chart shadcn.
// clampY (opsional): kunci koordinat Y control point agar kurva tidak keluar plot.
function bezierSegments(pts, clampY) {
  let d = "";
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1y = clampY ? clampY(p1.y + (p2.y - p0.y) / 6) : p1.y + (p2.y - p0.y) / 6;
    const c2y = clampY ? clampY(p2.y - (p3.y - p1.y) / 6) : p2.y - (p3.y - p1.y) / 6;
    d += ` C ${(p1.x + (p2.x - p0.x) / 6).toFixed(1)} ${c1y.toFixed(1)} ` +
      `${(p2.x - (p3.x - p1.x) / 6).toFixed(1)} ${c2y.toFixed(1)} ` +
      `${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

// Path garis halus penuh (M + segmen Bézier).
function smoothPath(pts, clampY) {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}` + bezierSegments(pts, clampY);
}

// Plot = wrapper scroll-x + <svg> yang menyesuaikan lebar.
function Plot({ height, children, label }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <svg className="line-chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
        {children}
      </svg>
    </div>
  );
}

// Garis grid horizontal (putus-putus) + label sumbu Y untuk domain [0, maxVal].
function YGrid({ maxVal, height, fmt }) {
  const plotW = W - M.left - M.right;
  const plotH = height - M.top - M.bottom;
  const lines = [];
  for (let i = 0; i <= 4; i++) {
    const val = (maxVal * i) / 4;
    const y = M.top + plotH * (1 - i / 4);
    lines.push(
      <g key={i}>
        <line x1={M.left} y1={y} x2={W - M.right} y2={y} className="grid-line" />
        <text x={M.left - 8} y={y + 4} textAnchor="end" className="axis-text">
          {fmt(val)}
        </text>
      </g>
    );
  }
  return lines;
}

// Label bulan di sumbu X — posisi konsisten dengan titik data.
function XLabels({ data, height }) {
  const plotW = W - M.left - M.right;
  const n = data.length;
  return data.map((d, i) => {
    const x = n > 1 ? M.left + (i / (n - 1)) * plotW : M.left + plotW / 2;
    return (
      <text key={d.bulan} x={x} y={height - 8} textAnchor="middle" className="axis-text">
        {MONTHS[d.bulan - 1]}
      </text>
    );
  });
}

export default function RpdCumulativeChart({ unit, formatRupiah }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const data = unit.months;
  const n = data.length;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const maxVal = niceCeil(
    Math.max(...data.map((d) => Math.max(d.target_kum, d.kegiatan_kum)), 1)
  );
  const xAt = (i) => (n > 1 ? M.left + (i / (n - 1)) * plotW : M.left + plotW / 2);
  const yAt = (v) => M.top + plotH * (1 - v / maxVal);
  const clampY = (y) => Math.min(Math.max(y, M.top), M.top + plotH);

  const toPts = (getV) =>
    data.map((d, i) => ({ x: xAt(i), y: yAt(getV(d)), v: getV(d), bulan: d.bulan }));
  const targetPts = toPts((d) => d.target_kum);
  const kegiatanPts = toPts((d) => d.kegiatan_kum);

  // Band deviasi: kurva Target maju → sambung ke ujung kurva Kegiatan →
  // kurva Kegiatan mundur → tutup. Area di antara dua garis = visual selisih.
  const bandD =
    smoothPath(targetPts, clampY) +
    ` L ${kegiatanPts[kegiatanPts.length - 1].x.toFixed(1)} ${kegiatanPts[kegiatanPts.length - 1].y.toFixed(1)}` +
    bezierSegments([...kegiatanPts].reverse(), clampY) +
    " Z";

  const lineTargetD = smoothPath(targetPts, clampY);
  const lineKegiatanD = smoothPath(kegiatanPts, clampY);

  // Posisi kotak tooltip: di kanan kursor; flip ke kiri bila dekat tepi kanan.
  const hoverX = hoverIdx == null ? 0 : xAt(hoverIdx);
  const tipX =
    hoverX + TIP_W + 12 > W - M.right ? hoverX - TIP_W - 12 : hoverX + 12;

  // Mouse (CSS px) → koordinat viewBox (svg responsive), lalu ke index bulan.
  const handleMove = (e) => {
    const svgEl = e.currentTarget.ownerSVGElement;
    const rect = svgEl.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    if (sx < M.left || sx > W - M.right) {
      setHoverIdx(null);
      return;
    }
    const i = Math.round(((sx - M.left) / plotW) * (n - 1));
    setHoverIdx(Math.min(Math.max(i, 0), n - 1));
  };

  return (
    <div>
      <div className="chart-legend">
        <span><span className="legend-swatch" style={{ background: "var(--primary)" }} />Target kumulatif</span>
        <span><span className="legend-swatch" style={{ background: "var(--success)" }} />Kegiatan kumulatif</span>
        <span><span className="legend-swatch" style={{ background: "color-mix(in srgb, var(--warning) 30%, var(--surface))" }} />Deviasi (selisih antar garis)</span>
      </div>
      <Plot height={H} label="Grafik kumulatif target vs kegiatan per bulan">
        <YGrid maxVal={maxVal} height={H} fmt={formatCompactRupiah} />
        <path d={bandD} className="deviation-area" />
        <path d={lineTargetD} fill="none" style={{ stroke: "var(--primary)" }} strokeWidth="2.5" strokeLinecap="round" />
        <path d={lineKegiatanD} fill="none" style={{ stroke: "var(--success)" }} strokeWidth="2.5" strokeLinecap="round" />
        {targetPts.map((p) => (
          <circle key={`t${p.bulan}`} cx={p.x} cy={p.y} r={4} style={{ fill: "var(--primary)" }}>
            <title>{`${MONTHS[p.bulan - 1]}: target ${formatRupiah(p.v)}`}</title>
          </circle>
        ))}
        {kegiatanPts.map((p) => (
          <circle key={`k${p.bulan}`} cx={p.x} cy={p.y} r={4} style={{ fill: "var(--success)" }}>
            <title>{`${MONTHS[p.bulan - 1]}: kegiatan ${formatRupiah(p.v)}`}</title>
          </circle>
        ))}

        {/* Overlay interaksi tooltip — transparan, menangkap mouse di area plot */}
        <rect
          x={M.left} y={M.top} width={plotW} height={plotH}
          fill="transparent"
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIdx(null)}
        />

        {/* Elemen saat hover */}
        {hoverIdx != null && (
          <g>
            <line x1={xAt(hoverIdx)} y1={M.top} x2={xAt(hoverIdx)} y2={M.top + plotH} className="chart-hover-line" />
            <circle cx={targetPts[hoverIdx].x} cy={targetPts[hoverIdx].y} r={6} style={{ fill: "var(--primary)" }} stroke="var(--bg)" strokeWidth={2} />
            <circle cx={kegiatanPts[hoverIdx].x} cy={kegiatanPts[hoverIdx].y} r={6} style={{ fill: "var(--success)" }} stroke="var(--bg)" strokeWidth={2} />
            <foreignObject x={tipX} y={M.top + 8} width={TIP_W} height={TIP_H}>
              <div className="chart-tooltip">
                <div className="tooltip-month">{MONTHS[data[hoverIdx].bulan - 1]}</div>
                <div className="tooltip-row">
                  <span className="tooltip-dot" style={{ background: "var(--primary)" }} />
                  <span>Target</span>
                  <span className="tooltip-value">{formatRupiah(data[hoverIdx].target_kum)}</span>
                </div>
                <div className="tooltip-row">
                  <span className="tooltip-dot" style={{ background: "var(--success)" }} />
                  <span>Kegiatan</span>
                  <span className="tooltip-value">{formatRupiah(data[hoverIdx].kegiatan_kum)}</span>
                </div>
                <div className="tooltip-row">
                  <span className="tooltip-dot" style={{ background: "var(--warning)" }} />
                  <span>Selisih</span>
                  <span className="tooltip-value">{formatRupiah(data[hoverIdx].selisih)}</span>
                </div>
              </div>
            </foreignObject>
          </g>
        )}
        <XLabels data={data} height={H} />
      </Plot>
    </div>
  );
}
```

- [ ] **Step 2: Verifikasi build**

Run: `cd ../frontend && bun run build`

Expected: build sukses (Vite mencetak `✓ built in …` dan tidak ada error). **Jangan** menambahkan `bun.lock` atau file lain yang muncul akibat instalasi ke git.

- [ ] **Step 3: Commit**

```bash
git add ../frontend/src/components/RpdCumulativeChart.jsx
git commit -m "feat(chart): satu chart gabungan smoothed ala shadcn dengan tooltip hover"
```

---

### Task 2: Class CSS chart baru di `index.css`

**Files:**
- Modify: `frontend/src/index.css:341-348` (blok `.line-chart` s/d `@media print`)

**Interfaces:**
- Menyediakan class yang dipakai JSX Task 1: `.chart-hover-line`, `.chart-tooltip`, `.tooltip-month`, `.tooltip-row`, `.tooltip-dot`, `.tooltip-value`.
- Mengubah: `.grid-line` menjadi putus-putus, `.chart-legend` margin bawah (posisi atas), `.legend-swatch` menjadi dot bulat 10px.
- Menghapus: `.zero-line` (tidak dipakai lagi — chart deviasi terpisah dihapus).
- Mempertahankan: `.line-chart`, `.axis-text`, `.deviation-area`, blok `@media print`.

- [ ] **Step 1: Ganti blok CSS**

Di `frontend/src/index.css`, ganti **seluruh blok** mulai baris 341 (`.line-chart { … }`) sampai baris 347 (`.chart-legend .legend-swatch { … }`) — biarkan blok `@media print` di baris 348 tetap — dengan:

```css
.line-chart { width: 100%; min-width: 560px; display: block; }
.line-chart .grid-line { stroke: var(--surface-hover); stroke-width: 1; stroke-dasharray: 3 3; }
.line-chart .axis-text { font-size: 11px; fill: var(--text-muted); }
.line-chart .deviation-area { fill: color-mix(in srgb, var(--warning) 18%, var(--surface)); }
.line-chart .chart-hover-line { stroke: var(--text-muted); stroke-width: 1; stroke-dasharray: 3 3; }
.chart-legend { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.7rem; font-size: 0.78rem; color: var(--text-secondary); }
.chart-legend .legend-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: middle; margin-right: 0.35rem; }
.chart-tooltip { box-sizing: border-box; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-md); padding: 0.5rem 0.65rem; font-size: 0.75rem; color: var(--text); animation: tooltip-in 0.15s ease-out; }
.chart-tooltip .tooltip-month { font-weight: 600; margin-bottom: 0.3rem; }
.chart-tooltip .tooltip-row { display: flex; align-items: center; gap: 0.45rem; line-height: 1.7; }
.chart-tooltip .tooltip-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.chart-tooltip .tooltip-value { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; }
@keyframes tooltip-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
```

Catatan: blok `@media print { .line-chart, .chart-legend { print-color-adjust: exact; } }` **tetap dipertahankan** di baris 348.

- [ ] **Step 2: Verifikasi build**

Run: `cd ../frontend && bun run build`

Expected: build sukses. `bun run build` sukses hanya membuktikan tidak ada syntax error; warna/visual diverifikasi manual oleh user (daftar di bawah).

- [ ] **Step 3: Commit**

```bash
git add ../frontend/src/index.css
git commit -m "style(chart): class tooltip, legend dot, grid dashed ala shadcn"
```

---

## Checklist Verifikasi Manual (dijalankan user di browser)

Frontend tanpa test runner — kebenaran visual diverifikasi manual oleh user di `http://localhost:5173/monitoring/rpd-timeline` (login `admin`, tahun dengan data ter-import):

- [ ] Satu kartu chart (chart deviasi terpisah tidak ada lagi).
- [ ] Dua garis **melengkung halus** (Target indigo, Kegiatan hijau), bukan garis bersiku.
- [ ] Band tipis di antara dua garis (visual deviasi).
- [ ] Grid hanya horizontal, putus-putus; tanpa garis sumbu; label rupiah kompak + bulan tetap.
- [ ] Legend di **atas** chart dengan dot bulat.
- [ ] **Hover**: garis panduan vertikal + active dot membesar + kotak tooltip berisi Target, Kegiatan, Selisih (rupiah penuh); kotak flip saat di tepi kanan; hilang saat mouse keluar plot.
- [ ] Dark mode tetap benar (dua-duanya via `var()`).
- [ ] Layar ≤768px: chart bisa digeser horizontal, label bulan terbaca.
- [ ] Cetak halaman: garis & band ikut tercetak (`print-color-adjust`).
- [ ] Selector unit & "Semua Unit" masih berfungsi; tanpa data → kartu tidak dirender.
