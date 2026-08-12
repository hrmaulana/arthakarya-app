# Line Chart Kumulatif RPD Target vs Kegiatan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan kartu "Grafik Kumulatif Target vs Kegiatan" di halaman `/monitoring/rpd-timeline` — line chart SVG (Target kum. vs Kegiatan kum., dengan area deviasi di antaranya) plus chart deviasi terpisah (selisih per bulan dengan baseline nol), dengan selector unit ("Semua Unit" + tiap unit).

**Architecture:** Komponen presentasional murni `RpdCumulativeChart.jsx` merender dua `<svg>` inline (pola donut monitoring: SVG murni, warna via `var()`). Data diambil dari state `rpdTarget` yang sudah ada di `RpdGantt.jsx` (dari `GET /api/rekap/rpd-target` yang menyediakan `target_kum`, `kegiatan_kum`, `selisih` per bulan per unit). Tidak ada perubahan backend.

**Tech Stack:** React 18 (JSX) · Vite · CSS di `frontend/src/index.css` (satu-satunya sumber desain). Tanpa library chart — SVG inline.

## Global Constraints

- **Working directory:** Semua perintah shell berjalan dari `backend/` di dalam worktree `C:\Users\PMP\OneDrive\Desktop\ArthaKarya\.claude\worktrees\kegiatan-kode-akun`. Perintah frontend diawali `cd ../frontend &&`. DILARANG `cd` ke main checkout.
- **Design system:** Semua warna lewat `var()` (mis. `var(--primary)`, `var(--success)`, `var(--warning)`, `var(--danger)`, `var(--text-muted)`, `var(--text-secondary)`, `var(--surface-hover)`) — jangan hardcode hex. Var harus punya varian dark (sudah ada).
- **Tidak ada dependency baru** dan **tidak ada library chart/UI** — SVG inline murni.
- **Class CSS baru hanya jika class existing tidak memenuhi** — line chart tidak tercakup class existing (bar/donut), jadi class baru sah.
- **Tanpa perubahan backend/API** — data `target_kum`, `kegiatan_kum`, `selisih` sudah dikirim endpoint.
- **Cetak:** kartu chart ikut tercetak (`print-color-adjust: exact`), seperti tabel perbandingan existing.
- **Responsif ≤768px:** wrapper chart `overflow-x: auto` + `min-width` pada SVG.
- **Git:** JANGAN stage `frontend/bun.lock` atau `frontend/vite.config.worktree.js` (untracked, milik sesi ini). Branch kerja: `rpd-cumulative-chart`. Semua commit diberi trailer `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Testing frontend:** repo ini TIDAK punya test runner frontend (package.json hanya `dev`/`build`/`preview`). Verifikasi = `bun run build` (lolos) + checklist manual di browser. Jangan menambahkan test framework baru (scope creep).

---

### Task 1: Komponen chart + class CSS

**Files:**
- Create: `frontend/src/components/RpdCumulativeChart.jsx`
- Modify: `frontend/src/index.css` (sisipkan blok setelah aturan `.bar-*`, anchor: baris `'.bar-row:hover .bar-fill.indigo,'`)

**Interfaces:**
- Produces: `RpdCumulativeChart` (default export), props `{ unit, formatRupiah }`:
  - `unit`: `{ unit_kerja_id: number|string, nama_unit: string, months: [{ bulan, target_kum, kegiatan_kum, selisih }] }` — sudah urut bulan naik.
  - `formatRupiah`: `(n:number) => string` — dari `useOutletContext` (halaman).
  - Komponen murni (tidak fetch, tidak pakai state).

- [ ] **Step 1: Tulis file komponen**

Buat `frontend/src/components/RpdCumulativeChart.jsx` dengan isi persis di bawah ini:

```jsx
// Line chart kumulatif Target vs Kegiatan + chart deviasi — SVG murni (tanpa library).
// Komponen presentasional: menerima data, tidak fetch. Warna semua via var() (dark mode siap).
//
// Props:
//   unit: { unit_kerja_id, nama_unit, months: [{ bulan, target_kum, kegiatan_kum, selisih }] }
//   formatRupiah: (n) => string  — formatter rupiah penuh dari useOutletContext
import React from "react";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

const W = 720;             // viewBox width
const CH_H = 240;          // tinggi chart kumulatif
const DEV_H = 170;         // tinggi chart deviasi
const M = { top: 14, right: 16, bottom: 30, left: 62 }; // margin

// Format rupiah kompak untuk label sumbu: "1,6 M" (miliar), "400 jt" (juta),
// sisanya angka bulat. Nilai penuh selalu ada di tooltip (title).
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

// Plot = wrapper scroll-x + <svg> yang menyesuaikan lebar.
function Plot({ height, children }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <svg className="line-chart" viewBox={`0 0 ${W} ${height}`} role="img">
        {children}
      </svg>
    </div>
  );
}

// Garis grid horizontal + label sumbu Y untuk domain [0, maxVal].
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
  const data = unit.months;
  const n = data.length;
  const plotW = W - M.left - M.right;
  const plotH = CH_H - M.top - M.bottom;

  const maxVal = niceCeil(
    Math.max(...data.map((d) => Math.max(d.target_kum, d.kegiatan_kum)), 1)
  );
  const xAt = (i) => (n > 1 ? M.left + (i / (n - 1)) * plotW : M.left + plotW / 2);
  const yAt = (v) => M.top + plotH * (1 - v / maxVal);

  const toPts = (getV) =>
    data.map((d, i) => ({ x: xAt(i), y: yAt(getV(d)), v: getV(d), bulan: d.bulan }));
  const targetPts = toPts((d) => d.target_kum);
  const kegiatanPts = toPts((d) => d.kegiatan_kum);

  const points = (pts) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  // Area bayangan deviasi: titik target maju + titik kegiatan mundur, lalu tutup.
  const areaD =
    `M ${targetPts[0].x.toFixed(1)} ${targetPts[0].y.toFixed(1)} ` +
    targetPts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") +
    ` L ${kegiatanPts[kegiatanPts.length - 1].x.toFixed(1)} ${kegiatanPts[kegiatanPts.length - 1].y.toFixed(1)} ` +
    kegiatanPts.slice(0, -1).reverse().map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") +
    " Z";

  const Dots = ({ pts, color }) =>
    pts.map((p) => (
      <circle key={p.bulan} cx={p.x} cy={p.y} r={3.5} style={{ fill: color }}>
        <title>{`${MONTHS[p.bulan - 1]}: ${formatRupiah(p.v)}`}</title>
      </circle>
    ));

  // === Chart deviasi ===
  const devMax = niceCeil(Math.max(...data.map((d) => Math.abs(d.selisih)), 1));
  const devH = DEV_H - M.top - M.bottom;
  const devY = (v) => M.top + devH / 2 - (v / devMax) * (devH / 2);
  const devColor = (v) => (v < 0 ? "var(--danger)" : "var(--warning)");

  return (
    <div>
      {/* Chart 1 — kumulatif */}
      <Plot height={CH_H}>
        <YGrid maxVal={maxVal} height={CH_H} fmt={formatCompactRupiah} />
        <path d={areaD} className="deviation-area" />
        <polyline points={points(targetPts)} fill="none" style={{ stroke: "var(--primary)" }} strokeWidth="2.5" strokeLinejoin="round" />
        <polyline points={points(kegiatanPts)} fill="none" style={{ stroke: "var(--success)" }} strokeWidth="2.5" strokeLinejoin="round" />
        <Dots pts={targetPts} color="var(--primary)" />
        <Dots pts={kegiatanPts} color="var(--success)" />
        <XLabels data={data} height={CH_H} />
      </Plot>
      <div className="chart-legend">
        <span><span className="legend-swatch" style={{ background: "var(--primary)" }} />Target kumulatif</span>
        <span><span className="legend-swatch" style={{ background: "var(--success)" }} />Kegiatan kumulatif</span>
        <span><span className="legend-swatch" style={{ background: "color-mix(in srgb, var(--warning) 30%, var(--surface))" }} />Deviasi (selisih antar garis)</span>
      </div>

      {/* Chart 2 — deviasi */}
      <h4 style={{ margin: "1.2rem 0 0.4rem" }}>Deviasi Target − Kegiatan</h4>
      <Plot height={DEV_H}>
        <line x1={M.left} y1={devY(0)} x2={W - M.right} y2={devY(0)} className="zero-line" />
        <text x={M.left - 8} y={devY(0) + 4} textAnchor="end" className="axis-text">0</text>
        {[devMax, devMax / 2].map((val) => (
          <g key={val}>
            <line x1={M.left} y1={devY(val)} x2={W - M.right} y2={devY(val)} className="grid-line" />
            <line x1={M.left} y1={devY(-val)} x2={W - M.right} y2={devY(-val)} className="grid-line" />
            <text x={M.left - 8} y={devY(val) + 4} textAnchor="end" className="axis-text">{formatCompactRupiah(val)}</text>
            <text x={M.left - 8} y={devY(-val) + 4} textAnchor="end" className="axis-text">{formatCompactRupiah(-val)}</text>
          </g>
        ))}
        {data.slice(1).map((d, i) => (
          <line
            key={d.bulan}
            x1={xAt(i)} y1={devY(data[i].selisih)}
            x2={xAt(i + 1)} y2={devY(d.selisih)}
            style={{ stroke: devColor(d.selisih) }}
            strokeWidth="2.5"
          />
        ))}
        {data.map((d, i) => (
          <circle key={d.bulan} cx={xAt(i)} cy={devY(d.selisih)} r={3.5} style={{ fill: devColor(d.selisih) }}>
            <title>{`${MONTHS[d.bulan - 1]}: selisih ${formatRupiah(d.selisih)}`}</title>
          </circle>
        ))}
        <XLabels data={data} height={DEV_H} />
      </Plot>
    </div>
  );
}
```

- [ ] **Step 2: Sisipkan class CSS**

Di `frontend/src/index.css`, sisipkan blok berikut tepat setelah aturan `.bar-*` (anchor: baris `'.bar-row:hover .bar-fill.indigo,'` beserta pasangan bloknya):

```css
/* Line chart kumulatif Target vs Kegiatan (SVG) */
.line-chart { width: 100%; min-width: 560px; display: block; }
.line-chart .grid-line { stroke: var(--surface-hover); stroke-width: 1; }
.line-chart .zero-line { stroke: var(--text-muted); stroke-width: 1.5; stroke-dasharray: 4 4; }
.line-chart .axis-text { font-size: 11px; fill: var(--text-muted); }
.line-chart .deviation-area { fill: color-mix(in srgb, var(--warning) 18%, var(--surface)); }
.chart-legend { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.7rem; font-size: 0.78rem; color: var(--text-secondary); }
.chart-legend .legend-swatch { display: inline-block; width: 18px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 0.35rem; }
@media print { .line-chart, .chart-legend { print-color-adjust: exact; } }
```

- [ ] **Step 3: Verifikasi build**

Jalankan dari `backend/`:
```
cd ../frontend && bun run build
```
Expected: `✓ built in ...` tanpa error.

- [ ] **Step 4: Commit**

```
git add ../frontend/src/components/RpdCumulativeChart.jsx ../frontend/src/index.css
git commit -m "feat(chart): komponen line chart kumulatif target vs kegiatan (SVG)"
```

Trailer `Co-Authored-By: Claude <noreply@anthropic.com>` wajib (via `-m` tambahan atau `git commit` lalu amend jika perlu).

---

### Task 2: Integrasi di halaman RpdGantt

**Files:**
- Modify: `frontend/src/pages/RpdGantt.jsx` (3 edit: import, state, komputasi + render kartu)

**Interfaces:**
- Consumes: `RpdCumulativeChart` dari `../components/RpdCumulativeChart.jsx` (default export), props `{ unit, formatRupiah }`.
- Menggunakan state `rpdTarget` (`{ months: number[], units: [...] }`) dan `formatRupiah` dari `useOutletContext` yang SUDAH ada di halaman.

- [ ] **Step 1: Import komponen**

Di `frontend/src/pages/RpdGantt.jsx`, setelah baris import `parseDate` (`import { parseDate } from "../lib/fmtDate.js";`), tambahkan:

```jsx
import RpdCumulativeChart from "../components/RpdCumulativeChart.jsx";
```

- [ ] **Step 2: State selector unit**

Di blok state, setelah baris `const fileInputRef = useRef(null);`, tambahkan:

```jsx
const [chartUnitId, setChartUnitId] = useState("total");
```

- [ ] **Step 3: Hitung seri total + unit terpilih**

Setelah komputasi `byMonth` (blok `timeline.forEach((k) => { ... })`), tambahkan:

```jsx
// Seri total "Semua Unit": jumlahkan target_kum / kegiatan_kum / selisih per bulan.
const chartTotal = rpdTarget.months.map((bulan) => {
  let target_kum = 0;
  let kegiatan_kum = 0;
  let selisih = 0;
  for (const u of rpdTarget.units) {
    const d = u.months.find((x) => x.bulan === bulan);
    target_kum += d ? d.target_kum : 0;
    kegiatan_kum += d ? d.kegiatan_kum : 0;
    selisih += d ? d.selisih : 0;
  }
  return { bulan, target_kum, kegiatan_kum, selisih };
});
const chartUnit =
  chartUnitId === "total"
    ? { unit_kerja_id: "total", nama_unit: "Semua Unit", months: chartTotal }
    : rpdTarget.units.find((u) => u.unit_kerja_id === chartUnitId) || null;
```

- [ ] **Step 4: Render kartu baru**

Sisipkan kartu berikut TEPAT SEBELUM kartu `{/* Perbandingan Kumulatif Target vs Kegiatan */}` (blok yang dimulai `{rpdTarget.units.length > 0 && (` di baris 331):

```jsx
{rpdTarget.units.length > 0 && (
  <div className="card">
    <div className="card-header">
      <h3>Grafik Kumulatif Target vs Kegiatan ({tahun})</h3>
    </div>
    <div className="page-content" style={{ padding: "0 1.25rem 1.25rem" }}>
      <div className="btn-group" style={{ flexWrap: "wrap", rowGap: "0.35rem", marginBottom: "0.9rem" }}>
        <button
          type="button"
          className={`btn btn-sm ${chartUnitId === "total" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setChartUnitId("total")}
        >
          Semua Unit
        </button>
        {rpdTarget.units.map((u) => (
          <button
            key={u.unit_kerja_id}
            type="button"
            className={`btn btn-sm ${chartUnitId === u.unit_kerja_id ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setChartUnitId(u.unit_kerja_id)}
          >
            {u.nama_unit}
          </button>
        ))}
      </div>
      {chartUnit ? (
        <RpdCumulativeChart unit={chartUnit} formatRupiah={formatRupiah} />
      ) : (
        <p className="text-muted">Pilih unit kerja untuk melihat grafik.</p>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 5: Verifikasi build**

Jalankan dari `backend/`:
```
cd ../frontend && bun run build
```
Expected: `✓ built in ...` tanpa error.

- [ ] **Step 6: Checklist manual di browser**

Backend dev (port 3002, `bun --watch`) dan Vite (port 5173) sudah jalan dari sesi ini. Buka `http://localhost:5173/monitoring/rpd-timeline`, login `admin` (password sementara). Periksa SEMUA:

- [ ] Kartu "Grafik Kumulatif Target vs Kegiatan" muncul di atas tabel "Perbandingan Kumulatif Target vs Kegiatan".
- [ ] Default "Semua Unit": dua garis (indigo = target, hijau = kegiatan) + area bayangan di antaranya + chart deviasi di bawah dengan baseline nol. Label bulan Jan–Des di sumbu X.
- [ ] Klik tiap unit → chart berubah mengikuti data unit tsb; tombol unit yang aktif tampil `btn-primary`.
- [ ] Hover titik → tooltip menampilkan rupiah penuh.
- [ ] Toggle dark mode → garis/grid/label terwarnai ulang benar via `var()` (verifikasi di kedua mode).
- [ ] Lebar jendela ≤768px → chart bergulir horizontal (bukan mengecil menimpa), label bulan terbaca.
- [ ] Cetak (Ctrl+P) → chart ikut tercetak dengan warna.

- [ ] **Step 7: Commit**

```
git add ../frontend/src/pages/RpdGantt.jsx
git commit -m "feat(rpd): integrasi line chart kumulatif target vs kegiatan di halaman RPD"
```

Trailer `Co-Authored-By: Claude <noreply@anthropic.com>` wajib.

---
