import { useState, useEffect } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { sppdApi } from "../lib/sppdApi.js";
import { fmtDate, fmtDateShort } from "../lib/fmtDate.js";

const STATUS_LABEL = {
  draft: "Draft",
  diajukan: "Menunggu",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
  dilaksanakan: "Dilaksanakan",
  pertanggungjawaban: "Pertanggungjawaban",
  dibayar: "Dibayar",
};

export default function SppdList() {
  const navigate = useNavigate();
  const { user } = useOutletContext();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [alerts, setAlerts] = useState(null);

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

  const fetchAlerts = async () => {
    try {
      const res = await sppdApi.alerts();
      setAlerts(res.data.data);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchList(); }, [filter]);
  useEffect(() => { fetchAlerts(); }, []);

  const stats = [
    { label: "Draft", jumlah: list.filter((k) => k.status === "draft").length },
    { label: "Menunggu", jumlah: list.filter((k) => k.status === "diajukan").length },
    { label: "Disetujui", jumlah: list.filter((k) => k.status === "disetujui").length },
    { label: "Dilaksanakan", jumlah: list.filter((k) => k.status === "dilaksanakan").length },
    { label: "Pertanggungjawaban", jumlah: list.filter((k) => k.status === "pertanggungjawaban").length },
    { label: "Dibayar", jumlah: list.filter((k) => k.status === "dibayar").length },
  ];

  const alertCards = [];
  if (alerts) {
    if (alerts.menunggu_unggahan > 0) {
      alertCards.push({ label: "Perlu Upload Dokumen", count: alerts.menunggu_unggahan, accent: "accent-amber" });
    }
    if (alerts.pending_verifikasi > 0 && user?.role === "admin") {
      alertCards.push({ label: "Perlu Verifikasi", count: alerts.pending_verifikasi, accent: "accent-indigo" });
    }
    if (alerts.perlu_revisi > 0) {
      alertCards.push({ label: "Perlu Revisi", count: alerts.perlu_revisi, accent: "red" });
    }
    if (alerts.overdue_pertanggungjawaban > 0) {
      alertCards.push({ label: "Overdue (>5 hari)", count: alerts.overdue_pertanggungjawaban, accent: "red" });
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>SPPD — Surat Perintah Perjalanan Dinas</h2>
        <div className="btn-group">
          <button className="btn btn-secondary" onClick={() => navigate("/sppd/surat-tugas")}>
            Surat Tugas
          </button>
          <button className="btn btn-primary" onClick={() => navigate("/sppd/new")}>
            + Buat SPPD
          </button>
        </div>
      </div>

      {/* Alert Cards */}
      {alertCards.length > 0 && (
        <div className="stats-grid" style={{ marginBottom: "0.75rem" }}>
          {alertCards.map((a) => (
            <div key={a.label} className={`stat-card ${a.accent}`}>
              <div className="stat-label">{a.label}</div>
              <div className="stat-value">{a.count}</div>
            </div>
          ))}
        </div>
      )}

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
            <option value="dilaksanakan">Dilaksanakan</option>
            <option value="pertanggungjawaban">Pertanggungjawaban</option>
            <option value="dibayar">Dibayar</option>
          </select>
        </div>

        {loading ? (
          <div className="empty-state"><p>Memuat data SPPD...</p></div>
        ) : list.length === 0 ? (
          <div className="empty-state">
            <p>Belum ada SPPD.</p>
            <p className="text-muted mt-2">
              Upload Surat Tugas terlebih dahulu, lalu buat SPPD dari Surat Tugas tersebut.
            </p>
            <button className="btn btn-primary mt-2" onClick={() => navigate("/sppd/surat-tugas/new")}>
              Upload Surat Tugas
            </button>
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
                      {fmtDateShort(k.tanggal_berangkat)}{" "}
                      —{" "}
                      {fmtDate(k.tanggal_pulang)}
                    </td>
                    <td>{k.jumlah_peserta} orang</td>
                    <td>
                      <span className={`badge badge-${k.status === "dilaksanakan" || k.status === "pertanggungjawaban" ? "info" : k.status}`}>
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
