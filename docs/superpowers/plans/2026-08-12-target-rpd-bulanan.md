# Target RPD Bulanan per Unit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambah data **Target RPD Bulanan per unit kerja** ke halaman RPD & Timeline Anggaran — import dari Excel (admin), tampil sebagai tabel unit × bulan, dan dibandingkan kumulatifnya dengan kegiatan per bulan (selisih).

**Architecture:** Dua tabel baru `rpd_target_imports` (snapshot per upload) + `rpd_target` (nilai per unit×bulan) lewat migrasi `007_rpd_target.sql`. Backend: perpanjang `backend/src/routes/rekap.ts` dengan `POST /rpd-target/import` (admin, parse via modul baru `src/rpd_target/importExcel.ts`) dan `GET /rpd-target` (agregasi + kumulatif + selisih, hormati `getUnitKerjaFilter`). Frontend: perpanjang `frontend/src/pages/RpdGantt.jsx` dengan kartu upload admin, tabel target per unit, dan kartu perbandingan kumulatif — hanya class CSS existing.

**Tech Stack:** React 18 + Vite · Bun + Express + TypeScript · pg + Zod · `xlsx` + `multer` (sudah dependency) · PostgreSQL 16 · bun:test.

## Global Constraints

- **Migrasi:** file baru di `db/migrations/` **repo root** (BUKAN `backend/src/db/migrations/` — path di spec keliru; verifikasi: `backend/scripts/migrate.ts` membaca `MIGRATIONS_DIR = path.resolve(import.meta.dir, "../../db/migrations")` → `db/migrations/`). Urut alfabetis, satu transaksi per file, dijalankan via `bun run migrate`. File berikutnya: `007_rpd_target.sql`.
- **Import terbaru** = `rpd_target` dengan `import_id = MAX(id)` dari `rpd_target_imports` untuk **tahun yang sama**. Re-upload membuat snapshot baru; snapshot lama tetap utuh sebagai riwayat.
- **Backend:** Express + TypeScript. Pola route: `router.use(authMiddleware)`, `getUnitKerjaFilter(req)` (admin = `{ unitKerjaId: null }` = lihat semua, operator = unitnya), `logger.error`, `res.json({ data })`. Pesan error Bahasa Indonesia.
- **Upload:** `multer` memory storage (max 10 MB) + `xlsx`. Import **admin only** (`requireRole("admin")`).
- **Frontend:** semua styling di `frontend/src/index.css` — pakai class existing hanya (`.card`, `.card-header`, `.table-wrapper`, `.table-sticky`, `.form-row`, `.form-group`, `.form-control`, `.btn btn-primary`, `.alert alert-success/error`, `.text-muted`, `.text-right`, `.font-mono`, `.badge`, `.empty-state`, `.page-header`, `.no-print`). Warna hanya `var(--...)`, verifikasi dark mode. Jangan tambah library.
- **Angka rupiah** tampil via `formatRupiah` dari `useOutletContext()`; kosong tampil `—`, nol yang bermakna (kumulatif/selisih) tampil `0`.
- **Test backend:** `bun test` di `backend/` (butuh container Postgres test `arthakarya_test_pg` port 5433; `TEST_DATABASE_URL` default `postgresql://arthakarya:arthakarya_secret@localhost:5433/arthakarya_test`). Skema dibuat `beforeAll` dari `db/init.sql` + `runMigrations`.
- **Test frontend:** `bun run build` di `frontend/` + verifikasi manual browser.

---

## File Structure

| File | Aksi | Tanggung jawab |
|---|---|---|
| `db/migrations/007_rpd_target.sql` | Create | DDL tabel `rpd_target_imports` + `rpd_target` |
| `backend/src/rpd_target/importExcel.ts` | Create | Parse buffer .xlsx → baris `(unit_kerja_id, bulan, nilai)`; lempar `ImportError` |
| `backend/src/routes/rekap.ts` | Modify | `POST /rpd-target/import` + `GET /rpd-target` |
| `backend/tests/integration.test.ts` | Modify | Test migrasi, parser, import, GET (tambahkan `rpd_target_imports, rpd_target` ke TRUNCATE `beforeEach`) |
| `frontend/src/pages/RpdGantt.jsx` | Modify | Kartu upload admin, tabel target per unit, kartu perbandingan kumulatif |

Dekompasisi: Task 1 migrasi → Task 2 parser (murni, unit-testable) → Task 3 route import → Task 4 route GET → Task 5 frontend. Setiap task menghasilkan deliverable yang bisa di-test sendiri.

---

### Task 1: Migrasi DB `007_rpd_target.sql`

**Files:**
- Create: `db/migrations/007_rpd_target.sql` (repo root)
- Test: `backend/tests/integration.test.ts` (tambah describe block "RPD Target — migrasi")

**Interfaces:**
- Consumes: pola migrasi existing (`001_baseline.sql` … `006_kegiatan_kode_akun.sql`), tabel `users(id)`, `unit_kerja(id)`.
- Produces: tabel `rpd_target_imports` dan `rpd_target` (dipakai Task 3/4).

- [ ] **Step 1: Write the failing test**

Tambahkan di `backend/tests/integration.test.ts`, setelah describe `"Rekap"` (atau sebelum `"Security"`):

```ts
describe("RPD Target — migrasi", () => {
  it("tabel rpd_target_imports & rpd_target dibuat oleh migrasi", async () => {
    const res = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('rpd_target_imports', 'rpd_target')
       ORDER BY table_name`
    );
    expect(res.rows.map((r) => r.table_name)).toEqual(["rpd_target", "rpd_target_imports"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test` (di `backend/`)
Expected: FAIL — `relation "rpd_target_imports" does not exist` (migrasi belum ada).

- [ ] **Step 3: Create the migration**

Create `db/migrations/007_rpd_target.sql`:

```sql
-- 007_rpd_target.sql — Target RPD Bulanan per unit kerja (import Excel)
-- Snapshot tiap upload (rpd_target_imports) + nilai per (unit, bulan) (rpd_target).
-- Import terbaru = baris rpd_target dengan import_id = MAX(id) pada
-- rpd_target_imports untuk tahun yang sama.

CREATE TABLE rpd_target_imports (
  id          SERIAL PRIMARY KEY,
  filename    TEXT NOT NULL,
  tahun       INTEGER NOT NULL,
  periode     TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_rows  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE rpd_target (
  id            SERIAL PRIMARY KEY,
  import_id     INTEGER NOT NULL REFERENCES rpd_target_imports(id) ON DELETE CASCADE,
  unit_kerja_id INTEGER NOT NULL REFERENCES unit_kerja(id),
  bulan         INTEGER NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  nilai         BIGINT NOT NULL DEFAULT 0,
  UNIQUE (import_id, unit_kerja_id, bulan)
);

CREATE INDEX idx_rpd_target_import_id ON rpd_target (import_id);
CREATE INDEX idx_rpd_target_imports_tahun ON rpd_target_imports (tahun);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test` (di `backend/`)
Expected: PASS — kedua tabel terdeteksi oleh `information_schema`.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/007_rpd_target.sql backend/tests/integration.test.ts
git commit -m "feat: migrasi tabel rpd_target (target RPD bulanan per unit)"
```

---

### Task 2: Parser Excel `src/rpd_target/importExcel.ts`

**Files:**
- Create: `backend/src/rpd_target/importExcel.ts`
- Test: `backend/tests/integration.test.ts` (tambah describe "RPD Target Excel — parser")

**Interfaces:**
- Consumes: `xlsx` (dependency sudah ada). Struktur `unit_kerja` (kolom `id`, `kode_unit`, `nama_unit`).
- Produces (dipakai Task 3):
  - `export class ImportError extends Error {}`
  - `export interface RpdTargetRow { unit_kerja_id: number; bulan: number; nilai: number }`
  - `export interface RpdTargetUnit { id: number; kode_unit: string; nama_unit: string }`
  - `export function parseRpdTargetExcel(buffer: Buffer, units: RpdTargetUnit[]): { rows: RpdTargetRow[] }` — lempar `ImportError` untuk file tak terbaca / tanpa sheet / header bulan tak dikenal / unit tak dikenal / nilai bukan angka ≥ 0.

- [ ] **Step 1: Write the failing test**

Di `backend/tests/integration.test.ts` tambahkan import statis di dekat import lain:

```ts
import { parseRpdTargetExcel } from "../src/rpd_target/importExcel.js";
```

Lalu tambahkan describe block baru (helper `buildXlsx` sudah ada di file ini):

```ts
describe("RPD Target Excel — parser", () => {
  const units = [
    { id: 1, kode_unit: "UK01", nama_unit: "Unit Uji Satu" },
    { id: 2, kode_unit: "UK02", nama_unit: "Unit Uji Dua" },
  ];

  it("parse header nama bulan + nilai → baris per (unit, bulan)", () => {
    const buf = buildXlsx(["Unit Kerja", "Agustus", "September", "Oktober"], [
      ["Unit Uji Satu", 1000000, 1500000, 2000000],
      ["Unit Uji Dua", "500000", "", 0],
    ]);
    const { rows } = parseRpdTargetExcel(buf, units);
    expect(rows).toHaveLength(6);
    const val = (id: number, b: number) =>
      rows.find((r) => r.unit_kerja_id === id && r.bulan === b)?.nilai;
    expect(val(1, 8)).toBe(1000000);
    expect(val(1, 9)).toBe(1500000);
    expect(val(1, 10)).toBe(2000000);
    expect(val(2, 8)).toBe(500000); // string "500000"
    expect(val(2, 9)).toBe(0);      // kosong = 0
    expect(val(2, 10)).toBe(0);     // 0 eksplisit
  });

  it("header bulan bisa angka 1-12", () => {
    const buf = buildXlsx(["Unit", "8", "9"], [["Unit Uji Satu", 100, 200]]);
    const { rows } = parseRpdTargetExcel(buf, units);
    expect(rows.map((r) => r.bulan)).toEqual([8, 9]);
  });

  it("cocok unit via kode_unit", () => {
    const buf = buildXlsx(["Unit", "Agustus"], [["UK01", 700]]);
    const { rows } = parseRpdTargetExcel(buf, units);
    expect(rows[0].unit_kerja_id).toBe(1);
  });

  it("unit tidak dikenal → ImportError", () => {
    const buf = buildXlsx(["Unit", "Agustus"], [["Unit Xyz", 700]]);
    expect(() => parseRpdTargetExcel(buf, units)).toThrow(/Unit Xyz/);
  });

  it("nilai negatif / non-angka → ImportError", () => {
    const bufNeg = buildXlsx(["Unit", "Agustus"], [["Unit Uji Satu", -5]]);
    expect(() => parseRpdTargetExcel(bufNeg, units)).toThrow(/harus angka/);
    const bufStr = buildXlsx(["Unit", "Agustus"], [["Unit Uji Satu", "abc"]]);
    expect(() => parseRpdTargetExcel(bufStr, units)).toThrow(/harus angka/);
  });

  it("header bulan tidak dikenal → ImportError", () => {
    const buf = buildXlsx(["Unit", "Hujan"], [["Unit Uji Satu", 700]]);
    expect(() => parseRpdTargetExcel(buf, units)).toThrow(/bulan/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test` (di `backend/`)
Expected: FAIL — `Cannot find module "../src/rpd_target/importExcel.js"`.

- [ ] **Step 3: Create the parser module**

Create `backend/src/rpd_target/importExcel.ts`:

```ts
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
    bulanByCol.set(c, bulan);
  }
  if (bulanByCol.size === 0) {
    throw new ImportError("Tidak ada kolom bulan di header.");
  }

  // Pemetaan unit Excel → unit_kerja_id: kode_unit dulu, lalu nama_unit.
  const unitLookup = new Map<string, number>();
  for (const u of units) {
    unitLookup.set(u.kode_unit.toLowerCase(), u.id);
    unitLookup.set(u.nama_unit.toLowerCase(), u.id);
  }
  const unitCache = new Map<string, number | null>(); // teks unit → id (null = tak dikenal)
  const mapUnit = (raw: string): number | null => {
    const key = raw.trim().toLowerCase();
    if (unitCache.has(key)) return unitCache.get(key)!;
    const id = unitLookup.get(key) ?? null;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test` (di `backend/`)
Expected: PASS — semua kasus parser lulus.

- [ ] **Step 5: Commit**

```bash
git add backend/src/rpd_target/importExcel.ts backend/tests/integration.test.ts
git commit -m "feat: parser Excel target RPD bulanan (unit x bulan)"
```

---

### Task 3: `POST /api/rekap/rpd-target/import` (admin)

**Files:**
- Modify: `backend/src/routes/rekap.ts` (tambah import + route)
- Test: `backend/tests/integration.test.ts` (tambah describe "RPD Target — import"; tambah tabel ke TRUNCATE `beforeEach`)

**Interfaces:**
- Consumes: `parseRpdTargetExcel`, `ImportError`, `RpdTargetRow` dari Task 2; `requireRole` dari `../middleware/authorize.js`; `multer`; tabel dari Task 1.
- Produces: endpoint `POST /api/rekap/rpd-target/import`. Request `multipart/form-data` — `file` (.xlsx), `tahun` (wajib, `YYYY`), `periode` (opsional). Response sukses `200` `{ message, data: { import_id, total_rows, tahun } }`. Error: `400` validasi/format, `403` non-admin, `401` belum login, `500` umum (via `logger.error`).

- [ ] **Step 1: Write the failing test**

Di `backend/tests/integration.test.ts`:

**1a.** Perbarui TRUNCATE `beforeEach` (tabel baru agar idempotent):

```ts
  beforeEach(async () => {
    await pool.query(
      `TRUNCATE kegiatan, mata_anggaran, monitoring_imports, monitoring_anggaran,
       rpd_target_imports, rpd_target, users, unit_kerja, jenis_kegiatan RESTART IDENTITY CASCADE`
    );
```

**1b.** Tambahkan helper upload + fixture (letakkan di dekat helper `uploadXlsx`):

```ts
const TARGET_HEADER = ["Unit Kerja", "Agustus", "September", "Oktober"];
const TARGET_ROWS = [
  ["Unit Uji Satu", 1000000, 1500000, 2000000],
  ["Unit Uji Dua", 500000, 600000, 0],
];

async function uploadRpdTarget(token: string, buf: Buffer, tahun = 2026, periode?: string) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([buf.buffer as ArrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "target-uji.xlsx"
  );
  form.append("tahun", String(tahun));
  if (periode) form.append("periode", periode);
  const res = await fetch(`${baseUrl}/api/rekap/rpd-target/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // body kosong / bukan JSON
  }
  return { status: res.status, body: json };
}
```

**1c.** Tambahkan describe block:

```ts
describe("RPD Target — import", () => {
  it("import sukses: snapshot + baris tersimpan", async () => {
    const res = await uploadRpdTarget(adminToken, buildXlsx(TARGET_HEADER, TARGET_ROWS), 2026, "Target 2026");
    expect(res.status).toBe(200);
    expect(res.body.data.tahun).toBe(2026);
    expect(res.body.data.total_rows).toBe(6);
    expect(res.body.data.import_id).toBeGreaterThan(0);

    const cnt = await pool.query("SELECT COUNT(*)::int AS n FROM rpd_target");
    expect(cnt.rows[0].n).toBe(6);
    const imp = await pool.query(
      `SELECT filename, tahun, periode, total_rows FROM rpd_target_imports`
    );
    expect(imp.rows).toHaveLength(1);
    expect(imp.rows[0].filename).toBe("target-uji.xlsx");
    expect(imp.rows[0].tahun).toBe(2026);
    expect(imp.rows[0].periode).toBe("Target 2026");
    expect(imp.rows[0].total_rows).toBe(6);
  });

  it("import kedua: snapshot baru menang, riwayat tetap", async () => {
    await uploadRpdTarget(adminToken, buildXlsx(TARGET_HEADER, TARGET_ROWS), 2026);
    const res2 = await uploadRpdTarget(
      adminToken,
      buildXlsx(TARGET_HEADER, [["Unit Uji Satu", 9000000, 0, 0]]),
      2026,
      "Target revisi"
    );
    expect(res2.status).toBe(200);
    expect(res2.body.data.total_rows).toBe(3);

    const imps = await pool.query(`SELECT id FROM rpd_target_imports ORDER BY id`);
    expect(imps.rows).toHaveLength(2);

    const latest = await pool.query(
      `SELECT rt.nilai FROM rpd_target rt
       WHERE rt.import_id = (SELECT MAX(id) FROM rpd_target_imports)
         AND rt.unit_kerja_id = 1 AND rt.bulan = 8`
    );
    expect(Number(latest.rows[0].nilai)).toBe(9000000);
  });

  it("operator → 403; tanpa file → 400; file bukan .xlsx → 400", async () => {
    const buf = buildXlsx(TARGET_HEADER, TARGET_ROWS);
    expect((await uploadRpdTarget(op1Token, buf)).status).toBe(403);
    expect((await api("POST", "/api/rekap/rpd-target/import", undefined, adminToken)).status).toBe(400);

    const form = new FormData();
    form.append("file", new Blob(["hello"], { type: "text/plain" }), "data.txt");
    form.append("tahun", "2026");
    const resTxt = await fetch(`${baseUrl}/api/rekap/rpd-target/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: form,
    });
    expect(resTxt.status).toBe(400);
    expect((await resTxt.json()).error).toContain(".xlsx");
  });

  it("tahun tidak valid → 400", async () => {
    const buf = buildXlsx(TARGET_HEADER, TARGET_ROWS);
    const form = new FormData();
    form.append(
      "file",
      new Blob([buf.buffer as ArrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "target.xlsx"
    );
    form.append("tahun", "abc");
    const res = await fetch(`${baseUrl}/api/rekap/rpd-target/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it("unit tidak dikenal → 400, seluruh import batal", async () => {
    const buf = buildXlsx(TARGET_HEADER, [
      ["Unit Uji Satu", 1000000, 0, 0],
      ["Unit Hantu", 500000, 0, 0],
    ]);
    const res = await uploadRpdTarget(adminToken, buf);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Unit Hantu");
    const cnt = await pool.query("SELECT COUNT(*)::int AS n FROM rpd_target");
    expect(cnt.rows[0].n).toBe(0);
  });

  it("nilai negatif → 400 dengan sebutan sel, import batal", async () => {
    const buf = buildXlsx(TARGET_HEADER, [["Unit Uji Satu", 1000000, -1, 0]]);
    const res = await uploadRpdTarget(adminToken, buf);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/harus angka/);
    const cnt = await pool.query("SELECT COUNT(*)::int AS n FROM rpd_target");
    expect(cnt.rows[0].n).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test` (di `backend/`)
Expected: FAIL — `Cannot POST /api/rekap/rpd-target/import` (404).

- [ ] **Step 3: Add the import route**

Di `backend/src/routes/rekap.ts`, tambahkan import (di atas `const router = Router();`):

```ts
import multer from "multer";
import { requireRole } from "../middleware/authorize.js";
import {
  parseRpdTargetExcel,
  ImportError,
  RpdTargetRow,
} from "../rpd_target/importExcel.js";
```

Tepat setelah deklarasi `router` (dan di bawah `router.use(authMiddleware)`), tambahkan:

```ts
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB — sama dengan import monitoring
});

// POST /api/rekap/rpd-target/import — admin; upload Excel target RPD bulanan
router.post(
  "/rpd-target/import",
  requireRole("admin"),
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "File Excel wajib diunggah (field 'file')." });
        return;
      }
      const filename = req.file.originalname || "upload.xlsx";
      if (!/\.xlsx$/i.test(filename)) {
        res.status(400).json({ error: "Format file harus .xlsx." });
        return;
      }

      const tahunRaw = typeof req.body?.tahun === "string" ? req.body.tahun.trim() : "";
      if (!/^\d{4}$/.test(tahunRaw)) {
        res.status(400).json({ error: "tahun wajib diisi dalam format YYYY." });
        return;
      }
      const tahun = Number(tahunRaw);
      if (tahun < 2000 || tahun > 2100) {
        res.status(400).json({ error: "tahun tidak masuk akal (harus 2000–2100)." });
        return;
      }
      const periode =
        typeof req.body?.periode === "string" && req.body.periode.trim()
          ? req.body.periode.trim().slice(0, 100)
          : null;

      const units = (
        await pool.query("SELECT id, kode_unit, nama_unit FROM unit_kerja")
      ).rows;

      let parsed: { rows: RpdTargetRow[] };
      try {
        parsed = parseRpdTargetExcel(req.file.buffer, units);
      } catch (err) {
        if (err instanceof ImportError) {
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const imp = await client.query(
          `INSERT INTO rpd_target_imports (filename, tahun, periode, uploaded_by, total_rows)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [filename, tahun, periode, req.user!.userId, parsed.rows.length]
        );
        const importId = imp.rows[0].id;
        for (const row of parsed.rows) {
          await client.query(
            `INSERT INTO rpd_target (import_id, unit_kerja_id, bulan, nilai)
             VALUES ($1, $2, $3, $4)`,
            [importId, row.unit_kerja_id, row.bulan, row.nilai]
          );
        }
        await client.query("COMMIT");

        logger.info("rpd_target_import", {
          import_id: importId,
          rows: parsed.rows.length,
          by: req.user!.userId,
        });

        res.json({
          message: `Import berhasil: ${parsed.rows.length} baris.`,
          data: { import_id: importId, total_rows: parsed.rows.length, tahun },
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err: any) {
      logger.error("rpd_target_import_error", { message: err.message });
      res.status(500).json({ error: "Gagal mengimpor file." });
    }
  }
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test` (di `backend/`)
Expected: PASS — semua kasus import lulus.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/rekap.ts backend/tests/integration.test.ts
git commit -m "feat: endpoint import target RPD bulanan (admin)"
```

---

### Task 4: `GET /api/rekap/rpd-target?tahun=YYYY`

**Files:**
- Modify: `backend/src/routes/rekap.ts` (tambah route GET)
- Test: `backend/tests/integration.test.ts` (tambah describe "RPD Target — GET")

**Interfaces:**
- Consumes: tabel Task 1; route import Task 3; `getUnitKerjaFilter` (sudah di `rekap.ts`); helper `uploadRpdTarget`/`TARGET_HEADER`/`TARGET_ROWS` dari Task 3.
- Produces: endpoint `GET /api/rekap/rpd-target?tahun=YYYY`. Response `200`:
  ```json
  {
    "data": {
      "tahun": 2026,
      "months": [8, 9, 10],
      "units": [
        {
          "unit_kerja_id": 1,
          "kode_unit": "UK01",
          "nama_unit": "Unit Uji Satu",
          "months": [
            { "bulan": 8, "target": 1000000, "target_kum": 1000000,
              "kegiatan": 750000, "kegiatan_kum": 750000, "selisih": 250000 }
          ]
        }
      ]
    }
  }
  ```
  Tanpa import → `{ data: { tahun, months: [], units: [] } }`. `tahun` opsional → default tahun berjalan.

- [ ] **Step 1: Write the failing test**

Tambahkan describe block di `backend/tests/integration.test.ts`:

```ts
describe("RPD Target — GET", () => {
  it("tanpa import → months & units kosong", async () => {
    const res = await api("GET", "/api/rekap/rpd-target?tahun=2026", undefined, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.tahun).toBe(2026);
    expect(res.body.data.months).toEqual([]);
    expect(res.body.data.units).toEqual([]);
  });

  it("target + kumulatif + kegiatan + selisih benar", async () => {
    await uploadRpdTarget(adminToken, buildXlsx(TARGET_HEADER, TARGET_ROWS), 2026);
    // Kegiatan unit 1 bulan Agustus (2 item = 750.000) — kegiatanPayload tanggal 2026-08-10
    await api("POST", "/api/kegiatan", kegiatanPayload, op1Token);

    const res = await api("GET", "/api/rekap/rpd-target?tahun=2026", undefined, adminToken);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.months).toEqual([8, 9, 10]);

    const unit1 = d.units.find((u: any) => u.unit_kerja_id === 1);
    expect(unit1.nama_unit).toBe("Unit Uji Satu");
    const aug = unit1.months.find((m: any) => m.bulan === 8);
    expect(aug.target).toBe(1000000);
    expect(aug.target_kum).toBe(1000000);
    expect(aug.kegiatan).toBe(750000);
    expect(aug.kegiatan_kum).toBe(750000);
    expect(aug.selisih).toBe(250000);

    const sep = unit1.months.find((m: any) => m.bulan === 9);
    expect(sep.target).toBe(1500000);
    expect(sep.target_kum).toBe(2500000);
    expect(sep.kegiatan).toBe(0);
    expect(sep.kegiatan_kum).toBe(750000);
    expect(sep.selisih).toBe(1750000);

    // Unit 2: bulan 10 kosong → target 0, kumulatif tetap berjalan
    const unit2 = d.units.find((u: any) => u.unit_kerja_id === 2);
    expect(unit2.months).toHaveLength(3);
    const oct2 = unit2.months.find((m: any) => m.bulan === 10);
    expect(oct2.target).toBe(0);
    expect(oct2.target_kum).toBe(1100000);
    expect(oct2.kegiatan_kum).toBe(0);
    expect(oct2.selisih).toBe(1100000);
  });

  it("operator hanya melihat unitnya sendiri", async () => {
    await uploadRpdTarget(adminToken, buildXlsx(TARGET_HEADER, TARGET_ROWS), 2026);
    const res = await api("GET", "/api/rekap/rpd-target?tahun=2026", undefined, op1Token);
    expect(res.status).toBe(200);
    expect(res.body.data.units).toHaveLength(1);
    expect(res.body.data.units[0].nama_unit).toBe("Unit Uji Satu");
  });

  it("tahun berbeda → kosong", async () => {
    await uploadRpdTarget(adminToken, buildXlsx(TARGET_HEADER, TARGET_ROWS), 2026);
    const res = await api("GET", "/api/rekap/rpd-target?tahun=2025", undefined, adminToken);
    expect(res.body.data.months).toEqual([]);
    expect(res.body.data.units).toEqual([]);
  });

  it("tanpa token → 401", async () => {
    const res = await api("GET", "/api/rekap/rpd-target?tahun=2026");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test` (di `backend/`)
Expected: FAIL — `Cannot GET /api/rekap/rpd-target` (404).

- [ ] **Step 3: Add the GET route**

Di `backend/src/routes/rekap.ts`, tambahkan setelah route `POST /rpd-target/import`:

```ts
// GET /api/rekap/rpd-target?tahun=YYYY
// Target RPD Bulanan per unit (import terbaru untuk tahun tsb) + kegiatan per
// unit per bulan + kumulatif berjalan + selisih = target_kum - kegiatan_kum.
router.get("/rpd-target", async (req: Request, res: Response) => {
  try {
    const { unitKerjaId } = getUnitKerjaFilter(req);
    const tahun = req.query.tahun ? Number(req.query.tahun) : new Date().getFullYear();

    // 1. Import terbaru untuk tahun ini
    const imp = await pool.query(
      `SELECT id FROM rpd_target_imports
       WHERE tahun = $1 ORDER BY id DESC LIMIT 1`,
      [tahun]
    );
    if (imp.rows.length === 0) {
      res.json({ data: { tahun, months: [], units: [] } });
      return;
    }
    const importId = imp.rows[0].id;

    // 2. Unit + target dari import terbaru (operator: hanya unitnya)
    const targetParams: any[] = [importId];
    let unitCond = "";
    if (unitKerjaId !== null) {
      targetParams.push(unitKerjaId);
      unitCond = ` AND rt.unit_kerja_id = $2`;
    }
    const targetResult = await pool.query(
      `SELECT rt.unit_kerja_id, uk.kode_unit, uk.nama_unit, rt.bulan, rt.nilai
       FROM rpd_target rt
       JOIN unit_kerja uk ON uk.id = rt.unit_kerja_id
       WHERE rt.import_id = $1${unitCond}
       ORDER BY uk.kode_unit, rt.bulan`,
      targetParams
    );

    const units = new Map<
      number,
      { unit_kerja_id: number; kode_unit: string; nama_unit: string; byBulan: Map<number, number> }
    >();
    const monthSet = new Set<number>();
    for (const row of targetResult.rows) {
      monthSet.add(row.bulan);
      let u = units.get(row.unit_kerja_id);
      if (!u) {
        u = {
          unit_kerja_id: row.unit_kerja_id,
          kode_unit: row.kode_unit,
          nama_unit: row.nama_unit,
          byBulan: new Map(),
        };
        units.set(row.unit_kerja_id, u);
      }
      u.byBulan.set(row.bulan, Number(row.nilai));
    }
    const monthList = [...monthSet].sort((a, b) => a - b);
    const unitIds = [...units.keys()];

    // 3. Kegiatan per (unit, bulan) — hanya unit yang ada di import
    const kegiatanMap = new Map<string, number>(); // `${unitId}:${bulan}` → total
    if (unitIds.length > 0) {
      const placeholders = unitIds.map((_, i) => `$${i + 2}`).join(", ");
      const kegiatanResult = await pool.query(
        `SELECT k.unit_kerja_id,
                EXTRACT(MONTH FROM k.tanggal)::INTEGER AS bulan,
                COALESCE(SUM(ma.jumlah_rp), 0)::BIGINT AS total
         FROM kegiatan k
         JOIN mata_anggaran ma ON ma.kegiatan_id = k.id
         WHERE EXTRACT(YEAR FROM k.tanggal) = $1
           AND k.unit_kerja_id IN (${placeholders})
         GROUP BY k.unit_kerja_id, bulan`,
        [tahun, ...unitIds]
      );
      for (const r of kegiatanResult.rows) {
        kegiatanMap.set(`${r.unit_kerja_id}:${r.bulan}`, Number(r.total));
      }
    }

    // 4. Komputasi kumulatif + selisih per unit (urut bulan naik)
    const resultUnits = [...units.values()].map((u) => {
      let targetKum = 0;
      let kegiatanKum = 0;
      const m = monthList.map((bulan) => {
        const target = u.byBulan.get(bulan) ?? 0;
        const kegiatan = kegiatanMap.get(`${u.unit_kerja_id}:${bulan}`) ?? 0;
        targetKum += target;
        kegiatanKum += kegiatan;
        return {
          bulan,
          target,
          target_kum: targetKum,
          kegiatan,
          kegiatan_kum: kegiatanKum,
          selisih: targetKum - kegiatanKum,
        };
      });
      return {
        unit_kerja_id: u.unit_kerja_id,
        kode_unit: u.kode_unit,
        nama_unit: u.nama_unit,
        months: m,
      };
    });

    res.json({
      data: { tahun, months: monthList, units: resultUnits },
    });
  } catch (err: any) {
    logger.error("rekap_rpd_target_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data target RPD bulanan." });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test` (di `backend/`)
Expected: PASS — semua kasus GET lulus.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/rekap.ts backend/tests/integration.test.ts
git commit -m "feat: endpoint GET target RPD bulanan per unit + kumulatif & selisih"
```

---

### Task 5: Frontend — halaman RpdGantt

**Files:**
- Modify: `frontend/src/pages/RpdGantt.jsx`

**Interfaces:**
- Consumes: `client` (`frontend/src/api/client.js`), `formatRupiah` + `user` dari `useOutletContext()`, `MONTHS` existing, data GET Task 4 (`months`, `units[].months[]` dengan `target, target_kum, kegiatan, kegiatan_kum, selisih`).
- Produces: UI target RPD per unit (tidak ada output ke task lain).

- [ ] **Step 1: Modify the component**

**1a.** Ubah import React di baris 1:

```jsx
import { useState, useEffect, useRef } from "react";
```

**1b.** Tambah state setelah `const [animated, setAnimated] = useState(false);`:

```jsx
const [rpdTarget, setRpdTarget] = useState({ months: [], units: [] });
const [file, setFile] = useState(null);
const [tahunImport, setTahunImport] = useState(tahun);
const [periode, setPeriode] = useState("");
const [uploading, setUploading] = useState(false);
const [uploadMsg, setUploadMsg] = useState("");
const [uploadErr, setUploadErr] = useState("");
const fileInputRef = useRef(null);
```

**1c.** Ubah `const { formatRupiah } = useOutletContext();` (baris 59) menjadi:

```jsx
const { formatRupiah, user } = useOutletContext();
const isAdmin = user?.role === "admin";
```

**1d.** Perbarui `useEffect` fetch — tambah panggilan rpd-target pada `Promise.all`, dan sinkronkan `tahunImport` dengan `tahun`:

```jsx
  useEffect(() => {
    setLoading(true);
    setAnimated(false);
    Promise.all([
      client.get(`/rekap/rpd-bulanan?tahun=${tahun}`),
      client.get("/rekap/timeline"),
      client.get(`/rekap/rpd-target?tahun=${tahun}`),
    ])
      .then(([rpdRes, tlRes, rpdTargetRes]) => {
        setRpd(rpdRes.data.data);
        setTahun(rpdRes.data.tahun);
        setTimeline(tlRes.data.data);
        setRpdTarget(rpdTargetRes.data.data);
        setTimeout(() => setAnimated(true), 80);
      })
      .catch((err) =>
        setError(err.response?.data?.error || "Gagal memuat data.")
      )
      .finally(() => setLoading(false));
  }, [tahun]);

  useEffect(() => {
    setTahunImport(tahun);
  }, [tahun]);
```

**1e.** Tambah handler import (letakkan setelah `useEffect`, sebelum `const maxRpd = ...`):

```jsx
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
```

**1f.** Tambahkan seksi UI baru — **sisipkan tepat setelah penutup kartu RPD bar chart** (setelah `</div>` yang menutup kartu "Rencana Penarikan Dana Bulanan", sebelum komentar `{/* === Gantt Timeline === */}`):

```jsx
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
```

- [ ] **Step 2: Build to verify it compiles**

Run: `bun run build` (di `frontend/`)
Expected: PASS — build Vite sukses tanpa error.

- [ ] **Step 3: Manual browser verification**

Jalankan aplikasi (backend + frontend, mis. `docker compose up -d` lalu akses halaman RPD & Timeline):
1. Sebagai **admin**: kartu "Import Target RPD Bulanan (Excel)" tampil; upload file .xlsx (unit × bulan, header nama bulan) → pesan sukses → tabel "Target RPD Bulanan per Unit" tampil dengan nilai & baris Total.
2. Kolom bulan sesuai header file; bulan kosong tampil `—` di sel target.
3. Kartu "Perbandingan Kumulatif Target vs Kegiatan" per unit: kolom Target / Target Kum. / Kegiatan / Kegiatan Kum. / Selisih benar; selisih negatif berwarna (`level-low`).
4. Belum ada import → "Belum ada target RPD. Upload Excel dulu."
5. Sebagai **operator**: kartu upload tidak tampil; tabel hanya unit milik operator (jika ada di import).
6. Dark mode: semua warna pakai `var(--...)`, keterbacaan oke.
7. Cetak halaman RPD: kartu upload tidak ikut tercetak (class `no-print`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/RpdGantt.jsx
git commit -m "feat: tampilkan target RPD bulanan per unit di halaman RPD & Timeline"
```

---

## Catatan Implementasi

- **Path migrasi:** `db/migrations/` di repo root (spec menulis `backend/src/db/migrations/` — itu keliru; `scripts/migrate.ts` memakai `path.resolve(import.meta.dir, "../../db/migrations")`).
- **Pertanyaan terbuka spec (di-defer):** format persis file Excel riil (nama sheet, bentuk header bulan) dan penampilan selisih negatif (warna vs kolom %) — disesuaikan saat verifikasi manual Task 5 tanpa mengubah data/API.
- **Tidak ada perubahan** pada `db/init.sql`, `docker-compose*`, `frontend/src/index.css`, atau dependency baru.
