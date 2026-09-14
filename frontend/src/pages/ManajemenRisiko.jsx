import { useState, useEffect } from "react";
import { useOutletContext, Link } from "react-router-dom";
import client from "../api/client.js";

const LEVEL_CONFIG = {
  tinggi: { label: "Tinggi", icon: "🔴", cls: "level-high" },
  sedang: { label: "Sedang", icon: "🟡", cls: "level-mid" },
  rendah: { label: "Rendah", icon: "🟢", cls: "level-low" },
};

const JENIS_LABEL = {
  serapan_rendah: "Serapan Rendah",
  akun_hampir_habis: "Akun Hampir Habis",
  over_alokasi: "Over-Alokasi",
  data_usang: "Data Usang",
  sppd_overdue: "SPPD Overdue",
  pagu_tidak_teralokasi: "Pagu Tidak Teralokasi",
};

const JENIS_ICON = {
  serapan_rendah: "📉",
  akun_hampir_habis: "🪫",
  over_alokasi: "📊",
  data_usang: "⏰",
  sppd_overdue: "📋",
  pagu_tidak_teralokasi: "💸",
};

export default function ManajemenRisiko() {
  const { formatRupiah, user } = useOutletContext();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [animated, setAnimated] = useState(false);
  const [levelFilter, setLevelFilter] = useState("");
  const [jenisFilter, setJenisFilter] = useState("");
  const [expandedRow, setExpandedRow] = useState(null);
  const [selectedUnit, setSelectedUnit] = useState("");

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (selectedUnit) params.unit_kerja_id = selectedUnit;
      const res = await client.get("/manajemen-risiko/auto-detect", { params });
      setData(res.data);
      setTimeout(() => setAnimated(true), 100);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal mendeteksi risiko.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedUnit]);

  // Filter data
  const filtered = data
    ? data.data.filter((r) => {
        if (levelFilter && r.level !== levelFilter) return false;
        if (jenisFilter && r.jenis !== jenisFilter) return false;
        return true;
      })
    : [];

  // Unique jenis for filter
  const jenisOptions = data
    ? [...new Set(data.data.map((r) => r.jenis))].sort()
    : [];

  // Toggle expand
  const toggleExpand = (id) => {
    setExpandedRow((prev) => (prev === id ? null : id));
  };

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h2>⚠️ Manajemen Risiko</h2>
        </div>
        <div className="empty-state">
          <p>Mendeteksi risiko...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="page-header">
          <h2>⚠️ Manajemen Risiko</h2>
        </div>
        <div className="alert alert-error">{error}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>⚠️ Manajemen Risiko</h2>
        <button
          className="btn btn-secondary btn-sm"
          onClick={fetchData}
          disabled={loading}
        >
          🔄 Deteksi Ulang
        </button>
      </div>

      {/* Summary Cards */}
      {data && (
        <div className="stats-grid">
          <div className="stat-card accent-red">
            <div className="stat-icon">🔴</div>
            <div className="stat-label">Risiko Tinggi</div>
            <div className="stat-value">{data.summary.tinggi}</div>
          </div>
          <div className="stat-card accent-amber">
            <div className="stat-icon">🟡</div>
            <div className="stat-label">Risiko Sedang</div>
            <div className="stat-value">{data.summary.sedang}</div>
          </div>
          <div className="stat-card accent-green">
            <div className="stat-icon">🟢</div>
            <div className="stat-label">Risiko Rendah</div>
            <div className="stat-value">{data.summary.rendah}</div>
          </div>
          <div className="stat-card accent-indigo">
            <div className="stat-icon">📊</div>
            <div className="stat-label">Total Risiko</div>
            <div className="stat-value">{data.summary.total}</div>
          </div>
        </div>
      )}

      {/* Analisis Keseluruhan */}
      {data?.analisis_keseluruhan && (
        <div className="card mb-2">
          <div className="card-header" style={{ fontSize: "0.85rem", fontWeight: 700 }}>
            🔍 Analisis Keseluruhan
          </div>
          <div className="card-body" style={{ padding: "0.85rem 1rem" }}>
            <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {data.analisis_keseluruhan}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card mb-2">
        <div className="card-body" style={{ padding: "0.75rem 1rem" }}>
          <div className="grid-3">
            <div className="form-group">
              <label className="form-label" style={{ fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                Filter Level
              </label>
              <select
                className="form-control"
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
              >
                <option value="">Semua Level</option>
                <option value="tinggi">Tinggi</option>
                <option value="sedang">Sedang</option>
                <option value="rendah">Rendah</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                Filter Jenis
              </label>
              <select
                className="form-control"
                value={jenisFilter}
                onChange={(e) => setJenisFilter(e.target.value)}
              >
                <option value="">Semua Jenis</option>
                {jenisOptions.map((j) => (
                  <option key={j} value={j}>
                    {JENIS_ICON[j] || "📌"} {JENIS_LABEL[j] || j}
                  </option>
                ))}
              </select>
            </div>
            {user?.role === "admin" && (
              <div className="form-group">
                <label className="form-label" style={{ fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                  Filter Unit
                </label>
                <input
                  className="form-control"
                  type="number"
                  placeholder="ID Unit Kerja"
                  value={selectedUnit}
                  onChange={(e) => setSelectedUnit(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Risk Table */}
      {filtered.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ padding: "2rem", textAlign: "center" }}>
            <p style={{ color: "var(--text-muted)" }}>
              {data?.data.length > 0
                ? "Tidak ada risiko yang sesuai filter."
                : "Tidak ada risiko terdeteksi. ✅"}
            </p>
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table table-sticky">
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                <th style={{ width: 100 }}>Level</th>
                <th style={{ width: 180 }}>Jenis Risiko</th>
                <th>Deskripsi</th>
                <th style={{ width: 200 }}>Akun</th>
                <th style={{ width: 200 }}>Unit Kerja</th>
                <th style={{ width: 90 }}>AI</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((risk) => {
                const lvl = LEVEL_CONFIG[risk.level] || LEVEL_CONFIG.rendah;
                const isExpanded = expandedRow === risk.id;
                return (
                  <tr
                    key={risk.id}
                    className={isExpanded ? "row-expanded" : ""}
                    style={{ cursor: "pointer" }}
                    onClick={() => toggleExpand(risk.id)}
                  >
                    <td style={{ textAlign: "center" }}>
                      {isExpanded ? "▼" : "▶"}
                    </td>
                    <td>
                      <span className={`badge ${lvl.cls}`}>
                        {lvl.icon} {lvl.label}
                      </span>
                    </td>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        {JENIS_ICON[risk.jenis] || "📌"}
                        <span>{JENIS_LABEL[risk.jenis] || risk.jenis}</span>
                      </span>
                    </td>
                    <td style={{ maxWidth: 300 }}>
                      <div style={{ fontSize: "0.85rem", lineHeight: 1.5 }}>
                        <strong>Deskripsi:</strong> {risk.deskripsi}
                      </div>
                      <div
                        style={{
                          fontSize: "0.82rem",
                          lineHeight: 1.4,
                          color: "var(--text-secondary)",
                          marginTop: "0.3rem",
                        }}
                      >
                        <strong>Rekomendasi:</strong> {risk.rekomendasi}
                      </div>
                    </td>
                    <td>
                      {risk.akun ? (
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "0.82rem" }}>
                            {risk.akun.kode}
                          </div>
                          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                            {risk.akun.nama}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td>
                      <span style={{ fontSize: "0.85rem" }}>
                        [{risk.unit_kerja.kode}] {risk.unit_kerja.nama}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {risk.ai_enhanced ? (
                        <span className="badge badge-info" title="Ditingkatkan dengan AI">🤖 AI</span>
                      ) : (
                        <span className="badge badge-draft" title="AI tidak tersedia">⚙️ Template</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Expanded Row Detail */}
      {expandedRow && (() => {
        const risk = data?.data.find((r) => r.id === expandedRow);
        if (!risk) return null;
        return (
          <div className="card" style={{ marginTop: "1rem", borderLeft: "4px solid var(--info)" }}>
            <div className="card-header">
              <h3 style={{ fontSize: "0.95rem" }}>
                📋 Detail Risiko: {JENIS_LABEL[risk.jenis] || risk.jenis}
              </h3>
            </div>
            <div className="card-body" style={{ padding: "1rem" }}>
              <div className="grid-2">
                <div>
                  <h4 style={{ fontSize: "0.85rem", marginBottom: "0.4rem", color: "var(--text-secondary)" }}>
                    Deskripsi Lengkap
                  </h4>
                  <p style={{ lineHeight: 1.6, margin: 0 }}>{risk.deskripsi}</p>
                </div>
                <div>
                  <h4 style={{ fontSize: "0.85rem", marginBottom: "0.4rem", color: "var(--text-secondary)" }}>
                    Rekomendasi Tindakan
                  </h4>
                  <p style={{ lineHeight: 1.6, margin: 0 }}>{risk.rekomendasi}</p>
                </div>
              </div>

              {risk.analisis && (
                <div style={{ marginTop: "1rem" }}>
                  <h4 style={{ fontSize: "0.85rem", marginBottom: "0.4rem", color: "var(--text-secondary)" }}>
                    🔬 Analisis Root Cause
                  </h4>
                  <p style={{ lineHeight: 1.6, margin: 0, color: "var(--text-secondary)" }}>
                    {risk.analisis}
                  </p>
                </div>
              )}

              <div style={{ marginTop: "1rem", display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                {risk.nilai && Object.entries(risk.nilai).map(([key, val]) => {
                  const labelMap = {
                    pagu: "Pagu",
                    realisasi: "Realisasi",
                    sisa_pagu: "Sisa Pagu",
                    persentase: "Persentase",
                    total_rencana: "Total Rencana",
                    kelebihan: "Kelebihan",
                    hari_terakhir: "Hari Terakhir",
                    hari_terlambat: "Hari Terlambat",
                    nama_kegiatan: "Nama Kegiatan",
                    sppd_id: "SPPD ID",
                    tanggal_selesai: "Tgl. Selesai",
                    tanggal_terakhir: "Tgl. Terakhir",
                    bulan_sekarang: "Bulan",
                    kode_akun: "Kode Akun",
                  };
                  const label = labelMap[key] || key;
                  let displayVal = val;
                  if (["pagu", "realisasi", "sisa_pagu", "total_rencana", "kelebihan"].includes(key) && typeof val === "number") {
                    displayVal = formatRupiah(val);
                  } else if (key === "persentase" && typeof val === "number") {
                    displayVal = `${val}%`;
                  }
                  return (
                    <div key={key} style={{ minWidth: 140 }}>
                      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
                        {label}
                      </div>
                      <div style={{ fontWeight: 600, fontSize: "0.9rem", marginTop: "0.15rem" }}>
                        {displayVal}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Tombol aksi untuk pagu_tidak_teralokasi */}
              {risk.jenis === "pagu_tidak_teralokasi" && risk.akun && (
                <div style={{ marginTop: "1rem" }}>
                  <Link
                    to={`/pengadaan/new?kode_akun=${encodeURIComponent(risk.akun.kode)}&unit=${risk.unit_kerja.id}&estimasi=${risk.nilai?.pagu || 0}`}
                    className="btn btn-primary btn-sm"
                  >
                    📦 Buat Rencana Pengadaan
                  </Link>
                  <small style={{ marginLeft: "0.5rem", color: "var(--text-muted)" }}>
                    Auto-fill dari sisa pagu ({formatRupiah(risk.nilai?.pagu || 0)})
                  </small>
                </div>
              )}

              <div style={{ marginTop: "1rem", fontSize: "0.78rem", color: "var(--text-muted)" }}>
                ID: {risk.id} | Terdeteksi: {risk.detected_at ? new Date(risk.detected_at).toLocaleString("id-ID") : "-"}
                {risk.ai_enhanced ? " | Ditingkatkan dengan AI" : " | Menggunakan template"}
              </div>
            </div>
          </div>
        );
      })()}

      <style>{`
        .row-expanded {
          background: var(--surface-hover) !important;
        }
        .row-expanded td {
          border-bottom: 1px solid var(--border);
        }
      `}</style>
    </div>
  );
}