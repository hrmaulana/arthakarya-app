import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams, useOutletContext } from "react-router-dom";
import { sppdApi } from "../lib/sppdApi.js";
import { suratTugasApi } from "../lib/suratTugasApi.js";

const STATUS_KEPEGAWAIAN = ["PNS", "PPPK", "PPNPN", "Konsultan"];

function pesertaKosong(lama = 1) {
  return {
    nama: "", nip: "", golongan: "", jabatan: "",
    status_kepegawaian: "PPNPN",
    uang_harian_hari: lama,
    uang_harian_satuan: 0,
    transport: 0, tiket_pp: 0,
    penginapan_malam: Math.max(0, lama - 1),
    penginapan_satuan: 0,
    honor_paket_meeting: 0,
    representatif: 0,
  };
}

function totalBiaya(p) {
  return (
    (p.uang_harian_hari || 0) * (p.uang_harian_satuan || 0) +
    (p.transport || 0) + (p.tiket_pp || 0) +
    (p.penginapan_malam || 0) * (p.penginapan_satuan || 0) +
    (p.honor_paket_meeting || 0) + (p.representatif || 0)
  );
}

export default function SppdForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { formatRupiah } = useOutletContext();
  const isEdit = Boolean(id);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [suratTugasList, setSuratTugasList] = useState([]);

  const [form, setForm] = useState({
    nama_kegiatan: "",
    alat_angkutan: "",
    tempat_berangkat: "Jakarta",
    tempat_tujuan: "",
    tanggal_berangkat: "",
    tanggal_pulang: "",
    tanggal_surat: new Date().toISOString().slice(0, 10),
    kota_dikeluarkan: "Jakarta",
    mata_anggaran: "",
    keterangan: "",
    surat_tugas_id: searchParams.get("surat_tugas_id") || "",
    ppk_nama: "",
    ppk_nip: "",
    ppk_jabatan: "",
  });

  const [peserta, setPeserta] = useState([pesertaKosong()]);

  // Load surat tugas list for create mode
  useEffect(() => {
    if (isEdit) return;
    suratTugasApi.list().then((res) => setSuratTugasList(res.data.data || [])).catch(() => {});
  }, [isEdit]);

  // Load existing data for edit mode
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setLoading(true);
        const res = await sppdApi.get(id);
        const d = res.data.data;
        setForm({
          nama_kegiatan: d.nama_kegiatan || "",
          alat_angkutan: d.alat_angkutan || "",
          tempat_berangkat: d.tempat_berangkat || "",
          tempat_tujuan: d.tempat_tujuan || "",
          tanggal_berangkat: d.tanggal_berangkat?.slice(0, 10) || "",
          tanggal_pulang: d.tanggal_pulang?.slice(0, 10) || "",
          tanggal_surat: d.tanggal_surat?.slice(0, 10) || "",
          kota_dikeluarkan: d.kota_dikeluarkan || "",
          mata_anggaran: d.mata_anggaran || "",
          keterangan: d.keterangan || "",
          ppk_nama: d.ppk_nama || "",
          ppk_nip: d.ppk_nip || "",
          ppk_jabatan: d.ppk_jabatan || "",
          surat_tugas_id: d.surat_tugas_id || "",
        });
        if (d.peserta?.length > 0) setPeserta(d.peserta);
      } catch {
        setError("Gagal memuat data SPPD.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Auto-calculate lama hari
  const lamaHari = (() => {
    if (!form.tanggal_berangkat || !form.tanggal_pulang) return 0;
    const a = new Date(form.tanggal_berangkat);
    const b = new Date(form.tanggal_pulang);
    return Math.max(0, Math.round((b - a) / 86400000) + 1);
  })();

  // Sync peserta hari & penginapan when lama changes
  useEffect(() => {
    if (lamaHari <= 0) return;
    setPeserta((prev) =>
      prev.map((p) => ({
        ...p,
        uang_harian_hari: lamaHari,
        penginapan_malam: Math.max(0, lamaHari - 1),
      }))
    );
  }, [lamaHari]);

  const updateForm = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const updatePeserta = (idx, field, value) => {
    setPeserta((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const tambahPeserta = () =>
    setPeserta((prev) => [...prev, pesertaKosong(lamaHari || 1)]);

  const hapusPeserta = (idx) =>
    setPeserta((prev) => prev.filter((_, i) => i !== idx));

  const grandTotal = peserta.reduce((sum, p) => sum + totalBiaya(p), 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const body = { ...form, lama_hari: lamaHari, peserta };
    setLoading(true);

    try {
      if (isEdit) {
        await sppdApi.update(id, body);
      } else {
        await sppdApi.create(body);
      }
      navigate("/sppd");
    } catch (err) {
      setError(err.response?.data?.error || "Gagal menyimpan SPPD.");
      setLoading(false);
    }
  };

  if (loading && isEdit) {
    return <div className="empty-state"><p>Memuat data SPPD...</p></div>;
  }

  return (
    <div className="form-narrow" style={{ maxWidth: "900px" }}>
      <div className="page-header">
        <h2>{isEdit ? "Edit SPPD" : "Buat SPPD Baru"}</h2>
        <button className="btn btn-ghost" onClick={() => navigate("/sppd")}>
          ← Kembali
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        {/* Kegiatan */}
        <div className="card">
          <div className="card-header"><h3>Data Kegiatan</h3></div>
          <div className="form-row">
            <div className="form-group" style={{ gridColumn: "1 / -1" }}>
              <label>Nama Kegiatan</label>
              <input className="form-control" required
                value={form.nama_kegiatan}
                onChange={(e) => updateForm("nama_kegiatan", e.target.value)} />
            </div>
            <div className="form-group">
              <label>Tempat Berangkat</label>
              <input className="form-control" required
                value={form.tempat_berangkat}
                onChange={(e) => updateForm("tempat_berangkat", e.target.value)} />
            </div>
            <div className="form-group">
              <label>Tempat Tujuan</label>
              <input className="form-control" required
                value={form.tempat_tujuan}
                onChange={(e) => updateForm("tempat_tujuan", e.target.value)} />
            </div>
            <div className="form-group">
              <label>Tanggal Berangkat</label>
              <input type="date" className="form-control" required
                value={form.tanggal_berangkat}
                onChange={(e) => updateForm("tanggal_berangkat", e.target.value)} />
            </div>
            <div className="form-group">
              <label>Tanggal Pulang</label>
              <input type="date" className="form-control" required
                value={form.tanggal_pulang}
                onChange={(e) => updateForm("tanggal_pulang", e.target.value)} />
            </div>
            <div className="form-group">
              <label>Lama Perjalanan</label>
              <input className="form-control" disabled value={`${lamaHari} Hari`} />
            </div>
            <div className="form-group">
              <label>Alat Angkutan</label>
              <input className="form-control"
                value={form.alat_angkutan}
                onChange={(e) => updateForm("alat_angkutan", e.target.value)} />
            </div>
            {!isEdit && suratTugasList.length > 0 && (
              <div className="form-group">
                <label>Surat Tugas (Opsional)</label>
                <select className="form-control"
                  value={form.surat_tugas_id}
                  onChange={(e) => updateForm("surat_tugas_id", e.target.value)}>
                  <option value="">— Tanpa Surat Tugas —</option>
                  {suratTugasList.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.nomor_surat} — {st.perihal}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-group">
              <label>Mata Anggaran</label>
              <input className="form-control"
                value={form.mata_anggaran}
                onChange={(e) => updateForm("mata_anggaran", e.target.value)} />
            </div>
            <div className="form-group">
              <label>Tanggal Surat</label>
              <input type="date" className="form-control" required
                value={form.tanggal_surat}
                onChange={(e) => updateForm("tanggal_surat", e.target.value)} />
            </div>
            <div className="form-group">
              <label>Kota Dikeluarkan</label>
              <input className="form-control" required
                value={form.kota_dikeluarkan}
                onChange={(e) => updateForm("kota_dikeluarkan", e.target.value)} />
            </div>
            <div className="form-group" style={{ gridColumn: "1 / -1" }}>
              <label>Keterangan</label>
              <textarea className="form-control" rows={2}
                value={form.keterangan}
                onChange={(e) => updateForm("keterangan", e.target.value)} />
            </div>
          </div>
        </div>

        {/* PPK */}
        <div className="card">
          <div className="card-header"><h3>Pejabat Pembuat Komitmen (PPK)</h3></div>
          <div className="form-row">
            <div className="form-group">
              <label>Nama PPK</label>
              <input className="form-control" required
                value={form.ppk_nama}
                onChange={(e) => updateForm("ppk_nama", e.target.value)} />
            </div>
            <div className="form-group">
              <label>NIP PPK</label>
              <input className="form-control"
                value={form.ppk_nip}
                onChange={(e) => updateForm("ppk_nip", e.target.value)} />
            </div>
            <div className="form-group">
              <label>Jabatan PPK</label>
              <input className="form-control" required
                value={form.ppk_jabatan}
                onChange={(e) => updateForm("ppk_jabatan", e.target.value)} />
            </div>
          </div>
        </div>

        {/* Peserta */}
        <div className="card">
          <div className="card-header">
            <h3>Peserta ({peserta.length})</h3>
            <button type="button" className="btn btn-secondary btn-sm" onClick={tambahPeserta}>
              + Tambah
            </button>
          </div>

          {peserta.length === 0 ? (
            <div className="empty-state"><p>Belum ada peserta.</p></div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Nama</th>
                    <th>Status</th>
                    <th>Uang Harian</th>
                    <th>Transport</th>
                    <th>Tiket PP</th>
                    <th>Penginapan</th>
                    <th>Lainnya</th>
                    <th>Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {peserta.map((p, idx) => (
                    <tr key={idx}>
                      <td>
                        <input className="form-control" style={{ minWidth: 120 }}
                          value={p.nama}
                          onChange={(e) => updatePeserta(idx, "nama", e.target.value)}
                          placeholder="Nama" />
                      </td>
                      <td>
                        <select className="form-control" style={{ minWidth: 90 }}
                          value={p.status_kepegawaian}
                          onChange={(e) => updatePeserta(idx, "status_kepegawaian", e.target.value)}>
                          {STATUS_KEPEGAWAIAN.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input type="number" className="form-control" style={{ width: 80 }}
                          value={p.uang_harian_satuan}
                          onChange={(e) => updatePeserta(idx, "uang_harian_satuan", +e.target.value)} />
                      </td>
                      <td>
                        <input type="number" className="form-control" style={{ width: 90 }}
                          value={p.transport}
                          onChange={(e) => updatePeserta(idx, "transport", +e.target.value)} />
                      </td>
                      <td>
                        <input type="number" className="form-control" style={{ width: 90 }}
                          value={p.tiket_pp}
                          onChange={(e) => updatePeserta(idx, "tiket_pp", +e.target.value)} />
                      </td>
                      <td>
                        <input type="number" className="form-control" style={{ width: 80 }}
                          value={p.penginapan_satuan}
                          onChange={(e) => updatePeserta(idx, "penginapan_satuan", +e.target.value)} />
                      </td>
                      <td>
                        <input type="number" className="form-control" style={{ width: 80 }}
                          value={p.honor_paket_meeting + p.representatif}
                          onChange={(e) => updatePeserta(idx, "honor_paket_meeting", +e.target.value)} />
                      </td>
                      <td className="font-bold font-mono">
                        {formatRupiah(totalBiaya(p))}
                      </td>
                      <td>
                        <button type="button" className="btn btn-ghost btn-sm"
                          onClick={() => hapusPeserta(idx)}
                          style={{ color: "var(--danger)" }}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="text-right mt-2">
            <span className="total-display">
              Total Biaya: {formatRupiah(grandTotal)}
            </span>
          </div>
        </div>

        {/* Submit */}
        <div className="btn-group mt-3" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-secondary"
            onClick={() => navigate("/sppd")}>Batal</button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Simpan SPPD"}
          </button>
        </div>
      </form>
    </div>
  );
}
