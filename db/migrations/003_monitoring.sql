-- 003_monitoring.sql
-- Monitoring Anggaran: snapshot import file Excel SAKTI (anggaran & realisasi).
-- Satu upload = satu snapshot; API membaca import terbaru (MAX id).
-- sisa_anggaran & persentase TIDAK disimpan — dihitung di query
-- (pagu_revisi - realisasi_sd_periode; realisasi_sd_periode / pagu_revisi).

CREATE TABLE monitoring_imports (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  periode VARCHAR(100),
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  total_rows INTEGER NOT NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE monitoring_anggaran (
  id BIGSERIAL PRIMARY KEY,
  import_id INTEGER NOT NULL REFERENCES monitoring_imports(id) ON DELETE CASCADE,
  unit_kerja_id INTEGER NOT NULL REFERENCES unit_kerja(id),
  kode_program VARCHAR(20),
  nama_program VARCHAR(255),
  kode_kegiatan VARCHAR(20),
  nama_kegiatan VARCHAR(255),
  kode_output VARCHAR(20),
  nama_output VARCHAR(255),
  kode_suboutput VARCHAR(20),
  nama_suboutput VARCHAR(255),
  kode_komponen VARCHAR(20),
  nama_komponen VARCHAR(255),
  kode_subkomponen VARCHAR(20),
  nama_subkomponen VARCHAR(255),
  kode_akun VARCHAR(20),
  nama_akun VARCHAR(255),
  pagu_revisi BIGINT NOT NULL DEFAULT 0,
  realisasi_periode_lalu BIGINT NOT NULL DEFAULT 0,
  realisasi_periode_ini BIGINT NOT NULL DEFAULT 0,
  realisasi_sd_periode BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_monitoring_anggaran_import ON monitoring_anggaran(import_id);
CREATE INDEX idx_monitoring_anggaran_unit ON monitoring_anggaran(unit_kerja_id);
