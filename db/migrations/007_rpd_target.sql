-- 007_rpd_target.sql — Target RPD Bulanan per unit kerja (import Excel)
-- Snapshot tiap upload (rpd_target_imports) + nilai per (unit, bulan) (rpd_target).
-- Import terbaru = baris rpd_target dengan import_id = MAX(id) pada
-- rpd_target_imports untuk tahun yang sama.

CREATE TABLE rpd_target_imports (
  id          SERIAL PRIMARY KEY,
  filename    TEXT NOT NULL,
  tahun       INTEGER NOT NULL,
  periode     TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_rows  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE rpd_target (
  id            SERIAL PRIMARY KEY,
  import_id     INTEGER NOT NULL REFERENCES rpd_target_imports(id) ON DELETE CASCADE,
  unit_kerja_id INTEGER NOT NULL REFERENCES unit_kerja(id),
  bulan         INTEGER NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  nilai         BIGINT NOT NULL DEFAULT 0,
  UNIQUE (import_id, unit_kerja_id, bulan)
);

CREATE INDEX idx_rpd_target_import_id ON rpd_target (import_id);
CREATE INDEX idx_rpd_target_imports_tahun ON rpd_target_imports (tahun);
