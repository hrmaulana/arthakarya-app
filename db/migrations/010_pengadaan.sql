-- 010_pengadaan.sql
-- Modul Pengadaan — Rencana Pengadaan Barang/Jasa
-- Terintegrasi dengan kegiatan, monitoring_anggaran, dan manajemen risiko

CREATE TABLE pengadaan (
  id SERIAL PRIMARY KEY,
  kegiatan_id INTEGER REFERENCES kegiatan(id) ON DELETE SET NULL,
  unit_kerja_id INTEGER NOT NULL REFERENCES unit_kerja(id),
  kode_akun VARCHAR(20),
  nama_pengadaan VARCHAR(500) NOT NULL,
  jenis VARCHAR(50) DEFAULT 'barang',  -- barang/jasa
  jumlah INTEGER DEFAULT 1,
  satuan VARCHAR(50),
  estimasi_biaya BIGINT NOT NULL,
  riwayat_status JSONB DEFAULT '[]'::jsonb,  -- [{status, tgl, oleh}]
  status VARCHAR(20) DEFAULT 'rencana',  -- rencana, proses_lelang, kontrak, selesai
  nomor_kontrak VARCHAR(100),
  tanggal_mulai DATE,
  tanggal_selesai DATE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_pengadaan_unit ON pengadaan(unit_kerja_id);
CREATE INDEX idx_pengadaan_status ON pengadaan(status);
CREATE INDEX idx_pengadaan_kegiatan ON pengadaan(kegiatan_id);