-- Migration: 011 — tambah kolom `jenis` di monitoring_imports
-- untuk membedakan tipe penyerapan: akrual, spp, sp2d
ALTER TABLE monitoring_imports
  ADD COLUMN IF NOT EXISTS jenis VARCHAR(10) NOT NULL DEFAULT 'akrual',
  ADD CONSTRAINT chk_jenis CHECK (jenis IN ('akrual', 'spp', 'sp2d'));

CREATE INDEX IF NOT EXISTS idx_monitoring_imports_jenis ON monitoring_imports(jenis);