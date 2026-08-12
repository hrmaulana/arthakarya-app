// Parser Excel target RPD bulanan → baris (unit, bulan, nilai) siap simpan.
//
// Format file: satu sheet, satu tabel unit × bulan.
//   Baris 1 (header): sel pertama = judul kolom unit (diabaikan), sisanya =
//     bulan — nama bulan Indonesia ("Agustus"), singkatan ("Agu"), atau angka
//     1-12. Urutan header menentukan urutan kolom.
//   Baris berikutnya: kolom 1 = unit kerja (dicocokkan via kode_unit dulu,
//     lalu nama_unit), sel lainnya = nilai rupiah bilangan bulat ≥ 0
//     (kosong = 0; nilai non-angka / negatif → ditolak).
// Jika ada unit/nilai/header yang tidak valid, import DITOLAK seluruhnya
// (ImportError) — tidak ada import sebagian.
import * as XLSX from "xlsx";

export class ImportError extends Error {}

export interface RpdTargetRow {
  unit_kerja_id: number;
  bulan: number;
  nilai: number;
}

export interface RpdTargetUnit {
  id: number;
  kode_unit: string;
  nama_unit: string;
}

const BULAN = new Map<string, number>([
  ["januari", 1], ["februari", 2], ["maret", 3], ["april", 4], ["mei", 5],
  ["juni", 6], ["juli", 7], ["agustus", 8], ["september", 9], ["oktober", 10],
  ["november", 11], ["desember", 12],
  ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["jun", 6], ["jul", 7],
  ["agu", 8], ["sep", 9], ["okt", 10], ["nov", 11], ["des", 12],
  ["1", 1], ["01", 1], ["2", 2], ["02", 2], ["3", 3], ["03", 3],
  ["4", 4], ["04", 4], ["5", 5], ["05", 5], ["6", 6], ["06", 6],
  ["7", 7], ["07", 7], ["8", 8], ["08", 8], ["9", 9], ["09", 9],
  ["10", 10], ["11", 11], ["12", 12],
]);

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function parseBulan(v: unknown): number | null {
  const key = toStr(v).toLowerCase().replace(/[^a-z0-9]+/g, "");
  return BULAN.get(key) ?? null;
}

// Nilai sel rupiah: angka, atau string "1.631.593.430" (titik ribuan). Kosong = 0.
// Negatif / non-angka → null (pemanggil menolak dengan pesan sel).
function parseNilai(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return 0;
  let n: number;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    n = Math.round(v);
  } else {
    const s = String(v).trim();
    if (!/^\d[\d.]*$/.test(s)) return null; // hanya digit & titik ribuan
    const cleaned = s.replace(/\./g, "");
    if (!/^\d+$/.test(cleaned)) return null;
    n = parseInt(cleaned, 10);
  }
  return n >= 0 ? n : null;
}

// "B" untuk kolom 1, "AA" untuk kolom 26, dst. — untuk pesan error "Sel B3 ...".
function colLetter(idx: number): string {
  let s = "";
  let i = idx;
  while (i >= 0) {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  }
  return s;
}

// Nama pendek umum untuk unit → nama resmi (dipakai saat import).
const UNIT_ALIASES: Record<string, string> = {
  sesdep: "sekretariat deputi pmp",
};

const MATCH_THRESHOLD = 0.75; // sama dengan import monitoring

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

// Skor kecocokan dua nama unit (0..1) — irisan token / token terbanyak di salah satu.
function overlapScore(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  const overlap = ta.filter((t) => setB.has(t)).length;
  return overlap / Math.min(ta.length, tb.length);
}

export function parseRpdTargetExcel(
  buffer: Buffer,
  units: RpdTargetUnit[]
): { rows: RpdTargetRow[] } {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw new ImportError("File tidak dapat dibaca sebagai Excel.");
  }

  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new ImportError("File Excel tidak memiliki sheet.");
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
  if (aoa.length < 2) {
    throw new ImportError("Sheet Excel kosong atau hanya berisi header.");
  }

  // Header → urutan bulan per kolom (kolom 0 = unit, diabaikan).
  const header = aoa[0];
  const bulanByCol = new Map<number, number>();
  for (let c = 1; c < header.length; c++) {
    const raw = toStr(header[c]);
    if (raw === "") continue;
    const bulan = parseBulan(raw);
    if (bulan === null) {
      throw new ImportError(`Kolom bulan tidak dikenal di header: "${raw}".`);
    }
    // Bulan duplikat di header → kolom terakhir yang menang. Mencegah baris
    // (unit, bulan) ganda yang akan melanggar UNIQUE di tabel rpd_target.
    for (const [cc, bb] of bulanByCol) {
      if (bb === bulan) bulanByCol.delete(cc);
    }
    bulanByCol.set(c, bulan);
  }
  if (bulanByCol.size === 0) {
    throw new ImportError("Tidak ada kolom bulan di header.");
  }

  // Pemetaan unit Excel → unit_kerja_id. Urutan: kode_unit/nama_unit persis →
  // alias singkatan → token-overlap (nama pendek seperti "PEMPMP"). Konsisten
  // dengan perilaku import monitoring.
  const unitLookup = new Map<string, number>();
  for (const u of units) {
    unitLookup.set(u.kode_unit.toLowerCase(), u.id);
    unitLookup.set(u.nama_unit.toLowerCase(), u.id);
  }
  const unitCache = new Map<string, number | null>(); // teks unit → id (null = tak dikenal)
  const mapUnit = (raw: string): number | null => {
    const key = raw.trim().toLowerCase();
    if (unitCache.has(key)) return unitCache.get(key)!;
    let id = unitLookup.get(key) ?? null;
    if (id === null) {
      const expanded = UNIT_ALIASES[key];
      if (expanded) id = unitLookup.get(expanded) ?? null;
    }
    if (id === null) {
      let bestId: number | null = null;
      let bestScore = 0;
      for (const u of units) {
        const score = overlapScore(key, u.nama_unit);
        if (score > bestScore) {
          bestScore = score;
          bestId = u.id;
        }
      }
      if (bestScore >= MATCH_THRESHOLD) id = bestId;
    }
    unitCache.set(key, id);
    return id;
  };

  const rows: RpdTargetRow[] = [];
  const unknownUnits = new Set<string>();

  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row || row.every((v) => v === null || v === "")) continue;
    const unitRaw = toStr(row[0]);
    if (!unitRaw) continue;
    const unitId = mapUnit(unitRaw);
    if (unitId === null) {
      unknownUnits.add(unitRaw);
      continue;
    }
    for (const [c, bulan] of bulanByCol) {
      const nilai = parseNilai(row[c]);
      if (nilai === null) {
        throw new ImportError(`Sel ${colLetter(c)}${r + 1} harus angka bulat ≥ 0.`);
      }
      rows.push({ unit_kerja_id: unitId, bulan, nilai });
    }
  }

  if (unknownUnits.size > 0) {
    throw new ImportError(
      `Unit kerja tidak dikenal di database: ${[...unknownUnits].join(", ")}. ` +
        "Perbaiki penamaan unit di file atau daftar unit kerja."
    );
  }
  if (rows.length === 0) {
    throw new ImportError("Tidak ada baris data yang valid di file.");
  }

  return { rows };
}
