# Live Refresh Halaman RPD via SSE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halaman `/monitoring/rpd-timeline` otomatis memuat ulang datanya saat data berubah (import RPD target atau mutasi kegiatan) tanpa refresh manual, lewat **Server-Sent Events (SSE)**.

**Architecture:** Backend menyimpan hub in-memory (`Set<Response>`) di `backend/src/events.ts`. Mutasi yang berhasil memanggil `broadcast(payload)` → seluruh klien SSE yang terhubung menerima frame `data: {json}\n\n`. Frontend membuka `EventSource("/api/rekap/events?token=...")` di halaman RPD dan refetch 3 endpoint data secara *silent* (tanpa spinner) saat ada pesan, dengan guard in-flight + debounce 300 ms + skip saat tab hidden.

**Tech Stack:** Bun + Express + TypeScript (backend) · React 18 + Vite (frontend) · PostgreSQL 16. Tanpa dependency baru. Tanpa perubahan DB.

## Global Constraints

- **Auth SSE = token JWT di query param** (`?token=`). EventSource tidak bisa menyetel header `Authorization`, jadi endpoint `/api/rekap/events` **tidak boleh** bergantung pada `authMiddleware` (yang hanya membaca header).
- **DEVASI DARI SPEC (baris 48):** spec menulis endpoint "berada setelah `router.use(authMiddleware)`" — kalimat itu tidak layak karena auth header-only menolak EventSource. Perbaikan: route `/events` didaftarkan **sebelum** `router.use(authMiddleware)` dan memvalidasi token dari `?token=` query (atau header `Authorization` bila ada). Ini sejalan dengan keputusan auth spec sendiri (query token, baris 17 & 77).
- Broadcast hanya **setelah commit/transaksi sukses** — bukan di dalam transaksi, bukan saat error.
- Pemicu broadcast **hanya dua**: (1) sukses `POST /api/rekap/rpd-target/import` → `{ type: "rpd-target", tahun }`; (2) sukses mutasi kegiatan (`POST`, `PUT`, `DELETE`, `PATCH /:id/status`) → `{ type: "kegiatan" }`.
- Hub in-memory satu instance per proses server (arsitektur single-instance deploy saat ini).
- Design system frontend: styling hanya di `frontend/src/index.css`, semua warna via `var()` (light di `:root`, dark di `[data-theme="dark"]`), jangan hardcode hex, jangan tambah library.
- Test backend: `bun test` (dari `backend/`), butuh container `arthakarya_test_pg` port 5433. Frontend tanpa test runner — verifikasi via `bun run build`.
- Jangan commit/ubah `frontend/bun.lock` (untracked, pre-existing) dan jangan stage `frontend/vite.config.worktree.js` (scratch).

---

### Task 1: Backend — event hub `backend/src/events.ts` + unit test

**Files:**
- Create: `backend/src/events.ts`
- Test: `backend/tests/events.test.ts`

**Interfaces:**
- Consumes: `Response` (express). Tidak menyentuh DB.
- Produces (dipakai Task 2 & 3):
  - `openSse(res: Response): void` — set header SSE, tulis `retry: 3000` + event `connected`, daftarkan klien, keepalive ping 25 dtk, cleanup saat close.
  - `broadcast(payload: object): void` — tulis `data: {json}\n\n` ke tiap klien; klien yang error dibuang.
  - `addSseClient(res: Response): void` / `removeSseClient(res: Response): void` — dipakai hub & test.

- [ ] **Step 1: Write the failing unit test**

`backend/tests/events.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { addSseClient, broadcast } from "../src/events.js";

// Fake Express Response — cukup untuk menguji hub (hanya butuh .write/.on).
function fakeRes() {
  const writes: string[] = [];
  return {
    writes,
    write: (s: string) => {
      writes.push(s);
      return true;
    },
    on: () => {},
  };
}

describe("events hub", () => {
  it("broadcast menulis frame `data: JSON` ke setiap klien", () => {
    const a = fakeRes();
    const b = fakeRes();
    addSseClient(a as any);
    addSseClient(b as any);

    broadcast({ type: "kegiatan" });

    expect(a.writes.join("")).toBe('data: {"type":"kegiatan"}\n\n');
    expect(b.writes.join("")).toBe('data: {"type":"kegiatan"}\n\n');
  });

  it("klien yang error dibuang (tidak dipanggil pada broadcast berikutnya)", () => {
    let calls = 0;
    const dead = {
      write: () => {
        calls++;
        throw new Error("socket gone");
      },
      on: () => {},
    };
    addSseClient(dead as any);

    broadcast({ type: "a" });
    broadcast({ type: "b" });

    expect(calls).toBe(1); // hanya broadcast pertama yang menyentuh klien mati
  });

  it("satu klien error tidak menggagalkan klien lain", () => {
    const ok = fakeRes();
    const dead = {
      write: () => {
        throw new Error("socket gone");
      },
      on: () => {},
    };
    addSseClient(dead as any);
    addSseClient(ok as any);

    broadcast({ type: "rpd-target", tahun: 2026 });

    expect(ok.writes.join("")).toBe('data: {"type":"rpd-target","tahun":2026}\n\n');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (dari `backend/`): `bun test tests/events.test.ts`
Expected: FAIL — `Cannot find module "../src/events.js"` (file belum ada).

- [ ] **Step 3: Write minimal implementation**

`backend/src/events.ts`:

```ts
// SSE event hub — in-memory, satu instance per proses server.
// Broadcast hanya menjangkau klien di proses ini (sesuai arsitektur single-instance).
import type { Response } from "express";

const clients = new Set<Response>();

export function addSseClient(res: Response): void {
  clients.add(res);
}

export function removeSseClient(res: Response): void {
  clients.delete(res);
}

// Tulis satu event ke semua klien. Klien yang error/sudah tutup dibuang
// agar satu klien bermasalah tidak menggagalkan yang lain.
export function broadcast(payload: object): void {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      removeSseClient(res);
    }
  }
}

// Buka koneksi SSE: set header anti-buffering, flush, retry + event awal
// "connected", daftarkan klien, lalu jaga tetap hidup dengan ping tiap 25 dtk.
export function openSse(res: Response): void {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // matikan buffering proxy (lihat catatan OPS.md)
  });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  addSseClient(res);

  const keepAlive = setInterval(() => res.write(": ping\n\n"), 25_000);
  res.on("close", () => {
    clearInterval(keepAlive);
    removeSseClient(res);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (dari `backend/`): `bun test tests/events.test.ts`
Expected: PASS (3 tests). File ini tidak menyentuh DB — tidak butuh container.

- [ ] **Step 5: Run full backend suite (regresi)**

Run (dari `backend/`, container `arthakarya_test_pg` harus jalan): `bun test`
Expected: PASS (70 test existing + 3 test baru = 73).

- [ ] **Step 6: Commit**

```bash
git add backend/src/events.ts backend/tests/events.test.ts
git commit -m "feat(sse): tambah event hub broadcast + unit test"
```

---

### Task 2: Backend — helper `verifyAuthToken` + endpoint `GET /api/rekap/events` + endpoint tests

**Files:**
- Modify: `backend/src/middleware/auth.ts:26-29` (tambah helper setelah `generateToken`)
- Modify: `backend/src/routes/rekap.ts:4` (import) dan `:14-16` (route `/events` sebelum `router.use`)
- Test: `backend/tests/integration.test.ts` (tambah blok `describe("SSE /api/rekap/events")`)

**Interfaces:**
- Consumes: `openSse` (Task 1), `AuthPayload` dari `backend/src/types.ts`.
- Produces (dipakai Task 3): endpoint `GET /api/rekap/events` yang — dengan token valid — membuka stream SSE; tanpa token → `401 { error: "Token tidak ditemukan. Silakan login." }`.

- [ ] **Step 1: Add helper `verifyAuthToken` di `auth.ts`**

`backend/src/middleware/auth.ts` — tambah setelah fungsi `generateToken` (baris 29):

```ts
// Verifikasi token tanpa men-set req.user — dipakai endpoint SSE yang
// menerima token via query param (EventSource tidak bisa set header).
export function verifyAuthToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Add the failing endpoint tests**

`backend/tests/integration.test.ts` — tambah helper + blok describe di bagian akhir file (sesudah semua describe existing; `baseUrl`, `adminToken`, `api`, `seedMonitoring`, `kegiatanPayload` sudah tersedia di file ini):

```ts
// ============================================================
// SSE /api/rekap/events
// ============================================================

// Baca stream SSE sampai mengandung `marker` (dengan batas waktu 2 dtk
// agar test tidak menggantung selamanya bila event tak kunjung tiba).
async function readSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
  timeoutMs = 2000
): Promise<string> {
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) return buf;
    buf += decoder.decode(value, { stream: true });
    if (buf.includes(marker)) return buf;
  }
  return buf;
}

describe("SSE /api/rekap/events", () => {
  beforeEach(seedMonitoring);

  it("menolak tanpa token (401)", async () => {
    const res = await fetch(`${baseUrl}/api/rekap/events`);
    expect(res.status).toBe(401);
  });

  it("dengan token: 200, content-type text/event-stream, terima event connected", async () => {
    const res = await fetch(`${baseUrl}/api/rekap/events?token=${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") || "").toContain("text/event-stream");

    const reader = res.body!.getReader();
    const text = await readSse(reader, '"type":"connected"');
    expect(text).toContain('"type":"connected"');
    await reader.cancel();
  });

  it("broadcast dari hub sampai ke klien yang terhubung", async () => {
    const { broadcast } = await import("../src/events.js");

    const res = await fetch(`${baseUrl}/api/rekap/events?token=${adminToken}`);
    const reader = res.body!.getReader();
    await readSse(reader, '"type":"connected"'); // buang event awal

    broadcast({ type: "kegiatan" });

    const text = await readSse(reader, '"type":"kegiatan"');
    expect(text).toContain('"type":"kegiatan"');
    await reader.cancel();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run (dari `backend/`, container jalan): `bun test tests/integration.test.ts`
Expected: 3 test SSE FAIL (route belum ada → `fetch` dapat 404 dari not-found handler, bukan 401/stream).

- [ ] **Step 4: Implement the endpoint**

`backend/src/routes/rekap.ts`:

**(a)** Ubah import auth (baris 4) menjadi:

```ts
import { authMiddleware, verifyAuthToken } from "../middleware/auth.js";
```

**(b)** Tambah import events (baris 12, setelah `import pool from "../db.js";`):

```ts
import { openSse } from "../events.js";
```

**(c)** Sisipkan route `/events` **sebelum** `router.use(authMiddleware);` (baris 16) — persis di antara `const router = Router();` (baris 14) dan baris 16:

```ts
// SSE live untuk halaman RPD timeline.
// DIDAFTARKAN SEBELUM router.use(authMiddleware) karena EventSource tidak bisa
// menyetel header Authorization — token diterima via query param ?token=
// (atau header, untuk kompatibilitas). (Deviasi dari spec baris 48 — lihat Global Constraints.)
router.get("/events", (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  const token = bearer || queryToken;

  if (!token || !verifyAuthToken(token)) {
    res.status(401).json({ error: "Token tidak ditemukan. Silakan login." });
    return;
  }

  openSse(res);
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run (dari `backend/`, container jalan): `bun test tests/integration.test.ts`
Expected: PASS — 3 test SSE + semua test existing.

- [ ] **Step 6: Commit**

```bash
git add backend/src/middleware/auth.ts backend/src/routes/rekap.ts backend/tests/integration.test.ts
git commit -m "feat(sse): endpoint GET /api/rekap/events + auth token query"
```

---

### Task 3: Backend — broadcast pada titik mutasi + test wiring

**Files:**
- Modify: `backend/src/routes/rekap.ts:86-97` (broadcast sukses import)
- Modify: `backend/src/routes/kegiatan.ts:1-8` (import), `:191` (POST), `:286` & `:293` (PUT), `:350` (DELETE), `:415-419` (PATCH status)
- Test: `backend/tests/integration.test.ts` (tambah 1 test di `describe("SSE /api/rekap/events")`)

**Interfaces:**
- Consumes: `broadcast` (Task 1), endpoint `/events` (Task 2).
- Produces: tiap mutasi sukses memicu `broadcast({ type: "rpd-target", tahun })` (import) atau `broadcast({ type: "kegiatan" })` (kegiatan).

- [ ] **Step 1: Add the failing wiring test**

`backend/tests/integration.test.ts` — tambah 1 test di dalam `describe("SSE /api/rekap/events", ...)` yang sudah dibuat di Task 2 (sebelum penutup `});` blok describe):

```ts
  it("kegiatan baru memicu event `kegiatan` ke klien SSE (full wiring)", async () => {
    const res = await fetch(`${baseUrl}/api/rekap/events?token=${adminToken}`);
    const reader = res.body!.getReader();
    await readSse(reader, '"type":"connected"');

    const created = await api("POST", "/api/kegiatan", kegiatanPayload, adminToken);
    expect(created.status).toBe(201);

    const text = await readSse(reader, '"type":"kegiatan"');
    expect(text).toContain('"type":"kegiatan"');
    await reader.cancel();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run (dari `backend/`, container jalan): `bun test tests/integration.test.ts`
Expected: test baru FAIL (broadcast belum dipasang → klien tidak menerima event `kegiatan`; `readSse` habis timeout dan mengembalikan buffer tanpa marker).

- [ ] **Step 3: Broadcast sukses import RPD**

`backend/src/routes/rekap.ts` — tambah import broadcast (baris 12, satukan dengan import `openSse`):

```ts
import { openSse, broadcast } from "../events.js";
```

Lalu di handler `POST /rpd-target/import`, **setelah** `await client.query("COMMIT");` (baris 86) dan setelah `logger.info("rpd_target_import", {...})` (baris 88-92), **sebelum** `res.json({...})` (baris 94):

```ts
        broadcast({ type: "rpd-target", tahun });
```

> Pastikan posisinya di luar transaksi (setelah COMMIT) dan hanya pada jalur sukses — saat rollback/catch tidak ada broadcast.

- [ ] **Step 4: Broadcast mutasi kegiatan**

`backend/src/routes/kegiatan.ts`:

**(a)** Tambah import (baris 7, setelah `import { logger } from "../logger.js";`):

```ts
import { broadcast } from "../events.js";
```

**(b)** `POST /` — setelah `await client.query("COMMIT");` (baris 191), sebelum `res.status(201).json({...})` (baris 193):

```ts
    await client.query("COMMIT");
    broadcast({ type: "kegiatan" });

    res.status(201).json({
```

**(c)** `PUT /:id` — kedua cabang sukses: setelah `await client.query("COMMIT");` di cabang `if (body.mata_anggaran)` (baris 286) dan di cabang `else` (baris 293):

```ts
      await client.query("COMMIT");
      broadcast({ type: "kegiatan" });
      res.json({
```

```ts
      await client.query("COMMIT");
      broadcast({ type: "kegiatan" });
      const mataResult = await pool.query(
```

**(d)** `DELETE /:id` — setelah `await pool.query("DELETE FROM kegiatan WHERE id = $1", [id]);` (baris 350), sebelum `res.json({ message: ... })` (baris 352):

```ts
    await pool.query("DELETE FROM kegiatan WHERE id = $1", [id]);
    broadcast({ type: "kegiatan" });

    res.json({ message: "Kegiatan berhasil dihapus." });
```

**(e)** `PATCH /:id/status` — setelah `UPDATE kegiatan ... RETURNING *` (baris 415-419), sebelum `res.json({ data, message })` (baris 421):

```ts
    const result = await pool.query(
      `UPDATE kegiatan SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [status, id]
    );

    broadcast({ type: "kegiatan" });

    res.json({
```

- [ ] **Step 5: Run full suite to verify pass**

Run (dari `backend/`, container jalan): `bun test`
Expected: PASS — 74 tests (73 + 1 wiring test).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/rekap.ts backend/src/routes/kegiatan.ts backend/tests/integration.test.ts
git commit -m "feat(sse): broadcast event pada sukses import RPD & mutasi kegiatan"
```

---

### Task 4: Frontend — hook `useSse`

**Files:**
- Create: `frontend/src/hooks/useSse.js`

**Interfaces:**
- Consumes: endpoint `GET /api/rekap/events?token=...` (Task 2).
- Produces (dipakai Task 5): `useSse(url: string, onMessage: (payload: object) => void)` — membuka `EventSource`, mem-parse tiap event, memanggil `onMessage` dengan payload; `url` stabil, `onMessage` selalu versi terbaru (via ref); auto-reconnect bawaan EventSource.

- [ ] **Step 1: Create the hook**

`frontend/src/hooks/useSse.js`:

```js
import { useEffect, useRef } from "react";

// Mendengarkan Server-Sent Events dari endpoint SSE backend.
// onMessage dipanggil untuk tiap event (sudah di-JSON.parse). Reconnect
// otomatis (retry: 3000 di server). Hanya perubahan `url` yang membuka ulang
// koneksi; `onMessage` terbaru selalu dipakai lewat ref agar caller bisa
// melempar arrow function baru tiap render tanpa menyebabkan reconnect.
export default function useSse(url, onMessage) {
  const cbRef = useRef(onMessage);
  useEffect(() => {
    cbRef.current = onMessage;
  });

  useEffect(() => {
    const es = new EventSource(url);
    es.onmessage = (e) => {
      let payload = null;
      try {
        payload = JSON.parse(e.data);
      } catch {
        return; // frame non-JSON (mis. ": ping") — abaikan
      }
      if (payload) cbRef.current(payload);
    };
    return () => es.close();
  }, [url]);
}
```

- [ ] **Step 2: Verify build masih hijau**

Run (dari `backend/`): `cd ../frontend && bun run build`
Expected: build sukses (file baru ikut terpakai meski belum dipakai).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useSse.js
git commit -m "feat(sse): hook useSse untuk mendengarkan event backend"
```

---

### Task 5: Frontend — `RpdGantt.jsx` refactor `loadData` + SSE + indikator live

**Files:**
- Modify: `frontend/src/pages/RpdGantt.jsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: `useSse` (Task 4), endpoint `/api/rekap/events` (Task 2), token JWT di `localStorage`.
- Produces: halaman RPD refetch otomatis saat import/mutasi; badge "Live · terakhir diperbarui HH:MM:SS" di header.

- [ ] **Step 1: Refactor — ekstrak `loadData` + state baru**

`frontend/src/pages/RpdGantt.jsx`:

**(a)** Ubah import React (baris 1) dan tambah import hook:

```js
import { useState, useEffect, useRef, useCallback } from "react";
```

```js
import useSse from "../hooks/useSse.js";
```

**(b)** Tambah state setelah `const [chartUnitId, setChartUnitId] = useState("total");` (baris 48):

```js
  const [lastUpdated, setLastUpdated] = useState(null); // untuk indikator live
  const refreshingRef = useRef(false); // guard refetch ganda (in-flight)
  const sseTimerRef = useRef(null); // debounce 300 ms untuk event beruntun
```

**(c)** Ganti `useEffect` muat data (baris 50-69) dengan `loadData` + effect:

```js
  // Muat data RPD. Mode silent (refetch SSE) tidak menyetel loading/error
  // maupun animasi masuk — hanya memperbarui data + lastUpdated.
  const loadData = useCallback(async (tahunSel, opts = {}) => {
    const silent = !!opts.silent;
    if (!silent) {
      setLoading(true);
      setAnimated(false);
    }
    try {
      const [rpdRes, tlRes, rpdTargetRes] = await Promise.all([
        client.get(`/rekap/rpd-bulanan?tahun=${tahunSel}`),
        client.get("/rekap/timeline"),
        client.get(`/rekap/rpd-target?tahun=${tahunSel}`),
      ]);
      setRpd(rpdRes.data.data);
      setTahun(rpdRes.data.tahun);
      setTimeline(tlRes.data.data);
      setRpdTarget(rpdTargetRes.data.data);
      setLastUpdated(new Date());
      if (!silent) setTimeout(() => setAnimated(true), 80);
    } catch (err) {
      if (!silent) setError(err.response?.data?.error || "Gagal memuat data.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(tahun);
  }, [tahun, loadData]);
```

> `useEffect` sinkronisasi `tahunImport` (baris 71-73) tetap dipertahankan apa adanya.

- [ ] **Step 2: Wiring SSE + skip saat tab hidden**

`frontend/src/pages/RpdGantt.jsx` — tambah tepat setelah `useOutletContext()` (baris 107), sebelum `const isAdmin = ...` (baris 108):

```js
  // Live refresh: dengarkan event SSE; refetch silent saat data berubah.
  // Guard in-flight mencegah tumpukan request; debounce 300 ms menggabung
  // event beruntun (mis. admin mengimpor sendiri → refetch manual + SSE).
  const sseToken = typeof localStorage !== "undefined" ? localStorage.getItem("token") || "" : "";
  useSse(`/api/rekap/events?token=${sseToken}`, () => {
    if (document.hidden) return; // tab tak terlihat — hemat; refetch saat kembali
    if (refreshingRef.current) return;
    clearTimeout(sseTimerRef.current);
    sseTimerRef.current = setTimeout(() => {
      refreshingRef.current = true;
      loadData(tahun, { silent: true }).finally(() => {
        refreshingRef.current = false;
      });
    }, 300);
  });

  // Saat tab kembali terlihat — segarkan sekali (silent).
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      loadData(tahun, { silent: true }).finally(() => {
        refreshingRef.current = false;
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [tahun, loadData]);
```

- [ ] **Step 3: Indikator live di header**

`frontend/src/pages/RpdGantt.jsx` — dalam JSX `page-header` (baris 145-146), sisipkan badge setelah `<h2>RPD & Timeline Anggaran</h2>`:

```jsx
        <h2>RPD & Timeline Anggaran</h2>
        {lastUpdated && (
          <span className="badge badge-live" title="Data diperbarui otomatis saat ada perubahan">
            <span className="live-dot" />Live · {lastUpdated.toLocaleTimeString("id-ID")}
          </span>
        )}
```

- [ ] **Step 4: CSS indikator live**

`frontend/src/index.css` — tambah blok ini di dekat definisi badge lain (semua warna via `var()`, otomatis dua mode):

```css
/* Indikator live halaman RPD — dot berdenyut + label */
.badge-live {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: color-mix(in srgb, var(--success) 12%, var(--surface));
  color: var(--success);
  border: 1px solid color-mix(in srgb, var(--success) 35%, var(--border));
  font-size: 0.72rem;
  font-weight: 600;
}
.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  animation: live-pulse 1.6s ease-in-out infinite;
}
@keyframes live-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
```

- [ ] **Step 5: Verify build + manual**

Run (dari `backend/`): `cd ../frontend && bun run build`
Expected: build sukses.

Manual (user): buka halaman `/monitoring/rpd-timeline`; buka 2 tab; import Excel RPD target di salah satu tab → tab lain memperbarui chart & tabel otomatis + badge "Live" muncul. Ganti tahun tetap berjalan. Cek dark mode (toggle tema) — dot & teks badge terbaca.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/RpdGantt.jsx frontend/src/index.css
git commit -m "feat(sse): auto-refresh halaman RPD + indikator live"
```

---

### Task 6: Docs — catatan deploy SSE di OPS.md

**Files:**
- Modify: `OPS.md` (seksi 1, setelah diagram topologi / di dekat poin nginx)

**Interfaces:**
- Consumes: keputusan arsitektur (hub in-memory, header `X-Accel-Buffering: no` di `openSse`).
- Produces: panduan agar SSE tidak diputus/buffered oleh reverse proxy nginx saat deploy.

- [ ] **Step 1: Tambah catatan**

`OPS.md` — dalam seksi `## 1. Arsitektur & Topologi`, tambah bullet setelah poin `- **TLS**: ...` (baris 31-32):

```markdown
- **SSE `/api/rekap/events`** (live refresh halaman RPD): nginx proxy `/api` harus
  **menonaktifkan buffering** untuk endpoint ini agar event terkirim instan —
  tambah `proxy_buffering off;` (atau per-route `location /api/rekap/events {
  proxy_buffering off; }`) di konfigurasi nginx frontend. Endpoint sudah mengirim
  header `X-Accel-Buffering: no` + ping keepalive tiap 25 dtk, dan `retry: 3000`
  di sisi klien EventSource. Hub broadcast in-memory hanya menjangkau satu proses
  server (single-instance — sesuai arsitektur saat ini).
```

- [ ] **Step 2: Commit**

```bash
git add OPS.md
git commit -m "docs(ops): catatan nginx untuk endpoint SSE"
```

---

## Self-Review

- **Spec coverage:**
  - Hub + broadcast + endpoint `/api/rekap/events` → Task 1 & 2.
  - Titik broadcast import & 4 mutasi kegiatan → Task 3.
  - `useSse` hook → Task 4.
  - Refactor `loadData(tahun, { silent })`, guard + debounce, skip tab hidden, `visibilitychange`, `lastUpdated`, badge live → Task 5.
  - Catatan deploy nginx → Task 6.
  - Auth query token → Task 2 (Global Constraints, deviasi dicatat).
  - Tidak ada perubahan DB, tanpa dependency baru → terpenuhi (tidak ada migrasi/dependency di task mana pun).
- **Placeholder scan:** tidak ada TBD/TODO; semua langkah kode diberi kode lengkap; referensi baris memakai nomor yang sudah diverifikasi dari file saat ini.
- **Type consistency:** `openSse`/`broadcast`/`addSseClient`/`removeSseClient` konsisten dari Task 1 ke Task 2/3; `verifyAuthToken` (Task 2) dipakai di route yang sama; `useSse(url, onMessage)` konsisten Task 4 → Task 5; state `lastUpdated`/`refreshingRef`/`sseTimerRef` konsisten dalam Task 5.

**Perhatian implementer:** jalankan semua perintah `bun test` dari `backend/` (container `arthakarya_test_pg` di port 5433 harus aktif). Jangan pernah `git add frontend/bun.lock` atau `frontend/vite.config.worktree.js`.
