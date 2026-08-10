import { useState, useEffect } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { sppdApi } from "../lib/sppdApi.js";

const STATUS_LABEL = {
  draft: "Draft",
  diajukan: "Menunggu",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
  dibayar: "Dibayar",
};

export default function SppdList() {
  const navigate = useNavigate();
  const { user } = useOutletContext();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await sppdApi.list(filter || undefined);
      setList(res.data.data);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [filter]);

  const stats = [
    { label: "Draft", jumlah: list.filter((k) => k.status === "draft").length },
    { label: "Menunggu", jumlah: list.filter((k) => k.status === "diajukan").length },
    { label: "Disetujui", jumlah: list.filter((k) => k.status === "disetujui").length },
    { label: "Ditolak", jumlah: list.filter((k) => k.status === "ditolak").length },
  ];

  return (
    <>
      <div className="page-header">
        <h2>SPPD — Surat Perintah Perjalanan Dinas</h2>
        <button className="btn btn-primary" onClick={() => navigate("/sppd/new")}>
          + Buat SPPD
        </button>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        {stats.map((s) => (
          <div key={s.label} className="stat-card accent-indigo">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.jumlah}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="card">
        <div className="card-header">
          <h3>Daftar SPPD</h3>
          <select
            className="form-control"
            style={{ width: "auto" }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">Semua Status</option>
            <option value="draft">Draft</option>
            <option value="diajukan">Menunggu Persetujuan</option>
            <option value="disetujui">Disetujui</option>
            <option value="ditolak">Ditolak</option>
            <option value="dibayar">Dibayar</option>
          </select>
        </div>

        {loading ? (
          <div className="empty-state"><p>Memuat data SPPD...</p></div>
        ) : list.length === 0 ? (
          <div className="empty-state">
            <p>Belum ada SPPD. Klik "Buat SPPD" untuk memulai.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nama Kegiatan</th>
                  <th>Tempat Tujuan</th>
                  <th>Tanggal</th>
                  <th>Peserta</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((k) => (
                  <tr
                    key={k.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/sppd/${k.id}`)}
                  >
                    <td className="font-bold">{k.nama_kegiatan}</td>
                    <td>{k.tempat_tujuan}</td>
                    <td>
                      {new Date(k.tanggal_berangkat).toLocaleDateString("id-ID", {
                        day: "numeric", month: "short",
                      })}{" "}
                      —{" "}
                      {new Date(k.tanggal_pulang).toLocaleDateString("id-ID", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </td>
                    <td>{k.jumlah_peserta} orang</td>
                    <td>
                      <span className={`badge badge-${k.status}`}>
                        {STATUS_LABEL[k.status] || k.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
