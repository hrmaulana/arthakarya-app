-- 005_sppd_workflow.sql
-- Extend SPPD module: Surat Tugas, Dokumen Pertanggungjawaban, Hari Libur, new statuses

-- ============================================================
-- SURAT TUGAS
-- ============================================================

CREATE TABLE surat_tugas (
    id SERIAL PRIMARY KEY,
    nomor_surat VARCHAR(200) NOT NULL,
    tanggal_surat DATE NOT NULL,
    perihal VARCHAR(500) NOT NULL,
    file_surat_path VARCHAR(1000),
    file_undangan_path VARCHAR(1000),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- HARI LIBUR (Jumat + Sabtu + tanggal merah nasional)
-- ============================================================

CREATE TABLE hari_libur (
    id SERIAL PRIMARY KEY,
    tanggal DATE NOT NULL UNIQUE,
    keterangan VARCHAR(200) NOT NULL
);

-- Pre-populate: Jumat & Sabtu for 2025-2026
-- 2025
INSERT INTO hari_libur (tanggal, keterangan) VALUES
('2025-01-03', 'Jumat'), ('2025-01-04', 'Sabtu'),
('2025-01-10', 'Jumat'), ('2025-01-11', 'Sabtu'),
('2025-01-17', 'Jumat'), ('2025-01-18', 'Sabtu'),
('2025-01-24', 'Jumat'), ('2025-01-25', 'Sabtu'),
('2025-01-31', 'Jumat'),
('2025-02-01', 'Sabtu'), ('2025-02-07', 'Jumat'), ('2025-02-08', 'Sabtu'),
('2025-02-14', 'Jumat'), ('2025-02-15', 'Sabtu'),
('2025-02-21', 'Jumat'), ('2025-02-22', 'Sabtu'),
('2025-02-28', 'Jumat'),
('2025-03-01', 'Sabtu'), ('2025-03-07', 'Jumat'), ('2025-03-08', 'Sabtu'),
('2025-03-14', 'Jumat'), ('2025-03-15', 'Sabtu'),
('2025-03-21', 'Jumat'), ('2025-03-22', 'Sabtu'),
('2025-03-28', 'Jumat'), ('2025-03-29', 'Sabtu'),
('2025-04-04', 'Jumat'), ('2025-04-05', 'Sabtu'),
('2025-04-11', 'Jumat'), ('2025-04-12', 'Sabtu'),
('2025-04-18', 'Jumat'), ('2025-04-19', 'Sabtu'),
('2025-04-25', 'Jumat'), ('2025-04-26', 'Sabtu'),
('2025-05-02', 'Jumat'), ('2025-05-03', 'Sabtu'),
('2025-05-09', 'Jumat'), ('2025-05-10', 'Sabtu'),
('2025-05-16', 'Jumat'), ('2025-05-17', 'Sabtu'),
('2025-05-23', 'Jumat'), ('2025-05-24', 'Sabtu'),
('2025-05-30', 'Jumat'), ('2025-05-31', 'Sabtu'),
('2025-06-06', 'Jumat'), ('2025-06-07', 'Sabtu'),
('2025-06-13', 'Jumat'), ('2025-06-14', 'Sabtu'),
('2025-06-20', 'Jumat'), ('2025-06-21', 'Sabtu'),
('2025-06-27', 'Jumat'), ('2025-06-28', 'Sabtu'),
('2025-07-04', 'Jumat'), ('2025-07-05', 'Sabtu'),
('2025-07-11', 'Jumat'), ('2025-07-12', 'Sabtu'),
('2025-07-18', 'Jumat'), ('2025-07-19', 'Sabtu'),
('2025-07-25', 'Jumat'), ('2025-07-26', 'Sabtu'),
('2025-08-01', 'Jumat'), ('2025-08-02', 'Sabtu'),
('2025-08-08', 'Jumat'), ('2025-08-09', 'Sabtu'),
('2025-08-15', 'Jumat'), ('2025-08-16', 'Sabtu'),
('2025-08-22', 'Jumat'), ('2025-08-23', 'Sabtu'),
('2025-08-29', 'Jumat'), ('2025-08-30', 'Sabtu'),
('2025-09-05', 'Jumat'), ('2025-09-06', 'Sabtu'),
('2025-09-12', 'Jumat'), ('2025-09-13', 'Sabtu'),
('2025-09-19', 'Jumat'), ('2025-09-20', 'Sabtu'),
('2025-09-26', 'Jumat'), ('2025-09-27', 'Sabtu'),
('2025-10-03', 'Jumat'), ('2025-10-04', 'Sabtu'),
('2025-10-10', 'Jumat'), ('2025-10-11', 'Sabtu'),
('2025-10-17', 'Jumat'), ('2025-10-18', 'Sabtu'),
('2025-10-24', 'Jumat'), ('2025-10-25', 'Sabtu'),
('2025-10-31', 'Jumat'),
('2025-11-01', 'Sabtu'), ('2025-11-07', 'Jumat'), ('2025-11-08', 'Sabtu'),
('2025-11-14', 'Jumat'), ('2025-11-15', 'Sabtu'),
('2025-11-21', 'Jumat'), ('2025-11-22', 'Sabtu'),
('2025-11-28', 'Jumat'), ('2025-11-29', 'Sabtu'),
('2025-12-05', 'Jumat'), ('2025-12-06', 'Sabtu'),
('2025-12-12', 'Jumat'), ('2025-12-13', 'Sabtu'),
('2025-12-19', 'Jumat'), ('2025-12-20', 'Sabtu'),
('2025-12-26', 'Jumat'), ('2025-12-27', 'Sabtu');

-- 2026
INSERT INTO hari_libur (tanggal, keterangan) VALUES
('2026-01-02', 'Jumat'), ('2026-01-03', 'Sabtu'),
('2026-01-09', 'Jumat'), ('2026-01-10', 'Sabtu'),
('2026-01-16', 'Jumat'), ('2026-01-17', 'Sabtu'),
('2026-01-23', 'Jumat'), ('2026-01-24', 'Sabtu'),
('2026-01-30', 'Jumat'), ('2026-01-31', 'Sabtu'),
('2026-02-06', 'Jumat'), ('2026-02-07', 'Sabtu'),
('2026-02-13', 'Jumat'), ('2026-02-14', 'Sabtu'),
('2026-02-20', 'Jumat'), ('2026-02-21', 'Sabtu'),
('2026-02-27', 'Jumat'), ('2026-02-28', 'Sabtu'),
('2026-03-06', 'Jumat'), ('2026-03-07', 'Sabtu'),
('2026-03-13', 'Jumat'), ('2026-03-14', 'Sabtu'),
('2026-03-20', 'Jumat'), ('2026-03-21', 'Sabtu'),
('2026-03-27', 'Jumat'), ('2026-03-28', 'Sabtu'),
('2026-04-03', 'Jumat'), ('2026-04-04', 'Sabtu'),
('2026-04-10', 'Jumat'), ('2026-04-11', 'Sabtu'),
('2026-04-17', 'Jumat'), ('2026-04-18', 'Sabtu'),
('2026-04-24', 'Jumat'), ('2026-04-25', 'Sabtu'),
('2026-05-01', 'Jumat'), ('2026-05-02', 'Sabtu'),
('2026-05-08', 'Jumat'), ('2026-05-09', 'Sabtu'),
('2026-05-15', 'Jumat'), ('2026-05-16', 'Sabtu'),
('2026-05-22', 'Jumat'), ('2026-05-23', 'Sabtu'),
('2026-05-29', 'Jumat'), ('2026-05-30', 'Sabtu'),
('2026-06-05', 'Jumat'), ('2026-06-06', 'Sabtu'),
('2026-06-12', 'Jumat'), ('2026-06-13', 'Sabtu'),
('2026-06-19', 'Jumat'), ('2026-06-20', 'Sabtu'),
('2026-06-26', 'Jumat'), ('2026-06-27', 'Sabtu'),
('2026-07-03', 'Jumat'), ('2026-07-04', 'Sabtu'),
('2026-07-10', 'Jumat'), ('2026-07-11', 'Sabtu'),
('2026-07-17', 'Jumat'), ('2026-07-18', 'Sabtu'),
('2026-07-24', 'Jumat'), ('2026-07-25', 'Sabtu'),
('2026-07-31', 'Jumat'),
('2026-08-01', 'Sabtu'), ('2026-08-07', 'Jumat'), ('2026-08-08', 'Sabtu'),
('2026-08-14', 'Jumat'), ('2026-08-15', 'Sabtu'),
('2026-08-21', 'Jumat'), ('2026-08-22', 'Sabtu'),
('2026-08-28', 'Jumat'), ('2026-08-29', 'Sabtu'),
('2026-09-04', 'Jumat'), ('2026-09-05', 'Sabtu'),
('2026-09-11', 'Jumat'), ('2026-09-12', 'Sabtu'),
('2026-09-18', 'Jumat'), ('2026-09-19', 'Sabtu'),
('2026-09-25', 'Jumat'), ('2026-09-26', 'Sabtu'),
('2026-10-02', 'Jumat'), ('2026-10-03', 'Sabtu'),
('2026-10-09', 'Jumat'), ('2026-10-10', 'Sabtu'),
('2026-10-16', 'Jumat'), ('2026-10-17', 'Sabtu'),
('2026-10-23', 'Jumat'), ('2026-10-24', 'Sabtu'),
('2026-10-30', 'Jumat'), ('2026-10-31', 'Sabtu'),
('2026-11-06', 'Jumat'), ('2026-11-07', 'Sabtu'),
('2026-11-13', 'Jumat'), ('2026-11-14', 'Sabtu'),
('2026-11-20', 'Jumat'), ('2026-11-21', 'Sabtu'),
('2026-11-27', 'Jumat'), ('2026-11-28', 'Sabtu'),
('2026-12-04', 'Jumat'), ('2026-12-05', 'Sabtu'),
('2026-12-11', 'Jumat'), ('2026-12-12', 'Sabtu'),
('2026-12-18', 'Jumat'), ('2026-12-19', 'Sabtu'),
('2026-12-25', 'Jumat'), ('2026-12-26', 'Sabtu');

-- ============================================================
-- SPPD_KEGIATAN: add surat_tugas_id + expand status CHECK
-- ============================================================

ALTER TABLE sppd_kegiatan
    ADD COLUMN IF NOT EXISTS surat_tugas_id INTEGER REFERENCES surat_tugas(id) ON DELETE SET NULL;

-- Drop old CHECK, add new one
ALTER TABLE sppd_kegiatan DROP CONSTRAINT IF EXISTS sppd_kegiatan_status_check;
ALTER TABLE sppd_kegiatan ADD CONSTRAINT sppd_kegiatan_status_check
    CHECK (status IN ('draft', 'diajukan', 'disetujui', 'ditolak', 'dilaksanakan', 'pertanggungjawaban', 'dibayar'));

-- ============================================================
-- SPPD_APPROVAL: expand keputusan CHECK
-- ============================================================

ALTER TABLE sppd_approval DROP CONSTRAINT IF EXISTS sppd_approval_keputusan_check;
ALTER TABLE sppd_approval ADD CONSTRAINT sppd_approval_keputusan_check
    CHECK (keputusan IN ('disetujui', 'ditolak', 'dibayar', 'revisi', 'diajukan_pertanggungjawaban'));

-- ============================================================
-- SPPD_DOKUMEN — file pertanggungjawaban
-- ============================================================

CREATE TABLE sppd_dokumen (
    id SERIAL PRIMARY KEY,
    sppd_kegiatan_id INTEGER NOT NULL REFERENCES sppd_kegiatan(id) ON DELETE CASCADE,
    sppd_peserta_id INTEGER REFERENCES sppd_peserta(id) ON DELETE CASCADE,  -- NULL = dokumen per-SPPD
    jenis VARCHAR(30) NOT NULL CHECK (jenis IN (
        'boarding_pass', 'kwitansi_hotel', 'sppd_cap', 'laporan_kegiatan'
    )),
    nama_file VARCHAR(500) NOT NULL,
    path_file VARCHAR(1000) NOT NULL,
    ukuran_bytes INTEGER,
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_surat_tugas_created_by ON surat_tugas(created_by);
CREATE INDEX idx_sppd_kegiatan_surat_tugas ON sppd_kegiatan(surat_tugas_id);
CREATE INDEX idx_sppd_dokumen_kegiatan ON sppd_dokumen(sppd_kegiatan_id);
CREATE INDEX idx_sppd_dokumen_peserta ON sppd_dokumen(sppd_peserta_id);
CREATE INDEX idx_hari_libur_tanggal ON hari_libur(tanggal);
