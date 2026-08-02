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
├── frontend/          # React + Vite SPA
│   ├── src/
│   │   ├── api/       # Axios client + interceptors
│   │   ├── context/   # AuthContext (login/logout/state)
│   │   ├── components/# Shared UI components
│   │   └── pages/     # Route pages (Login, Kegiatan, Dashboard)
│   └── nginx.conf     # Nginx config (production serving + API proxy)
├── backend/           # Bun + Express REST API
│   └── src/
│       ├── middleware/ # JWT auth + role authorization
│       └── routes/     # Auth, Reference, Kegiatan CRUD, Rekap
├── db/
│   └── init.sql       # Schema + seed data (auto-loaded on first run)
├── docker-compose.yml
├── .env.example
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
