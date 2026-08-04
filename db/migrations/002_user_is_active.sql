-- 002_user_is_active.sql
-- Soft delete user: admin bisa menonaktifkan user (tidak bisa login)
-- tanpa menghapus riwayat kegiatannya (created_by tetap tercatat).
-- is_active TRUE (default) = aktif; FALSE = nonaktif.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
