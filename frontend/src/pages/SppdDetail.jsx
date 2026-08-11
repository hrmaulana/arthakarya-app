import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { sppdApi } from "../lib/sppdApi.js";
import { fmtDate } from "../lib/fmtDate.js";

const STATUS_LABEL = {
  draft: "Draft",
  diajukan: "Menunggu Persetujuan",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
  dilaksanakan: "Dilaksanakan",
  pertanggungjawaban: "Pertanggungjawaban",
  dibayar: "Dibayar",
};

const STATUS_KEPEGAWAIAN = ["PNS", "PPPK", "PPNPN", "Konsultan"];

const DOKUMEN_JENIS_LABEL = {
  boarding_pass: "Boarding Pass",
  kwitansi_hotel: "Kwitansi Hotel",
  sppd_cap: "SPPD Dicap",
  laporan_kegiatan: "Laporan Kegiatan",
};

function totalBiaya(p) {
  return (
    (p.uang_harian_hari || 0) * (p.uang_harian_satuan || 0) +
    (p.transport || 0) + (p.tiket_pp || 0) +
    (p.penginapan_malam || 0) * (p.penginapan_satuan || 0) +
    (p.honor_paket_meeting || 0) + (p.representatif || 0)
  );
}

function ApprovalTimeline({ approvals }) {
  if (!approvals?.length) return null;
  const items = [...approvals].reverse();

  return (
    <div className="card">
      <div className="card-header"><h3>Riwayat Approval</h3></div>
      <div style={{ padding: "0 0.5rem" }}>
        {items.map((a) => (
          <div key={a.id} className="timeline-item">
            <div className="timeline-badge">
              <span className={`badge badge-${a.keputusan === "revisi" || a.keputusan === "diajukan_pertanggungjawaban" ? "warning" : a.keputusan}`}>
                {a.keputusan === "revisi" ? "Revisi" :
                 a.keputusan === "diajukan_pertanggungjawaban" ? "Ajukan Pertanggungjawaban" :
                 STATUS_LABEL[a.keputusan] || a.keputusan}
              </span>
            </div>
            <div className="timeline-body">
              <div className="timeline-meta">
                <strong>{a.actor_username}</strong>
                {" · "}
                {new Date(a.created_at).toLocaleDateString("id-ID", {
                  day: "numeric", month: "long", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </div>
              {a.catatan && (
                <div className="timeline-note">"{a.catatan}"</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SppdDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { formatRupiah, user } = useOutletContext();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [catatan, setCatatan] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { dokumenId, namaFile }

  // Upload state
  const [uploadModal, setUploadModal] = useState(null); // { jenis, pesertaId, pesertaNama }
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);

  const fetchDetail = useCallback(async () => {
    try {
      setLoading(true);
      const res = await sppdApi.get(id);
      setData(res.data.data);
    } catch {
      setError("Gagal memuat detail SPPD.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const doAction = async (action, keputusan) => {
    setActionLoading(true);
    setError(null);
    try {
      if (action === "submit") await sppdApi.submit(id);
      else if (action === "approve") await sppdApi.approve(id, keputusan, catatan || undefined);
      else if (action === "delete") {
        await sppdApi.remove(id);
        navigate("/sppd");
        return;
      }
      else if (action === "ajukan-pertanggungjawaban") {
        await sppdApi.ajukanPertanggungjawaban(id);
      }
      else if (action === "verifikasi-dokumen") {
        await sppdApi.verifikasiDokumen(id, keputusan, catatan || undefined);
      }
      await fetchDetail();
      setConfirm(null);
      setCatatan("");
    } catch (err) {
      setError(err.response?.data?.error || `Gagal ${action}.`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile || !uploadModal) return;
    setUploadLoading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      fd.append("jenis", uploadModal.jenis);
      if (uploadModal.pesertaId) {
        fd.append("sppd_peserta_id", String(uploadModal.pesertaId));
      }
      await sppdApi.uploadDokumen(id, fd);
      await fetchDetail();
      setUploadModal(null);
      setUploadFile(null);
    } catch (err) {
      setUploadError(err.response?.data?.error || "Gagal mengupload dokumen.");
    } finally {
      setUploadLoading(false);
    }
  };

  const handleDeleteDokumen = async (dokumenId) => {
    try {
      setDeleteConfirm(null);
      await sppdApi.deleteDokumen(id, dokumenId);
      await fetchDetail();
    } catch (err) {
      setError(err.response?.data?.error || "Gagal menghapus dokumen.");
    }
  };

  const viewFile = async (dokumenId) => {
    try {
      const token = localStorage.getItem("token");
      const url = sppdApi.dokumenUrl(id, dokumenId);
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

  const cetakPdf = async (pesertaId) => {
    try {
      const token = localStorage.getItem("token");
      const url = sppdApi.cetakUrl(id, pesertaId);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Gagal mencetak PDF.");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank");
    } catch {
      alert("Gagal mencetak PDF. Silakan coba lagi.");
    }
  };

  if (loading) {
    return <div className="empty-state"><p>Memuat detail SPPD...</p></div>;
  }

  if (!data) {
    return <div className="empty-state"><p>{error || "SPPD tidak ditemukan."}</p></div>;
  }

  const isOwner = data.created_by === user?.id;
  const isAdmin = user?.role === "admin";
  const canEdit = data.status === "draft" && (isOwner || isAdmin);
  const isDraft = data.status === "draft";
  const isDiajukan = data.status === "diajukan";
  const isDisetujui = data.status === "disetujui";
  const isDilaksanakan = data.status === "dilaksanakan";
  const isPertanggungjawaban = data.status === "pertanggungjawaban";
  const isDibayar = data.status === "dibayar";
  const showCetak = isDisetujui || isDibayar || isDilaksanakan || isPertanggungjawaban;

  const peserta = data.peserta || [];
  const dokumen = data.dokumen || [];
  const grandTotal = peserta.reduce((sum, p) => sum + totalBiaya(p), 0);

  const getDokumen = (jenis, pesertaId) =>
    dokumen.find((d) => d.jenis === jenis && (d.sppd_peserta_id === pesertaId || (!d.sppd_peserta_id && !pesertaId)));

  const dokumenPerPeserta = ["boarding_pass", "kwitansi_hotel", "sppd_cap"];
  const dokumenPerSppd = ["laporan_kegiatan"];

  return (
    <div className="form-narrow" style={{ maxWidth: "960px" }}>
      <div className="page-header">
        <div>
          <h2>{data.nama_kegiatan}</h2>
          <span className={`badge badge-${isDilaksanakan || isPertanggungjawaban ? "info" : data.status}`} style={{ marginTop: 4, display: "inline-block" }}>
            {STATUS_LABEL[data.status] || data.status}
          </span>
        </div>
        <div className="btn-group">
          <button className="btn btn-ghost" onClick={() => navigate("/sppd")}>
            ← Kembali
          </button>
          {canEdit && (
            <button className="btn btn-secondary"
              onClick={() => navigate(`/sppd/${id}/edit`)}>
              Edit SPPD
            </button>
          )}
          {isDraft && (isOwner || isAdmin) && (
            <button className="btn btn-primary"
              disabled={peserta.length === 0 || actionLoading}
              onClick={() => setConfirm({ action: "submit" })}>
              {actionLoading && confirm?.action === "submit" ? "..." : "Ajukan"}
            </button>
          )}
          {isDraft && isOwner && (
            <button className="btn btn-danger"
              disabled={actionLoading}
              onClick={() => setConfirm({ action: "delete" })}>
              Hapus
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Approval actions — admin */}
      {isDiajukan && isAdmin && (
        <div className="card" style={{ borderLeft: "3px solid var(--primary)" }}>
          <div className="card-header"><h3>Tindakan Approval</h3></div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn btn-success"
              disabled={actionLoading}
              onClick={() => setConfirm({ action: "approve", keputusan: "disetujui" })}>
              ✓ Setujui
            </button>
            <button className="btn btn-danger"
              disabled={actionLoading}
              onClick={() => setConfirm({ action: "approve", keputusan: "ditolak" })}>
              ✕ Tolak
            </button>
          </div>
        </div>
      )}

      {/* Pertanggungjawaban actions — dilaksanakan */}
      {isDilaksanakan && (isOwner || isAdmin) && (
        <div className="card" style={{ borderLeft: "3px solid var(--warning)" }}>
          <div className="card-header">
            <h3>Pertanggungjawaban</h3>
          </div>
          <p className="text-muted mb-2">
            Upload dokumen perjalanan dinas: Boarding Pass, Kwitansi Hotel, SPPD yang sudah dicap (wajib), dan Laporan Kegiatan.
          </p>
          <p className="text-xs text-muted mb-2">
            Deadline upload: 5 hari kerja setelah tanggal pulang. Setelah lengkap, klik "Ajukan Pertanggungjawaban."
          </p>
          <button className="btn btn-primary"
            disabled={actionLoading}
            onClick={() => setConfirm({ action: "ajukan-pertanggungjawaban" })}>
            {actionLoading ? "Mengirim..." : "📋 Ajukan Pertanggungjawaban"}
          </button>
        </div>
      )}

      {/* Verifikasi — admin bendahara */}
      {isPertanggungjawaban && isAdmin && (
        <div className="card" style={{ borderLeft: "3px solid var(--info)" }}>
          <div className="card-header"><h3>Verifikasi Dokumen</h3></div>
          <p className="text-muted mb-2">Periksa semua dokumen pertanggungjawaban. Jika lengkap, tandai "Dibayar."</p>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn btn-success"
              disabled={actionLoading}
              onClick={() => setConfirm({ action: "verifikasi-dokumen", keputusan: "dibayar" })}>
              💰 Setujui & Dibayar
            </button>
            <button className="btn btn-danger"
              disabled={actionLoading}
              onClick={() => setConfirm({ action: "verifikasi-dokumen", keputusan: "revisi" })}>
              ✎ Minta Revisi
            </button>
          </div>
        </div>
      )}

      {/* Kegiatan Info */}
      <div className="card">
        <div className="card-header"><h3>Data Perjalanan Dinas</h3></div>
        <div className="detail-grid">
          <div className="detail-item">
            <div className="detail-label">Nama Kegiatan</div>
            <div className="detail-value">{data.nama_kegiatan}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Tempat Berangkat</div>
            <div className="detail-value">{data.tempat_berangkat}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Tempat Tujuan</div>
            <div className="detail-value">{data.tempat_tujuan}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Tanggal Berangkat</div>
            <div className="detail-value">
              {fmtDate(data.tanggal_berangkat)}
            </div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Tanggal Pulang</div>
            <div className="detail-value">
              {fmtDate(data.tanggal_pulang)}
            </div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Lama Perjalanan</div>
            <div className="detail-value">{data.lama_hari} Hari</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Alat Angkutan</div>
            <div className="detail-value">{data.alat_angkutan || "—"}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Mata Anggaran</div>
            <div className="detail-value">{data.mata_anggaran || "—"}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Tanggal Surat</div>
            <div className="detail-value">
              {fmtDate(data.tanggal_surat)}
            </div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Kota Dikeluarkan</div>
            <div className="detail-value">{data.kota_dikeluarkan}</div>
          </div>
          {data.keterangan && (
            <div className="detail-item" style={{ gridColumn: "1 / -1" }}>
              <div className="detail-label">Keterangan</div>
              <div className="detail-value">{data.keterangan}</div>
            </div>
          )}
        </div>
      </div>

      {/* PPK */}
      <div className="card">
        <div className="card-header"><h3>Pejabat Pembuat Komitmen (PPK)</h3></div>
        <div className="detail-grid">
          <div className="detail-item">
            <div className="detail-label">Nama PPK</div>
            <div className="detail-value">{data.ppk_nama}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">NIP PPK</div>
            <div className="detail-value">{data.ppk_nip || "—"}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Jabatan PPK</div>
            <div className="detail-value">{data.ppk_jabatan}</div>
          </div>
        </div>
      </div>

      {/* Peserta + Dokumen */}
      <div className="card">
        <div className="card-header">
          <h3>Peserta ({peserta.length})</h3>
          {canEdit && (
            <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/sppd/${id}/edit`)}>
              Edit Peserta
            </button>
          )}
        </div>

        {peserta.length === 0 ? (
          <div className="empty-state"><p>Belum ada peserta.</p></div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nama / NIP</th>
                  <th>Status</th>
                  <th>Uang Harian</th>
                  <th>Transport</th>
                  <th>Tiket PP</th>
                  <th>Penginapan</th>
                  <th>Lainnya</th>
                  <th>Total</th>
                  {showCetak && (
                    <th className="no-print">Cetak</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {peserta.map((p, idx) => (
                  <tr key={p.id}>
                    <td>{idx + 1}</td>
                    <td>
                      <div className="font-bold">{p.nama}</div>
                      <div className="text-xs text-muted">{p.nip || "—"}</div>
                      {p.nomor_sppd && (
                        <div className="badge badge-info" style={{ fontSize: "0.65rem", marginTop: 2 }}>
                          {p.nomor_sppd}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-secondary">{p.status_kepegawaian}</span>
                    </td>
                    <td className="font-mono">
                      {formatRupiah(p.uang_harian_hari * p.uang_harian_satuan)}
                      <div className="text-xs text-muted">
                        {p.uang_harian_hari} hr × {formatRupiah(p.uang_harian_satuan)}
                      </div>
                    </td>
                    <td className="font-mono">{formatRupiah(p.transport)}</td>
                    <td className="font-mono">{formatRupiah(p.tiket_pp)}</td>
                    <td className="font-mono">
                      {formatRupiah(p.penginapan_malam * p.penginapan_satuan)}
                      <div className="text-xs text-muted">
                        {p.penginapan_malam} mlm × {formatRupiah(p.penginapan_satuan)}
                      </div>
                    </td>
                    <td className="font-mono">
                      {formatRupiah(p.honor_paket_meeting + p.representatif)}
                    </td>
                    <td className="font-bold font-mono">{formatRupiah(totalBiaya(p))}</td>
                    {showCetak && (
                      <td className="no-print">
                        <button
                          onClick={() => cetakPdf(p.id)}
                          className="btn btn-ghost btn-sm"
                        >
                          🖨 PDF
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="text-right mt-2">
          <span className="total-display">
            Total Biaya Keseluruhan: {formatRupiah(grandTotal)}
          </span>
        </div>
      </div>

      {/* Dokumen Pertanggungjawaban */}
      {(isDilaksanakan || isPertanggungjawaban || isDibayar) && (
        <div className="card">
          <div className="card-header">
            <h3>Dokumen Pertanggungjawaban</h3>
          </div>

          {/* Per Peserta: boarding_pass, kwitansi_hotel, sppd_cap */}
          {peserta.map((p) => (
            <div key={p.id} className="mb-2" style={{ borderBottom: peserta.length > 1 ? "1px solid var(--border)" : "none", paddingBottom: "0.75rem", marginBottom: "0.75rem" }}>
              <div className="font-bold mb-1" style={{ fontSize: "0.85rem" }}>{p.nama}</div>
              <div className="dokumen-grid">
                {dokumenPerPeserta.map((jenis) => {
                  const doc = getDokumen(jenis, p.id);
                  const canUpload = isDilaksanakan && (isOwner || isAdmin);
                  return (
                    <div key={jenis} className={`dokumen-item ${doc ? "dokumen-uploaded" : "dokumen-missing"}`}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="dokumen-label">
                          {DOKUMEN_JENIS_LABEL[jenis]}
                          {jenis === "sppd_cap" && <span style={{ color: "var(--danger)" }}> *</span>}
                        </div>
                        {doc ? (
                          <>
                            <div className="dokumen-filename" title={doc.nama_file}>{doc.nama_file}</div>
                            <div className="text-xs text-muted">{doc.uploaded_by_username}</div>
                          </>
                        ) : (
                          <div className="text-xs text-muted">Belum diupload</div>
                        )}
                      </div>
                      {doc && (
                        <>
                          <button onClick={() => viewFile(doc.id)}
                            className="btn btn-ghost btn-sm" title="Lihat">👁</button>
                          {canUpload && (
                            <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }}
                              onClick={() => setDeleteConfirm({ dokumenId: doc.id, namaFile: doc.nama_file })} title="Hapus">✕</button>
                          )}
                        </>
                      )}
                      {canUpload && (
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => setUploadModal({ jenis, pesertaId: p.id, pesertaNama: p.nama })}
                          title={doc ? "Ganti" : "Upload"}>
                          {doc ? "↻" : "↑"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Per SPPD: laporan_kegiatan */}
          <div className="mt-2" style={{ paddingTop: peserta.length > 0 ? "0.5rem" : "0" }}>
            <div className="font-bold mb-1" style={{ fontSize: "0.85rem" }}>Dokumen Kegiatan</div>
            <div className="dokumen-grid">
              {dokumenPerSppd.map((jenis) => {
                const doc = getDokumen(jenis, null);
                const canUpload = isDilaksanakan && (isOwner || isAdmin);
                return (
                  <div key={jenis} className={`dokumen-item ${doc ? "dokumen-uploaded" : "dokumen-missing"}`}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="dokumen-label">{DOKUMEN_JENIS_LABEL[jenis]}</div>
                      {doc ? (
                        <>
                          <div className="dokumen-filename" title={doc.nama_file}>{doc.nama_file}</div>
                          <div className="text-xs text-muted">{doc.uploaded_by_username}</div>
                        </>
                      ) : (
                        <div className="text-xs text-muted">Belum diupload</div>
                      )}
                    </div>
                    {doc && (
                      <>
                        <button onClick={() => viewFile(doc.id)}
                          className="btn btn-ghost btn-sm" title="Lihat">👁</button>
                        {canUpload && (
                          <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }}
                            onClick={() => setDeleteConfirm({ dokumenId: doc.id, namaFile: doc.nama_file })} title="Hapus">✕</button>
                        )}
                      </>
                    )}
                    {canUpload && (
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => setUploadModal({ jenis, pesertaId: null, pesertaNama: null })}
                        title={doc ? "Ganti" : "Upload"}>
                        {doc ? "↻" : "↑"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="text-xs text-muted mt-2">
            <span style={{ color: "var(--danger)" }}>*</span> SPPD Dicap wajib diupload untuk setiap peserta sebelum mengajukan pertanggungjawaban.
          </div>
        </div>
      )}

      {/* Approval History */}
      <ApprovalTimeline approvals={data.approvals} />

      {/* Upload Modal */}
      {uploadModal && (
        <div className="modal-backdrop" onClick={() => !uploadLoading && setUploadModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "440px" }}>
            <h3>
              Upload {DOKUMEN_JENIS_LABEL[uploadModal.jenis]}
              {uploadModal.pesertaNama ? ` — ${uploadModal.pesertaNama}` : ""}
            </h3>
            {uploadError && <div className="alert alert-error">{uploadError}</div>}
            <div className="form-group">
              <label>File (PDF atau gambar, max 10 MB)</label>
              <input type="file" className="form-control" accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => { setUploadFile(e.target.files?.[0] || null); setUploadError(null); }} />
            </div>
            <div className="btn-group" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="btn btn-secondary" disabled={uploadLoading}
                onClick={() => setUploadModal(null)}>Batal</button>
              <button className="btn btn-primary" disabled={uploadLoading || !uploadFile}
                onClick={handleUpload}>
                {uploadLoading ? "Mengupload..." : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Konfirmasi Modal */}
      {confirm && (
        <div className="modal-backdrop" onClick={() => { if (!actionLoading) setConfirm(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            {confirm.action === "submit" && (
              <>
                <h3>Ajukan SPPD?</h3>
                <p>SPPD ini akan diajukan ke admin untuk disetujui. Setelah diajukan, Anda tidak dapat mengubah data.</p>
                {peserta.length === 0 && (
                  <div className="alert alert-warning">Belum ada peserta. Harap tambahkan minimal 1 peserta.</div>
                )}
                <div className="btn-group" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
                  <button className="btn btn-secondary" disabled={actionLoading}
                    onClick={() => setConfirm(null)}>Batal</button>
                  <button className="btn btn-primary" disabled={actionLoading || peserta.length === 0}
                    onClick={() => doAction("submit")}>
                    {actionLoading ? "Mengirim..." : "Ya, Ajukan"}
                  </button>
                </div>
              </>
            )}

            {confirm.action === "approve" && (
              <>
                <h3>
                  {confirm.keputusan === "disetujui" ? "Setujui SPPD?"
                    : "Tolak SPPD?"}
                </h3>
                <p>
                  {confirm.keputusan === "disetujui" && "SPPD akan disetujui dan nomor SPPD akan otomatis dibuat."}
                  {confirm.keputusan === "ditolak" && "SPPD akan ditolak. Pemohon dapat membuat ulang SPPD baru."}
                </p>
                <div className="form-group">
                  <label>Catatan:</label>
                  <textarea className="form-control" rows={2}
                    value={catatan} onChange={(e) => setCatatan(e.target.value)}
                    placeholder={confirm.keputusan === "ditolak" ? "Alasan penolakan (wajib)" : "Opsional"} />
                </div>
                <div className="btn-group" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
                  <button className="btn btn-secondary" disabled={actionLoading}
                    onClick={() => { setConfirm(null); setCatatan(""); }}>Batal</button>
                  <button className={`btn ${confirm.keputusan === "disetujui" ? "btn-success" : "btn-danger"}`}
                    disabled={actionLoading || (confirm.keputusan === "ditolak" && !catatan.trim())}
                    onClick={() => doAction("approve", confirm.keputusan)}>
                    {actionLoading ? "Memproses..." : "Konfirmasi"}
                  </button>
                </div>
              </>
            )}

            {confirm.action === "delete" && (
              <>
                <h3>Hapus SPPD?</h3>
                <p>SPPD ini akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.</p>
                <div className="btn-group" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
                  <button className="btn btn-secondary" disabled={actionLoading}
                    onClick={() => setConfirm(null)}>Batal</button>
                  <button className="btn btn-danger" disabled={actionLoading}
                    onClick={() => doAction("delete")}>
                    {actionLoading ? "Menghapus..." : "Ya, Hapus"}
                  </button>
                </div>
              </>
            )}

            {confirm.action === "ajukan-pertanggungjawaban" && (
              <>
                <h3>Ajukan Pertanggungjawaban?</h3>
                <p>Pastikan semua SPPD Cap sudah diupload untuk setiap peserta. Setelah diajukan, admin bendahara akan memverifikasi dokumen.</p>
                <div className="btn-group" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
                  <button className="btn btn-secondary" disabled={actionLoading}
                    onClick={() => setConfirm(null)}>Batal</button>
                  <button className="btn btn-primary" disabled={actionLoading}
                    onClick={() => doAction("ajukan-pertanggungjawaban")}>
                    {actionLoading ? "Mengirim..." : "Ya, Ajukan"}
                  </button>
                </div>
              </>
            )}

            {confirm.action === "verifikasi-dokumen" && (
              <>
                <h3>
                  {confirm.keputusan === "dibayar" ? "Setujui & Bayar?"
                    : "Minta Revisi Dokumen?"}
                </h3>
                <p>
                  {confirm.keputusan === "dibayar" && "Dokumen dinyatakan lengkap dan dana akan dibayarkan. Status SPPD menjadi final."}
                  {confirm.keputusan === "revisi" && "Peserta/operator diminta merevisi dokumen yang kurang lengkap."}
                </p>
                <div className="form-group">
                  <label>Catatan{confirm.keputusan === "revisi" ? " (wajib)" : ""}:</label>
                  <textarea className="form-control" rows={2}
                    value={catatan} onChange={(e) => setCatatan(e.target.value)}
                    placeholder={confirm.keputusan === "revisi" ? "Dokumen mana yang perlu direvisi dan kenapa" : "Opsional"} />
                </div>
                <div className="btn-group" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
                  <button className="btn btn-secondary" disabled={actionLoading}
                    onClick={() => { setConfirm(null); setCatatan(""); }}>Batal</button>
                  <button className={`btn ${confirm.keputusan === "dibayar" ? "btn-success" : "btn-danger"}`}
                    disabled={actionLoading || (confirm.keputusan === "revisi" && !catatan.trim())}
                    onClick={() => doAction("verifikasi-dokumen", confirm.keputusan)}>
                    {actionLoading ? "Memproses..." : "Konfirmasi"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Hapus Dokumen Confirmation */}
      {deleteConfirm && (
        <div className="modal-backdrop" onClick={() => setDeleteConfirm(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "400px" }}>
            <h3>Hapus Dokumen?</h3>
            <p>
              File <strong>{deleteConfirm.namaFile}</strong> akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.
            </p>
            <div className="btn-group" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="btn btn-secondary"
                onClick={() => setDeleteConfirm(null)}>Batal</button>
              <button className="btn btn-danger"
                onClick={() => handleDeleteDokumen(deleteConfirm.dokumenId)}>
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
