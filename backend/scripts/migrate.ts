// Lightweight migration runner untuk Arthakarya.
//
// Cara kerja:
//   1. Membuat tabel schema_migrations jika belum ada.
//   2. Menjalankan file db/migrations/*.sql yang belum tercatat, urut alfabetis,
//      masing-masing dalam satu transaksi.
//   3. Mencatat versi yang berhasil di schema_migrations.
//
// Menjalankan:  bun run scripts/migrate.ts   (atau: bun run migrate)
// Idempotent: aman dijalankan berkali-kali.
//
// Fungsi runMigrations di-export agar bisa dipakai oleh test integrasi.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

// Lokasi default: repo root db/migrations (relatif dari backend/scripts).
// Di container (docker-compose.prod.yml) di-override via env MIGRATIONS_DIR.
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ||
  path.resolve(import.meta.dir, "../../db/migrations");

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://arthakarya:arthakarya_secret@localhost:5432/arthakarya";

/** Jalankan semua migrasi yang belum diterapkan terhadap pool yang diberikan. */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("[migrate] Tidak ada file migrasi di " + MIGRATIONS_DIR);
    return;
  }

  for (const file of files) {
    const applied = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [file]
    );
    if (applied.rows.length > 0) continue;

    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [file]
      );
      await client.query("COMMIT");
      console.log(`[migrate] applied ${file}`);
    } catch (err: any) {
      await client.query("ROLLBACK");
      throw new Error(`Migrasi ${file} gagal: ${err.message}`);
    } finally {
      client.release();
    }
  }

  console.log("[migrate] Semua migrasi sudah ter-update.");
}

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  main().catch((err: Error) => {
    console.error("[migrate] Gagal:", err.message);
    process.exit(1);
  });
}
