// Seed admin awal — PRODUCTION ONLY.
//
// Membuat user admin pertama jika belum ada admin sama sekali.
// Password acak (crypto.randomBytes) dicetak SEKALI ke stdout saat
// pertama dijalankan, lalu tidak akan muncul lagi (idempotent).
//
// Menjalankan:  bun run scripts/seed-admin.ts   (atau: bun run seed-admin)
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://arthakarya:arthakarya_secret@localhost:5432/arthakarya";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const BCRYPT_COST = 12;

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });

  try {
    // Sudah ada admin? Tidak perlu apa-apa (idempotent).
    const existing = await pool.query(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    );
    if (existing.rows.length > 0) {
      console.log("[seed-admin] Admin sudah ada, tidak ada aksi.");
      return;
    }

    // Admin harus terikat ke unit kerja — ambil unit pertama.
    const unit = await pool.query(
      "SELECT id, kode_unit, nama_unit FROM unit_kerja ORDER BY id LIMIT 1"
    );
    if (unit.rows.length === 0) {
      console.error(
        "[seed-admin] Tidak ada unit_kerja. Isi daftar unit kerja di db/init.sql sebelum menjalankan seed-admin."
      );
      process.exit(1);
    }

    const password = crypto.randomBytes(12).toString("base64url"); // ±16 karakter
    const hash = await bcrypt.hash(password, BCRYPT_COST);

    await pool.query(
      `INSERT INTO users (unit_kerja_id, username, password_hash, role)
       VALUES ($1, $2, $3, 'admin')`,
      [unit.rows[0].id, ADMIN_USERNAME, hash]
    );

    console.log("==============================================================");
    console.log("[seed-admin] Admin awal BERHASIL dibuat.");
    console.log(`  Username : ${ADMIN_USERNAME}`);
    console.log(`  Password : ${password}`);
    console.log(`  Unit     : ${unit.rows[0].kode_unit} — ${unit.rows[0].nama_unit}`);
    console.log("  ⚠️  CATAT password di atas SEKARANG, lalu ganti");
    console.log("      segera setelah login pertama via menu Ganti Password.");
    console.log("==============================================================");
  } finally {
    await pool.end();
  }
}

main().catch((err: Error) => {
  console.error("[seed-admin] Gagal:", err.message);
  process.exit(1);
});
