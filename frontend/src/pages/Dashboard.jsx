import { useState, useEffect } from "react";
import client from "../api/client.js";

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [perUnit, setPerUnit] = useState([]);
  const [perJenis, setPerJenis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      client.get("/rekap/summary"),
      client.get("/rekap/per-unit-kerja"),
      client.get("/rekap/per-jenis-kegiatan"),
    ])
      .then(([summaryRes, unitRes, jenisRes]) => {
        setSummary(summaryRes.data.data);
        setPerUnit(unitRes.data.data);
        setPerJenis(jenisRes.data.data);
        // Trigger bar animation after render
        setTimeout(() => setAnimated(true), 100);
      })
      .catch((err) => {
        setError(err.response?.data?.error || "Gagal mengambil data rekap.");
      })
      .finally(() => setLoading(false));
  }, []);

  const formatRupiah = (n) =>
    new Intl.NumberFormat("id-ID", {
      style: "currency", currency: "IDR", minimumFractionDigits: 0,
    }).format(Number(n));

  if (loading) return <div className="empty-state"><p>Memuat data rekap...</p></div>;
  if (error) return <div className="alert alert-error">{error}</div>;

  // Calculate bar widths
  const maxUnitTotal = Math.max(...perUnit.map((r) => Number(r.total_anggaran)), 1);
  const maxJenisTotal = Math.max(...perJenis.map((r) => Number(r.total_anggaran)), 1);

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard Rekap Anggaran</h2>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="stats-grid">
          <div className="stat-card accent-indigo">
            <div className="stat-icon">🏛️</div>
            <div className="stat-label">Total Unit Kerja</div>
            <div className="stat-value">{summary.total_unit_kerja}</div>
          </div>
          <div className="stat-card accent-green">
            <div className="stat-icon">📋</div>
            <div className="stat-label">Total Kegiatan</div>
            <div className="stat-value">{summary.total_kegiatan}</div>
          </div>
          <div className="stat-card accent-amber">
            <div className="stat-icon">💰</div>
            <div className="stat-label">Total Anggaran</div>
            <div className="stat-value" style={{ fontSize: "1.3rem" }}>
              {formatRupiah(summary.total_anggaran)}
            </div>
          </div>
        </div>
      )}

      {/* Per Unit Kerja — Bar Chart */}
      <div className="card">
        <div className="card-header">
          <h3>Total Anggaran per Unit Kerja</h3>
        </div>
        {perUnit.length === 0 ? (
          <p className="text-muted">Belum ada data.</p>
        ) : (
          <div className="bar-chart">
            {perUnit.map((row, i) => {
              const width = animated ? (Number(row.total_anggaran) / maxUnitTotal) * 100 : 0;
              return (
                <div className="bar-row" key={row.unit_kerja_id} tabIndex={0} aria-describedby={`bar-tip-${i}`}>
                  <div className="bar-label" title={row.nama_unit}>
                    {row.nama_unit}
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill indigo" style={{ width: `${width}%` }} />
                  </div>
                  <div className="bar-value">{formatRupiah(row.total_anggaran)}</div>
                  <div className="bar-tip" id={`bar-tip-${i}`} role="tooltip">
                    <strong>{formatRupiah(row.total_anggaran)}</strong> Anggaran
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Per Jenis Kegiatan — Bar Chart */}
      <div className="card">
        <div className="card-header">
          <h3>Total Anggaran per Jenis Kegiatan</h3>
        </div>
        {perJenis.length === 0 ? (
          <p className="text-muted">Belum ada data.</p>
        ) : (
          <div className="bar-chart">
            {perJenis.map((row, i) => {
              const width = animated ? (Number(row.total_anggaran) / maxJenisTotal) * 100 : 0;
              return (
                <div className="bar-row" key={row.jenis_kegiatan_id} tabIndex={0} aria-describedby={`bar-tip-${i}`}>
                  <div className="bar-label" title={row.nama_jenis}>
                    {row.nama_jenis}
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill indigo" style={{ width: `${width}%` }} />
                  </div>
                  <div className="bar-value">{formatRupiah(row.total_anggaran)}</div>
                  <div className="bar-tip" id={`bar-tip-${i}`} role="tooltip">
                    <strong>{formatRupiah(row.total_anggaran)}</strong> Anggaran
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
