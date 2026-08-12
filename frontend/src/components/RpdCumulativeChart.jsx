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
        <span><span className="legend-swatch" style={{ background: "color-mix(in srgb, var(--warning) 18%, var(--surface))" }} />Deviasi (selisih antar garis)</span>
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
