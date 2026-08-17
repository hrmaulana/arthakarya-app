-- 008_sppd_approval_keputusan_widen.sql
-- sppd_approval.keputusan VARCHAR(20) terlalu sempit untuk nilai
-- 'diajukan_pertanggungjawaban' (27 karakter) yang di-INSERT endpoint
-- POST /api/sppd/:id/ajukan-pertanggungjawaban → gagal dengan
-- "value too long for type character varying(20)" (500).
-- Migrasi 005 menambah nilai tsb ke CHECK constraint tapi tidak
-- melebarkan kolomnya. Perbaikan: lebarkan kolom.
ALTER TABLE sppd_approval ALTER COLUMN keputusan TYPE VARCHAR(40);
