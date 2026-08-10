import { useState, useEffect } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { sppdApi } from "../lib/sppdApi.js";

const STATUS_LABEL = {
  draft: "Draft",
  diajukan: "Menunggu Persetujuan",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
  dibayar: "Dibayar",
};

const STATUS_KEPEGAWAIAN = ["PNS", "PPPK", "PPNPN", "Konsultan"];

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
  const items = [...approvals].reverse(); // oldest first

  return (
    <div className="card">
      <div className="card-header"><h3>Riwayat Approval</h3></div>
      <div style={{ padding: "0 0.5rem" }}>
        {items.map((a) => (
          <div key={a.id} className="timeline-item">
            <div className="timeline-badge">
              <span className={`badge badge-${a.keputusan}`}>
                {STATUS_LABEL[a.keputusan] || a.keputusan}
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
  const [confirm, setConfirm] = useState(null); // { action, keputusan? }
  const [catatan, setCatatan] = useState("");

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
      await fetchDetail();
      setConfirm(null);
      setCatatan("");
    } catch (err) {
      setError(err.response?.data?.error || `Gagal ${action}.`);
    } finally {
      setActionLoading(false);
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

  const peserta = data.peserta || [];
  const grandTotal = peserta.reduce((sum, p) => sum + totalBiaya(p), 0);

  return (
    <div className="form-narrow" style={{ maxWidth: "960px" }}>
      <div className="page-header">
        <div>
          <h2>{data.nama_kegiatan}</h2>
          <span className={`badge badge-${data.status}`} style={{ marginTop: 4, display: "inline-block" }}>
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
            {confirm?.action === "approve" && (
              <div style={{ width: "100%" }}>
                <label className="form-label">
                  Catatan{alert?.keputusan === "ditolak" ? " (wajib)" : ""}:
                </label>
                <textarea className="form-control" rows={2}
                  value={catatan}
                  onChange={(e) => setCatatan(e.target.value)}
                  placeholder="Opsional, kecuali menolak..." />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mark as Paid */}
      {isDisetujui && isAdmin && (
        <div className="card" style={{ borderLeft: "3px solid var(--info)" }}>
          <div className="card-header"><h3>Tandai Dibayar</h3></div>
          <button className="btn btn-primary"
            disabled={actionLoading}
            onClick={() => setConfirm({ action: "approve", keputusan: "dibayar" })}>
            💰 Tandai Sudah Dibayar
          </button>
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
              {new Date(data.tanggal_berangkat + "T00:00:00").toLocaleDateString("id-ID", {
                day: "numeric", month: "long", year: "numeric",
              })}
            </div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Tanggal Pulang</div>
            <div className="detail-value">
              {new Date(data.tanggal_pulang + "T00:00:00").toLocaleDateString("id-ID", {
                day: "numeric", month: "long", year: "numeric",
              })}
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
              {data.tanggal_surat
                ? new Date(data.tanggal_surat + "T00:00:00").toLocaleDateString("id-ID", {
                    day: "numeric", month: "long", year: "numeric",
                  })
                : "—"}
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

      {/* Peserta */}
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
                  {(data.status === "disetujui" || data.status === "dibayar") && (
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
                    {(data.status === "disetujui" || data.status === "dibayar") && (
                      <td className="no-print">
                        <a
                          href={sppdApi.cetakUrl(id, p.id)}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-ghost btn-sm"
                        >
                          🖨 PDF
                        </a>
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

      {/* Approval History */}
      <ApprovalTimeline approvals={data.approvals} />

      {/* Konfirmasi Modal */}
      {confirm && (
        <div className="modal-backdrop" onClick={() => { if (!actionLoading) setConfirm(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            {confirm.action === "submit" && (
              <>
                <h3>Ajukan SPPD?</h3>
                <p>
                  SPPD ini akan diajukan ke admin untuk disetujui. Setelah diajukan,
                  Anda tidak dapat mengubah data.
                </p>
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
                    : confirm.keputusan === "ditolak" ? "Tolak SPPD?"
                    : "Tandai Sudah Dibayar?"}
                </h3>
                <p>
                  {confirm.keputusan === "disetujui" && "SPPD akan disetujui dan nomor SPPD akan otomatis dibuat."}
                  {confirm.keputusan === "ditolak" && "SPPD akan ditolak. Pemohon dapat membuat ulang SPPD baru."}
                  {confirm.keputusan === "dibayar" && "Tandai bahwa dana SPPD ini sudah dibayarkan."}
                </p>
                <div className="form-group">
                  <label>Catatan:</label>
                  <textarea className="form-control" rows={2}
                    value={catatan} onChange={(e) => setCatatan(e.target.value)}
                    placeholder={confirm.keputusan === "ditolak" ? "Alasan penolakan (wajib)" : "Opsional"} />
                </div>
                <div className="btn-group" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
                  <button className="btn btn-secondary" disabled={actionLoading}
                    onClick={() => { setConfirm(null); setCatatan(""); }}>
                    Batal
                  </button>
                  <button className={`btn ${confirm.keputusan === "disetujui" ? "btn-success" : confirm.keputusan === "ditolak" ? "btn-danger" : "btn-primary"}`}
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
          </div>
        </div>
      )}
    </div>
  );
}
