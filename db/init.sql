-- Arthakarya Database Schema
-- PostgreSQL 16

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
-- SEED DATA
-- ============================================================

-- 6 Unit Kerja
INSERT INTO unit_kerja (kode_unit, nama_unit) VALUES
    ('UK01', 'Sekretariat'),
    ('UK02', 'Bidang Perencanaan'),
    ('UK03', 'Bidang Keuangan'),
    ('UK04', 'Bidang Operasional'),
    ('UK05', 'Bidang Pengawasan'),
    ('UK06', 'Bidang Humas');

-- Jenis Kegiatan
INSERT INTO jenis_kegiatan (nama_jenis) VALUES
    ('Rapat Koordinasi'),
    ('Pelatihan & Workshop'),
    ('Perjalanan Dinas'),
    ('Pengadaan Barang/Jasa'),
    ('Sosialisasi & Publikasi'),
    ('Pemeliharaan & Perbaikan');

-- Users (password: "password123" untuk semua, di-hash dengan bcrypt)
-- Hash bcrypt dari "password123" (cost 10):
-- $2a$10$ZCBZtR7bjkxr86XeDg40.e9UEhD4bjKHD67wjLuhLoryzmddfl.Wa
INSERT INTO users (unit_kerja_id, username, password_hash, role) VALUES
    (1, 'admin',        '$2a$10$ZCBZtR7bjkxr86XeDg40.e9UEhD4bjKHD67wjLuhLoryzmddfl.Wa', 'admin'),
    (2, 'operator_uk2', '$2a$10$ZCBZtR7bjkxr86XeDg40.e9UEhD4bjKHD67wjLuhLoryzmddfl.Wa', 'operator'),
    (3, 'operator_uk3', '$2a$10$ZCBZtR7bjkxr86XeDg40.e9UEhD4bjKHD67wjLuhLoryzmddfl.Wa', 'operator'),
    -- Unit Kerja 4 (Bidang Operasional) punya 4 akun user
    (4, 'op_uk4_1',     '$2a$10$ZCBZtR7bjkxr86XeDg40.e9UEhD4bjKHD67wjLuhLoryzmddfl.Wa', 'operator'),
    (4, 'op_uk4_2',     '$2a$10$ZCBZtR7bjkxr86XeDg40.e9UEhD4bjKHD67wjLuhLoryzmddfl.Wa', 'operator'),
    (4, 'op_uk4_3',     '$2a$10$ZCBZtR7bjkxr86XeDg40.e9UEhD4bjKHD67wjLuhLoryzmddfl.Wa', 'operator'),
    (4, 'op_uk4_4',     '$2a$10$ZCBZtR7bjkxr86XeDg40.e9UEhD4bjKHD67wjLuhLoryzmddfl.Wa', 'operator'),
    (5, 'operator_uk5', '$2a$10$ZCBZtR7bjkxr86XeDg40.e9UEhD4bjKHD67wjLuhLoryzmddfl.Wa', 'operator'),
    (6, 'operator_uk6', '$2a$10$ZCBZtR7bjkxr86XeDg40.e9UEhD4bjKHD67wjLuhLoryzmddfl.Wa', 'operator');

-- Sample kegiatan + mata_anggaran untuk demo
INSERT INTO kegiatan (unit_kerja_id, jenis_kegiatan_id, created_by, nama_kegiatan, tanggal, status) VALUES
    (2, 1, 2, 'Rapat Koordinasi Program Tahunan 2026', '2026-08-15', 'draft'),
    (2, 3, 2, 'Perjalanan Dinas ke Jakarta', '2026-09-01', 'diajukan'),
    (3, 2, 3, 'Workshop Penyusunan Anggaran', '2026-08-20', 'disetujui'),
    (4, 4, 4, 'Pengadaan Laptop Kantor', '2026-08-10', 'draft');

INSERT INTO mata_anggaran (kegiatan_id, nama_item, jumlah_rp, keterangan) VALUES
    -- Rapat Koordinasi
    (1, 'Konsumsi rapat', 1500000, 'Snack dan makan siang 30 peserta'),
    (1, 'ATK', 500000, 'Notebook, pulpen, map'),
    (1, 'Sewa ruangan', 2000000, 'Aula utama'),
    -- Perjalanan Dinas
    (2, 'Tiket pesawat PP', 4500000, '2 orang'),
    (2, 'Hotel 3 malam', 3600000, '2 kamar'),
    (2, 'Uang harian', 2400000, '2 orang x 3 hari'),
    -- Workshop
    (3, 'Narasumber', 5000000, 'Honor 2 narasumber'),
    (3, 'Konsumsi', 3000000, 'Snack dan makan siang 50 peserta'),
    (3, 'Sertifikat & materi', 1500000, 'Cetak 50 set'),
    -- Pengadaan Laptop
    (4, 'Laptop ThinkPad', 75000000, '5 unit x Rp 15.000.000'),
    (4, 'Mouse wireless', 1500000, '5 unit x Rp 300.000');
