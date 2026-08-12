import { useState, useRef, useEffect } from "react";

export default function AkunCombobox({
  akunList = [],
  selected,
  onChange,
  readOnly = false,
  displayText,
  placeholder = "Pilih kode akun…",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const rootRef = useRef(null);

  const q = query.trim().toLowerCase();
  const filtered = q === ""
    ? akunList
    : akunList.filter(
        (a) =>
          `${a.kode_akun} ${a.nama_akun}`.toLowerCase().includes(q)
      );

  // Tutup saat klik di luar komponen
  useEffect(() => {
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => setHighlightIdx(0), [query]);

  if (readOnly) {
    return (
      <span className="akun-display">
        {selected
          ? <><strong>{selected.kode_akun}</strong> {selected.nama_akun}</>
          : (displayText || "—")}
      </span>
    );
  }

  const inputValue = open
    ? query
    : selected
    ? `${selected.kode_akun} — ${selected.nama_akun}`
    : "";

  return (
    <div className="combobox" ref={rootRef}>
      <input
        type="text"
        className="form-control"
        value={inputValue}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onChange(null); // pilihan lama dianggap kosong sampai dipilih ulang
        }}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlightIdx((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlightIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (filtered[highlightIdx]) {
              onChange(filtered[highlightIdx]);
              setOpen(false);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        aria-label="Pilih kode akun"
      />
      {open && (
        <ul className="combobox-menu">
          {filtered.map((a, i) => (
            <li
              key={a.kode_akun}
              className={`combobox-option${i === highlightIdx ? " combobox-option-active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); onChange(a); setOpen(false); }}
              onMouseEnter={() => setHighlightIdx(i)}
            >
              <strong>{a.kode_akun}</strong> {a.nama_akun}
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="combobox-empty">Tidak ada kode akun yang cocok.</li>
          )}
        </ul>
      )}
    </div>
  );
}
