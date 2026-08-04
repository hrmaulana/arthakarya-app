-- Arthakarya Database Schema — PRODUCTION
-- PostgreSQL 16
--
-- ⚠️  FILE INI HANYA DIEKSEKUSI SEKALI, saat volume database masih kosong
--     (docker-entrypoint-initdb.d). Perubahan skema SELANJUTNYA wajib melalui
--     db/migrations/ (lihat backend/scripts/migrate.ts).
--
-- ⚠️  PRODUCTION: TIDAK ADA USER DEMO DI SINI. Admin awal dibuat oleh
--     backend/scripts/seed-admin.ts (password acak, dicetak sekali).
--     Daftar unit_kerja di bawah ini masih PLACEHOLDER — ganti dengan
--     daftar unit kerja asli instansi SEBELUM first boot!

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE unit_kerja (
    id SERIAL PRIMARY KEY,
    kode_unit VARCHAR(20) NOT NULL UNIQUE,
    nama_unit VARCHAR(200) NOT NULL
);

CREATE TABLE jenis_kegiatan (
    id SERIAL PRIMARY KEY,
    nama_jenis VARCHAR(200) NOT NULL UNIQUE
);

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    unit_kerja_id INTEGER NOT NULL REFERENCES unit_kerja(id),
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'operator')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE kegiatan (
    id SERIAL PRIMARY KEY,
    unit_kerja_id INTEGER NOT NULL REFERENCES unit_kerja(id),
    jenis_kegiatan_id INTEGER NOT NULL REFERENCES jenis_kegiatan(id),
    created_by INTEGER NOT NULL REFERENCES users(id),
    nama_kegiatan VARCHAR(500) NOT NULL,
    tanggal DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'diajukan', 'disetujui', 'ditolak')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE mata_anggaran (
    id SERIAL PRIMARY KEY,
    kegiatan_id INTEGER NOT NULL REFERENCES kegiatan(id) ON DELETE CASCADE,
    nama_item VARCHAR(500) NOT NULL,
    jumlah_rp BIGINT NOT NULL CHECK (jumlah_rp >= 0),
    keterangan TEXT
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_kegiatan_unit_kerja ON kegiatan(unit_kerja_id);
CREATE INDEX idx_kegiatan_jenis ON kegiatan(jenis_kegiatan_id);
CREATE INDEX idx_kegiatan_status ON kegiatan(status);
CREATE INDEX idx_mata_anggaran_kegiatan ON mata_anggaran(kegiatan_id);
CREATE INDEX idx_users_unit_kerja ON users(unit_kerja_id);

-- ============================================================
-- SEED DATA (PRODUCTION)
-- ============================================================

-- Jenis Kegiatan (referensi tetap)
INSERT INTO jenis_kegiatan (nama_jenis) VALUES
    ('Rapat Koordinasi'),
    ('Pelatihan & Workshop'),
    ('Perjalanan Dinas'),
    ('Pengadaan Barang/Jasa'),
    ('Sosialisasi & Publikasi'),
    ('Pemeliharaan & Perbaikan');

-- Unit Kerja — daftar asli (disahkan oleh admin, 2026-08-04).
-- Perubahan struktur unit kerja setelah ini harus lewat db/migrations/,
-- bukan edit file ini.
INSERT INTO unit_kerja (kode_unit, nama_unit) VALUES
    ('UKE01', 'Sekretariat Deputi PMP'),
    ('UKE02', 'Direktorat PEMPMP'),
    ('UKE03', 'Direktorat PFMSK'),
    ('UKE04', 'Direktorat PHKEI'),
    ('UKE05', 'Direktorat P4T'),
    ('UKE06', 'Direktorat SITALA');
