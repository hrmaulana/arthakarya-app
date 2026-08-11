import { useState, useEffect } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { suratTugasApi } from "../lib/suratTugasApi.js";
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

export default function SuratTugasDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user } = useOutletContext();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDetail = async () => {
    try {
      setLoading(true);
      const res = await suratTugasApi.get(id);
      setData(res.data.data);
    } catch {
      setError("Gagal memuat Surat Tugas.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDetail(); }, [id]);

  if (loading) {
    return <div className="empty-state"><p>Memuat detail Surat Tugas...</p></div>;
  }
  if (!data) {
    return <div className="empty-state"><p>{error || "Surat Tugas tidak ditemukan."}</p></div>;
  }

  const sppdList = data.sppd_list || [];

  const viewFile = async (jenis) => {
    try {
      const token = localStorage.getItem("token");
      const url = suratTugasApi.fileUrl(id, jenis);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Gagal memuat file.");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank");
    } catch {
      alert("Gagal membuka file. Silakan coba lagi.");
    }
  };

  return (
    <div className="form-narrow" style={{ maxWidth: "900px" }}>
      <div className="page-header">
        <div>
          <h2>{data.nomor_surat}</h2>
        </div>
        <div className="btn-group">
          <button className="btn btn-ghost" onClick={() => navigate("/sppd/surat-tugas")}>
            ← Kembali
          </button>
          <button className="btn btn-secondary"
            onClick={() => navigate(`/sppd/surat-tugas/${id}/edit`)}>
            Edit
          </button>
          <button className="btn btn-primary"
            onClick={() => navigate(`/sppd/new?surat_tugas_id=${id}`)}>
            + Tambah SPPD
          </button>
        </div>
      </div>

      {/* Detail Surat Tugas */}
      <div className="card">
        <div className="card-header"><h3>Detail Surat Tugas</h3></div>
        <div className="detail-grid">
          <div className="detail-item">
            <div className="detail-label">Nomor Surat</div>
            <div className="detail-value">{data.nomor_surat}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Tanggal Surat</div>
            <div className="detail-value">
              {fmtDate(data.tanggal_surat)}
            </div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Diunggah Oleh</div>
            <div className="detail-value">{data.created_by_username}</div>
          </div>
          <div className="detail-item" style={{ gridColumn: "1 / -1" }}>
            <div className="detail-label">Perihal</div>
            <div className="detail-value">{data.perihal}</div>
          </div>
        </div>
      </div>

      {/* File Preview */}
      <div className="card">
        <div className="card-header"><h3>Dokumen</h3></div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          {data.file_surat_path ? (
            <button onClick={() => viewFile("surat")}
              className="btn btn-secondary btn-sm">
              📄 Lihat Surat Tugas
            </button>
          ) : (
            <span className="text-muted">Surat Tugas belum diunggah.</span>
          )}
          {data.file_undangan_path ? (
            <button onClick={() => viewFile("undangan")}
              className="btn btn-secondary btn-sm">
              📄 Lihat Undangan
            </button>
          ) : (
            <span className="text-muted">Undangan belum diunggah.</span>
          )}
        </div>
      </div>

      {/* SPPD Terkait */}
      <div className="card">
        <div className="card-header">
          <h3>SPPD Terkait ({sppdList.length})</h3>
        </div>

        {sppdList.length === 0 ? (
          <div className="empty-state">
            <p>Belum ada SPPD yang dibuat dari Surat Tugas ini.</p>
            <button className="btn btn-primary mt-2"
              onClick={() => navigate(`/sppd/new?surat_tugas_id=${id}`)}>
              + Buat SPPD Baru
            </button>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nama Kegiatan</th>
                  <th>Tanggal</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sppdList.map((sppd) => (
                  <tr key={sppd.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/sppd/${sppd.id}`)}
                  >
                    <td className="font-bold">{sppd.nama_kegiatan}</td>
                    <td>
                      {fmtDateShort(sppd.tanggal_berangkat)}{" "}
                      —{" "}
                      {fmtDate(sppd.tanggal_pulang)}
                    </td>
                    <td>
                      <span className={`badge badge-${sppd.status === "dilaksanakan" || sppd.status === "pertanggungjawaban" ? "info" : sppd.status}`}>
                        {STATUS_LABEL[sppd.status] || sppd.status}
                      </span>
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
