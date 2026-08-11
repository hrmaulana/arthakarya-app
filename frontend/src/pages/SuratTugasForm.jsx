import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { suratTugasApi } from "../lib/suratTugasApi.js";

export default function SuratTugasForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    nomor_surat: "",
    tanggal_surat: new Date().toISOString().slice(0, 10),
    perihal: "",
  });
  const [fileSurat, setFileSurat] = useState(null);
  const [fileUndangan, setFileUndangan] = useState(null);
  const [existingFiles, setExistingFiles] = useState(null); // { file_surat_path, file_undangan_path }

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setLoading(true);
        const res = await suratTugasApi.get(id);
        const d = res.data.data;
        setForm({
          nomor_surat: d.nomor_surat,
          tanggal_surat: d.tanggal_surat?.slice(0, 10) || "",
          perihal: d.perihal,
        });
        setExistingFiles({
          file_surat_path: d.file_surat_path,
          file_undangan_path: d.file_undangan_path,
        });
      } catch {
        setError("Gagal memuat Surat Tugas.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const fd = new FormData();
    fd.append("nomor_surat", form.nomor_surat);
    fd.append("tanggal_surat", form.tanggal_surat);
    fd.append("perihal", form.perihal);
    if (fileSurat) fd.append("file_surat", fileSurat);
    if (fileUndangan) fd.append("file_undangan", fileUndangan);

    try {
      if (isEdit) {
        await suratTugasApi.update(id, fd);
      } else {
        await suratTugasApi.create(fd);
      }
      navigate("/sppd/surat-tugas");
    } catch (err) {
      setError(err.response?.data?.error || "Gagal menyimpan Surat Tugas.");
      setLoading(false);
    }
  };

  if (loading && isEdit) {
    return <div className="empty-state"><p>Memuat data...</p></div>;
  }

  const canViewFile = (path) => path;
  const hasExistingSurat = existingFiles?.file_surat_path;
  const hasExistingUndangan = existingFiles?.file_undangan_path;

  return (
    <div className="form-narrow" style={{ maxWidth: "600px" }}>
      <div className="page-header">
        <h2>{isEdit ? "Edit Surat Tugas" : "Upload Surat Tugas"}</h2>
        <button className="btn btn-ghost" onClick={() => navigate("/sppd/surat-tugas")}>
          ← Kembali
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="card">
          <div className="card-header"><h3>Data Surat Tugas</h3></div>

          <div className="form-group">
            <label>Nomor Surat Tugas</label>
            <input className="form-control" required
              value={form.nomor_surat}
              onChange={(e) => setForm((p) => ({ ...p, nomor_surat: e.target.value }))}
              placeholder="Contoh: ST-001/UNIT/VIII/2026" />
          </div>

          <div className="form-group">
            <label>Tanggal Surat</label>
            <input type="date" className="form-control" required
              value={form.tanggal_surat}
              onChange={(e) => setForm((p) => ({ ...p, tanggal_surat: e.target.value }))} />
          </div>

          <div className="form-group">
            <label>Perihal</label>
            <textarea className="form-control" rows={2} required
              value={form.perihal}
              onChange={(e) => setForm((p) => ({ ...p, perihal: e.target.value }))}
              placeholder="Perihal kegiatan perjalanan dinas" />
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Dokumen</h3></div>

          <div className="form-group">
            <label>File Surat Tugas (PDF, max 10 MB)</label>
            {!isEdit && (
              <input type="file" className="form-control" accept=".pdf"
                onChange={(e) => setFileSurat(e.target.files?.[0] || null)} />
            )}
            {isEdit && (
              <>
                {hasExistingSurat ? (
                  <div className="alert alert-success" style={{ marginBottom: "0.5rem" }}>
                    ✓ File Surat Tugas sudah diunggah. Upload baru untuk mengganti.
                  </div>
                ) : (
                  <div className="alert alert-warning" style={{ marginBottom: "0.5rem" }}>
                    File Surat Tugas belum diunggah.
                  </div>
                )}
                <input type="file" className="form-control" accept=".pdf"
                  onChange={(e) => setFileSurat(e.target.files?.[0] || null)} />
                {hasExistingSurat && (
                  <a href={suratTugasApi.fileUrl(id, "surat")} target="_blank" rel="noreferrer"
                    className="btn btn-ghost btn-sm mt-1" style={{ fontSize: "0.78rem" }}>
                    📄 Lihat File Saat Ini
                  </a>
                )}
              </>
            )}
          </div>

          <div className="form-group">
            <label>File Undangan (PDF, max 10 MB)</label>
            {!isEdit && (
              <input type="file" className="form-control" accept=".pdf"
                onChange={(e) => setFileUndangan(e.target.files?.[0] || null)} />
            )}
            {isEdit && (
              <>
                {hasExistingUndangan ? (
                  <div className="alert alert-success" style={{ marginBottom: "0.5rem" }}>
                    ✓ File Undangan sudah diunggah. Upload baru untuk mengganti.
                  </div>
                ) : (
                  <div className="alert alert-warning" style={{ marginBottom: "0.5rem" }}>
                    File Undangan belum diunggah.
                  </div>
                )}
                <input type="file" className="form-control" accept=".pdf"
                  onChange={(e) => setFileUndangan(e.target.files?.[0] || null)} />
                {hasExistingUndangan && (
                  <a href={suratTugasApi.fileUrl(id, "undangan")} target="_blank" rel="noreferrer"
                    className="btn btn-ghost btn-sm mt-1" style={{ fontSize: "0.78rem" }}>
                    📄 Lihat File Saat Ini
                  </a>
                )}
              </>
            )}
          </div>
        </div>

        <div className="btn-group mt-3" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-secondary"
            onClick={() => navigate("/sppd/surat-tugas")}>Batal</button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Upload Surat Tugas"}
          </button>
        </div>
      </form>
    </div>
  );
}
