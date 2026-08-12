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
function Plot({ height, children, label }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <svg className="line-chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
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
      <Plot height={CH_H} label="Grafik kumulatif target vs kegiatan per bulan">
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
      <Plot height={DEV_H} label="Grafik deviasi target dikurangi kegiatan per bulan">
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
