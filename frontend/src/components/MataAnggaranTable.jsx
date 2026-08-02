import { useState } from "react";

const emptyItem = { nama_item: "", jumlah_rp: "", keterangan: "" };

export default function MataAnggaranTable({ items = [], onChange, readOnly = false }) {
  const [rows, setRows] = useState(() => {
    if (items.length === 0) return [{ ...emptyItem }];
    return items.map((it) => ({
      nama_item: it.nama_item || "",
      jumlah_rp: it.jumlah_rp !== undefined ? String(it.jumlah_rp) : "",
      keterangan: it.keterangan || "",
    }));
  });

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
        jumlah_rp: r.jumlah_rp === "" ? 0 : parseInt(r.jumlah_rp, 10),
        keterangan: r.keterangan.trim() || undefined,
      }));
    onChange(cleaned);
  };

  const addRow = () => {
    const updated = [...rows, { ...emptyItem }];
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
        jumlah_rp: r.jumlah_rp === "" ? 0 : parseInt(r.jumlah_rp, 10),
        keterangan: r.keterangan.trim() || undefined,
      }));
    onChange(cleaned);
  };

  const total = rows.reduce((sum, r) => {
    const val = parseInt(r.jumlah_rp, 10);
    return sum + (isNaN(val) ? 0 : val);
  }, 0);

  const formatRupiah = (n) =>
    new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(n);

  return (
    <div>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th style={{ width: "40%" }}>Nama Item</th>
              <th style={{ width: "20%" }}>Jumlah (Rp)</th>
              <th style={{ width: "30%" }}>Keterangan</th>
              {!readOnly && <th style={{ width: "60px" }}></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td>
                  <input
                    type="text"
                    className="form-control"
                    value={row.nama_item}
                    onChange={(e) => updateRow(i, "nama_item", e.target.value)}
                    placeholder="Contoh: Konsumsi rapat"
                    disabled={readOnly}
                    style={{ width: "100%" }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="form-control"
                    value={row.jumlah_rp}
                    onChange={(e) => updateRow(i, "jumlah_rp", e.target.value)}
                    placeholder="0"
                    min="0"
                    disabled={readOnly}
                    style={{ width: "100%" }}
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
                    style={{ width: "100%" }}
                  />
                </td>
                {!readOnly && (
                  <td>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => removeRow(i)}
                      title="Hapus baris"
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
