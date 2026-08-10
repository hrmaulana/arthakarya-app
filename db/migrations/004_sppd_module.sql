-- 004_sppd_module.sql
-- Modul SPPD (Surat Perintah Perjalanan Dinas)
-- Tabel: sppd_kegiatan, sppd_peserta, sppd_approval
-- Extend users: nip, jabatan, pangkat_golongan, ttd_url

-- ============================================================
-- EXTEND USERS
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS nip VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS jabatan VARCHAR(200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS pangkat_golongan VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS ttd_url TEXT;

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE sppd_kegiatan (
    id SERIAL PRIMARY KEY,
    created_by INTEGER NOT NULL REFERENCES users(id),
    nama_kegiatan VARCHAR(500) NOT NULL,
    alat_angkutan VARCHAR(100),
    tempat_berangkat VARCHAR(200) NOT NULL,
    tempat_tujuan VARCHAR(200) NOT NULL,
    tanggal_berangkat DATE NOT NULL,
    tanggal_pulang DATE NOT NULL,
    lama_hari INTEGER NOT NULL,
    tanggal_surat DATE NOT NULL DEFAULT CURRENT_DATE,
    kota_dikeluarkan VARCHAR(100) NOT NULL,
    mata_anggaran VARCHAR(500),
    keterangan TEXT,
    ppk_nama VARCHAR(200) NOT NULL,
    ppk_nip VARCHAR(30),
    ppk_jabatan VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'diajukan', 'disetujui', 'ditolak', 'dibayar')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sppd_peserta (
    id SERIAL PRIMARY KEY,
    sppd_kegiatan_id INTEGER NOT NULL REFERENCES sppd_kegiatan(id) ON DELETE CASCADE,
    nama VARCHAR(200) NOT NULL,
    nip VARCHAR(30),
    golongan VARCHAR(50),
    jabatan VARCHAR(200),
    status_kepegawaian VARCHAR(20) NOT NULL DEFAULT 'PNS'
        CHECK (status_kepegawaian IN ('PNS', 'PPPK', 'PPNPN', 'Konsultan')),
    nomor_sppd VARCHAR(100),
    uang_harian_hari INTEGER NOT NULL DEFAULT 0,
    uang_harian_satuan INTEGER NOT NULL DEFAULT 0,
    transport INTEGER NOT NULL DEFAULT 0,
    tiket_pp INTEGER NOT NULL DEFAULT 0,
    penginapan_malam INTEGER NOT NULL DEFAULT 0,
    penginapan_satuan INTEGER NOT NULL DEFAULT 0,
    honor_paket_meeting INTEGER NOT NULL DEFAULT 0,
    representatif INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sppd_approval (
    id SERIAL PRIMARY KEY,
    sppd_kegiatan_id INTEGER NOT NULL REFERENCES sppd_kegiatan(id) ON DELETE CASCADE,
    actor_id INTEGER NOT NULL REFERENCES users(id),
    keputusan VARCHAR(20) NOT NULL
        CHECK (keputusan IN ('disetujui', 'ditolak', 'dibayar')),
    catatan TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_sppd_kegiatan_status ON sppd_kegiatan(status);
CREATE INDEX idx_sppd_kegiatan_created_by ON sppd_kegiatan(created_by);
CREATE INDEX idx_sppd_peserta_kegiatan ON sppd_peserta(sppd_kegiatan_id);
CREATE INDEX idx_sppd_approval_kegiatan ON sppd_approval(sppd_kegiatan_id);
