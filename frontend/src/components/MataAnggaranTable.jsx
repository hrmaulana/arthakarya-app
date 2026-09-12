import { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import client from "../api/client.js";
import AkunCombobox from "./AkunCombobox.jsx";

const emptyItem = { kode_akun: "", nama_item: "", jumlah_rp: "", keterangan: "" };

// Rupiah: terima "1000000" maupun "1.000.000" → integer; kosong/invalid → 0
export const parseRupiah = (s) => {
  const n = parseInt(String(s ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
};

// Key stabil per baris (bukan index) — focus & state aman saat baris di tengah dihapus
let uidCounter = 0;
const nextKey = () => ++uidCounter;

export default function MataAnggaranTable({
  items = [],
  onChange,
  readOnly = false,
  unitKerjaId,
  excludeKegiatanId,
  onAkunListReady,
}) {
  const { formatRupiah } = useOutletContext();
  const [akunList, setAkunList] = useState([]);
  const [showZeroSisa, setShowZeroSisa] = useState(false);

  // Filter: sembunyikan akun dengan sisa = 0 (default)
  const comboboxAkunList = showZeroSisa
    ? akunList
    : akunList.filter((a) => a.sisa_pagu > 0);

  // Level sisa pagu
  const sisaLevel = (akun) => {
    if (!akun || akun.pagu_revisi == null || akun.pagu_revisi === 0) return "low";
    const pct = (akun.sisa_pagu / akun.pagu_revisi) * 100;
    if (pct > 50) return "high";
    if (pct >= 10) return "mid";
    return "low";
  };

  useEffect(() => {
    if (!unitKerjaId) return;
    const params = new URLSearchParams({ unit_kerja_id: unitKerjaId });
    if (excludeKegiatanId) params.set("exclude_kegiatan_id", excludeKegiatanId);
    client
      .get(`/reference/akun?${params.toString()}`)
      .then((res) => {
        const data = res.data.data || [];
        setAkunList(data);
        if (onAkunListReady) onAkunListReady(data);
      })
      .catch(() => {
        setAkunList([]);
        if (onAkunListReady) onAkunListReady([]);
      });
  }, [unitKerjaId, excludeKegiatanId, onAkunListReady]);

  const [rows, setRows] = useState(() => {
    if (items.length === 0) return [{ ...emptyItem, key: nextKey() }];
    return items.map((it) => ({
      key: nextKey(),
      kode_akun: it.kode_akun || "",
      nama_item: it.nama_item || "",
      jumlah_rp: it.jumlah_rp !== undefined ? String(it.jumlah_rp) : "",
      keterangan: it.keterangan || "",
    }));
  });
  const [focusedIdx, setFocusedIdx] = useState(null);

  const toPayload = (rs) =>
    rs
      .filter((r) => r.kode_akun.trim() !== "" || r.jumlah_rp !== "")
      .map((r) => ({
        kode_akun: r.kode_akun.trim(),
        jumlah_rp: parseRupiah(r.jumlah_rp),
        keterangan: r.keterangan.trim() || undefined,
      }));

  const notify = (updated) => onChange(toPayload(updated));

  const updateRow = (index, field, value) => {
    const updated = rows.map((row, i) =>
      i === index ? { ...row, [field]: value } : row
    );
    setRows(updated);
    notify(updated);
  };

  const addRow = () => {
    const updated = [...rows, { ...emptyItem, key: nextKey() }];
    setRows(updated);
  };

  const removeRow = (index) => {
    if (rows.length <= 1) return;
    const updated = rows.filter((_, i) => i !== index);
    setRows(updated);
    notify(updated);
  };

  const selectAkun = (index, akun) => {
    const updated = rows.map((row, i) =>
      i === index
        ? {
            ...row,
            kode_akun: akun?.kode_akun || "",
            nama_item: akun?.nama_akun || "",
          }
        : row
    );
    setRows(updated);
    notify(updated);
  };

  const total = rows.reduce((sum, r) => sum + parseRupiah(r.jumlah_rp), 0);

  // Kolom rupiah: mentah saat sedang diketik, terformat (pemisah ribuan) saat tidak fokus
  const jumlahDisplay = (row) =>
    row.jumlah_rp === "" ? "" : parseRupiah(row.jumlah_rp).toLocaleString("id-ID");

  return (
    <div>
      {!readOnly && akunList.length === 0 && unitKerjaId && (
        <div className="alert alert-warning mb-2">
          Belum ada data monitoring untuk unit kerja ini. Import Excel SAKTI dulu di halaman Monitoring Anggaran.
        </div>
      )}
      {!readOnly && !unitKerjaId && (
        <div className="alert alert-warning mb-2">
          Pilih unit kerja terlebih dahulu untuk menampilkan daftar kode akun.
        </div>
      )}
      {!readOnly && akunList.length > 0 && (
        <label className="checkbox-inline mb-2" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.85rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showZeroSisa}
            onChange={(e) => setShowZeroSisa(e.target.checked)}
          />
          Tampilkan akun dengan sisa=0
        </label>
      )}
      <div className="table-wrapper">
        <table className="table-sticky">
          <thead>
            <tr>
              <th scope="col">Kode Akun</th>
              <th scope="col">Sisa Pagu</th>
              <th scope="col">Jumlah (Rp)</th>
              <th scope="col">Keterangan</th>
              {!readOnly && <th scope="col"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const akun = akunList.find(a => a.kode_akun === row.kode_akun);
              const isOver = !!akun && parseRupiah(row.jumlah_rp) > akun.sisa_pagu;
              return (
              <tr key={row.key}>
                <td>
                  {!readOnly && row.kode_akun === "" && row.nama_item !== "" && (
                    <div className="badge badge-warning" style={{ marginBottom: 4 }}>
                      Item lama: {row.nama_item} — pilih ulang kode akun
                    </div>
                  )}
                  <AkunCombobox
                    akunList={comboboxAkunList}
                    selected={row.kode_akun ? { kode_akun: row.kode_akun, nama_akun: row.nama_item } : null}
                    onChange={(akun) => selectAkun(i, akun)}
                    readOnly={readOnly}
                    displayText={row.kode_akun ? undefined : row.nama_item}
                  />
                </td>
                <td>
                  {akun ? (
                    <span className={`akun-sisa sisa-${sisaLevel(akun)}`}>
                      {formatRupiah(akun.sisa_pagu)}
                    </span>
                  ) : (
                    <span className="akun-sisa text-muted">—</span>
                  )}
                </td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      className={`form-control${isOver && !readOnly ? " is-over" : ""}`}
                      value={focusedIdx === i ? row.jumlah_rp : jumlahDisplay(row)}
                      onChange={(e) => updateRow(i, "jumlah_rp", e.target.value)}
                      onFocus={() => setFocusedIdx(i)}
                      onBlur={() => setFocusedIdx(null)}
                      placeholder="0"
                      disabled={readOnly}
                      style={{ flex: 1 }}
                      aria-label={`Jumlah rupiah baris ${i + 1}`}
                    />
                    {!readOnly && akun && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => updateRow(i, "jumlah_rp", String(akun.sisa_pagu))}
                        title={`Isi dengan sisa pagu: Rp ${formatRupiah(akun.sisa_pagu)}`}
                        style={{ whiteSpace: "nowrap", fontSize: "0.7rem", padding: "2px 6px" }}
                      >
                        Isi Sisa
                      </button>
                    )}
                  </div>
                  {isOver && !readOnly && (
                    <div
                      className="badge badge-warning mt-1"
                      style={{ fontSize: "0.65rem", whiteSpace: "normal" }}
                    >
                      Melebihi sisa pagu (Rp {formatRupiah(akun.sisa_pagu)})
                    </div>
                  )}
                </td>
                <td>
                  <input
                    type="text"
                    className="form-control"
                    value={row.keterangan}
                    onChange={(e) => updateRow(i, "keterangan", e.target.value)}
                    placeholder="Opsional"
                    disabled={readOnly}
                    aria-label={`Keterangan baris ${i + 1}`}
                  />
                </td>
                {!readOnly && (
                  <td>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => removeRow(i)}
                      title="Hapus baris"
                      aria-label={`Hapus baris ${i + 1}`}
                    >
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            );})}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={readOnly ? 4 : 5} className="text-right">
                <span className="total-display">
                  Total: {formatRupiah(total)}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!readOnly && (
        <button
          type="button"
          className="btn btn-secondary btn-sm mt-2"
          onClick={addRow}
        >
          + Tambah Item
        </button>
      )}
    </div>
  );
}
