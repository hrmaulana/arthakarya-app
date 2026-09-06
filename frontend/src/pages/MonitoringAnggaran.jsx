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

// Donut chart SVG murni (tanpa library) — animasi via stroke-dashoffset
function Donut({ pct, animated }) {
  const C = 2 * Math.PI * 45; // r = 45
  const offset = C * (1 - (animated ? Number(pct) || 0 : 0) / 100);
  const level = levelOf(pct);
  const colorVar =
    level === "low" ? "var(--danger)" : level === "mid" ? "var(--warning)" : "var(--success)";
  return (
    <div className={`donut-wrap level-${level}`}>
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
  const [dataManual, setDataManual] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [animated, setAnimated] = useState(false);

  // Manual input state
  const [editingSpp, setEditingSpp] = useState(false);
  const [editingKegiatan, setEditingKegiatan] = useState(false);
  const [sppInput, setSppInput] = useState("");
  const [kegiatanInput, setKegiatanInput] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  // Upload
  const [file, setFile] = useState(null);
  const [periode, setPeriode] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Refs for inline edit
  const sppRef = useRef(null);
  const kegiatanRef = useRef(null);

  // Filter detail
  const [filterUnit, setFilterUnit] = useState("");
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summaryRes, latestRes, detailRes, manualRes] = await Promise.all([
        client.get("/monitoring/summary"),
        client.get("/monitoring/latest"),
        client.get("/monitoring/detail"),
        client.get("/monitoring/data-manual"),
      ]);
      setSummary(summaryRes.data.data);
      setLatest(latestRes.data.data);
      setDetail(detailRes.data.data);
      setDataManual(manualRes.data.data);
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

  // ── Manual Data Handlers ──

  const startEditSpp = () => {
    setSppInput(dataManual?.spp_persen != null ? String(dataManual.spp_persen) : "");
    setEditingSpp(true);
    setTimeout(() => sppRef.current?.focus(), 50);
  };

  const startEditKegiatan = () => {
    setKegiatanInput(dataManual?.kegiatan_belum_berkaskan != null ? String(dataManual.kegiatan_belum_berkaskan) : "");
    setEditingKegiatan(true);
    setTimeout(() => kegiatanRef.current?.focus(), 50);
  };

  const cancelEditSpp = () => setEditingSpp(false);
  const cancelEditKegiatan = () => setEditingKegiatan(false);

  const saveManual = async (field) => {
    const sppVal = field === "spp" ? Number(sppInput) : Number(dataManual?.spp_persen || 0);
    const kegiatanVal = field === "kegiatan" ? Number(kegiatanInput) : Number(dataManual?.kegiatan_belum_berkaskan || 0);

    if (isNaN(sppVal) || sppVal < 0 || sppVal > 100) {
      setError("Persentase SPP harus angka 0–100.");
      return;
    }
    if (isNaN(kegiatanVal) || kegiatanVal < 0 || !Number.isInteger(kegiatanVal)) {
      setError("Jumlah kegiatan harus bilangan bulat >= 0.");
      return;
    }

    setSavingManual(true);
    setError("");
    setSuccessMsg("");
    try {
      const res = await client.put("/monitoring/data-manual", {
        spp_persen: sppVal,
        kegiatan_belum_berkaskan: kegiatanVal,
      });
      setDataManual(res.data.data);
      setSuccessMsg(res.data.message);
      setEditingSpp(false);
      setEditingKegiatan(false);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal menyimpan data manual.");
    } finally {
      setSavingManual(false);
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

  const sppPersen = dataManual?.spp_persen ?? null;
  const kegiatanBelum = dataManual?.kegiatan_belum_berkaskan ?? null;

  return (
    <div>
      <div className="page-header">
        <h2>Monitoring Anggaran</h2>
        {hasData && (
          <button type="button" className="btn btn-secondary no-print" onClick={() => window.print()}>
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

      {loading && !hasData ? (
        <div className="empty-state"><p>Memuat data...</p></div>
      ) : !hasData ? (
        <div className="empty-state">
          <p>Belum ada data monitoring.{isAdmin ? " Upload file Excel di atas untuk memulai." : ""}</p>
        </div>
      ) : (
        <div className={loading ? "mon-is-loading" : undefined} aria-busy={loading || undefined}>
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
              {/* Card 1: Total Pagu Revisi */}
              <div className="stat-card accent-indigo">
                <div className="stat-icon">💰</div>
                <div className="stat-label">Total Pagu Revisi</div>
                <div className="stat-value" style={{ fontSize: "1.3rem" }}>{formatRupiah(summary.total.pagu)}</div>
              </div>
              {/* Card 2: Realisasi s.d. Periode */}
              <div className="stat-card accent-green">
                <div className="stat-icon">✅</div>
                <div className="stat-label">Realisasi s.d. Periode</div>
                <div className="stat-value" style={{ fontSize: "1.3rem" }}>{formatRupiah(summary.total.realisasi)}</div>
              </div>
              {/* Card 3: Sisa Anggaran */}
              <div className="stat-card accent-amber">
                <div className="stat-icon">🏦</div>
                <div className="stat-label">Sisa Anggaran</div>
                <div className="stat-value" style={{ fontSize: "1.3rem" }}>{formatRupiah(summary.total.sisa)}</div>
              </div>
              {/* Card 4: Persentase SPP — manual input */}
              <div className="stat-card accent-purple manual-card">
                <div className="stat-icon">📋</div>
                <div className="stat-label">Persentase SPP</div>
                {editingSpp ? (
                  <div className="manual-edit-wrap">
                    <input
                      ref={sppRef}
                      type="number"
                      className="form-control manual-input"
                      value={sppInput}
                      onChange={(e) => setSppInput(e.target.value)}
                      min="0"
                      max="100"
                      step="0.01"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveManual("spp");
                        if (e.key === "Escape") cancelEditSpp();
                      }}
                    />
                    <button className="btn btn-sm btn-primary" onClick={() => saveManual("spp")} disabled={savingManual}>
                      ✓
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={cancelEditSpp}>
                      ✗
                    </button>
                  </div>
                ) : (
                  <div className="manual-value-wrap">
                    <span className="stat-value">{sppPersen !== null ? `${Number(sppPersen).toLocaleString("id-ID")}%` : "-"}</span>
                    {isAdmin && (
                      <button className="btn-edit-inline" onClick={startEditSpp} title="Edit">✏️</button>
                    )}
                  </div>
                )}
              </div>
              {/* Card 5: Kegiatan Belum Diberkaskan — manual input */}
              <div className="stat-card accent-orange manual-card">
                <div className="stat-icon">📂</div>
                <div className="stat-label">Kegiatan Belum Diberkaskan</div>
                {editingKegiatan ? (
                  <div className="manual-edit-wrap">
                    <input
                      ref={kegiatanRef}
                      type="number"
                      className="form-control manual-input"
                      value={kegiatanInput}
                      onChange={(e) => setKegiatanInput(e.target.value)}
                      min="0"
                      step="1"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveManual("kegiatan");
                        if (e.key === "Escape") cancelEditKegiatan();
                      }}
                    />
                    <button className="btn btn-sm btn-primary" onClick={() => saveManual("kegiatan")} disabled={savingManual}>
                      ✓
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={cancelEditKegiatan}>
                      ✗
                    </button>
                  </div>
                ) : (
                  <div className="manual-value-wrap">
                    <span className="stat-value">{kegiatanBelum !== null ? Number(kegiatanBelum).toLocaleString("id-ID") : "-"}</span>
                    {isAdmin && (
                      <button className="btn-edit-inline" onClick={startEditKegiatan} title="Edit">✏️</button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="card donut-card">
              <div className="card-header" style={{ width: "100%" }}>
                <h3>Total Penyerapan</h3>
              </div>
              <Donut pct={totalPct} animated={animated} />
              <div className="donut-legend">
                <div className="legend-item">
                  <span>Pagu</span>
                  <strong>{formatRupiah(summary.total.pagu)}</strong>
                </div>
                <div className="legend-item">
                  <span>Realisasi</span>
                  <strong>{formatRupiah(summary.total.realisasi)}</strong>
                </div>
                <div className="legend-item">
                  <span>Sisa</span>
                  <strong>{formatRupiah(summary.total.sisa)}</strong>
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
              {topAkun.map((a, i) => {
                const pagu = formatRupiah(a.pagu);
                const realisasi = formatRupiah(a.realisasi);
                return (
                <div className="bar-row" key={a.nama_akun} tabIndex={0} aria-describedby={`bar-tip-${i}`}>
                  <div className="bar-label" title={a.nama_akun}>{a.nama_akun}</div>
                  <div className="bar-track">
                    <div
                      className="bar-fill indigo"
                      style={{ width: `${animated ? (Number(a.pagu) / maxPagu) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="mon-bar-value">{pagu}</div>
                  <div className="bar-tip" id={`bar-tip-${i}`} role="tooltip">
                    <strong>{pagu}</strong> Pagu
                    <span>Realisasi {realisasi}</span>
                    <span>Penyerapan {pct(a.persentase)}</span>
                  </div>
                </div>
                );
              })}
            </div>
            <div className="card-header">
              <h3>Realisasi per Jenis Akun</h3>
            </div>
            <div className="table-wrapper">
              <table className="table-sticky">
                <thead>
                  <tr>
                    <th scope="col">Nama Akun</th>
                    <th scope="col" style={{ textAlign: "right" }}>Pagu</th>
                    <th scope="col" style={{ textAlign: "right" }}>Realisasi s.d. Periode</th>
                    <th scope="col" style={{ textAlign: "right" }}>Sisa</th>
                    <th scope="col" style={{ textAlign: "right" }}>%</th>
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
                    <th scope="col">Unit</th>
                    <th scope="col">Kegiatan</th>
                    <th scope="col">Akun</th>
                    <th scope="col" style={{ textAlign: "right" }}>Pagu Revisi</th>
                    <th scope="col" style={{ textAlign: "right" }}>Realisasi s.d. Periode</th>
                    <th scope="col" style={{ textAlign: "right" }}>Sisa</th>
                    <th scope="col" style={{ textAlign: "right" }}>%</th>
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
        </div>
      )}
    </div>
  );
}
