import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import client from "../api/client.js";
import MataAnggaranTable, { parseRupiah } from "../components/MataAnggaranTable.jsx";

export default function KegiatanForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [unitKerjaList, setUnitKerjaList] = useState([]);
  const [jenisKegiatanList, setJenisKegiatanList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);

  // Form state
  const [form, setForm] = useState({
    nama_kegiatan: "",
    unit_kerja_id: "",
    jenis_kegiatan_id: "",
    tanggal: "",
    status: "draft",
  });
  const [mataAnggaran, setMataAnggaran] = useState([]);

  // Fetch user + reference data
  useEffect(() => {
    const stored = localStorage.getItem("user");
    const user = stored ? JSON.parse(stored) : null;
    setCurrentUser(user);

    // Pre-fill unit_kerja for operator
    if (user && user.role === "operator") {
      setForm((f) => ({ ...f, unit_kerja_id: user.unit_kerja_id }));
    }

    Promise.all([
      client.get("/reference/unit-kerja"),
      client.get("/reference/jenis-kegiatan"),
    ])
      .then(([ukRes, jkRes]) => {
        setUnitKerjaList(ukRes.data.data);
        setJenisKegiatanList(jkRes.data.data);
      })
      .catch((err) => {
        console.error("Gagal memuat data referensi:", err);
      });

    // If editing, fetch existing kegiatan
    if (isEdit) {
      setLoading(true);
      client
        .get(`/kegiatan/${id}`)
        .then((res) => {
          const d = res.data.data;
          setForm({
            nama_kegiatan: d.nama_kegiatan,
            unit_kerja_id: d.unit_kerja_id,
            jenis_kegiatan_id: d.jenis_kegiatan_id,
            tanggal: d.tanggal,
            status: d.status,
          });
          setMataAnggaran(d.mata_anggaran || []);
        })
        .catch((err) => {
          setError(err.response?.data?.error || "Gagal memuat detail kegiatan.");
        })
        .finally(() => setLoading(false));
    }
  }, [id, isEdit]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // Client-side validation
    if (!form.nama_kegiatan.trim()) {
      setError("Nama kegiatan wajib diisi.");
      return;
    }
    if (!form.tanggal) {
      setError("Tanggal wajib diisi.");
      return;
    }
    if (!form.unit_kerja_id) {
      setError("Unit kerja wajib dipilih.");
      return;
    }
    if (!form.jenis_kegiatan_id) {
      setError("Jenis kegiatan wajib dipilih.");
      return;
    }
    if (mataAnggaran.length === 0) {
      setError("Minimal satu item mata anggaran harus diisi.");
      return;
    }

    // Ensure jumlah_rp are integers (terima "1.000.000" maupun "1000000")
    const cleaned = mataAnggaran.map((item) => ({
      ...item,
      jumlah_rp: parseRupiah(item.jumlah_rp),
    }));

    const payload = {
      ...form,
      unit_kerja_id: Number(form.unit_kerja_id),
      jenis_kegiatan_id: Number(form.jenis_kegiatan_id),
      mata_anggaran: cleaned,
    };

    setSubmitting(true);
    try {
      if (isEdit) {
        await client.put(`/kegiatan/${id}`, payload);
      } else {
        await client.post("/kegiatan", payload);
      }
      navigate("/kegiatan", { replace: true });
    } catch (err) {
      const msg = err.response?.data?.error || "Gagal menyimpan kegiatan.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="empty-state"><p>Memuat data...</p></div>;
  }

  const isOperator = currentUser?.role === "operator";

  return (
    <div>
      <div className="page-header">
        <h2>{isEdit ? "Edit Kegiatan" : "Tambah Kegiatan Baru"}</h2>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        {/* Header */}
        <div className="card">
          <h3 className="mb-2">Informasi Kegiatan</h3>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="nama_kegiatan">Nama Kegiatan *</label>
              <input
                id="nama_kegiatan"
                type="text"
                className="form-control"
                value={form.nama_kegiatan}
                onChange={(e) => handleChange("nama_kegiatan", e.target.value)}
                placeholder="Contoh: Rapat Koordinasi Program"
              />
            </div>

            <div className="form-group">
              <label htmlFor="tanggal">Tanggal *</label>
              <input
                id="tanggal"
                type="date"
                className="form-control"
                value={form.tanggal}
                onChange={(e) => handleChange("tanggal", e.target.value)}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="unit_kerja">Unit Kerja *</label>
              {isOperator ? (
                <input
                  id="unit_kerja"
                  type="text"
                  className="form-control"
                  value={
                    unitKerjaList.find((u) => u.id === form.unit_kerja_id)
                      ?.nama_unit || ""
                  }
                  disabled
                />
              ) : (
                <select
                  id="unit_kerja"
                  className="form-control"
                  value={form.unit_kerja_id}
                  onChange={(e) =>
                    handleChange("unit_kerja_id", Number(e.target.value))
                  }
                >
                  <option value="">-- Pilih Unit Kerja --</option>
                  {unitKerjaList.map((uk) => (
                    <option key={uk.id} value={uk.id}>
                      {uk.kode_unit} — {uk.nama_unit}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="jenis_kegiatan">Jenis Kegiatan *</label>
              <select
                id="jenis_kegiatan"
                className="form-control"
                value={form.jenis_kegiatan_id}
                onChange={(e) =>
                  handleChange("jenis_kegiatan_id", Number(e.target.value))
                }
              >
                <option value="">-- Pilih Jenis Kegiatan --</option>
                {jenisKegiatanList.map((jk) => (
                  <option key={jk.id} value={jk.id}>
                    {jk.nama_jenis}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="status">Status</label>
              <select
                id="status"
                className="form-control"
                value={form.status}
                onChange={(e) => handleChange("status", e.target.value)}
              >
                <option value="draft">Draf</option>
                <option value="diajukan">Diajukan</option>
                {currentUser?.role === "admin" && (
                  <>
                    <option value="disetujui">Disetujui</option>
                    <option value="ditolak">Ditolak</option>
                  </>
                )}
              </select>
            </div>
          </div>
        </div>

        {/* Mata Anggaran */}
        <div className="card">
          <h3 className="mb-2">💵 Rincian Mata Anggaran</h3>
          <p className="text-muted mb-2">
            Tambahkan item-item anggaran. Total akan dihitung otomatis.
          </p>
          <MataAnggaranTable
            items={mataAnggaran}
            onChange={setMataAnggaran}
          />
        </div>

        {/* Submit */}
        <div className="btn-group">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
          >
            {submitting
              ? "Menyimpan..."
              : isEdit
              ? "Simpan Perubahan"
              : "Simpan Kegiatan"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate("/kegiatan")}
          >
            Batal
          </button>
        </div>
      </form>
    </div>
  );
}
