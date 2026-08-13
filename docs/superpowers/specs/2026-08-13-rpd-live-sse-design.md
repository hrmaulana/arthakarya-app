# Live Refresh Halaman RPD via SSE — Design

**Tanggal:** 2026-08-13
**Status:** Disetujui user (via brainstorming)

## Goal

Halaman `/monitoring/rpd-timeline` (komponen `RpdGantt`) otomatis memuat ulang datanya **saat data berubah** tanpa refresh manual — melalui **Server-Sent Events (SSE)**. Pemicu: (1) import Excel RPD target, (2) mutasi data kegiatan (yang memengaruhi timeline Gantt). Hanya halaman RPD timeline yang mendengarkan.

## Konteks & Keputusan User

- Halaman saat ini menarik data sekali saat mount / ganti tahun (`RpdGantt.jsx:50-69`): `Promise.all` dari `GET /rekap/rpd-bulanan?tahun=YYYY`, `GET /rekap/timeline`, `GET /rekap/rpd-target?tahun=YYYY`. Tidak ada auto-refresh.
- User memilih: **"Update instan saat data berubah"** (bukan polling berkala, bukan tombol manual).
- Pemicu dipilih user: **import Excel RPD + perubahan kegiatan** (create/update/delete/status) — bukan seluruh mutasi backend.
- Cakupan dipilih user: **hanya halaman RPD timeline** yang mendengarkan event & refresh.
- Mekanisme dipilih user: **SSE** (Server-Sent Events) — saluran push satu-arah, auto-reconnect bawaan, tanpa library baru.
- Auth dipilih (rekomendasi): **EventSource + token JWT di query param** (`?token=`). Opsi `fetch`-streaming dengan header Bearer dicatat sebagai alternatif bila token di URL tidak diinginkan.
- Tanpa perubahan DB. Tanpa dependency baru.

## Arsitektur

```
[Backend: event hub in-memory]
   import RPD sukses ──► broadcast({type:"rpd-target", tahun})
   kegiatan POST/PUT/DELETE/status ──► broadcast({type:"kegiatan"})
                                  │
                                  ▼
        GET /api/rekap/events (SSE, authMiddleware)
                                  │  (satu-arah, streaming)
                                  ▼
[Frontend: RpdGantt.jsx]  EventSource → onmessage → loadData(tahun)
   (debounce 300ms + guard in-flight + skip saat tab hidden)
```

## Backend

### File baru: `backend/src/events.ts`

Hub in-memory satu instance per proses server:

- `type SseClient = Response` (Express response).
- `const clients = new Set<SseClient>()`.
- `broadcast(payload: object)`: untuk tiap klien tulis `data: ${JSON.stringify(payload)}\n\n`; klien yang `error`/sudah tutup dibuang dari set. Bungkus dalam try/catch per klien agar satu klien bermasalah tidak menggagalkan yang lain.
- `addClient(res)` / `removeClient(res)`.

### Endpoint baru: `GET /api/rekap/events` (di `backend/src/routes/rekap.ts`)

- Berada setelah `router.use(authMiddleware)` → otomatis butuh JWT.
- Setup SSE:
  - `res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" })`
  - `res.flushHeaders()`
  - Tulis `retry: 3000\n\n` (reconnect 3 detik)
  - Kirim event awal: `data: {"type":"connected"}\n\n` — penanda bagi klien bahwa saluran terbuka.
  - `addClient(res)`; `req.on("close", () => removeClient(res))`; jika `req.on("error")` serupa.
- Keepalive: `setInterval(() => res.write(": ping\n\n"), 25_000)` agar proxy tidak memutus koneksi idle; `clearInterval` saat close.
- Response tidak pernah `end()` sampai klien memutus.

### Titik broadcast

1. **Sukses import RPD** — `rekap.ts` handler `POST /rpd-target/import`, setelah `COMMIT` sukses (setelah log `rpd_target_import`, sebelum `res.json`):
   `broadcast({ type: "rpd-target", tahun })`.
   → Bukan di dalam transaksi (broadcast hanya setelah commit).
2. **Mutasi kegiatan** — `backend/src/routes/kegiatan.ts`:
   - `POST /` (create) — setelah sukses.
   - `PUT /:id` (update) — setelah sukses.
   - `DELETE /:id` — setelah sukses.
   - `PATCH /:id/status` — setelah sukses.
   Semuanya `broadcast({ type: "kegiatan" })`.

## Frontend

### File baru: `frontend/src/hooks/useSse.js`

Hook kecil, hanya dipakai halaman RPD:

- `useSse(url, onMessage)`: dalam `useEffect`, buat `new EventSource(url)`; `es.onmessage = (e) => onMessage(JSON.parse(e.data))`; cleanup `es.close()`.
- URL: `/api/rekap/events?token=${localStorage.getItem("token")}` (token di query — keputusan auth).
- Tidak perlu menangani reconnect manual — `retry: 3000` + auto-reconnect bawaan EventSource.

### Modifikasi: `frontend/src/pages/RpdGantt.jsx`

- **Refactor**: ekstrak `Promise.all` 3 endpoint (baris 50-69) menjadi `loadData = useCallback(async (tahun, opts) => {...}, [])`:
  - `opts = { silent?: boolean }`. Mode **silent** (dipakai refetch SSE): TIDAK men-set `loading` ke true, TIDAK men-set `error`, TIDAK memicu animasi masuk — hanya memperbarui `rpd`, `tahun`, `timeline`, `rpdTarget`. Mode normal (dipakai saat mount / ganti tahun): seperti perilaku sekarang (set `loading=true`, `animated=false`, `setTimeout` animasi).
  - `lastUpdated` (state) di-set tiap kali `loadData` selesai (untuk indikator live).
  - Effect `[tahun]` memanggil `loadData(tahun)` (mode normal).
- **Guard refresh ganda** (penting):
  - Bendera `refreshingRef` (useRef): bila sebuah refetch sedang berjalan, abaikan pemicu berikutnya (jangan menumpuk request).
  - Debounce ~300ms: event beruntun dalam satu tick digabung jadi satu refetch. Juga melindungi kasus admin yang mengimpor sendiri — import handler sudah refetch manual (`rpd-target` saja, baris 97-98) dan event SSE menyusul hampir bersamaan.
- **SSE effect**: `useSse(`/api/rekap/events?token=${token}`, () => loadData(tahun, { silent: true }))`, deps `[tahun, loadData]`. Handler refetch pada **setiap** pesan (termasuk `connected`) — guard + debounce menggabungkan duplikat. Reconnect otomatis.
- **Skip saat tab hidden**: dalam handler pesan, jika `document.hidden` → jangan refetch (hemat resource); tambah `visibilitychange` listener yang memanggil `loadData(tahun, { silent: true })` saat tab kembali terlihat.
- **Indikator live** di header halaman: `.badge` kecil (gaya design system, warna `var(--success)`) dengan dot berdenyut (CSS keyframes, pola `animated` + `setTimeout`) + teks "Live · terakhir diperbarui HH:MM:SS" (state `lastUpdated` di-set tiap `loadData` selesai).
- Komponen `RpdCumulativeChart` & tabel TIDAK berubah.

## UX

- Dot hijau berdenyut + "Live" + "terakhir diperbarui <waktu>" di samping judul halaman.
- Refetch tidak menampilkan spinner layar penuh (loading state lama hanya untuk pemuatan awal; refresh berikutnya diam-diam memperbarui data) — `loading` awal tetap seperti sekarang, refetch SSE tidak set `loading=true`.
- Saat koneksi putus, EventSource reconnect otomatis tanpa indikasi (opsional: ubah dot jadi abu-abu saat koneksi turun — `es.onerror`).

## Edge Cases

- Token kedaluwarsa: request normal halaman → 401 → interceptor redirect login (existing). SSE ikut gagal/reconnect — tidak fatal.
- Server restart / koneksi drop: EventSource reconnect (retry 3 dtk); setelah hidup kembali, koneksi baru menerima `connected` → handler refetch silent sekali agar langsung segar (saat mount, duplikat digabung guard in-flight).
- Banyak tab: tiap tab mendapat event & refetch sendiri — aman.
- Import untuk tahun berbeda dari tahun aktif halaman: event tetap diterima; `loadData(tahun)` refetch tahun aktif — tidak salah (data tahun aktif tak berubah, biaya satu request kecil).
- Import gagal (error 400/500): TIDAK broadcast (hanya setelah commit).
- Vite dev proxy: meng-proxy `/api` termasuk streaming SSE (http-proxy mendukung). Jika ada buffering di dev, tambah `proxy: { "/api": { ... } }` tidak perlu diubah.

## Deploy (catatan OPS.md)

- Reverse proxy nginx/production harus **menonaktifkan buffering** untuk `/api/rekap/events`:
  `proxy_buffering off;` + header `X-Accel-Buffering: no` (sudah diset endpoint).
- Koneksi SSE tidak boleh diakhiri oleh `proxy_read_timeout` yang terlalu pendek; keepalive ping 25 dtk menjaga koneksi tetap hidup.
- Karena hub in-memory, broadcast hanya menjangkau klien di **satu proses server** — sesuai arsitektur deploy saat ini (single instance).

## File & Uji

**Backend:**
- Create: `backend/src/events.ts`
- Modify: `backend/src/routes/rekap.ts` (endpoint `/events` + broadcast import)
- Modify: `backend/src/routes/kegiatan.ts` (broadcast 4 titik)
- Tests (`bun test`, container `arthakarya_test_pg`):
  - `events` hub: `broadcast` menulis ke klien, klien error dibuang, payload JSON benar.
  - Endpoint `/events`: 401 tanpa token; dengan token → response `text/event-stream`, terima event `connected` + event broadcast (mis. panggil hub `broadcast` langsung lalu baca stream, atau panggil import lalu baca stream).

**Frontend (tanpa test runner — verifikasi via build + manual):**
- Create: `frontend/src/hooks/useSse.js`
- Modify: `frontend/src/pages/RpdGantt.jsx`
- Verifikasi: `cd frontend && bun run build` hijau; manual: buka 2 tab halaman RPD, import Excel di salah satu → tab lain otomatis memperbarui chart & tabel; ganti tahun tetap jalan; dark mode dot live terbaca.

## Out of Scope

- Perubahan mekanisme ke WebSocket / polling.
- Halaman lain (monitoring, dashboard) ikut real-time.
- Broadcast untuk data monitoring umum.
- Autentikasi cookie / token SSE khusus pendek umur.
