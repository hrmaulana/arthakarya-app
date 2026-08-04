# Arthakarya — Aplikasi Perencanaan Kegiatan dan Anggaran

Aplikasi web untuk perencanaan kegiatan dan anggaran dengan hierarki **Unit Kerja → Kegiatan → Mata Anggaran**, dilengkapi role-based access control (admin/operator) dan dashboard rekap anggaran.

## Tech Stack

| Layer    | Teknologi                     |
| -------- | ----------------------------- |
| Frontend | React 18 + Vite 5 + React Router v6 |
| Backend  | Bun + Express.js + TypeScript |
| Database | PostgreSQL 16                 |
| Infra    | Docker + Docker Compose       |

## Struktur Folder

```
arthakarya/
├── frontend/                  # React + Vite SPA
│   ├── src/
│   │   ├── api/               # Axios client + interceptors
│   │   ├── context/           # AuthContext (login/logout/state)
│   │   ├── components/        # Shared UI components
│   │   └── pages/             # Route pages (Login, Kegiatan, Dashboard, ...)
│   ├── nginx.conf             # Nginx config (dev: SPA + API proxy)
│   └── nginx.prod.conf.template # Nginx production (TLS + security headers + CSP)
├── backend/                   # Bun + Express REST API
│   ├── src/
│   │   ├── middleware/        # JWT auth, role authorization, rate limit
│   │   ├── routes/            # Auth, Users, Reference, Kegiatan CRUD, Rekap
│   │   ├── validation.ts      # Validasi zod semua payload
│   │   └── app.ts / index.ts  # Express app (dipisah agar bisa di-test)
│   ├── scripts/               # migrate.ts (runner migrasi), seed-admin.ts
│   └── tests/                 # Test integrasi (bun test)
├── db/
│   ├── init.sql               # Schema production (tanpa user demo)
│   └── migrations/            # Migrasi skema bernomor (runner: backend/scripts/migrate.ts)
├── scripts/                   # backup.sh, restore.sh, deploy.sh, nightly-check.sh, gen-secrets.sh
├── docker-compose.yml         # Stack development
├── docker-compose.prod.yml    # Stack PRODUCTION (self-hosted, TLS, tanpa port DB/API ke host)
├── .github/workflows/         # ci.yml (test+build), deploy.yml (tag → self-hosted runner)
├── .env.example               # Dev
├── .env.example.prod          # Production (sekret dibuat scripts/gen-secrets.sh)
├── OPS.md                     # ⚠️ Runbook operasional produksi — baca sebelum go-live
└── README.md
```

## Menjalankan Aplikasi

### Prasyarat

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose

### Langkah 1: Setup environment

```bash
cp .env.example .env
```

Default credential di `.env.example` sudah cocok dengan konfigurasi di `docker-compose.yml`. Ubah `JWT_SECRET` untuk production.

### Langkah 2: Jalankan semua service

```bash
docker compose up --build
```

Tiga container akan berjalan:

| Container            | Port  | Keterangan                        |
| -------------------- | ----- | --------------------------------- |
| `arthakarya_db`      | 5432  | PostgreSQL 16 (named volume: `pgdata`) |
| `arthakarya_backend` | 3001  | REST API (Bun + Express)          |
| `arthakarya_frontend`| 80    | Nginx serving React SPA           |

### Langkah 3: Akses aplikasi

Buka **http://localhost** di browser.

## Akun Demo

Data seed otomatis dimuat saat database pertama kali dibuat.

| Username       | Password      | Role     | Unit Kerja              |
| -------------- | ------------- | -------- | ----------------------- |
| `admin`        | `password123` | admin    | Sekretariat             |
| `operator_uk2` | `password123` | operator | Bidang Perencanaan      |
| `operator_uk3` | `password123` | operator | Bidang Keuangan         |
| `op_uk4_1`     | `password123` | operator | Bidang Operasional      |
| `op_uk4_2`     | `password123` | operator | Bidang Operasional      |
| `op_uk4_3`     | `password123` | operator | Bidang Operasional      |
| `op_uk4_4`     | `password123` | operator | Bidang Operasional      |
| `operator_uk5` | `password123` | operator | Bidang Pengawasan       |
| `operator_uk6` | `password123` | operator | Bidang Humas            |

## API Endpoints

### Auth & User Management
| Method | Path                            | Auth  | Deskripsi                    |
| ------ | ------------------------------- | ----- | ---------------------------- |
| POST   | /api/auth/login                 | No    | Login, dapat JWT             |
| GET    | /api/auth/me                    | Yes   | Info user saat ini           |
| PUT    | /api/auth/change-password       | Yes   | User ganti password sendiri  |
| GET    | /api/users                      | Admin | Daftar semua user            |
| POST   | /api/users/:id/reset-password   | Admin | Admin reset password user    |

### Reference
| Method | Path                          | Auth | Deskripsi               |
| ------ | ----------------------------- | ---- | ----------------------- |
| GET    | /api/reference/unit-kerja     | Yes  | Daftar unit kerja       |
| GET    | /api/reference/jenis-kegiatan | Yes  | Daftar jenis kegiatan   |

### Kegiatan
| Method | Path                        | Auth     | Deskripsi                          |
| ------ | --------------------------- | -------- | ---------------------------------- |
| GET    | /api/kegiatan               | Yes      | List (operator: unit sendiri)      |
| POST   | /api/kegiatan               | Yes      | Create + nested mata_anggaran[]    |
| GET    | /api/kegiatan/:id           | Yes      | Detail dengan mata_anggaran        |
| PUT    | /api/kegiatan/:id           | Yes      | Update header + sync mata_anggaran |
| DELETE | /api/kegiatan/:id           | Yes      | Hapus (operator: hanya draft)     |
| PATCH  | /api/kegiatan/:id/status    | Yes      | Ubah status (ditolak → draft)     |

### Rekap
| Method | Path                           | Auth | Deskripsi                            |
| ------ | ------------------------------ | ---- | ------------------------------------ |
| GET    | /api/rekap/per-unit-kerja      | Yes  | SUM anggaran grouped by unit kerja   |
| GET    | /api/rekap/per-jenis-kegiatan  | Yes  | SUM anggaran grouped by jenis kegiatan |
| GET    | /api/rekap/summary             | Yes  | Ringkasan total                      |

## Otorisasi & Aturan Bisnis

- **Operator** hanya bisa mengakses/memutasi data kegiatan dengan `unit_kerja_id` miliknya sendiri (diambil dari JWT token, bukan dari parameter request).
- **Admin** bisa mengakses semua unit kerja, menyetujui/menolak/menghapus kegiatan, dan mereset password user.
- Kegiatan **disetujui** bersifat _read-only_ — tidak dapat diedit atau dihapus.
- Kegiatan **ditolak** dapat dikembalikan ke `draft` oleh operator untuk direvisi.
- Operator hanya dapat menghapus kegiatan berstatus `draft` milik unitnya sendiri.

## Pengembangan Lokal (tanpa Docker)

### Backend
```bash
cd backend
cp ../.env.example .env
# Edit DATABASE_URL ke localhost jika perlu
bun install
bun run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Frontend dev server berjalan di `http://localhost:5173` dengan proxy API ke backend.

## Volume Data

- **`arthakarya_pgdata`**: Data PostgreSQL disimpan di named volume — tidak hilang saat `docker compose up --build` dijalankan ulang.

## Fase Production

Aplikasi siap dideploy self-hosted (satu server / laptop di kantor) dengan
`docker-compose.prod.yml`: TLS Let's Encrypt (DNS-01 Cloudflare), backup
harian + salinan ke NAS, migrasi skema, rate limit login, security headers,
monitoring + notifikasi Telegram, dan deploy via tag rilis (CI/CD).

**⚠️ Bacaan wajib sebelum go-live: [`OPS.md`](OPS.md)** — berisi runbook
lengkap: setup checklist, deploy, rollback, restore backup + drill,
troubleshooting, dan lokasi semua secret.

Ringkasan alur produksi:

```bash
cp .env.example.prod .env          # lalu: bash scripts/gen-secrets.sh (secret acak)
# ... setup DNS Cloudflare + secrets/cloudflare.ini (lihat OPS.md) ...
docker compose -f docker-compose.prod.yml run --rm certbot   # terbitkan sertifikat
docker compose -f docker-compose.prod.yml up -d --build      # jalankan stack
docker compose -f docker-compose.prod.yml logs migrator      # ambil password admin awal
```

Catatan keamanan produksi: DB dan API **tidak** membuka port ke host —
hanya nginx (80/443) yang terekspos; operator dll. hanya bisa dibuat via
Manajemen User oleh admin.
