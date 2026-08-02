import { useState, useEffect, useCallback } from "react";
import { Link, useOutletContext } from "react-router-dom";
import client from "../api/client.js";

const STATUS_BADGE = {
  draft: "badge-draft",
  diajukan: "badge-diajukan",
  disetujui: "badge-disetujui",
  ditolak: "badge-ditolak",
};

export default function KegiatanList() {
  const { formatRupiah, user } = useOutletContext();
  const [kegiatan, setKegiatan] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const res = await client.get("/kegiatan", { params });
      setKegiatan(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal mengambil data.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

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

  return (
    <div>
      <div className="page-header">
        <h2>Daftar Kegiatan</h2>
        <Link to="/kegiatan/new" className="btn btn-primary">
          + Tambah Kegiatan
        </Link>
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
        <div className="form-row">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Filter Status</label>
            <select
              className="form-control"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Semua Status</option>
              <option value="draft">Draft</option>
              <option value="diajukan">Diajukan</option>
              <option value="disetujui">Disetujui</option>
              <option value="ditolak">Ditolak</option>
            </select>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div className="empty-state"><p>Memuat data...</p></div>
        ) : kegiatan.length === 0 ? (
          <div className="empty-state">
            <p>🔍 Belum ada kegiatan.</p>
            <Link to="/kegiatan/new" className="btn btn-primary mt-2">
              Buat Kegiatan Pertama
            </Link>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nama Kegiatan</th>
                  <th>Unit Kerja</th>
                  <th>Jenis</th>
                  <th>Tanggal</th>
                  <th>Total Anggaran</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {kegiatan.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <strong>{k.nama_kegiatan}</strong>
                    </td>
                    <td>{k.unit_kerja_nama}</td>
                    <td>{k.jenis_kegiatan_nama}</td>
                    <td>{new Date(k.tanggal).toLocaleDateString("id-ID")}</td>
                    <td className="text-right">
                      {formatRupiah(Number(k.total_anggaran))}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[k.status] || ""}`}>
                        {k.status}
                      </span>
                    </td>
                    <td>
                      <div className="btn-group">
                        {/* Edit — disabled for disetujui */}
                        {k.status === "disetujui" ? (
                          <span
                            className="btn btn-secondary btn-sm"
                            style={{ opacity: 0.4, cursor: "not-allowed" }}
                            title="Kegiatan disetujui tidak dapat diedit"
                          >
                            🔒
                          </span>
                        ) : (
                          <Link
                            to={`/kegiatan/${k.id}/edit`}
                            className="btn btn-secondary btn-sm"
                            title="Edit"
                          >
                            ✏️
                          </Link>
                        )}

                        {/* Status actions */}
                        {k.status === "draft" && (
                          <button
                            className="btn btn-success btn-sm"
                            onClick={() => handleStatusChange(k.id, "diajukan")}
                            title="Ajukan"
                          >
                            📤
                          </button>
                        )}
                        {k.status === "ditolak" && (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleStatusChange(k.id, "draft")}
                            title="Kembali ke Draft untuk revisi"
                          >
                            🔄
                          </button>
                        )}
                        {k.status === "diajukan" && user?.role === "admin" && (
                          <>
                            <button
                              className="btn btn-success btn-sm"
                              onClick={() => handleStatusChange(k.id, "disetujui")}
                              title="Setujui"
                            >
                              ✅
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleStatusChange(k.id, "ditolak")}
                              title="Tolak"
                            >
                              ❌
                            </button>
                          </>
                        )}

                        {/* Delete: admin all, operator hanya draft */}
                        {(user?.role === "admin" || (user?.role === "operator" && k.status === "draft")) && (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDelete(k.id)}
                            title="Hapus"
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
