import { useState, useEffect, useCallback, useRef } from "react";
import { useOutletContext } from "react-router-dom";
import client from "../api/client.js";

// Level penyerapan: < 40% rendah (perhatian), 40–70% sedang, > 70% baik
const levelOf = (p) => {
  const n = Number(p) || 0;
  if (n < 40) return "low";
  if (n < 70) return "mid";
  return "high";
};

const barColors = ["indigo", "green", "amber"];

// Donut chart SVG murni (tanpa library) — animasi via stroke-dashoffset
function Donut({ pct, animated }) {
  const C = 2 * Math.PI * 45; // r = 45
  const offset = C * (1 - (animated ? Number(pct) || 0 : 0) / 100);
  const level = levelOf(pct);
  const colorVar =
    level === "low" ? "var(--danger)" : level === "mid" ? "var(--warning)" : "var(--success)";
  return (
    <div className="donut-wrap">
      <svg width="150" height="150" viewBox="0 0 120 120">
        <circle className="donut-ring" cx="60" cy="60" r="45" />
        <circle
          className="donut-fill"
          cx="60"
          cy="60"
          r="45"
          strokeDasharray={C}
          strokeDashoffset={offset}
          style={{ stroke: colorVar }}
        />
      </svg>
      <div className="donut-center">
        <strong>{Number(pct).toLocaleString("id-ID")}%</strong>
        <span>Penyerapan</span>
      </div>
    </div>
  );
}

export default function MonitoringAnggaran() {
  const { formatRupiah, user } = useOutletContext();
  const isAdmin = user?.role === "admin";

  const [summary, setSummary] = useState(null);
  const [latest, setLatest] = useState(null);
  const [detail, setDetail] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [animated, setAnimated] = useState(false);

  // Upload
  const [file, setFile] = useState(null);
  const [periode, setPeriode] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Filter detail
  const [filterUnit, setFilterUnit] = useState("");
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    setAnimated(false);
    try {
      const [summaryRes, latestRes, detailRes] = await Promise.all([
        client.get("/monitoring/summary"),
        client.get("/monitoring/latest"),
        client.get("/monitoring/detail"),
      ]);
      setSummary(summaryRes.data.data);
      setLatest(latestRes.data.data);
      setDetail(detailRes.data.data);
      setTimeout(() => setAnimated(true), 100);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal memuat data monitoring.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) {
      setError("Pilih file Excel (.xlsx) terlebih dahulu.");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    if (periode.trim()) formData.append("periode", periode.trim());

    setUploading(true);
    setError("");
    setSuccessMsg("");
    try {
      const res = await client.post("/monitoring/import", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const d = res.data.data;
      setSuccessMsg(
        `${res.data.message} Total pagu ${formatRupiah(d.pagu)}, realisasi ${formatRupiah(d.realisasi)}.`
      );
      setFile(null);
      setPeriode("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || "Gagal mengimpor file.");
    } finally {
      setUploading(false);
    }
  };

  const pct = (p) =>
    p === null || p === undefined ? "-" : `${Number(p).toLocaleString("id-ID")}%`;

  const q = search.trim().toLowerCase();
  const filteredDetail = detail.filter((r) => {
    if (filterUnit && String(r.unit_kerja_id) !== filterUnit) return false;
    if (!q) return true;
    return (
      (r.nama_kegiatan || "").toLowerCase().includes(q) ||
      (r.nama_akun || "").toLowerCase().includes(q) ||
      (r.kode_akun || "").toLowerCase().includes(q)
    );
  });

  const hasData = !!latest;
  const totalPct = Number(summary?.total?.persentase) || 0;
  const totalLevel = levelOf(totalPct);

  // Top 8 akun berdasar pagu untuk bar chart
  const topAkun = (summary?.per_akun || []).slice(0, 8);
  const maxPagu = Math.max(...topAkun.map((a) => Number(a.pagu) || 0), 1);

  return (
    <div>
      <div className="page-header">
        <h2>Monitoring Anggaran</h2>
        {hasData && (
          <button className="btn btn-secondary no-print" onClick={() => window.print()}>
            🖨 Cetak Laporan
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      {/* Upload (admin only) */}
      {isAdmin && (
        <div className="card no-print" style={{ border: "1px solid var(--surface-hover)", marginBottom: "1.5rem" }}>
          <div className="card-header">
            <h3>Upload Data Anggaran &amp; Realisasi (Excel)</h3>
          </div>
          <form onSubmit={handleUpload}>
            <div className="form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label>File Excel (.xlsx)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="form-control"
                  accept=".xlsx"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Periode (opsional)</label>
                <input
                  type="text"
                  className="form-control"
                  value={periode}
                  onChange={(e) => setPeriode(e.target.value)}
                  placeholder="mis. Periode 20 Juli 2026"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <button type="submit" className="btn btn-primary" disabled={uploading}>
                  {uploading ? "Mengimpor..." : "⏫ Import"}
                </button>
              </div>
            </div>
            <p className="text-muted" style={{ marginTop: "0.6rem", marginBottom: 0, fontSize: "0.8rem" }}>
              Satu upload = satu periode. Upload baru menggantikan data tampilan, riwayat upload lama tetap tersimpan.
            </p>
          </form>
        </div>
      )}

      {loading ? (
        <div className="empty-state"><p>Memuat data...</p></div>
      ) : !hasData ? (
        <div className="empty-state">
          <p>Belum ada data monitoring.{isAdmin ? " Upload file Excel di atas untuk memulai." : ""}</p>
        </div>
      ) : (
        <>
          {/* Header resmi — hanya muncul saat dicetak */}
          <div className="print-only">
            <div className="print-header">
              <h1>DASHBOARD MONITORING REALISASI ANGGARAN (PENYERAPAN)</h1>
              <h2>Lingkup Kedeputian Bidang Pemantauan, Evaluasi, dan Pengendalian Pembangunan</h2>
              <p>
                Data: {latest.filename}
                {latest.periode ? ` · ${latest.periode}` : ""} · Dicetak{" "}
                {new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            </div>
          </div>

          {latest && (
            <p className="text-muted no-print" style={{ marginBottom: "1rem" }}>
              Data: <strong>{latest.filename}</strong>
              {latest.periode && <> · {latest.periode}</>} · {latest.total_rows.toLocaleString("id-ID")} baris · diunggah {latest.uploaded_by} ·{" "}
              {new Date(latest.uploaded_at).toLocaleString("id-ID")}
            </p>
          )}

          {/* Hero: kartu ringkasan + donut */}
          <div className="mon-hero">
            <div className="stats-grid" style={{ height: "100%" }}>
              <div className="stat-card accent-indigo">
                <div className="stat-icon">💰</div>
                <div className="stat-label">Total Pagu Revisi</div>
                <div className="stat-value" style={{ fontSize: "1.3rem" }}>{formatRupiah(summary.total.pagu)}</div>
              </div>
              <div className="stat-card accent-green">
                <div className="stat-icon">✅</div>
                <div className="stat-label">Realisasi s.d. Periode</div>
                <div className="stat-value" style={{ fontSize: "1.3rem" }}>{formatRupiah(summary.total.realisasi)}</div>
              </div>
              <div className="stat-card accent-amber">
                <div className="stat-icon">🏦</div>
                <div className="stat-label">Sisa Anggaran</div>
                <div className="stat-value" style={{ fontSize: "1.3rem" }}>{formatRupiah(summary.total.sisa)}</div>
              </div>
              <div className={`stat-card ${totalLevel === "low" ? "accent-red" : "accent-indigo"}`}>
                <div className="stat-icon">🎯</div>
                <div className="stat-label">Persentase Penyerapan</div>
                <div className={`stat-value ${totalLevel === "low" ? "level-low" : ""}`}>{pct(summary.total.persentase)}</div>
              </div>
            </div>

            <div className="card donut-card">
              <div className="card-header" style={{ width: "100%" }}>
                <h3>Total Penyerapan</h3>
              </div>
              <Donut pct={totalPct} animated={animated} />
              <div className="donut-legend">
                <div className="legend-item">
                  <span className="swatch" style={{ background: "var(--primary)" }} />
                  <strong>{formatRupiah(summary.total.pagu)}</strong> Pagu
                </div>
                <div className="legend-item">
                  <span className="swatch" style={{ background: "var(--success)" }} />
                  <strong>{formatRupiah(summary.total.realisasi)}</strong> Realisasi
                </div>
                <div className="legend-item">
                  <span className="swatch" style={{ background: "var(--warning)" }} />
                  <strong>{formatRupiah(summary.total.sisa)}</strong> Sisa
                </div>
              </div>
            </div>
          </div>

          {/* Per unit kerja */}
          <div className="card" style={{ marginTop: "1.5rem" }}>
            <div className="card-header">
              <h3>Realisasi per Unit Kerja</h3>
            </div>
            <div className="grid-3">
              {summary.per_unit.map((u) => {
                const level = levelOf(u.persentase);
                return (
                  <div key={u.unit_kerja_id} className={`unit-card level-${level}`}>
                    <span className="unit-kode">{u.kode_unit}</span>
                    <div className="unit-name">{u.nama_unit}</div>
                    <div className={`unit-pct level-${level}`}>{pct(u.persentase)}</div>
                    <div className="unit-progress">
                      <div
                        className={`bar-fill level-${level}-bg`}
                        style={{ width: `${animated ? Math.min(Number(u.persentase) || 0, 100) : 0}%` }}
                      />
                    </div>
                    <div className="unit-stats">
                      <div className="unit-stat">
                        <span className="label">Pagu Revisi</span>
                        <span className="value">{formatRupiah(u.pagu)}</span>
                      </div>
                      <div className="unit-stat">
                        <span className="label">Realisasi s.d. Periode</span>
                        <span className="value">{formatRupiah(u.realisasi)}</span>
                      </div>
                      <div className="unit-stat">
                        <span className="label">Sisa Anggaran</span>
                        <span className="value">{formatRupiah(u.sisa)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Per jenis akun */}
          <div className="card" style={{ marginTop: "1.5rem" }}>
            <div className="card-header">
              <h3>Pagu per Jenis Akun — Top 8</h3>
            </div>
            <div className="bar-chart" style={{ marginBottom: "1.25rem" }}>
              {topAkun.map((a, i) => (
                <div className="bar-row" key={a.nama_akun}>
                  <div className="bar-label" title={a.nama_akun}>{a.nama_akun}</div>
                  <div className="bar-track">
                    <div
                      className={`bar-fill ${barColors[i % barColors.length]}`}
                      style={{ width: `${animated ? (Number(a.pagu) / maxPagu) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="mon-bar-value">{formatRupiah(a.pagu)}</div>
                </div>
              ))}
            </div>
            <div className="card-header">
              <h3>Realisasi per Jenis Akun</h3>
            </div>
            <div className="table-wrapper">
              <table className="table-sticky">
                <thead>
                  <tr>
                    <th>Nama Akun</th>
                    <th style={{ textAlign: "right" }}>Pagu</th>
                    <th style={{ textAlign: "right" }}>Realisasi s.d. Periode</th>
                    <th style={{ textAlign: "right" }}>Sisa</th>
                    <th style={{ textAlign: "right" }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.per_akun.map((a) => (
                    <tr key={a.nama_akun}>
                      <td>{a.nama_akun}</td>
                      <td style={{ textAlign: "right" }}>{formatRupiah(a.pagu)}</td>
                      <td style={{ textAlign: "right" }}>{formatRupiah(a.realisasi)}</td>
                      <td style={{ textAlign: "right" }}>{formatRupiah(a.sisa)}</td>
                      <td style={{ textAlign: "right" }}>{pct(a.persentase)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detail */}
          <div className="card" style={{ marginTop: "1.5rem" }}>
            <div className="card-header">
              <h3>Detail (Drill-Down)</h3>
              <span className="text-muted no-print">{filteredDetail.length.toLocaleString("id-ID")} baris</span>
            </div>
            <div className="form-row no-print" style={{ padding: "0 1rem 1rem" }}>
              {isAdmin && (
                <div className="form-group" style={{ marginBottom: 0, minWidth: 220 }}>
                  <select
                    className="form-control"
                    value={filterUnit}
                    onChange={(e) => setFilterUnit(e.target.value)}
                  >
                    <option value="">Semua Unit Kerja</option>
                    {summary.per_unit.map((u) => (
                      <option key={u.unit_kerja_id} value={u.unit_kerja_id}>
                        {u.kode_unit} — {u.nama_unit}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                <input
                  type="text"
                  className="form-control"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari kegiatan / akun / kode akun…"
                />
              </div>
            </div>
            <div className="table-wrapper">
              <table className="table-sticky">
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Kegiatan</th>
                    <th>Akun</th>
                    <th style={{ textAlign: "right" }}>Pagu Revisi</th>
                    <th style={{ textAlign: "right" }}>Realisasi s.d. Periode</th>
                    <th style={{ textAlign: "right" }}>Sisa</th>
                    <th style={{ textAlign: "right" }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDetail.map((r) => (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{r.kode_unit}</td>
                      <td>
                        <strong>{r.kode_kegiatan}</strong> {r.nama_kegiatan}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <strong>{r.kode_akun}</strong> {r.nama_akun}
                      </td>
                      <td style={{ textAlign: "right" }}>{formatRupiah(r.pagu_revisi)}</td>
                      <td style={{ textAlign: "right" }}>{formatRupiah(r.realisasi_sd_periode)}</td>
                      <td style={{ textAlign: "right" }}>{formatRupiah(r.sisa)}</td>
                      <td style={{ textAlign: "right" }}>{pct(r.persentase)}</td>
                    </tr>
                  ))}
                  {filteredDetail.length === 0 && (
                    <tr>
                      <td colSpan={7} className="empty-state" style={{ padding: "1.5rem" }}>
                        Tidak ada baris yang cocok.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
