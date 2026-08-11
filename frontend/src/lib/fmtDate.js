// Format tanggal dari backend (DATE column = YYYY-MM-DD atau ISO string)
export function fmtDate(d, options = {}) {
  if (!d) return "—";
  try {
    // Ambil date part saja: handle "YYYY-MM-DD" dan "2026-08-11T00:00:00.000Z"
    const datePart = String(d).split("T")[0];
    const date = new Date(datePart + "T00:00:00");
    if (isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
      ...options,
    });
  } catch {
    return "—";
  }
}

// Format pendek: "12 Agu 2026"
export function fmtDateShort(d) {
  return fmtDate(d, { month: "short" });
}

// Parse string tanggal ke Date object (aman untuk komputasi)
export function parseDate(d) {
  if (!d) return new Date(NaN);
  const datePart = String(d).split("T")[0];
  return new Date(datePart + "T00:00:00");
}
