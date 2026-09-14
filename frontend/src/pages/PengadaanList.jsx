import { useState, useEffect } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import client from "../api/client.js";

const STATUS_LABEL = {
  rencana: "Rencana",
  proses_lelang: "Proses Lelang",
  kontrak: "Kontrak",
  selesai: "Selesai",
};

const JENIS_LABEL = {
  barang: "Barang",
  jasa: "Jasa",
};

export default function PengadaanList() {
  const navigate = useNavigate();
  const { formatRupiah, user } = useOutletContext();
  const [list, setList] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterUnit, setFilterUnit] = useState("");
  const [unitOptions, setUnitOptions] = useState([]);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      if (filterUnit && user?.role === "admin") params.unit_kerja_id = filterUnit;
      const res = await client.get("/pengadaan", { params });
      setList(res.data.data || []);
      setMeta(res.data.meta || null);
    } catch {
      setList([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [filterStatus, filterUnit]);

  // Load unit options for admin filter
  useEffect(() => {
    if (user?.role !== "admin") return;
    client.get("/reference/unit-kerja").then((res) => {
      setUnitOptions(res.data.data || []);
    }).catch(() => {});
  }, [user]);

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm("Hapus pengadaan ini?")) return;
    try {
      await client.delete(`/pengadaan/${id}`);
      fetchList();
    } catch (err) {
      alert(err.response?.data?.error || "Gagal menghapus.");
    }
  };

  const handleStatusChange = async (id, statusBaru, e) => {
    e.stopPropagation();
    try {
      await client.patch(`/pengadaan/${id}/status`, { status: statusBaru });
      fetchList();
    } catch (err) {
      alert(err.response?.data?.error || "Gagal mengubah status.");
    }
  };

  const statCards = meta
    ? [
        { label: "Total", jumlah: meta.total, accent: "accent-indigo" },
        { label: "Rencana", jumlah: meta.per_status?.rencana || 0, accent: "accent-amber" },
        { label: "Proses Lelang", jumlah: meta.per_status?.proses_lelang || 0, accent: "accent-purple" },
        { label: "Kontrak", jumlah: meta.per_status?.kontrak || 0, accent: "accent-green" },
        { label: "Selesai", jumlah: meta.per_status?.selesai || 0, accent: "accent-orange" },
      ]
    : [];

  // Next status for each status
  const nextStatus = {
    rencana: "proses_lelang",
    proses_lelang: "kontrak",
    kontrak: "selesai",
  };

  return (
    <>
      <div className="page-header">
        <h2>📦 Rencana Pengadaan</h2>
        <button className="btn btn-primary" onClick={() => navigate("/pengadaan/new")}>
          + Tambah Pengadaan
        </button>
      </div>

      {/* Stat Cards */}
      {statCards.length > 0 && (
        <div className="stats-grid">
          {statCards.map((s) => (
            <div key={s.label} className={`stat-card ${s.accent}`}>
              <div className="stat-label">{s.label}</div>
              <div className="stat-value">{s.jumlah}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="card-header">
          <h3>Daftar Pengadaan</h3>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <select
              className="form-control"
              style={{ width: "auto", minWidth: 140 }}
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">Semua Status</option>
              <option value="rencana">Rencana</option>
              <option value="proses_lelang">Proses Lelang</option>
              <option value="kontrak">Kontrak</option>
              <option value="selesai">Selesai</option>
            </select>
            {user?.role === "admin" && (
              <select
                className="form-control"
                style={{ width: "auto", minWidth: 200 }}
                value={filterUnit}
                onChange={(e) => setFilterUnit(e.target.value)}
              >
                <option value="">Semua Unit</option>
                {unitOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    [{u.kode_unit}] {u.nama_unit}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {loading ? (
          <div className="empty-state"><p>Memuat data pengadaan...</p></div>
        ) : list.length === 0 ? (
          <div className="empty-state">
            <p>Belum ada rencana pengadaan.</p>
            <p className="text-muted mt-2">
              Buat rencana pengadaan baru untuk barang/jasa yang akan dilelang.
            </p>
            <button className="btn btn-primary mt-2" onClick={() => navigate("/pengadaan/new")}>
              + Buat Pengadaan
            </button>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nama Pengadaan</th>
                  <th>Kegiatan</th>
                  <th>Kode Akun</th>
                  <th>Estimasi</th>
                  <th>Sisa Pagu</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {list.map((item) => {
                  const isSelesai = item.status === "selesai";
                  const next = nextStatus[item.status];
                  return (
                    <tr key={item.id}>
                      <td className="font-bold">{item.nama_pengadaan}</td>
                      <td>{item.nama_kegiatan || <span className="text-muted">-</span>}</td>
                      <td className="font-mono">{item.kode_akun || <span className="text-muted">-</span>}</td>
                      <td className="font-mono">{formatRupiah(item.estimasi_biaya)}</td>
                      <td className="font-mono">
                        {item.sisa_pagu !== null && item.sisa_pagu !== undefined
                          ? formatRupiah(item.sisa_pagu)
                          : <span className="text-muted">-</span>}
                      </td>
                      <td>
                        <span className={`badge badge-${
                          item.status === "rencana" ? "draft" :
                          item.status === "proses_lelang" ? "diajukan" :
                          item.status === "kontrak" ? "disetujui" :
                          item.status === "selesai" ? "ditolak" :
                          "draft"
                        }`}>
                          {STATUS_LABEL[item.status] || item.status}
                        </span>
                      </td>
                      <td>
                        <div className="btn-group" style={{ gap: "0.25rem" }}>
                          {!isSelesai && (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => navigate(`/pengadaan/${item.id}/edit`)}
                            >
                              Edit
                            </button>
                          )}
                          {!isSelesai && (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={(e) => handleDelete(item.id, e)}
                            >
                              Hapus
                            </button>
                          )}
                          {next && (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={(e) => handleStatusChange(item.id, next, e)}
                            >
                              {next === "proses_lelang" ? "→ Lelang" :
                               next === "kontrak" ? "→ Kontrak" :
                               next === "selesai" ? "→ Selesai" : ""}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}