import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams, useOutletContext } from "react-router-dom";
import client from "../api/client.js";

export default function PengadaanForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { formatRupiah, user } = useOutletContext();
  const isEdit = Boolean(id);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Reference data
  const [kegiatanList, setKegiatanList] = useState([]);
  const [akunList, setAkunList] = useState([]);
  const [sisaPagu, setSisaPagu] = useState(null);

  // Form state
  const [form, setForm] = useState({
    nama_pengadaan: "",
    kegiatan_id: "",
    kode_akun: "",
    jenis: "barang",
    jumlah: 1,
    satuan: "",
    estimasi_biaya: "",
    tanggal_mulai: "",
    tanggal_selesai: "",
  });

  // Load kegiatan list
  useEffect(() => {
    client.get("/kegiatan").then((res) => {
      setKegiatanList(res.data.data || []);
    }).catch(() => {});
  }, []);

  // Load akun list for the user's unit
  useEffect(() => {
    const unitId = user?.unit_kerja_id;
    if (!unitId) return;
    client.get("/reference/akun", { params: { unit_kerja_id: unitId } }).then((res) => {
      setAkunList(res.data.data || []);
    }).catch(() => {});
  }, [user]);

  // Load existing data for edit mode
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setLoading(true);
        const res = await client.get(`/pengadaan/${id}`);
        const d = res.data.data;
        setForm({
          nama_pengadaan: d.nama_pengadaan || "",
          kegiatan_id: d.kegiatan_id?.toString() || "",
          kode_akun: d.kode_akun || "",
          jenis: d.jenis || "barang",
          jumlah: d.jumlah ?? 1,
          satuan: d.satuan || "",
          estimasi_biaya: d.estimasi_biaya?.toString() || "",
          tanggal_mulai: d.tanggal_mulai?.slice(0, 10) || "",
          tanggal_selesai: d.tanggal_selesai?.slice(0, 10) || "",
        });
        setSisaPagu(d.sisa_pagu);
      } catch {
        setError("Gagal memuat data pengadaan.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Pre-fill from URL params (from risk item link or other)
  useEffect(() => {
    if (isEdit) return;
    const kodeAkun = searchParams.get("kode_akun");
    const unitId = searchParams.get("unit");
    const estimasi = searchParams.get("estimasi");
    const kegiatanId = searchParams.get("kegiatan_id");

    if (kodeAkun) setForm((prev) => ({ ...prev, kode_akun: kodeAkun }));
    if (estimasi) setForm((prev) => ({ ...prev, estimasi_biaya: estimasi }));
    if (kegiatanId) setForm((prev) => ({ ...prev, kegiatan_id: kegiatanId }));

    // Auto set nama from akun if pre-filled
    if (kodeAkun && akunList.length > 0) {
      const akun = akunList.find((a) => a.kode_akun === kodeAkun);
      if (akun) {
        const tahun = new Date().getFullYear();
        setForm((prev) => ({ ...prev, nama_pengadaan: `${akun.nama_akun} - ${tahun}` }));
      }
    }
  }, [searchParams, isEdit, akunList]);

  // Sisa pagu when kode_akun changes
  useEffect(() => {
    if (!form.kode_akun) {
      setSisaPagu(null);
      return;
    }
    const akun = akunList.find((a) => a.kode_akun === form.kode_akun);
    if (akun) {
      setSisaPagu(akun.sisa_pagu);
    } else {
      setSisaPagu(null);
    }
  }, [form.kode_akun, akunList]);

  const updateForm = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const estimasiError = (() => {
    if (!form.estimasi_biaya || !sisaPagu) return null;
    const estimasi = Number(form.estimasi_biaya);
    if (estimasi > sisaPagu) return `Estimasi melebihi sisa pagu (${formatRupiah(sisaPagu)})`;
    return null;
  })();

  // Auto-set kode_akun from selected kegiatan
  const handleKegiatanChange = async (kegiatanId) => {
    updateForm("kegiatan_id", kegiatanId);
    if (!kegiatanId) return;

    // Try to get kode_akun from kegiatan's mata_anggaran
    try {
      const res = await client.get(`/kegiatan/${kegiatanId}`);
      const d = res.data.data;
      if (d?.mata_anggaran?.length > 0) {
        const firstAkun = d.mata_anggaran[0].kode_akun;
        if (firstAkun && !form.kode_akun) {
          updateForm("kode_akun", firstAkun);
        }
      }
    } catch { /* ignore */ }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!form.nama_pengadaan.trim()) {
      setError("Nama pengadaan wajib diisi.");
      return;
    }

    const estimasi = Number(form.estimasi_biaya);
    if (!estimasi || estimasi <= 0) {
      setError("Estimasi biaya harus berupa angka positif.");
      return;
    }

    if (estimasiError) {
      setError(estimasiError);
      return;
    }

    const body = {
      nama_pengadaan: form.nama_pengadaan.trim(),
      kegiatan_id: form.kegiatan_id ? Number(form.kegiatan_id) : null,
      kode_akun: form.kode_akun || null,
      jenis: form.jenis,
      jumlah: Number(form.jumlah) || 1,
      satuan: form.satuan || null,
      estimasi_biaya: estimasi,
      tanggal_mulai: form.tanggal_mulai || null,
      tanggal_selesai: form.tanggal_selesai || null,
    };

    // If admin and user has different unit_id
    if (user?.role === "admin" && form.unit_kerja_id) {
      body.unit_kerja_id = Number(form.unit_kerja_id);
    }

    setSaving(true);
    try {
      if (isEdit) {
        await client.put(`/pengadaan/${id}`, body);
      } else {
        await client.post("/pengadaan", body);
      }
      navigate("/pengadaan");
    } catch (err) {
      setError(err.response?.data?.error || "Gagal menyimpan pengadaan.");
    } finally {
      setSaving(false);
    }
  };

  if (loading && isEdit) {
    return <div className="empty-state"><p>Memuat data pengadaan...</p></div>;
  }

  return (
    <div className="form-narrow" style={{ maxWidth: "700px" }}>
      <div className="page-header">
        <h2>{isEdit ? "Edit Pengadaan" : "Tambah Pengadaan Baru"}</h2>
        <button className="btn btn-ghost" onClick={() => navigate("/pengadaan")}>
          ← Kembali
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="card">
          <div className="card-header"><h3>Informasi Pengadaan</h3></div>
          <div className="form-row">
            <div className="form-group" style={{ gridColumn: "1 / -1" }}>
              <label>Nama Pengadaan *</label>
              <input className="form-control" required
                value={form.nama_pengadaan}
                onChange={(e) => updateForm("nama_pengadaan", e.target.value)}
                placeholder="Nama barang/jasa" />
            </div>

            <div className="form-group">
              <label>Kegiatan</label>
              <select className="form-control"
                value={form.kegiatan_id}
                onChange={(e) => handleKegiatanChange(e.target.value)}
              >
                <option value="">— Pilih Kegiatan —</option>
                {kegiatanList.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.nama_kegiatan}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Kode Akun</label>
              <select className="form-control"
                value={form.kode_akun}
                onChange={(e) => updateForm("kode_akun", e.target.value)}
              >
                <option value="">— Pilih Akun —</option>
                {akunList.map((a) => (
                  <option key={a.kode_akun} value={a.kode_akun}>
                    {a.kode_akun} — {a.nama_akun}
                  </option>
                ))}
              </select>
              {sisaPagu !== null && (
                <small style={{ display: "block", marginTop: "0.25rem", color: "var(--text-muted)" }}>
                  Sisa Pagu: {formatRupiah(sisaPagu)}
                </small>
              )}
              {estimasiError && (
                <small style={{ display: "block", marginTop: "0.15rem", color: "var(--danger)" }}>
                  ⚠️ {estimasiError}
                </small>
              )}
            </div>

            <div className="form-group">
              <label>Jenis</label>
              <select className="form-control"
                value={form.jenis}
                onChange={(e) => updateForm("jenis", e.target.value)}
              >
                <option value="barang">Barang</option>
                <option value="jasa">Jasa</option>
              </select>
            </div>

            <div className="form-group">
              <label>Jumlah</label>
              <input type="number" className="form-control" min="1"
                value={form.jumlah}
                onChange={(e) => updateForm("jumlah", e.target.value)}
                placeholder="1" />
            </div>

            <div className="form-group">
              <label>Satuan</label>
              <input className="form-control"
                value={form.satuan}
                onChange={(e) => updateForm("satuan", e.target.value)}
                placeholder="unit, paket, dll" />
            </div>

            <div className="form-group">
              <label>Estimasi Biaya *</label>
              <input type="number" className="form-control" required min="1"
                value={form.estimasi_biaya}
                onChange={(e) => updateForm("estimasi_biaya", e.target.value)}
                placeholder="0" />
              {form.estimasi_biaya && (
                <small style={{ display: "block", marginTop: "0.25rem", color: "var(--text-muted)" }}>
                  {formatRupiah(Number(form.estimasi_biaya))}
                </small>
              )}
            </div>

            <div className="form-group">
              <label>Tanggal Mulai</label>
              <input type="date" className="form-control"
                value={form.tanggal_mulai}
                onChange={(e) => updateForm("tanggal_mulai", e.target.value)} />
            </div>

            <div className="form-group">
              <label>Tanggal Selesai</label>
              <input type="date" className="form-control"
                value={form.tanggal_selesai}
                onChange={(e) => updateForm("tanggal_selesai", e.target.value)} />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="btn-group mt-3" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-secondary"
            onClick={() => navigate("/pengadaan")}>Batal</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Simpan Pengadaan"}
          </button>
        </div>
      </form>
    </div>
  );
}