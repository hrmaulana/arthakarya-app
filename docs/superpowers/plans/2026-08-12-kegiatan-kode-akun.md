# Rincian Mata Anggaran Memakai Kode Akun — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Item "rincian mata anggaran" pada halaman Tambah/Edit Kegiatan hanya boleh memakai kode akun yang sudah ada di sistem (dari data monitoring SAKTI), bukan teks bebas.

**Architecture:** Client memilih kode akun via combobox pencarian; client hanya mengirim `kode_akun` + `jumlah_rp` + `keterangan`. Server me-resolve `nama_akun` dari import monitoring terbaru dan menyimpannya ke kolom `nama_item` (agar kueri downstream rekap/cetak/SPPD tetap bekerja). Kolom `kode_akun` ditambahkan ke tabel `mata_anggaran` lewat migrasi.

**Tech Stack:** React 18 + Vite (frontend), Bun + Express + TypeScript + Zod + pg (backend), PostgreSQL 16, bun:test (backend).

## Global Constraints

- Migrasi SQL baru = file baru di `db/migrations/` (urutan alfabet, satu transaksi per file). Runner: `backend/scripts/migrate.ts`, urut alfabetis.
- Backend test: `cd backend && bun test` — butuh DB test (default `postgresql://arthakarya:arthakarya_secret@localhost:5433/arthakarya_test`, container `arthakarya_test_pg`). Skema dibuat dari `db/init.sql` + `runMigrations` di `beforeAll`.
- Frontend build: `cd frontend && bun run build`. Typecheck backend: `cd backend && bun run typecheck`.
- Desain frontend: semua styling di `frontend/src/index.css`, pakai `var()` tema (light **dan** dark), tanpa library baru. Jangan hardcode hex.
- `mata_anggaran.nama_item` TETAP dipakai sebagai nama tampilan (isi = `nama_akun` hasil resolve). Client **tidak** lagi mengirim `nama_item`.
- Daftar akun = distinct `kode_akun, nama_akun` dari import monitoring **terbaru** (`MAX(id)` pada `monitoring_imports`).
- Kode akun boleh duplikat dalam satu kegiatan (tanpa cek unik).

---

### Task 1: Migrasi kolom `kode_akun`

**Files:**
- Create: `db/migrations/006_kegiatan_kode_akun.sql`

**Interfaces:**
- Produces: kolom `mata_anggaran.kode_akun VARCHAR(20)` (nullable). Dipakai Task 3 (insert `kode_akun`) dan Task 5 (baca kembali saat edit).

- [ ] **Step 1: Buat file migrasi**

`db/migrations/006_kegiatan_kode_akun.sql`:
```sql
-- 006_kegiatan_kode_akun.sql
-- Rincian mata anggaran kini diikat ke kode akun dari data monitoring (SAKTI).
-- kode_akun nullable: baris lama tetap aman, baris baru selalu terisi.
ALTER TABLE mata_anggaran ADD COLUMN kode_akun VARCHAR(20);
```

- [ ] **Step 2: Jalankan migrasi terhadap DB test**

Pastikan container DB test aktif (`docker compose up -d arthakarya_test_pg` atau sesuai runbook). Lalu:
```bash
cd backend
DATABASE_URL=postgresql://arthakarya:arthakarya_secret@localhost:5433/arthakarya_test bun run migrate
```
Expected: log `[migrate] applied 006_kegiatan_kode_akun.sql` dan tidak ada error.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/006_kegiatan_kode_akun.sql
git commit -m "feat: migrasi kode_akun di mata_anggaran"
```

---

### Task 2: Endpoint daftar akun `GET /api/reference/akun`

**Files:**
- Modify: `backend/src/routes/reference.ts`
- Test: `backend/tests/integration.test.ts` (tambah `TRUNCATE` monitoring di `beforeEach` + describe baru "Reference Akun")

**Interfaces:**
- Produces: `GET /api/reference/akun` (auth) → `{ data: [{ kode_akun, nama_akun }, ...] }`, distinct dari import terbaru. Dipakai Task 5 (frontend).
- Consumes: tabel `monitoring_imports` / `monitoring_anggaran` (sudah ada dari migrasi `003`).

- [ ] **Step 1: Tulis test gagal**

Di `backend/tests/integration.test.ts`:

Ubah `beforeEach` agar monitoring ikut di-truncate (line 102–104):
```ts
await pool.query(
  `TRUNCATE kegiatan, mata_anggaran, monitoring_imports, monitoring_anggaran, users, unit_kerja, jenis_kegiatan RESTART IDENTITY CASCADE`
);
```

Tambahkan describe baru setelah describe "Kegiatan & RBAC" (sebelum describe "Rekap"):
```ts
// ============================================================
// REFERENCE AKUN
// ============================================================

describe("Reference Akun", () => {
  beforeEach(async () => {
    // Import lama (tidak boleh muncul) + import terbaru (harus muncul)
    const imp1 = await pool.query(
      `INSERT INTO monitoring_imports (filename, uploaded_by, total_rows, periode)
       VALUES ('lama.xlsx', 1, 1, 'Periode Lama') RETURNING id`
    );
    await pool.query(
      `INSERT INTO monitoring_anggaran
         (import_id, unit_kerja_id, kode_akun, nama_akun, pagu_revisi, realisasi_periode_lalu, realisasi_periode_ini, realisasi_sd_periode)
       VALUES ($1, 1, '111111', 'Akun Lama', 100, 0, 0, 0)`,
      [imp1.rows[0].id]
    );

    const imp2 = await pool.query(
      `INSERT INTO monitoring_imports (filename, uploaded_by, total_rows, periode)
       VALUES ('baru.xlsx', 1, 2, 'Periode Baru') RETURNING id`
    );
    await pool.query(
      `INSERT INTO monitoring_anggaran
         (import_id, unit_kerja_id, kode_akun, nama_akun, pagu_revisi, realisasi_periode_lalu, realisasi_periode_ini, realisasi_sd_periode)
       VALUES ($1, 1, '522111', 'Belanja Barang Non Operasional', 1000000, 0, 0, 0),
              ($1, 2, '522131', 'Belanja Jasa Profesi', 500000, 0, 0, 0)`,
      [imp2.rows[0].id]
    );
  });

  it("GET /reference/akun → distinct dari import terbaru", async () => {
    const res = await api("GET", "/api/reference/akun", undefined, adminToken);
    expect(res.status).toBe(200);
    const akun = res.body.data;
    expect(akun.length).toBe(2);
    expect(akun).toEqual(
      expect.arrayContaining([
        { kode_akun: "522111", nama_akun: "Belanja Barang Non Operasional" },
        { kode_akun: "522131", nama_akun: "Belanja Jasa Profesi" },
      ])
    );
    // Akun dari import lama tidak muncul
    expect(akun.some((a: any) => a.kode_akun === "111111")).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test → harus gagal**

```bash
cd backend
bun test
```
Expected: test "Reference Akun › GET /reference/akun …" FAIL dengan status 404 (route belum ada). Test lain tetap lewat.

- [ ] **Step 3: Implementasi endpoint**

Di `backend/src/routes/reference.ts`, tambahkan sebelum `export default router;`:
```ts
// GET /api/reference/akun — daftar kode akun dari import monitoring terbaru
router.get("/akun", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT kode_akun, nama_akun
       FROM monitoring_anggaran
       WHERE import_id = (SELECT MAX(id) FROM monitoring_imports)
       ORDER BY kode_akun`
    );
    res.json({ data: result.rows });
  } catch (err: any) {
    logger.error("ref_akun_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data kode akun." });
  }
});
```

- [ ] **Step 4: Jalankan test → harus lewat**

```bash
cd backend
bun test
```
Expected: semua test PASS (termasuk "Reference Akun").

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/reference.ts backend/tests/integration.test.ts
git commit -m "feat: endpoint reference/akun — daftar kode akun dari import monitoring terbaru"
```

---

### Task 3: Backend kegiatan — validasi `kode_akun` + resolve `nama_akun`

**Files:**
- Modify: `backend/src/validation.ts` (schema `mataAnggaranItemSchema`)
- Modify: `backend/src/types.ts` (interface `MataAnggaran`)
- Modify: `backend/src/routes/kegiatan.ts` (helper `resolveNamaAkun`, POST & PUT)
- Test: `backend/tests/integration.test.ts` (seed monitoring di describe Kegiatan, update `kegiatanPayload`, test negatif, test baru)

**Interfaces:**
- Produces: `POST /api/kegiatan` dan `PUT /api/kegiatan/:id` menerima `mata_anggaran: [{ kode_akun, jumlah_rp, keterangan? }]`, menyimpan `kode_akun` + `nama_item` (nama akun hasil resolve). Kode akun tidak dikenal → 400 `"Kode akun \"<kode>\" tidak ditemukan."`.
- Consumes: helper `resolveNamaAkun(kodeAkun): Promise<string | null>`; kolom `mata_anggaran.kode_akun` (Task 1).

- [ ] **Step 1: Update schema validasi**

`backend/src/validation.ts` — ganti `mataAnggaranItemSchema` (baris 49–60):
```ts
const mataAnggaranItemSchema = z.object({
  kode_akun: z
    .string()
    .trim()
    .min(1, "kode_akun wajib diisi.")
    .max(20, "kode_akun maksimal 20 karakter."),
  jumlah_rp: z
    .number({ invalid_type_error: "jumlah_rp harus berupa angka." })
    .int("jumlah_rp harus berupa angka bulat.")
    .min(0, "jumlah_rp tidak boleh negatif."),
  keterangan: z.string().trim().max(2000).optional().nullable(),
});
```

- [ ] **Step 2: Update tipe**

`backend/src/types.ts` — interface `MataAnggaran`:
```ts
export interface MataAnggaran {
  id?: number;
  kegiatan_id?: number;
  kode_akun?: string; // null untuk baris legacy (diketik bebas sebelum fitur ini)
  nama_item: string;
  jumlah_rp: number;
  keterangan?: string;
}
```

- [ ] **Step 3: Tambah helper + ubah POST/PUT**

`backend/src/routes/kegiatan.ts` — tambah helper setelah imports (sebelum `const router`):
```ts
// Resolve nama akun dari import monitoring terbaru; null jika kode akun tak dikenal
async function resolveNamaAkun(kodeAkun: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT nama_akun FROM monitoring_anggaran
     WHERE kode_akun = $1
       AND import_id = (SELECT MAX(id) FROM monitoring_imports)
     LIMIT 1`,
    [kodeAkun]
  );
  return r.rows[0]?.nama_akun ?? null;
}
```

**POST** — ganti blok mulai `await client.query("BEGIN");` (baris 120) sampai selesai insert mata anggaran. Resolve dilakukan SEBELUM `BEGIN` agar kode tak dikenal bisa 400 tanpa transaksi menggantung:
```ts
const body = req.body;
const user = req.user!;

// Resolve nama akun sebelum transaksi (read-only) — kode tak dikenal → 400
const resolvedItems: { kode_akun: string; nama_item: string; jumlah_rp: number; keterangan: string | null }[] = [];
for (const item of body.mata_anggaran) {
  const namaAkun = await resolveNamaAkun(item.kode_akun);
  if (!namaAkun) {
    res.status(400).json({ error: `Kode akun "${item.kode_akun}" tidak ditemukan.` });
    return;
  }
  resolvedItems.push({
    kode_akun: item.kode_akun,
    nama_item: namaAkun,
    jumlah_rp: item.jumlah_rp,
    keterangan: item.keterangan || null,
  });
}

await client.query("BEGIN");

const kegiatanResult = await client.query(
  `INSERT INTO kegiatan (unit_kerja_id, jenis_kegiatan_id, created_by, nama_kegiatan, tanggal, status)
   VALUES ($1, $2, $3, $4, $5, $6)
   RETURNING *`,
  [
    body.unit_kerja_id,
    body.jenis_kegiatan_id,
    user.userId,
    body.nama_kegiatan.trim(),
    body.tanggal,
    body.status || "draft",
  ]
);

const kegiatan = kegiatanResult.rows[0];

const mataItems: MataAnggaran[] = [];
for (const item of resolvedItems) {
  const mataResult = await client.query(
    `INSERT INTO mata_anggaran (kegiatan_id, kode_akun, nama_item, jumlah_rp, keterangan)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [kegiatan.id, item.kode_akun, item.nama_item, item.jumlah_rp, item.keterangan]
  );
  mataItems.push(mataResult.rows[0]);
}

await client.query("COMMIT");

res.status(201).json({
  data: { ...kegiatan, mata_anggaran: mataItems },
  message: "Kegiatan berhasil dibuat.",
});
```

**PUT** — setelah cek status `disetujui` (sebelum `await client.query("BEGIN");` di baris 199), tambahkan resolve yang sama. Perhatikan `mata_anggaran` bersifat opsional di PUT — guard dengan `if (body.mata_anggaran)`:
```ts
const resolvedItems: { kode_akun: string; nama_item: string; jumlah_rp: number; keterangan: string | null }[] = [];
if (body.mata_anggaran) {
  for (const item of body.mata_anggaran) {
    const namaAkun = await resolveNamaAkun(item.kode_akun);
    if (!namaAkun) {
      res.status(400).json({ error: `Kode akun "${item.kode_akun}" tidak ditemukan.` });
      return;
    }
    resolvedItems.push({
      kode_akun: item.kode_akun,
      nama_item: namaAkun,
      jumlah_rp: item.jumlah_rp,
      keterangan: item.keterangan || null,
    });
  }
}
```
Ganti blok insert di PUT (baris 221–234) menjadi:
```ts
if (body.mata_anggaran) {
  await client.query("DELETE FROM mata_anggaran WHERE kegiatan_id = $1", [id]);

  const mataItems: MataAnggaran[] = [];
  for (const item of resolvedItems) {
    const mataResult = await client.query(
      `INSERT INTO mata_anggaran (kegiatan_id, kode_akun, nama_item, jumlah_rp, keterangan)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [Number(id), item.kode_akun, item.nama_item, item.jumlah_rp, item.keterangan]
    );
    mataItems.push(mataResult.rows[0]);
  }

  await client.query("COMMIT");
  res.json({
    data: { ...kegiatan, mata_anggaran: mataItems },
    message: "Kegiatan berhasil diperbarui.",
  });
}
```

- [ ] **Step 4: Update test kegiatan (fail dulu sebelum implementasi)**

`backend/tests/integration.test.ts`:

**(a)** Di describe `"Kegiatan & RBAC"` (baris 370), tambahkan `beforeEach` setelah `describe("Kegiatan & RBAC", () => {` untuk seed monitoring:
```ts
beforeEach(async () => {
  // Seed monitoring agar resolve nama_akun bekerja
  const imp = await pool.query(
    `INSERT INTO monitoring_imports (filename, uploaded_by, total_rows, periode)
     VALUES ('uji.xlsx', 1, 2, 'Periode Uji') RETURNING id`
  );
  await pool.query(
    `INSERT INTO monitoring_anggaran
       (import_id, unit_kerja_id, kode_akun, nama_akun, pagu_revisi, realisasi_periode_lalu, realisasi_periode_ini, realisasi_sd_periode)
     VALUES ($1, 1, '522111', 'Belanja Barang Non Operasional', 1000000, 0, 0, 0),
            ($1, 1, '522131', 'Belanja Jasa Profesi', 500000, 0, 0, 0)`,
    [imp.rows[0].id]
  );
});
```

**(b)** Update `kegiatanPayload` (baris 120–130):
```ts
const kegiatanPayload = {
  nama_kegiatan: "Rapat Koordinasi Uji",
  tanggal: "2026-08-10",
  unit_kerja_id: 1,
  jenis_kegiatan_id: 1,
  status: "draft",
  mata_anggaran: [
    { kode_akun: "522111", jumlah_rp: 500000, keterangan: "snack" },
    { kode_akun: "522131", jumlah_rp: 250000 },
  ],
};
```

**(c)** Update test "validasi zod: jumlah_rp negatif → 400" (baris 394–405):
```ts
it("validasi zod: jumlah_rp negatif → 400", async () => {
  const res = await api(
    "POST",
    "/api/kegiatan",
    {
      ...kegiatanPayload,
      mata_anggaran: [{ kode_akun: "522111", jumlah_rp: -5 }],
    },
    op1Token
  );
  expect(res.status).toBe(400);
});
```

**(d)** Tambahkan test baru di dalam describe `"Kegiatan & RBAC"`:
```ts
it("POST menyimpan kode_akun & nama_item hasil resolve", async () => {
  const res = await api("POST", "/api/kegiatan", kegiatanPayload, op1Token);
  expect(res.status).toBe(201);
  expect(res.body.data.mata_anggaran[0].kode_akun).toBe("522111");
  expect(res.body.data.mata_anggaran[0].nama_item).toBe("Belanja Barang Non Operasional");
});

it("kode akun tidak dikenal → 400", async () => {
  const res = await api(
    "POST",
    "/api/kegiatan",
    { ...kegiatanPayload, mata_anggaran: [{ kode_akun: "999999", jumlah_rp: 1000 }] },
    op1Token
  );
  expect(res.status).toBe(400);
  expect(res.body.error).toContain("tidak ditemukan");
});

it("validasi zod: kode_akun kosong → 400", async () => {
  const res = await api(
    "POST",
    "/api/kegiatan",
    { ...kegiatanPayload, mata_anggaran: [{ kode_akun: "", jumlah_rp: 500000 }] },
    op1Token
  );
  expect(res.status).toBe(400);
});
```

- [ ] **Step 5: Jalankan test → harus gagal (belum implementasi)**

```bash
cd backend
bun test
```
Expected: test kegiatan yang POST `kegiatanPayload` gagal (zod menolak karena `kode_akun` tak dikenal / schema masih butuh `nama_item`). Ini test merah yang valid.

- [ ] **Step 6: Implementasi (Step 1–3 selesai) → jalankan test**

```bash
cd backend
bun test
bun run typecheck
```
Expected: semua test PASS dan typecheck bersih.

- [ ] **Step 7: Commit**

```bash
git add backend/src/validation.ts backend/src/types.ts backend/src/routes/kegiatan.ts backend/tests/integration.test.ts
git commit -m "feat: rincian mata anggaran memakai kode akun — validasi + resolve nama_akun di server"
```

---

### Task 4: Frontend — komponen `AkunCombobox` + CSS

**Files:**
- Create: `frontend/src/components/AkunCombobox.jsx`
- Modify: `frontend/src/index.css` (style combobox + `badge-warning` + `akun-display`)

**Interfaces:**
- Produces: `AkunCombobox({ akunList, selected, onChange, readOnly, displayText, placeholder })`.
  - `akunList: [{ kode_akun, nama_akun }]`
  - `selected: { kode_akun, nama_akun } | null`
  - `onChange(akun | null)` — dipanggil saat pilih (objek akun) atau saat ketik mengosongkan pilihan (null)
  - `readOnly?: boolean` — render teks polos
  - `displayText?: string` — fallback teks saat readOnly & selected null (mis. item legacy)
  - `placeholder?: string`
- Dipakai Task 5.

- [ ] **Step 1: Buat komponen**

`frontend/src/components/AkunCombobox.jsx`:
```jsx
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
```

- [ ] **Step 2: Tambah CSS**

Di `frontend/src/index.css`, tambahkan blok (letakkan di area komponen form/dropdown yang sudah ada, mis. setelah `.badge-pertanggungjawaban` sekitar baris 460, atau dekat `.table-wrapper`):
```css
/* ---------- Combobox kode akun ---------- */
.combobox { position: relative; }
.combobox-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 240px;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
}
.combobox-option {
  padding: 8px 10px;
  border-radius: calc(var(--radius) - 2px);
  cursor: pointer;
  color: var(--text);
  font-size: 0.875rem;
}
.combobox-option strong { color: var(--primary); font-weight: 600; margin-right: 4px; }
.combobox-option-active { background: var(--surface-hover); }
.combobox-empty { padding: 10px; color: var(--text-muted); font-size: 0.85rem; }
.akun-display { font-size: 0.875rem; }
.badge-warning { background: var(--warning-subtle); color: var(--warning); }
```

- [ ] **Step 3: Verifikasi build**

```bash
cd frontend
bun run build
```
Expected: build sukses tanpa error.

- [ ] **Step 4: Verifikasi manual cepat (opsional)**

Jalankan dev: `cd frontend && bun run dev`. Tidak bisa diuji langsung tanpa data — cek hanya memastikan halaman lama tidak error. Verifikasi penuh menyusul di Task 5.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AkunCombobox.jsx frontend/src/index.css
git commit -m "feat: komponen AkunCombobox + style dropdown & badge-warning"
```

---

### Task 5: Frontend — wiring `MataAnggaranTable` + `KegiatanForm`

**Files:**
- Modify: `frontend/src/components/MataAnggaranTable.jsx`
- Modify: `frontend/src/pages/KegiatanForm.jsx`

**Interfaces:**
- Consumes: `AkunCombobox` (Task 4), `GET /api/reference/akun` (Task 2), `parseRupiah` (sudah ada di `MataAnggaranTable.jsx`).
- Produces: `onChange` di `MataAnggaranTable` mengirim `[{ kode_akun, jumlah_rp, keterangan }]` (tanpa `nama_item`). KegiatanForm mevalidasi semua baris punya `kode_akun` sebelum submit.

- [ ] **Step 1: Ubah `MataAnggaranTable.jsx`**

Import client & useEffect:
```jsx
import { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import client from "../api/client.js";
import AkunCombobox from "./AkunCombobox.jsx";
```

Ganti `emptyItem` & state rows:
```jsx
const emptyItem = { kode_akun: "", nama_item: "", jumlah_rp: "", keterangan: "" };
```
Di dalam komponen, tambah fetch daftar akun:
```jsx
const [akunList, setAkunList] = useState([]);
useEffect(() => {
  client
    .get("/reference/akun")
    .then((res) => setAkunList(res.data.data || []))
    .catch(() => setAkunList([]));
}, []);
```

Ganti state init rows (perhatikan baris legacy: ada `nama_item` tanpa `kode_akun`):
```jsx
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
```

Ganti helper `toPayload` (pakai di `updateRow`, `removeRow`, dan `selectAkun`):
```jsx
const toPayload = (rs) =>
  rs
    .filter((r) => r.kode_akun.trim() !== "" || r.jumlah_rp !== "")
    .map((r) => ({
      kode_akun: r.kode_akun.trim(),
      jumlah_rp: parseRupiah(r.jumlah_rp),
      keterangan: r.keterangan.trim() || undefined,
    }));

const notify = (updated) => onChange(toPayload(updated));
```

Ganti `updateRow` & `removeRow` agar memakai `notify(updated)` (isi body tidak berubah selain nama field `nama_item` → `kode_akun`).

Tambah handler pilih akun:
```jsx
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
```

**Render kolom pertama** — ganti `<td>` berisi input `nama_item` (baris 87–97) menjadi:
```jsx
<td>
  {!readOnly && row.kode_akun === "" && row.nama_item !== "" && (
    <div className="badge badge-warning" style={{ marginBottom: 4 }}>
      Item lama: {row.nama_item} — pilih ulang kode akun
    </div>
  )}
  <AkunCombobox
    akunList={akunList}
    selected={row.kode_akun ? { kode_akun: row.kode_akun, nama_akun: row.nama_item } : null}
    onChange={(akun) => selectAkun(i, akun)}
    readOnly={readOnly}
    displayText={row.kode_akun ? undefined : row.nama_item}
  />
</td>
```

**Header tabel** (baris 78): ganti `<th scope="col">Nama Item</th>` menjadi `<th scope="col">Kode Akun</th>`.

**Peringatan daftar akun kosong** — tambahkan di atas `.table-wrapper` (dalam `<div>` pembuka). `.mb-2` sudah dipakai di proyek (mis. `KegiatanForm.jsx`):
```jsx
{!readOnly && akunList.length === 0 && (
  <div className="alert alert-warning mb-2">
    Belum ada data monitoring. Import Excel SAKTI dulu di halaman Monitoring Anggaran.
  </div>
)}
```

- [ ] **Step 2: Ubah `KegiatanForm.jsx`**

Tambahkan validasi setelah cek `mataAnggaran.length === 0` (baris 99–102):
```jsx
if (mataAnggaran.some((item) => !item.kode_akun || !item.kode_akun.trim())) {
  setError("Setiap item mata anggaran wajib memilih kode akun.");
  return;
}
```

Pastikan payload tetap bersih (blok `cleaned` baris 104–108 sudah benar — mempertahankan `kode_akun` dan me-parse `jumlah_rp`):
```jsx
const cleaned = mataAnggaran.map((item) => ({
  ...item,
  jumlah_rp: parseRupiah(item.jumlah_rp),
}));
```

- [ ] **Step 3: Verifikasi build**

```bash
cd frontend
bun run build
```
Expected: build sukses tanpa error.

- [ ] **Step 4: Verifikasi manual di browser**

1. `cd backend && bun run dev` dan `cd frontend && bun run dev` (atau sesuai runbook).
2. Pastikan ada data monitoring (import Excel SAKTI dulu di halaman Monitoring Anggaran, atau seed manual).
3. Buka **Tambah Kegiatan Baru** → di Rincian Mata Anggaran, kolom "Kode Akun": ketik sebagian kode/nama → daftar terfilter → klik pilih → jumlah & keterangan diisi → Simpan.
4. Buka **Edit** kegiatan tersebut → kode akun tampil di combobox, bisa diganti.
5. Tanpa memilih kode akun → tombol simpan memunculkan error "Setiap item mata anggaran wajib memilih kode akun."
6. Cek **mode gelap** (toggle tema) — dropdown & badge tetap terbaca.
7. (Opsional) Buka kegiatan lama ber-`nama_item` bebas → muncul badge "Item lama: … — pilih ulang kode akun"; simpan ditolak sampai dipilih ulang.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MataAnggaranTable.jsx frontend/src/pages/KegiatanForm.jsx
git commit -m "feat: rincian mata anggaran wajib memakai kode akun (combobox) di form kegiatan"
```

---

### Task 6: Regresi — full suite + build

**Files:**
- None (verifikasi). Fix jika ada yang rusak.

**Interfaces:**
- Verifikasi integrasi Task 1–5.

- [ ] **Step 1: Jalankan seluruh test backend**

```bash
cd backend
bun test
bun run typecheck
```
Expected: semua test PASS, typecheck bersih.

- [ ] **Step 2: Jalankan build frontend**

```bash
cd frontend
bun run build
```
Expected: build sukses.

- [ ] **Step 3: Cek kode tidak ada sisa `nama_item` di payload frontend**

```bash
cd /c/Users/PMP/OneDrive/Desktop/ArthaKarya
grep -rn "nama_item" frontend/src/pages/KegiatanForm.jsx frontend/src/components/MataAnggaranTable.jsx
```
Expected: hanya muncul di dalam komponen sebagai state tampilan (`row.nama_item`), TIDAK dikirim sebagai payload.

- [ ] **Step 4: Commit jika ada perbaikan**

Hanya commit bila ada file berubah.

---

## Catatan / Risiko

- **Backend test butuh DB test** (`arthakarya_test_pg`, port 5433) aktif. Jika container mati, jalankan sesuai runbook (`OPS.md`) / docker compose.
- **Data lama tanpa `kode_akun`**: saat edit, wajib dipilih ulang (sesuai keputusan "semua wajib kode akun"). Migrasi TIDAK menghapus data lama.
- **SPPD snapshot** menyimpan `mata_anggaran` sebagai teks (`sppd.ts`) — tidak terpengaruh perubahan bentuk payload.
- **`GET /api/kegiatan/:id`** memakai `SELECT *` → otomatis mengembalikan `kode_akun` untuk baris baru tanpa perubahan route.
