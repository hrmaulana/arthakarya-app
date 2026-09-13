import { useState, useEffect, useCallback } from "react";
import { Link, useOutletContext } from "react-router-dom";
import client from "../api/client.js";
import { fmtDate } from "../lib/fmtDate.js";

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

const SORT_OPTIONS = [
  { value: "tanggal:desc", label: "Tanggal terbaru" },
  { value: "tanggal:asc", label: "Tanggal terlama" },
  { value: "akun:asc", label: "Kode Akun A→Z" },
  { value: "akun:desc", label: "Kode Akun Z→A" },
  { value: "anggaran:desc", label: "Anggaran terbesar" },
  { value: "anggaran:asc", label: "Anggaran terkecil" },
];

export default function KegiatanList() {
  const { formatRupiah, user } = useOutletContext();
  const [kegiatan, setKegiatan] = useState([]);
  const [akunOptions, setAkunOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [akunFilter, setAkunFilter] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [unitOptions, setUnitOptions] = useState([]);
  const [sortKey, setSortKey] = useState("tanggal:desc");
  const [compareData, setCompareData] = useState(null);
  const [compareLoading, setCompareLoading] = useState(true);

  // Fetch perbandingan pagu vs rencana
  useEffect(() => {
    setCompareLoading(true);
    client
      .get("/rekap/rencana-vs-pagu")
      .then((res) => {
        setCompareData(res.data.data);
      })
      .catch(() => {
        setCompareData(null);
      })
      .finally(() => setCompareLoading(false));
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (akunFilter) params.kode_akun = akunFilter;
      if (unitFilter) params.unit_kerja_id = unitFilter;
      const [sortBy, order] = sortKey.split(":");
      params.sort = sortBy;
      params.order = order;
      const res = await client.get("/kegiatan", { params });
      setKegiatan(res.data.data);
      setAkunOptions(res.data.meta?.akun_options || []);
      setUnitOptions(res.data.meta?.unit_options || []);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal mengambil data.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, akunFilter, unitFilter, sortKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = async (id) => {
    if (!confirm("Hapus kegiatan ini? Tindakan ini tidak dapat dibatalkan.")) return;
    try {
      await client.delete(`/kegiatan/${id}`);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || "Gagal menghapus.");
    }
  };

  const handleStatusChange = async (id, newStatus) => {
    try {
      await client.patch(`/kegiatan/${id}/status`, { status: newStatus });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || "Gagal mengubah status.");
    }
  };

  // Mini dashboard
  const totalAnggaran = kegiatan.reduce(
    (sum, k) => sum + Number(k.total_anggaran || 0),
    0
  );
  const akunTeralokasi = new Set(
    kegiatan.flatMap((k) => k.akun_list || [])
  );

  return (
    <div>
      <div className="page-header">
        <h2>Daftar Kegiatan</h2>
        <Link to="/kegiatan/new" className="btn btn-primary">
          + Tambah Kegiatan
        </Link>
      </div>

      {/* Mini dashboard */}
      {!loading && (
        <div className="stats-grid">
          <div className="stat-card accent-indigo">
            <div className="stat-icon">📋</div>
            <div className="stat-label">Total Kegiatan</div>
            <div className="stat-value">{kegiatan.length}</div>
          </div>
          <div className="stat-card accent-green">
            <div className="stat-icon">💰</div>
            <div className="stat-label">Total Anggaran</div>
            <div className="stat-value" style={{ fontSize: "1.3rem" }}>
              {formatRupiah(totalAnggaran)}
            </div>
          </div>
          <div className="stat-card accent-amber">
            <div className="stat-icon">🏷️</div>
            <div className="stat-label">Akun Teralokasi</div>
            <div className="stat-value">{akunTeralokasi.size}</div>
          </div>
        </div>
      )}

      {/* Summary card: Perbandingan Pagu vs Rencana */}
      {!compareLoading && compareData && compareData.total && (
        <div className="card mb-2">
          <div className="card-header" style={{ fontSize: "0.85rem", fontWeight: 700 }}>
            📊 Perbandingan Anggaran
          </div>
          <div className="card-body" style={{ padding: "0.85rem 1rem" }}>
            <div className="bar-chart">
              {/* Pagu */}
              <div className="bar-row">
                <span className="bar-label" style={{ width: 100, textAlign: "left" }}>Pagu</span>
                <div className="bar-track" style={{ flex: 1 }}>
                  <div className="bar-fill indigo" style={{ width: "100%", minWidth: "4px" }} />
                </div>
                <span className="bar-value" style={{ width: "auto", minWidth: 120, textAlign: "right" }}>
                  {formatRupiah(compareData.total.pagu)}
                </span>
              </div>
              {/* Realisasi */}
              <div className="bar-row">
                <span className="bar-label" style={{ width: 100, textAlign: "left" }}>Realisasi</span>
                <div className="bar-track" style={{ flex: 1 }}>
                  <div
                    className="bar-fill"
                    style={{
                      width: `${Math.min(compareData.total.persentase_realisasi, 100)}%`,
                      minWidth: compareData.total.persentase_realisasi > 0 ? "4px" : 0,
                      background: `var(--success)`,
                    }}
                  />
                </div>
                <span className="bar-value" style={{ width: "auto", minWidth: 120, textAlign: "right" }}>
                  {formatRupiah(compareData.total.realisasi)}{" "}
                  <span className={compareData.total.persentase_realisasi > 50 ? "level-high" : compareData.total.persentase_realisasi > 10 ? "level-mid" : "level-low"}>
                    ({compareData.total.persentase_realisasi}%)
                  </span>
                </span>
              </div>
              {/* Rencana Kegiatan */}
              <div className="bar-row">
                <span className="bar-label" style={{ width: 100, textAlign: "left" }}>Rencana</span>
                <div className="bar-track" style={{ flex: 1 }}>
                  <div
                    className="bar-fill"
                    style={{
                      width: `${Math.min(compareData.total.persentase_rencana, 100)}%`,
                      minWidth: compareData.total.persentase_rencana > 0 ? "4px" : 0,
                      background: `var(--warning)`,
                    }}
                  />
                </div>
                <span className="bar-value" style={{ width: "auto", minWidth: 120, textAlign: "right" }}>
                  {formatRupiah(compareData.total.rencana)}{" "}
                  <span className={compareData.total.persentase_rencana > 50 ? "level-high" : compareData.total.persentase_rencana > 10 ? "level-mid" : "level-low"}>
                    ({compareData.total.persentase_rencana}%)
                  </span>
                </span>
              </div>
              {/* Sisa */}
              <div className="bar-row">
                <span className="bar-label" style={{ width: 100, textAlign: "left" }}>Sisa</span>
                <div className="bar-track" style={{ flex: 1 }}>
                  <div
                    className="bar-fill"
                    style={{
                      width: `${Math.min(Math.max(0, ((compareData.total.sisa || 0) / compareData.total.pagu) * 100), 100)}%`,
                      minWidth: compareData.total.sisa > 0 ? "4px" : 0,
                      background: `var(--info)`,
                    }}
                  />
                </div>
                <span className="bar-value" style={{ width: "auto", minWidth: 120, textAlign: "right" }}>
                  {compareData.total.sisa >= 0 ? (
                    formatRupiah(compareData.total.sisa)
                  ) : (
                    <span className="level-low">-{formatRupiah(Math.abs(compareData.total.sisa))}</span>
                  )}{" "}
                  <span className={compareData.total.sisa > 0 ? "level-high" : compareData.total.sisa === 0 ? "level-mid" : "level-low"}>
                    ({compareData.total.pagu > 0 ? Math.round((Math.max(0, compareData.total.sisa || 0) / compareData.total.pagu) * 10000) / 100 : 0}%)
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="form-row">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-status">Filter Status</label>
            <select
              id="filter-status"
              className="form-control"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Semua Status</option>
              <option value="draft">Draf</option>
              <option value="diajukan">Diajukan</option>
              <option value="disetujui">Disetujui</option>
              <option value="ditolak">Ditolak</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-akun">Filter Akun</label>
            <select
              id="filter-akun"
              className="form-control"
              value={akunFilter}
              onChange={(e) => setAkunFilter(e.target.value)}
            >
              <option value="">Semua Akun</option>
              {akunOptions.map((a) => (
                <option key={a.kode_akun} value={a.kode_akun}>
                  {a.kode_akun}
                  {a.nama_akun ? ` — ${a.nama_akun}` : ""} ({a.jml_kegiatan})
                </option>
              ))}
            </select>
          </div>
          {user?.role === "admin" && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="filter-unit">Filter Unit Kerja</label>
              <select
                id="filter-unit"
                className="form-control"
                value={unitFilter}
                onChange={(e) => setUnitFilter(e.target.value)}
              >
                <option value="">Semua Unit</option>
                {unitOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nama_unit} ({u.jml_kegiatan})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="sort-key">Urutkan</label>
            <select
              id="sort-key"
              className="form-control"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {/* Table */}
      <div className="card card-flush">
        {loading ? (
          <div className="empty-state"><p>Memuat data...</p></div>
        ) : kegiatan.length === 0 ? (
          <div className="empty-state">
            <p>
              {statusFilter || akunFilter || unitFilter
                ? "Tidak ada kegiatan dengan filter yang dipilih."
                : "🔍 Belum ada kegiatan."}
            </p>
            {!statusFilter && !akunFilter && !unitFilter && (
              <Link to="/kegiatan/new" className="btn btn-primary mt-2">
                Buat Kegiatan Pertama
              </Link>
            )}
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table-sticky">
              <thead>
                <tr>
                  <th scope="col">Nama Kegiatan</th>
                  <th scope="col">Unit Kerja</th>
                  <th scope="col">Akun</th>
                  <th scope="col">Tanggal</th>
                  <th scope="col">Total Anggaran</th>
                  <th scope="col">Status</th>
                  <th scope="col">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {kegiatan.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <strong>{k.nama_kegiatan}</strong>
                    </td>
                    <td>{k.unit_kerja_nama}</td>
                    <td>
                      {(k.akun_list || []).length > 0 ? (
                        <div className="akun-cell">
                          {k.akun_list.slice(0, 3).map((ak) => (
                            <span key={ak} className="badge badge-info">{ak}</span>
                          ))}
                          {k.akun_list.length > 3 && (
                            <span className="badge badge-draft">+{k.akun_list.length - 3}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>{fmtDate(k.tanggal)}</td>
                    <td className="text-right">
                      {formatRupiah(Number(k.total_anggaran))}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[k.status] || "badge-draft"}`}>
                        {STATUS_LABEL[k.status] || k.status}
                      </span>
                    </td>
                    <td>
                      <div className="btn-group">
                        {/* Edit — disabled for disetujui */}
                        {k.status === "disetujui" ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled
                            title="Kegiatan disetujui tidak dapat diedit"
                            aria-label="Kegiatan disetujui, tidak dapat diedit"
                          >
                            🔒
                          </button>
                        ) : (
                          <Link
                            to={`/kegiatan/${k.id}/edit`}
                            className="btn btn-secondary btn-sm"
                            title="Edit"
                            aria-label="Edit kegiatan"
                          >
                            ✏️
                          </Link>
                        )}

                        {/* Status actions */}
                        {k.status === "draft" && (
                          <button
                            type="button"
                            className="btn btn-success btn-sm"
                            onClick={() => handleStatusChange(k.id, "diajukan")}
                            title="Ajukan"
                            aria-label="Ajukan kegiatan"
                          >
                            📤
                          </button>
                        )}
                        {k.status === "ditolak" && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleStatusChange(k.id, "draft")}
                            title="Kembali ke Draft untuk revisi"
                            aria-label="Kembali ke draft"
                          >
                            🔄
                          </button>
                        )}
                        {k.status === "diajukan" && user?.role === "admin" && (
                          <>
                            <button
                              type="button"
                              className="btn btn-success btn-sm"
                              onClick={() => handleStatusChange(k.id, "disetujui")}
                              title="Setujui"
                              aria-label="Setujui kegiatan"
                            >
                              ✅
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => handleStatusChange(k.id, "ditolak")}
                              title="Tolak"
                              aria-label="Tolak pengajuan"
                            >
                              ❌
                            </button>
                          </>
                        )}

                        {/* Delete: admin all, operator hanya draft */}
                        {(user?.role === "admin" || (user?.role === "operator" && k.status === "draft")) && (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDelete(k.id)}
                            title="Hapus"
                            aria-label="Hapus kegiatan"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
