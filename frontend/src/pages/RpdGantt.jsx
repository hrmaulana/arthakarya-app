import { useState, useEffect, useRef, useCallback } from "react";
import useSse from "../hooks/useSse.js";
import { useOutletContext } from "react-router-dom";
import client from "../api/client.js";
import { parseDate } from "../lib/fmtDate.js";
import RpdCumulativeChart from "../components/RpdCumulativeChart.jsx";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

const STATUS_COLORS = {
  draft: { bg: "var(--surface-hover)", border: "var(--text-muted)" },
  diajukan: { bg: "var(--warning-subtle)", border: "var(--warning)" },
  disetujui: { bg: "var(--success-subtle)", border: "var(--success)" },
  ditolak: { bg: "var(--danger-subtle)", border: "var(--danger)" },
};

const STATUS_BADGE = {
  draft: "badge-draft",
  diajukan: "badge-diajukan",
  disetujui: "badge-disetujui",
  ditolak: "badge-ditolak",
};

const STATUS_LABEL = {
  draft: "Draf",
  diajukan: "Diajukan",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
};

export default function RpdGantt() {
  const [rpd, setRpd] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [tahun, setTahun] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [animated, setAnimated] = useState(false);
  const [rpdTarget, setRpdTarget] = useState({ months: [], units: [] });
  const [file, setFile] = useState(null);
  const [tahunImport, setTahunImport] = useState(tahun);
  const [periode, setPeriode] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [uploadErr, setUploadErr] = useState("");
  const fileInputRef = useRef(null);
  const [chartUnitId, setChartUnitId] = useState("total");
  const [chartMode, setChartMode] = useState("kumulatif"); // "kumulatif" | "bulanan"
  const [lastUpdated, setLastUpdated] = useState(null); // untuk indikator live
  const refreshingRef = useRef(false); // guard refetch ganda (in-flight)
  const sseTimerRef = useRef(null); // debounce 300 ms untuk event beruntun

  // Muat data RPD. Mode silent (refetch SSE) tidak menyetel loading/error
  // maupun animasi masuk — hanya memperbarui data + lastUpdated.
  const loadData = useCallback(async (tahunSel, opts = {}) => {
    const silent = !!opts.silent;
    if (!silent) {
      setLoading(true);
      setAnimated(false);
    }
    try {
      const [rpdRes, tlRes, rpdTargetRes] = await Promise.all([
        client.get(`/rekap/rpd-bulanan?tahun=${tahunSel}`),
        client.get("/rekap/timeline"),
        client.get(`/rekap/rpd-target?tahun=${tahunSel}`),
      ]);
      setRpd(rpdRes.data.data);
      setTahun(rpdRes.data.tahun);
      setTimeline(tlRes.data.data);
      setRpdTarget(rpdTargetRes.data.data);
      setLastUpdated(new Date());
      if (!silent) setTimeout(() => setAnimated(true), 80);
    } catch (err) {
      if (!silent) setError(err.response?.data?.error || "Gagal memuat data.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(tahun);
  }, [tahun, loadData]);

  useEffect(() => {
    setTahunImport(tahun);
  }, [tahun]);

  const handleImport = async (e) => {
    e.preventDefault();
    if (!file) {
      setUploadErr("Pilih file Excel (.xlsx) terlebih dahulu.");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("tahun", String(tahunImport));
    if (periode.trim()) formData.append("periode", periode.trim());

    setUploading(true);
    setUploadErr("");
    setUploadMsg("");
    try {
      const res = await client.post("/rekap/rpd-target/import", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setUploadMsg(res.data.message);
      setFile(null);
      setPeriode("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      const rpdTargetRes = await client.get(`/rekap/rpd-target?tahun=${tahunImport}`);
      setRpdTarget(rpdTargetRes.data.data);
      setTahun(tahunImport);
    } catch (err) {
      setUploadErr(err.response?.data?.error || "Gagal mengimpor file.");
    } finally {
      setUploading(false);
    }
  };

  const { formatRupiah, user } = useOutletContext();

  // Live refresh: dengarkan event SSE; refetch silent saat data berubah.
  // Guard in-flight mencegah tumpukan request; debounce 300 ms menggabung
  // event beruntun (mis. admin mengimpor sendiri → refetch manual + SSE).
  const sseToken = typeof localStorage !== "undefined" ? localStorage.getItem("token") || "" : "";
  useSse(`/api/rekap/events?token=${sseToken}`, () => {
    if (document.hidden) return; // tab tak terlihat — hemat; refetch saat kembali
    if (refreshingRef.current) return;
    clearTimeout(sseTimerRef.current);
    sseTimerRef.current = setTimeout(() => {
      refreshingRef.current = true;
      loadData(tahun, { silent: true }).finally(() => {
        refreshingRef.current = false;
      });
    }, 300);
  });

  // Saat tab kembali terlihat — segarkan sekali (silent).
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      loadData(tahun, { silent: true }).finally(() => {
        refreshingRef.current = false;
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [tahun, loadData]);

  const isAdmin = user?.role === "admin";

  // Seri bar chart RPD: "bulanan" = total per bulan; "kumulatif" = total berjalan
  // (running sum). Jumlah kegiatan ikut diakumulasi pada mode kumulatif.
  let runningAnggaran = 0;
  let runningKegiatan = 0;
  const rpdSeries = rpd.map((d) => {
    if (chartMode !== "kumulatif") return d;
    runningAnggaran += Number(d.total_anggaran) || 0;
    runningKegiatan += Number(d.jumlah_kegiatan) || 0;
    return { ...d, total_anggaran: runningAnggaran, jumlah_kegiatan: runningKegiatan };
  });
  const maxRpd = Math.max(...rpdSeries.map((d) => Number(d.total_anggaran)), 1);

  // Group timeline by month
  const byMonth = {};
  timeline.forEach((k) => {
    const m = parseDate(k.tanggal).getMonth(); // 0-11
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(k);
  });

  // Seri total "Semua Unit": jumlahkan nilai bulanan (target/kegiatan) DAN nilai
  // berjalan (target_kum/kegiatan_kum) per bulan — dibutuhkan kedua mode grafik.
  const chartTotal = rpdTarget.months.map((bulan) => {
    let target = 0;
    let kegiatan = 0;
    let target_kum = 0;
    let kegiatan_kum = 0;
    for (const u of rpdTarget.units) {
      const d = u.months.find((x) => x.bulan === bulan);
      if (!d) continue;
      target += d.target || 0;
      kegiatan += d.kegiatan || 0;
      target_kum += d.target_kum || 0;
      kegiatan_kum += d.kegiatan_kum || 0;
    }
    return {
      bulan,
      target,
      kegiatan,
      target_kum,
      kegiatan_kum,
      selisih: target_kum - kegiatan_kum,
    };
  });
  const chartUnit =
    chartUnitId === "total"
      ? { unit_kerja_id: "total", nama_unit: "Semua Unit", months: chartTotal }
      : rpdTarget.units.find((u) => u.unit_kerja_id === chartUnitId) || null;

  if (loading)
    return <div className="empty-state"><p>Memuat data RPD & Timeline...</p></div>;
  if (error)
    return <div className="alert alert-error">{error}</div>;

  return (
    <div>
      <div className="page-header">
        <h2>RPD & Timeline Anggaran</h2>
        {lastUpdated && (
          <span className="badge badge-live" title="Data diperbarui otomatis saat ada perubahan">
            <span className="live-dot" />Live · {lastUpdated.toLocaleTimeString("id-ID")}
          </span>
        )}
        <div className="btn-group" role="group" aria-label="Mode tampilan grafik">
          <button
            type="button"
            className={`btn btn-sm ${chartMode === "kumulatif" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setChartMode("kumulatif")}
          >
            Kumulatif
          </button>
          <button
            type="button"
            className={`btn btn-sm ${chartMode === "bulanan" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setChartMode("bulanan")}
          >
            Bulanan
          </button>
        </div>
        <div className="btn-group">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setTahun((y) => y - 1)}
          >
            ← {tahun - 1}
          </button>
          <span style={{ fontWeight: 700, fontSize: "0.95rem", padding: "0.3rem 0.5rem" }}>
            {tahun}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setTahun((y) => y + 1)}
          >
            {tahun + 1} →
          </button>
        </div>
      </div>

      {/* === RPD — Rencana Penarikan Dana Bulanan === */}
      <div className="card">
        <div className="card-header">
          <h3>
            {chartMode === "kumulatif"
              ? "Rencana Penarikan Dana Kumulatif"
              : "Rencana Penarikan Dana Bulanan"}{" "}
            ({tahun})
          </h3>
        </div>
        {rpd.length === 0 ? (
          <p className="text-muted">Belum ada data RPD untuk tahun {tahun}.</p>
        ) : (
        <div className="bar-chart">
          {rpdSeries.map((d, i) => {
            const width = animated
              ? (Number(d.total_anggaran) / maxRpd) * 100
              : 0;
            return (
              <div className="bar-row" key={d.bulan}>
                <div className="bar-label">{d.nama_bulan}</div>
                <div className="bar-track">
                  <div
                    className="bar-fill indigo"
                    style={{ width: `${width}%` }}
                  />
                  {d.jumlah_kegiatan > 0 && (
                    <span
                      style={{
                        position: "absolute",
                        left: `${Math.min(width + 1, 96)}%`,
                        top: "50%",
                        transform: "translateY(-50%)",
                        fontSize: "0.7rem",
                        color: "var(--text-muted)",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        maxWidth: "34%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {d.jumlah_kegiatan} kegiatan
                    </span>
                  )}
                </div>
                <div className="bar-value">
                  {d.total_anggaran > 0 ? formatRupiah(d.total_anggaran) : "—"}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* === Target RPD Bulanan per Unit === */}
      {isAdmin && (
        <div className="card no-print" style={{ border: "1px solid var(--surface-hover)", marginBottom: "1.5rem" }}>
          <div className="card-header">
            <h3>Import Target RPD Bulanan (Excel)</h3>
          </div>
          <form onSubmit={handleImport}>
            <div className="form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label>File Excel (.xlsx)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="form-control"
                  accept=".xlsx"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Tahun</label>
                <input
                  type="number"
                  className="form-control"
                  min={2000}
                  max={2100}
                  value={tahunImport}
                  onChange={(e) => setTahunImport(Number(e.target.value))}
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Periode (opsional)</label>
                <input
                  type="text"
                  className="form-control"
                  value={periode}
                  onChange={(e) => setPeriode(e.target.value)}
                  placeholder="mis. Target per Agustus 2026"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <button type="submit" className="btn btn-primary" disabled={uploading}>
                  {uploading ? "Mengimpor..." : "⏫ Import"}
                </button>
              </div>
            </div>
            <p className="text-muted" style={{ marginTop: "0.6rem", marginBottom: 0, fontSize: "0.8rem" }}>
              Format: baris pertama = header bulan, kolom pertama = unit kerja (Sesdep, PEMPMP, dst).
              Upload baru menggantikan data tampilan; riwayat upload lama tetap tersimpan.
            </p>
          </form>
          {uploadMsg && (
            <div className="alert alert-success" style={{ marginTop: "1rem", marginBottom: 0 }}>
              {uploadMsg}
            </div>
          )}
          {uploadErr && (
            <div className="alert alert-error" style={{ marginTop: "1rem", marginBottom: 0 }}>
              {uploadErr}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h3>Target RPD Bulanan per Unit ({tahun})</h3>
          {rpdTarget.units.length > 0 && (
            <span className="text-muted">{rpdTarget.months.length} bulan</span>
          )}
        </div>
        {rpdTarget.units.length === 0 ? (
          <p className="text-muted">Belum ada target RPD. Upload Excel dulu.</p>
        ) : (
          <div className="table-wrapper">
            <table className="table-sticky">
              <thead>
                <tr>
                  <th scope="col">Unit Kerja</th>
                  {rpdTarget.months.map((m) => (
                    <th key={m} scope="col" className="text-right">
                      {MONTHS[m - 1]}
                    </th>
                  ))}
                  <th scope="col" className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rpdTarget.units.map((u) => (
                  <tr key={u.unit_kerja_id}>
                    <td><strong>{u.nama_unit}</strong></td>
                    {u.months.map((d) => (
                      <td key={d.bulan} className="text-right font-mono">
                        {d.target > 0 ? formatRupiah(d.target) : "—"}
                      </td>
                    ))}
                    <td className="text-right font-mono">
                      <strong>{formatRupiah(u.months.reduce((s, d) => s + d.target, 0))}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>Total</strong></td>
                  {rpdTarget.months.map((m) => {
                    const sum = rpdTarget.units.reduce((s, u) => {
                      const d = u.months.find((x) => x.bulan === m);
                      return s + (d ? d.target : 0);
                    }, 0);
                    return (
                      <td key={m} className="text-right font-mono">
                        <strong>{sum > 0 ? formatRupiah(sum) : "—"}</strong>
                      </td>
                    );
                  })}
                  <td className="text-right font-mono">
                    <strong>
                      {formatRupiah(
                        rpdTarget.units.reduce(
                          (s, u) => s + u.months.reduce((t, d) => t + d.target, 0),
                          0
                        )
                      )}
                    </strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {rpdTarget.units.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3>
              {chartMode === "kumulatif"
                ? `Grafik Kumulatif Target vs Kegiatan (${tahun})`
                : `Grafik Target vs Kegiatan per Bulan (${tahun})`}
            </h3>
          </div>
          <div className="page-content" style={{ padding: "0 1.25rem 1.25rem" }}>
            <div className="btn-group" style={{ flexWrap: "wrap", rowGap: "0.35rem", marginBottom: "0.9rem" }}>
              <button
                type="button"
                className={`btn btn-sm ${chartUnitId === "total" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setChartUnitId("total")}
              >
                Semua Unit
              </button>
              {rpdTarget.units.map((u) => (
                <button
                  key={u.unit_kerja_id}
                  type="button"
                  className={`btn btn-sm ${chartUnitId === u.unit_kerja_id ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setChartUnitId(u.unit_kerja_id)}
                >
                  {u.nama_unit}
                </button>
              ))}
            </div>
            {chartUnit ? (
              <RpdCumulativeChart unit={chartUnit} formatRupiah={formatRupiah} mode={chartMode} />
            ) : (
              <p className="text-muted">Pilih unit kerja untuk melihat grafik.</p>
            )}
          </div>
        </div>
      )}

      {rpdTarget.units.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3>Perbandingan Kumulatif Target vs Kegiatan</h3>
            <span className="text-muted">selisih = target kum. − kegiatan kum.</span>
          </div>
          <div className="page-content">
            {rpdTarget.units.map((u) => (
              <div key={u.unit_kerja_id} style={{ marginBottom: "1.5rem" }}>
                <h4 style={{ marginTop: 0 }}>{u.nama_unit}</h4>
                <div className="table-wrapper">
                  <table className="table-sticky">
                    <thead>
                      <tr>
                        <th scope="col">Bulan</th>
                        <th scope="col" className="text-right">Target</th>
                        <th scope="col" className="text-right">Target Kum.</th>
                        <th scope="col" className="text-right">Kegiatan</th>
                        <th scope="col" className="text-right">Kegiatan Kum.</th>
                        <th scope="col" className="text-right">Selisih</th>
                      </tr>
                    </thead>
                    <tbody>
                      {u.months.map((d) => (
                        <tr key={d.bulan}>
                          <td>
                            <strong>{MONTHS[d.bulan - 1]} {tahun}</strong>
                          </td>
                          <td className="text-right font-mono">
                            {d.target > 0 ? formatRupiah(d.target) : "—"}
                          </td>
                          <td className="text-right font-mono">{formatRupiah(d.target_kum)}</td>
                          <td className="text-right font-mono">
                            {d.kegiatan > 0 ? formatRupiah(d.kegiatan) : "—"}
                          </td>
                          <td className="text-right font-mono">{formatRupiah(d.kegiatan_kum)}</td>
                          <td className={`text-right font-mono ${d.selisih < 0 ? "level-low" : ""}`}>
                            {formatRupiah(d.selisih)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === Gantt Timeline === */}
      <div className="card">
        <div className="card-header">
          <h3>Gantt Timeline Kegiatan</h3>
          <span className="text-muted">
            {timeline.length} kegiatan
          </span>
        </div>

        {timeline.length === 0 ? (
          <p className="text-muted">Belum ada kegiatan.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            {/* Month header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "220px repeat(12, 1fr)",
                gap: "2px",
                marginBottom: "4px",
              }}
            >
              <div />
              {MONTHS.map((m, i) => {
                const hasData = byMonth[i] && byMonth[i].length > 0;
                return (
                  <div
                    key={m}
                    style={{
                      textAlign: "center",
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      color: hasData ? "var(--primary)" : "var(--text-muted)",
                      padding: "0.3rem 0",
                      background: hasData ? "var(--primary-subtle)" : "transparent",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    {m}
                  </div>
                );
              })}
            </div>

            {/* Activity rows */}
            {timeline.map((k) => {
              const m = parseDate(k.tanggal).getMonth();
              const colors = STATUS_COLORS[k.status] || STATUS_COLORS.draft;
              return (
                <div
                  key={k.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "220px repeat(12, 1fr)",
                    gap: "2px",
                    marginBottom: "2px",
                    alignItems: "center",
                  }}
                >
                  {/* Label */}
                  <div
                    style={{
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      paddingRight: "0.5rem",
                    }}
                    title={`${k.nama_kegiatan} — ${k.unit_kerja_nama} — ${formatRupiah(k.total_anggaran)}`}
                  >
                    {k.nama_kegiatan}
                    <span style={{ display: "block", fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 400 }}>
                      {k.unit_kerja_nama}
                    </span>
                  </div>

                  {/* Month cells */}
                  {MONTHS.map((_, i) => (
                    <div
                      key={i}
                      style={{
                        height: "34px",
                        background:
                          i === m ? colors.bg : "transparent",
                        borderRadius: i === m ? "var(--radius-sm)" : "0",
                        border:
                          i === m
                            ? `1.5px solid ${colors.border}`
                            : "1px solid transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.15s",
                      }}
                      aria-label={
                        i === m
                          ? `${k.nama_kegiatan}, ${MONTHS[i]} ${tahun}, status ${STATUS_LABEL[k.status] || k.status}, ${formatRupiah(k.total_anggaran)}`
                          : undefined
                      }
                      title={
                        i === m
                          ? `${k.nama_kegiatan}\n${formatRupiah(k.total_anggaran)}\nStatus: ${STATUS_LABEL[k.status] || k.status}`
                          : ""
                      }
                    >
                      {i === m && (
                        <span
                          aria-hidden="true"
                          style={{
                            fontSize: "0.65rem",
                            fontWeight: 700,
                            color: colors.border,
                          }}
                        >
                          {formatRupiah(k.total_anggaran)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Legend — badge berlabel (status tidak lagi warna-saja) */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "1rem" }}>
          {Object.entries(STATUS_LABEL).map(([status, label]) => (
            <span key={status} className={`badge ${STATUS_BADGE[status] || "badge-draft"}`}>
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* === Summary Table === */}
      <div className="card">
        <div className="card-header">
          <h3>Ringkasan Kegiatan per Bulan</h3>
        </div>
        <div className="table-wrapper">
          <table className="table-sticky">
            <thead>
              <tr>
                <th scope="col">Bulan</th>
                <th scope="col">Jumlah Kegiatan</th>
                <th scope="col" className="text-right">Total Anggaran</th>
              </tr>
            </thead>
            <tbody>
              {rpd.map((d) => (
                <tr key={d.bulan}>
                  <td>
                    <strong>{d.nama_bulan}</strong>
                  </td>
                  <td>{d.jumlah_kegiatan}</td>
                  <td className="text-right">
                    {d.total_anggaran > 0
                      ? formatRupiah(d.total_anggaran)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>TOTAL {tahun}</strong></td>
                <td>
                  <strong>{rpd.reduce((s, d) => s + d.jumlah_kegiatan, 0)}</strong>
                </td>
                <td className="text-right">
                  <strong>
                    {formatRupiah(rpd.reduce((s, d) => s + Number(d.total_anggaran), 0))}
                  </strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
