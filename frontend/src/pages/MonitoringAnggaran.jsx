import { useState, useEffect, useCallback, useRef } from "react";
import { useOutletContext } from "react-router-dom";
import client from "../api/client.js";

export default function MonitoringAnggaran() {
  const { formatRupiah, user } = useOutletContext();
  const isAdmin = user?.role === "admin";

  const [summary, setSummary] = useState(null);
  const [latest, setLatest] = useState(null);
  const [detail, setDetail] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

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
    try {
      const [summaryRes, latestRes, detailRes] = await Promise.all([
        client.get("/monitoring/summary"),
        client.get("/monitoring/latest"),
        client.get("/monitoring/detail"),
      ]);
      setSummary(summaryRes.data.data);
      setLatest(latestRes.data.data);
      setDetail(detailRes.data.data);
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

  return (
    <div>
      <div className="page-header">
        <h2>Monitoring Anggaran</h2>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      {/* Upload (admin only) */}
      {isAdmin && (
        <div className="card" style={{ border: "1px solid var(--surface-hover)", marginBottom: "1.5rem" }}>
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
          {latest && (
            <p className="text-muted" style={{ marginBottom: "1rem" }}>
              Data: <strong>{latest.filename}</strong>
              {latest.periode && <> · {latest.periode}</>} · {latest.total_rows.toLocaleString("id-ID")} baris · diunggah {latest.uploaded_by} ·{" "}
              {new Date(latest.uploaded_at).toLocaleString("id-ID")}
            </p>
          )}

          {/* Kartu ringkasan */}
          <div className="stats-grid">
            <div className="stat-card accent-indigo">
              <div className="stat-icon">💰</div>
              <div className="stat-label">Total Pagu Revisi</div>
              <div className="stat-value">{formatRupiah(summary.total.pagu)}</div>
            </div>
            <div className="stat-card accent-green">
              <div className="stat-icon">✅</div>
              <div className="stat-label">Realisasi s.d. Periode</div>
              <div className="stat-value">{formatRupiah(summary.total.realisasi)}</div>
            </div>
            <div className="stat-card accent-amber">
              <div className="stat-icon">🏦</div>
              <div className="stat-label">Sisa Anggaran</div>
              <div className="stat-value">{formatRupiah(summary.total.sisa)}</div>
            </div>
            <div className="stat-card accent-indigo">
              <div className="stat-icon">🎯</div>
              <div className="stat-label">Persentase Penyerapan</div>
              <div className="stat-value">{pct(summary.total.persentase)}</div>
            </div>
          </div>

          {/* Per unit kerja */}
          <div className="card" style={{ marginTop: "1.5rem" }}>
            <div className="card-header">
              <h3>Realisasi per Unit Kerja</h3>
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Unit Kerja</th>
                    <th style={{ textAlign: "right" }}>Pagu Revisi</th>
                    <th style={{ textAlign: "right" }}>Realisasi s.d. Periode</th>
                    <th style={{ textAlign: "right" }}>Sisa Anggaran</th>
                    <th style={{ minWidth: 200 }}>Penyerapan</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.per_unit.map((u) => (
                    <tr key={u.unit_kerja_id}>
                      <td><strong>{u.kode_unit}</strong> — {u.nama_unit}</td>
                      <td style={{ textAlign: "right" }}>{formatRupiah(u.pagu)}</td>
                      <td style={{ textAlign: "right" }}>{formatRupiah(u.realisasi)}</td>
                      <td style={{ textAlign: "right" }}>{formatRupiah(u.sisa)}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                          <div className="bar-track" style={{ flex: 1, minWidth: 90 }}>
                            <div
                              className="bar-fill green"
                              style={{ width: `${Math.min(Number(u.persentase) || 0, 100)}%` }}
                            />
                          </div>
                          <span className="text-muted" style={{ width: 55, textAlign: "right", fontSize: "0.8rem" }}>
                            {pct(u.persentase)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per jenis akun */}
          <div className="card" style={{ marginTop: "1.5rem" }}>
            <div className="card-header">
              <h3>Realisasi per Jenis Akun</h3>
            </div>
            <div className="table-wrapper">
              <table>
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
            </div>
            <div className="form-row" style={{ padding: "0 1rem 1rem" }}>
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
              <table>
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
