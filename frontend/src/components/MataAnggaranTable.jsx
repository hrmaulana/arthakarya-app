import { useState } from "react";
import { useOutletContext } from "react-router-dom";

const emptyItem = { nama_item: "", jumlah_rp: "", keterangan: "" };

// Rupiah: terima "1000000" maupun "1.000.000" → integer; kosong/invalid → 0
export const parseRupiah = (s) => {
  const n = parseInt(String(s ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
};

// Key stabil per baris (bukan index) — focus & state aman saat baris di tengah dihapus
let uidCounter = 0;
const nextKey = () => ++uidCounter;

export default function MataAnggaranTable({ items = [], onChange, readOnly = false }) {
  const { formatRupiah } = useOutletContext();
  const [rows, setRows] = useState(() => {
    if (items.length === 0) return [{ ...emptyItem, key: nextKey() }];
    return items.map((it) => ({
      key: nextKey(),
      nama_item: it.nama_item || "",
      jumlah_rp: it.jumlah_rp !== undefined ? String(it.jumlah_rp) : "",
      keterangan: it.keterangan || "",
    }));
  });
  const [focusedIdx, setFocusedIdx] = useState(null);

  const updateRow = (index, field, value) => {
    const updated = rows.map((row, i) =>
      i === index ? { ...row, [field]: value } : row
    );
    setRows(updated);

    // Notify parent with cleaned data
    const cleaned = updated
      .filter((r) => r.nama_item.trim() !== "" || r.jumlah_rp !== "")
      .map((r) => ({
        nama_item: r.nama_item.trim(),
        jumlah_rp: parseRupiah(r.jumlah_rp),
        keterangan: r.keterangan.trim() || undefined,
      }));
    onChange(cleaned);
  };

  const addRow = () => {
    const updated = [...rows, { ...emptyItem, key: nextKey() }];
    setRows(updated);
  };

  const removeRow = (index) => {
    if (rows.length <= 1) return;
    const updated = rows.filter((_, i) => i !== index);
    setRows(updated);

    const cleaned = updated
      .filter((r) => r.nama_item.trim() !== "" || r.jumlah_rp !== "")
      .map((r) => ({
        nama_item: r.nama_item.trim(),
        jumlah_rp: parseRupiah(r.jumlah_rp),
        keterangan: r.keterangan.trim() || undefined,
      }));
    onChange(cleaned);
  };

  const total = rows.reduce((sum, r) => sum + parseRupiah(r.jumlah_rp), 0);

  // Kolom rupiah: mentah saat sedang diketik, terformat (pemisah ribuan) saat tidak fokus
  const jumlahDisplay = (row) =>
    row.jumlah_rp === "" ? "" : parseRupiah(row.jumlah_rp).toLocaleString("id-ID");

  return (
    <div>
      <div className="table-wrapper">
        <table className="table-sticky">
          <thead>
            <tr>
              <th scope="col">Nama Item</th>
              <th scope="col">Jumlah (Rp)</th>
              <th scope="col">Keterangan</th>
              {!readOnly && <th scope="col"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.key}>
                <td>
                  <input
                    type="text"
                    className="form-control"
                    value={row.nama_item}
                    onChange={(e) => updateRow(i, "nama_item", e.target.value)}
                    placeholder="Contoh: Konsumsi rapat"
                    disabled={readOnly}
                    aria-label={`Nama item baris ${i + 1}`}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="form-control"
                    value={focusedIdx === i ? row.jumlah_rp : jumlahDisplay(row)}
                    onChange={(e) => updateRow(i, "jumlah_rp", e.target.value)}
                    onFocus={() => setFocusedIdx(i)}
                    onBlur={() => setFocusedIdx(null)}
                    placeholder="0"
                    disabled={readOnly}
                    aria-label={`Jumlah rupiah baris ${i + 1}`}
                  />
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
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={readOnly ? 3 : 4} className="text-right">
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
