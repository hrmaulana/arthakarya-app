# Filter Unit Kerja di Daftar Kegiatan (Role Admin) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan dropdown "Filter Unit Kerja" khusus admin di halaman Daftar Kegiatan yang memfilter daftar per unit kerja (dengan jumlah kegiatan per unit di dalam dropdown), tanpa mengubah perilaku operator.

**Architecture:** Filter berjalan server-side. `getUnitKerjaFilter()` di `authorize.ts` diubah agar admin menghormati query `?unit_kerja_id=` (validasi numerik; tidak valid → diabaikan). Route `GET /api/kegiatan` memperkenalkan `unitScope` (scope penuh role: admin → `null`, operator → unit sendiri) yang dipakai untuk menghitung opsi dropdown `akun_options` dan `unit_options` — sehingga dropdown unit tetap lengkap walau filter sedang aktif. Frontend menambah state `unitFilter`/`unitOptions` dan merender dropdown admin-only.

**Tech Stack:** Express + TypeScript (backend), React 18 + Vite (frontend), PostgreSQL 16, Bun (test runner).

## Global Constraints

- Operator: perilaku **tidak berubah** — selalu di-scope ke unitnya sendiri oleh middleware/JWT.
- `unit_kerja_id` query tidak valid (bukan angka, ≤ 0) untuk admin → **diabaikan**, perilaku = tanpa filter (guard `Number.isInteger(id) && id > 0`).
- `unitScope` (scope penuh role) dipakai untuk `akun_options` **dan** `unit_options`; **bukan** filter yang sedang aktif (`unitKerjaId`).
- Dropdown unit hanya dirender bila `user?.role === "admin"`; label opsi: `"{nama_unit} ({jml_kegiatan})"`.
- Tidak ada migrasi DB, tidak ada perubahan route/URL.
- Test backend: `bun test --timeout 60000` di `backend/` (butuh container `arthakarya_test_pg` port 5433).
- Verifikasi frontend: `cd frontend && bun run build` (vite build).
- Bahasa UI: Indonesia, konsisten dengan label existing ("Semua Status", "Semua Akun" → "Semua Unit").
- Commit terpisah per task; push HANYA jika diminta user.

---

### Task 1: Backend — `getUnitKerjaFilter()` hormati `?unit_kerja_id=` untuk admin

**Files:**
- Modify: `backend/src/middleware/authorize.ts:60-64`
- Test: `backend/tests/integration.test.ts` (setelah test "operator hanya melihat kegiatan unitnya sendiri", baris ~515)

**Interfaces:**
- Consumes: pola test existing — `api(method, path, body?, token?)`, `kegiatanPayload` (default `unit_kerja_id: 1`), token `adminToken`/`op1Token`/`op2Token`. Catatan: POST via `op2Token` memaksa `unit_kerja_id` dari JWT (= 2), mengabaikan body.
- Produces: `getUnitKerjaFilter(req: Request): { unitKerjaId: number | null }` — kini untuk admin membaca `req.query.unit_kerja_id` bila angka valid.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan dua test baru di dalam describe kegiatan (setelah baris 515, test "operator hanya melihat kegiatan unitnya sendiri"):

```ts
  it("admin dapat memfilter kegiatan per unit via ?unit_kerja_id", async () => {
    await api("POST", "/api/kegiatan", kegiatanPayload, op1Token); // unit 1
    await api("POST", "/api/kegiatan", kegiatanPayload, op2Token); // unit 2

    const res = await api("GET", "/api/kegiatan?unit_kerja_id=2", undefined, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].unit_kerja_id).toBe(2);
  });

  it("admin: unit_kerja_id tidak valid diabaikan (tanpa filter)", async () => {
    await api("POST", "/api/kegiatan", kegiatanPayload, op1Token); // unit 1
    await api("POST", "/api/kegiatan", kegiatanPayload, op2Token); // unit 2

    const res = await api("GET", "/api/kegiatan?unit_kerja_id=abc", undefined, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });
```

- [ ] **Step 2: Jalankan test untuk memverifikasi ia gagal**

Run (dari `backend/`): `bun test tests/integration.test.ts --timeout 60000 -t "admin dapat memfilter"`

Expected: FAIL — `data.length` adalah 2, bukan 1 (admin saat ini mengabaikan query, `getUnitKerjaFilter` selalu `null` untuk admin).

- [ ] **Step 3: Implementasi minimal**

Ubah `getUnitKerjaFilter` di `backend/src/middleware/authorize.ts` (baris 60-64) menjadi:

```ts
export function getUnitKerjaFilter(req: Request): { unitKerjaId: number | null } {
  if (!req.user) return { unitKerjaId: null };
  if (req.user.role === "admin") {
    // Admin dapat memfilter per unit via ?unit_kerja_id= (validasi numerik).
    const q = req.query.unit_kerja_id;
    if (typeof q === "string" && q !== "") {
      const id = Number(q);
      if (Number.isInteger(id) && id > 0) return { unitKerjaId: id };
    }
    return { unitKerjaId: null };
  }
  return { unitKerjaId: req.user.unit_kerja_id };
}
```

- [ ] **Step 4: Jalankan test untuk memverifikasi ia lulus**

Run: `bun test tests/integration.test.ts --timeout 60000`

Expected: PASS untuk kedua test baru; test existing (termasuk "operator hanya melihat kegiatan unitnya sendiri") tetap hijau.

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/authorize.ts backend/tests/integration.test.ts
git commit -m "feat: admin dapat memfilter kegiatan per unit kerja via ?unit_kerja_id"
```

---

### Task 2: Backend — `unitScope` + `meta.unit_options` di GET /api/kegiatan

**Files:**
- Modify: `backend/src/routes/kegiatan.ts:53-134` (handler GET /)
- Test: `backend/tests/integration.test.ts` (tambahan, setelah test Task 1)

**Interfaces:**
- Consumes: `getUnitKerjaFilter(req)` dari Task 1 (kini memfilter admin via query).
- Produces: respons `GET /api/kegiatan` menjadi `{ data, meta: { akun_options, unit_options } }`; baris `unit_options` berbentuk `{ id: number, nama_unit: string, jml_kegiatan: string }` (COUNT bigint → string via pg — frontend cukup menampilkannya).

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan test berikut (setelah test Task 1):

```ts
  it("meta.unit_options berisi semua unit dengan jumlah kegiatan", async () => {
    await api("POST", "/api/kegiatan", kegiatanPayload, op1Token); // unit 1: 1 kegiatan
    await api("POST", "/api/kegiatan", kegiatanPayload, op1Token); // unit 1: 2 kegiatan
    await api("POST", "/api/kegiatan", kegiatanPayload, op2Token); // unit 2: 1 kegiatan

    const res = await api("GET", "/api/kegiatan", undefined, adminToken);
    expect(res.body.meta.unit_options).toBeDefined();
    const opts = res.body.meta.unit_options;
    expect(opts.length).toBe(2);
    const unit1 = opts.find((o: any) => o.id === 1);
    const unit2 = opts.find((o: any) => o.id === 2);
    expect(unit1.nama_unit).toBe("Unit Uji Satu");
    expect(Number(unit1.jml_kegiatan)).toBe(2);
    expect(unit2.nama_unit).toBe("Unit Uji Dua");
    expect(Number(unit2.jml_kegiatan)).toBe(1);

    // Tetap lengkap walau filter unit aktif (unitScope ≠ filter aktif)
    const filtered = await api("GET", "/api/kegiatan?unit_kerja_id=2", undefined, adminToken);
    expect(filtered.body.meta.unit_options.length).toBe(2);
  });
```

- [ ] **Step 2: Jalankan test untuk memverifikasi ia gagal**

Run: `bun test tests/integration.test.ts --timeout 60000 -t "meta.unit_options"`

Expected: FAIL pada `expect(res.body.meta.unit_options).toBeDefined()` — `unit_options` belum ada di meta (assertion failure yang bersih, bukan TypeError).

- [ ] **Step 3: Implementasi minimal**

Di `backend/src/routes/kegiatan.ts`, dalam handler GET / (awal fungsi, baris ~54):

```ts
    const { unitKerjaId } = getUnitKerjaFilter(req);
    // Scope penuh role untuk opsi dropdown — TIDAK mengikuti filter aktif.
    // Admin: null (lihat semua unit); Operator: selalu unitnya sendiri.
    const unitScope = req.user?.role === "admin" ? null : (req.user?.unit_kerja_id ?? null);
    const { status, kode_akun, sort, order } = req.query;
```

Ubah blok opsi akun (baris 110-127) agar memakai `unitScope` (bukan `unitKerjaId`), lalu tambah kueri `unit_options` setelahnya:

```ts
    // Opsi akun untuk dropdown filter (scope penuh role, tanpa filter akun/unit)
    let akunQuery = `
      SELECT ma.kode_akun, COUNT(DISTINCT k.id) AS jml_kegiatan,
             (SELECT mo.nama_akun FROM monitoring_anggaran mo
              WHERE mo.kode_akun = ma.kode_akun
                AND mo.import_id = (SELECT MAX(id) FROM monitoring_imports)
              LIMIT 1) AS nama_akun
      FROM mata_anggaran ma
      JOIN kegiatan k ON k.id = ma.kegiatan_id
      WHERE ma.kode_akun IS NOT NULL AND ma.kode_akun <> ''
    `;
    const akunParams: any[] = [];
    if (unitScope !== null) {
      akunParams.push(unitScope);
      akunQuery += ` AND k.unit_kerja_id = $${akunParams.length}`;
    }
    akunQuery += ` GROUP BY ma.kode_akun ORDER BY ma.kode_akun`;
    const akunResult = await pool.query(akunQuery, akunParams);

    // Opsi unit untuk dropdown filter (scope penuh role — admin selalu semua unit)
    let unitQuery = `
      SELECT uk.id, uk.nama_unit, COUNT(DISTINCT k.id) AS jml_kegiatan
      FROM unit_kerja uk
      LEFT JOIN kegiatan k ON k.unit_kerja_id = uk.id
      WHERE 1=1
    `;
    const unitParams: any[] = [];
    if (unitScope !== null) {
      unitParams.push(unitScope);
      unitQuery += ` AND k.unit_kerja_id = $${unitParams.length}`;
    }
    unitQuery += ` GROUP BY uk.id, uk.nama_unit ORDER BY uk.nama_unit`;
    const unitResult = await pool.query(unitQuery, unitParams);

    res.json({ data: result.rows, meta: { akun_options: akunResult.rows, unit_options: unitResult.rows } });
```

`LEFT JOIN` dipakai agar unit tanpa kegiatan tetap muncul dengan `jml_kegiatan = 0`. Kueri utama (main query) tetap memakai `unitKerjaId` — tidak berubah.

- [ ] **Step 4: Jalankan test untuk memverifikasi ia lulus**

Run: `bun test tests/integration.test.ts --timeout 60000`

Expected: PASS test `unit_options`; seluruh suite hijau.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/kegiatan.ts backend/tests/integration.test.ts
git commit -m "feat: tambah meta.unit_options di GET /api/kegiatan"
```

---

### Task 3: Frontend — dropdown "Filter Unit Kerja" (khusus admin)

**Files:**
- Modify: `frontend/src/pages/KegiatanList.jsx` (state, fetchData, dropdown, empty-state)

**Interfaces:**
- Consumes: `useOutletContext()` → `{ formatRupiah, user }` (sudah ada); `res.data.meta.unit_options` dari Task 2.
- Produces: state `unitFilter: string` ("" = semua) dan `unitOptions: array`; param fetch `unit_kerja_id`.

- [ ] **Step 1: Tambah state**

Di `frontend/src/pages/KegiatanList.jsx`, setelah `const [akunFilter, setAkunFilter] = useState("");` (baris 36):

```jsx
  const [unitFilter, setUnitFilter] = useState("");
  const [unitOptions, setUnitOptions] = useState([]);
```

- [ ] **Step 2: Kirim param + simpan unit_options di fetchData**

Ubah `fetchData` (baris 39-57):

```jsx
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (akunFilter) params.kode_akun = akunFilter;
      if (unitFilter) params.unit_kerja_id = unitFilter;
      const [sortBy, order] = sortKey.split(":");
      params.sort = sortBy;
      params.order = order;
      const res = await client.get("/kegiatan", { params });
      setKegiatan(res.data.data);
      setAkunOptions(res.data.meta?.akun_options || []);
      setUnitOptions(res.data.meta?.unit_options || []);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal mengambil data.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, akunFilter, unitFilter, sortKey]);
```

- [ ] **Step 3: Render dropdown admin-only**

Di dalam `.form-row` (setelah grup "Filter Akun", sebelum grup "Urutkan", baris ~156), sisipkan:

```jsx
          {user?.role === "admin" && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Filter Unit Kerja</label>
              <select
                className="form-control"
                value={unitFilter}
                onChange={(e) => setUnitFilter(e.target.value)}
              >
                <option value="">Semua Unit</option>
                {unitOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nama_unit} ({u.jml_kegiatan})
                  </option>
                ))}
              </select>
            </div>
          )}
```

- [ ] **Step 4: Perbarui teks empty-state**

Ubah blok empty-state (baris 181-191):

```jsx
            <p>
              {statusFilter || akunFilter || unitFilter
                ? "Tidak ada kegiatan dengan filter yang dipilih."
                : "🔍 Belum ada kegiatan."}
            </p>
            {!statusFilter && !akunFilter && !unitFilter && (
              <Link to="/kegiatan/new" className="btn btn-primary mt-2">
                Buat Kegiatan Pertama
              </Link>
            )}
```

- [ ] **Step 5: Verifikasi build**

Run: `cd frontend && bun run build`

Expected: build sukses tanpa error. (Tidak ada unit test framework di frontend; verifikasi via vite build + review JSX.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/KegiatanList.jsx
git commit -m "feat: dropdown filter unit kerja di daftar kegiatan (admin)"
```

---

### Task 4: Regression penuh + refresh graph

**Files:**
- None (verifikasi)

- [ ] **Step 1: Jalankan seluruh suite backend**

Run (dari `backend/`): `bun test --timeout 60000`

Expected: seluruh test hijau (termasuk regression "operator hanya melihat kegiatan unitnya sendiri" dan "admin tanpa query melihat semua unit").

- [ ] **Step 2: Verifikasi build frontend**

Run: `cd frontend && bun run build`

Expected: build sukses.

- [ ] **Step 3: Refresh graphify (per CLAUDE.md)**

Run: `graphify update .`

Expected: selesai tanpa error (AST-only, tanpa biaya API). `graphify-out/` gitignored → tidak perlu commit.

- [ ] **Step 4: Laporkan hasil**

Ringkas ke user: file yang berubah, hasil test, status build. Tanyakan apakah mau di-commit ke branch + push (sesuai konvensi: commit/push hanya bila diminta).

---

## Self-Review

**1. Spec coverage:**
- `getUnitKerjaFilter` hormati `?unit_kerja_id=` → Task 1 (termasuk validasi & test tidak-valid).
- `unitScope` (scope penuh role) untuk `akun_options` + `unit_options` → Task 2 (test memverifikasi dropdown tetap lengkap saat filter aktif).
- `meta.unit_options` SQL (LEFT JOIN + COUNT DISTINCT, ORDER BY nama_unit) → Task 2.
- Dropdown admin-only + label `"{nama_unit} ({jml_kegiatan})"` → Task 3.
- `fetchData` kirim `unit_kerja_id`, deps `useCallback` diperbarui → Task 3.
- Empty-state menyebut filter unit → Task 3.
- Regression: operator scoping + admin tanpa query → Task 4 (existing test baris 505-515 tetap hijau).
- Tidak ada migrasi DB / perubahan route → dipenuhi (tidak ada task semacam itu).

**2. Placeholder scan:** Semua langkah berisi kode lengkap; tidak ada "TBD"/"TODO"/"similar to".

**3. Type consistency:** `getUnitKerjaFilter` → `{ unitKerjaId: number | null }` konsisten. `unitScope` bertipe `number | null` dipakai konsisten di kedua kueri opsi. `unit_options` baris: `{ id, nama_unit, jml_kegiatan }` (jml_kegiatan string dari pg) konsisten antara test (`Number(...)`) dan frontend (render langsung). State frontend `unitFilter`/`unitOptions` dipakai konsisten di fetchData, dropdown, dan empty-state.
