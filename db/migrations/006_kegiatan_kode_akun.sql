-- 006_kegiatan_kode_akun.sql
-- Rincian mata anggaran kini diikat ke kode akun dari data monitoring (SAKTI).
-- kode_akun nullable: baris lama tetap aman, baris baru selalu terisi.
ALTER TABLE mata_anggaran ADD COLUMN kode_akun VARCHAR(20);
