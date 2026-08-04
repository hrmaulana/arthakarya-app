// Parser Excel anggaran SAKTI → baris monitoring siap simpan.
//
// Sumber data: sheet "Data Detail" (baris 1 = header, baris berikutnya = data).
// Memetakan nama unit kerja dari Excel ke unit_kerja di database via
// token overlap (nama di Excel bisa beda tipis, mis. "PEMPMP" vs
// "Direktorat PEMPMP"). Jika ada unit yang tidak terpetakan, import
// DITOLAK dengan daftar nama unit-nya (tidak diam-diam membuang baris).
import * as XLSX from "xlsx";

export class ImportError extends Error {}

export interface MonitoringRow {
  unit_kerja_id: number;
  kode_program: string;
  nama_program: string;
  kode_kegiatan: string;
  nama_kegiatan: string;
  kode_output: string;
  nama_output: string;
  kode_suboutput: string;
  nama_suboutput: string;
  kode_komponen: string;
  nama_komponen: string;
  kode_subkomponen: string;
  nama_subkomponen: string;
  kode_akun: string;
  nama_akun: string;
  pagu_revisi: number;
  realisasi_periode_lalu: number;
  realisasi_periode_ini: number;
  realisasi_sd_periode: number;
}

export const SHEET_NAME = "Data Detail";

const REQUIRED_COLUMNS = [
  "Kode Program", "Nama Program", "Kode Kegiatan", "Nama Kegiatan", "Unit Kerja",
  "Kode Output", "Nama Output", "Kode SubOutput", "Nama SubOutput",
  "Kode Komponen", "Nama Komponen", "Kode SubKomponen", "Nama SubKomponen",
  "Kode Akun", "Nama Akun",
  "Pagu Revisi", "Realisasi Periode Lalu", "Realisasi Periode Ini", "Realisasi sd Periode",
] as const;

const MATCH_THRESHOLD = 0.75;

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function toInt(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Math.round(v);
  // Defensif terhadap angka berformat "1.234.567" (string)
  const cleaned = String(v).replace(/[^0-9-]/g, "");
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/** Skor kecocokan dua nama unit (0..1) — irisan token / token terbanyak di salah satu. */
function overlapScore(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  const overlap = ta.filter((t) => setB.has(t)).length;
  return overlap / Math.min(ta.length, tb.length);
}

/**
 * Parse buffer xlsx menjadi baris monitoring.
 * @param units daftar unit kerja dari DB ({ id, nama_unit }) untuk pemetaan.
 * @throws ImportError dengan pesan yang jelas untuk dipakai di respons API.
 */
export function parseAnggaranExcel(
  buffer: Buffer,
  units: { id: number; nama_unit: string }[]
): { rows: MonitoringRow[] } {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw new ImportError("File tidak dapat dibaca sebagai Excel.");
  }

  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) throw new ImportError(`Sheet "${SHEET_NAME}" tidak ditemukan di file.`);

  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
  if (aoa.length < 2) throw new ImportError(`Sheet "${SHEET_NAME}" kosong.`);

  // Header → index kolom
  const header = aoa[0].map((h) => toStr(h).toLowerCase());
  const idx = new Map<string, number>();
  header.forEach((h, i) => idx.set(h, i));

  const col = (name: string): number => {
    const i = idx.get(name.toLowerCase());
    if (i === undefined) {
      throw new ImportError(`Kolom "${name}" tidak ditemukan di sheet "${SHEET_NAME}".`);
    }
    return i;
  };
  const c: Record<string, number> = {};
  for (const name of REQUIRED_COLUMNS) c[name] = col(name);

  // Pemetaan unit Excel → unit_kerja_id (token overlap, pilih skor terbaik)
  const unitCache = new Map<string, number>(); // nama unit excel → id
  const unmatched = new Set<string>();

  const mapUnit = (excelUnit: string): number | null => {
    if (unitCache.has(excelUnit)) return unitCache.get(excelUnit)!;
    let bestId: number | null = null;
    let bestScore = 0;
    for (const u of units) {
      const score = overlapScore(excelUnit, u.nama_unit);
      if (score > bestScore) {
        bestScore = score;
        bestId = u.id;
      }
    }
    const id = bestScore >= MATCH_THRESHOLD ? bestId : null;
    unitCache.set(excelUnit, id ?? -1);
    return id;
  };

  const rows: MonitoringRow[] = [];
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row || row.every((v) => v === null || v === "")) continue;

    const excelUnit = toStr(row[c["Unit Kerja"]]);
    if (!excelUnit) continue;
    const unitId = mapUnit(excelUnit);
    if (unitId === null) {
      unmatched.add(excelUnit);
      continue;
    }

    rows.push({
      unit_kerja_id: unitId,
      kode_program: toStr(row[c["Kode Program"]]),
      nama_program: toStr(row[c["Nama Program"]]),
      kode_kegiatan: toStr(row[c["Kode Kegiatan"]]),
      nama_kegiatan: toStr(row[c["Nama Kegiatan"]]),
      kode_output: toStr(row[c["Kode Output"]]),
      nama_output: toStr(row[c["Nama Output"]]),
      kode_suboutput: toStr(row[c["Kode SubOutput"]]),
      nama_suboutput: toStr(row[c["Nama SubOutput"]]),
      kode_komponen: toStr(row[c["Kode Komponen"]]),
      nama_komponen: toStr(row[c["Nama Komponen"]]),
      kode_subkomponen: toStr(row[c["Kode SubKomponen"]]),
      nama_subkomponen: toStr(row[c["Nama SubKomponen"]]),
      kode_akun: toStr(row[c["Kode Akun"]]),
      nama_akun: toStr(row[c["Nama Akun"]]),
      pagu_revisi: toInt(row[c["Pagu Revisi"]]),
      realisasi_periode_lalu: toInt(row[c["Realisasi Periode Lalu"]]),
      realisasi_periode_ini: toInt(row[c["Realisasi Periode Ini"]]),
      realisasi_sd_periode: toInt(row[c["Realisasi sd Periode"]]),
    });
  }

  if (unmatched.size > 0) {
    throw new ImportError(
      `Unit kerja tidak dikenal di database: ${[...unmatched].join(", ")}. ` +
        "Perbaiki penamaan unit di file atau daftar unit kerja."
    );
  }

  if (rows.length === 0) {
    throw new ImportError("Tidak ada baris data yang valid di sheet Data Detail.");
  }

  return { rows };
}
