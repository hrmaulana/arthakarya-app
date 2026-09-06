-- 009_monitoring_input_manual.sql
-- Data manual (tidak dari Excel) untuk halaman Monitoring Penyerapan:
--   - Persentase SPP (Surat Perintah Pembayaran)
--   - Jumlah kegiatan yang belum diberkaskan
--
-- Hanya satu baris per import_id (merge dengan import terbaru monitoring_imports).
-- API GET /api/monitoring/data-manual mengambil baris yang import_id-nya cocok
-- dengan import_id terbaru, atau null jika belum ada.
-- API PUT /api/monitoring/data-manual (admin) membuat/mengupdate baris.

CREATE TABLE monitoring_input_manual (
  id SERIAL PRIMARY KEY,
  import_id INTEGER NOT NULL REFERENCES monitoring_imports(id) ON DELETE CASCADE,
  spp_persen NUMERIC(5,2) DEFAULT 0,
  kegiatan_belum_berkaskan INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  updated_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_monitoring_manual_import ON monitoring_input_manual(import_id);
