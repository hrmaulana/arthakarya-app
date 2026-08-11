import { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import client from "../api/client.js";
import { parseDate } from "../lib/fmtDate.js";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

const STATUS_COLORS = {
  draft: { bg: "var(--surface-hover)", border: "var(--text-muted)" },
  diajukan: { bg: "var(--warning-subtle)", border: "var(--warning)" },
  disetujui: { bg: "var(--success-subtle)", border: "var(--success)" },
  ditolak: { bg: "var(--danger-subtle)", border: "var(--danger)" },
};

const STATUS_BADGE = {
  draft: "badge-draft",
  diajukan: "badge-diajukan",
  disetujui: "badge-disetujui",
  ditolak: "badge-ditolak",
};

const STATUS_LABEL = {
  draft: "Draf",
  diajukan: "Diajukan",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
};

export default function RpdGantt() {
  const [rpd, setRpd] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [tahun, setTahun] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    setLoading(true);
    setAnimated(false);
    Promise.all([
      client.get(`/rekap/rpd-bulanan?tahun=${tahun}`),
      client.get("/rekap/timeline"),
    ])
      .then(([rpdRes, tlRes]) => {
        setRpd(rpdRes.data.data);
        setTahun(rpdRes.data.tahun);
        setTimeline(tlRes.data.data);
        setTimeout(() => setAnimated(true), 80);
      })
      .catch((err) =>
        setError(err.response?.data?.error || "Gagal memuat data.")
      )
      .finally(() => setLoading(false));
  }, [tahun]);

  const { formatRupiah } = useOutletContext();

  const maxRpd = Math.max(...rpd.map((d) => Number(d.total_anggaran)), 1);

  // Group timeline by month
  const byMonth = {};
  timeline.forEach((k) => {
    const m = parseDate(k.tanggal).getMonth(); // 0-11
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(k);
  });

  if (loading)
    return <div className="empty-state"><p>Memuat data RPD & Timeline...</p></div>;
  if (error)
    return <div className="alert alert-error">{error}</div>;

  return (
    <div>
      <div className="page-header">
        <h2>RPD & Timeline Anggaran</h2>
        <div className="btn-group">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setTahun((y) => y - 1)}
          >
            ← {tahun - 1}
          </button>
          <span style={{ fontWeight: 700, fontSize: "0.95rem", padding: "0.3rem 0.5rem" }}>
            {tahun}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setTahun((y) => y + 1)}
          >
            {tahun + 1} →
          </button>
        </div>
      </div>

      {/* === RPD — Rencana Penarikan Dana Bulanan === */}
      <div className="card">
        <div className="card-header">
          <h3>Rencana Penarikan Dana Bulanan ({tahun})</h3>
        </div>
        {rpd.length === 0 ? (
          <p className="text-muted">Belum ada data RPD untuk tahun {tahun}.</p>
        ) : (
        <div className="bar-chart">
          {rpd.map((d, i) => {
            const width = animated
              ? (Number(d.total_anggaran) / maxRpd) * 100
              : 0;
            return (
              <div className="bar-row" key={d.bulan}>
                <div className="bar-label">{d.nama_bulan}</div>
                <div className="bar-track">
                  <div
                    className="bar-fill indigo"
                    style={{ width: `${width}%` }}
                  />
                  {d.jumlah_kegiatan > 0 && (
                    <span
                      style={{
                        position: "absolute",
                        left: `${Math.min(width + 1, 96)}%`,
                        top: "50%",
                        transform: "translateY(-50%)",
                        fontSize: "0.7rem",
                        color: "var(--text-muted)",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        maxWidth: "34%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {d.jumlah_kegiatan} kegiatan
                    </span>
                  )}
                </div>
                <div className="bar-value">
                  {d.total_anggaran > 0 ? formatRupiah(d.total_anggaran) : "—"}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* === Gantt Timeline === */}
      <div className="card">
        <div className="card-header">
          <h3>Gantt Timeline Kegiatan</h3>
          <span className="text-muted">
            {timeline.length} kegiatan
          </span>
        </div>

        {timeline.length === 0 ? (
          <p className="text-muted">Belum ada kegiatan.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            {/* Month header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "220px repeat(12, 1fr)",
                gap: "2px",
                marginBottom: "4px",
              }}
            >
              <div />
              {MONTHS.map((m, i) => {
                const hasData = byMonth[i] && byMonth[i].length > 0;
                return (
                  <div
                    key={m}
                    style={{
                      textAlign: "center",
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      color: hasData ? "var(--primary)" : "var(--text-muted)",
                      padding: "0.3rem 0",
                      background: hasData ? "var(--primary-subtle)" : "transparent",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    {m}
                  </div>
                );
              })}
            </div>

            {/* Activity rows */}
            {timeline.map((k) => {
              const m = parseDate(k.tanggal).getMonth();
              const colors = STATUS_COLORS[k.status] || STATUS_COLORS.draft;
              return (
                <div
                  key={k.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "220px repeat(12, 1fr)",
                    gap: "2px",
                    marginBottom: "2px",
                    alignItems: "center",
                  }}
                >
                  {/* Label */}
                  <div
                    style={{
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      paddingRight: "0.5rem",
                    }}
                    title={`${k.nama_kegiatan} — ${k.unit_kerja_nama} — ${formatRupiah(k.total_anggaran)}`}
                  >
                    {k.nama_kegiatan}
                    <span style={{ display: "block", fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 400 }}>
                      {k.unit_kerja_nama}
                    </span>
                  </div>

                  {/* Month cells */}
                  {MONTHS.map((_, i) => (
                    <div
                      key={i}
                      style={{
                        height: "34px",
                        background:
                          i === m ? colors.bg : "transparent",
                        borderRadius: i === m ? "var(--radius-sm)" : "0",
                        border:
                          i === m
                            ? `1.5px solid ${colors.border}`
                            : "1px solid transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.15s",
                      }}
                      aria-label={
                        i === m
                          ? `${k.nama_kegiatan}, ${MONTHS[i]} ${tahun}, status ${STATUS_LABEL[k.status] || k.status}, ${formatRupiah(k.total_anggaran)}`
                          : undefined
                      }
                      title={
                        i === m
                          ? `${k.nama_kegiatan}\n${formatRupiah(k.total_anggaran)}\nStatus: ${STATUS_LABEL[k.status] || k.status}`
                          : ""
                      }
                    >
                      {i === m && (
                        <span
                          aria-hidden="true"
                          style={{
                            fontSize: "0.65rem",
                            fontWeight: 700,
                            color: colors.border,
                          }}
                        >
                          {formatRupiah(k.total_anggaran)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Legend — badge berlabel (status tidak lagi warna-saja) */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "1rem" }}>
          {Object.entries(STATUS_LABEL).map(([status, label]) => (
            <span key={status} className={`badge ${STATUS_BADGE[status] || "badge-draft"}`}>
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* === Summary Table === */}
      <div className="card">
        <div className="card-header">
          <h3>Ringkasan Kegiatan per Bulan</h3>
        </div>
        <div className="table-wrapper">
          <table className="table-sticky">
            <thead>
              <tr>
                <th scope="col">Bulan</th>
                <th scope="col">Jumlah Kegiatan</th>
                <th scope="col" className="text-right">Total Anggaran</th>
              </tr>
            </thead>
            <tbody>
              {rpd.map((d) => (
                <tr key={d.bulan}>
                  <td>
                    <strong>{d.nama_bulan}</strong>
                  </td>
                  <td>{d.jumlah_kegiatan}</td>
                  <td className="text-right">
                    {d.total_anggaran > 0
                      ? formatRupiah(d.total_anggaran)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>TOTAL {tahun}</strong></td>
                <td>
                  <strong>{rpd.reduce((s, d) => s + d.jumlah_kegiatan, 0)}</strong>
                </td>
                <td className="text-right">
                  <strong>
                    {formatRupiah(rpd.reduce((s, d) => s + Number(d.total_anggaran), 0))}
                  </strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
