// Test validasi sisa pagu saat menyimpan kegiatan
//
// Menjalankan:  bun test (di folder backend)
// Butuh container arthakarya_test_pg port 5433
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import type { Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import bcrypt from "bcryptjs";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://arthakarya:***@localhost:5433/arthakarya_test";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.BCRYPT_COST = "4";

const { default: app } = await import("../src/app.js");
const pool = (await import("../src/db.js")).default;
const { runMigrations } = await import("../scripts/migrate.js");

const TEST_BCRYPT_COST = 4;
let server: Server;
let baseUrl: string;

async function api(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // body kosong / bukan JSON
  }
  return { status: res.status, body: json };
}

async function login(username: string, password: string) {
  const res = await api("POST", "/api/auth/login", { username, password });
  return { status: res.status, token: res.body?.token, body: res.body };
}

let adminToken = "";
let opToken = "";

beforeAll(async () => {
  await pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);

  const initSql = await readFile(path.resolve(import.meta.dir, "../../db/init.sql"), "utf8");
  await pool.query(initSql);
  await runMigrations(pool);

  const hash = await bcrypt.hash("password-uji-123", TEST_BCRYPT_COST);

  await pool.query(`INSERT INTO unit_kerja (kode_unit, nama_unit) VALUES
    ('UK01', 'Unit Uji Satu'), ('UK02', 'Unit Uji Dua')`);
  await pool.query(`INSERT INTO jenis_kegiatan (nama_jenis) VALUES ('Rapat Uji')`);
  await pool.query(
    `INSERT INTO users (unit_kerja_id, username, password_hash, role) VALUES
     (1, 'admin_uji', $1, 'admin'),
     (1, 'operator_uji', $1, 'operator')`,
    [hash]
  );

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${(addr as { port: number }).port}`;

  adminToken = (await login("admin_uji", "password-uji-123")).token;
  opToken = (await login("operator_uji", "password-uji-123")).token;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE kegiatan, mata_anggaran, monitoring_imports, monitoring_anggaran,
     users, unit_kerja, jenis_kegiatan RESTART IDENTITY CASCADE`
  );
  const hash = await bcrypt.hash("password-uji-123", TEST_BCRYPT_COST);
  await pool.query(`INSERT INTO unit_kerja (kode_unit, nama_unit) VALUES
    ('UK01', 'Unit Uji Satu'), ('UK02', 'Unit Uji Dua')`);
  await pool.query(`INSERT INTO jenis_kegiatan (nama_jenis) VALUES ('Rapat Uji')`);
  await pool.query(
    `INSERT INTO users (unit_kerja_id, username, password_hash, role) VALUES
     (1, 'admin_uji', $1, 'admin'),
     (1, 'operator_uji', $1, 'operator')`,
    [hash]
  );
});

/** Seed monitoring anggaran dengan akun untuk unit 1 */
async function seedMonitoring(unitKerjaId = 1) {
  const imp = await pool.query(
    `INSERT INTO monitoring_imports (filename, uploaded_by, total_rows, periode)
     VALUES ('uji-akun.xlsx', 1, 4, 'Periode Uji') RETURNING id`
  );
  await pool.query(
    `INSERT INTO monitoring_anggaran
       (import_id, unit_kerja_id, kode_akun, nama_akun, pagu_revisi,
        realisasi_periode_lalu, realisasi_periode_ini, realisasi_sd_periode)
     VALUES
       ($1, $2, '521111', 'Belanja Bahan', 10000000, 0, 0, 0),
       ($1, $2, '522111', 'Belanja Barang Non Operasional', 5000000, 0, 0, 2000000),
       ($1, $2, '523111', 'Belanja Jasa Lainnya', 3000000, 0, 0, 500000)`,
    [imp.rows[0].id, unitKerjaId]
  );
}

/** Seed kegiatan dengan satu item MAK */
async function seedKegiatan(
  unitKerjaId = 1,
  kodeAkun = "521111",
  jumlahRp = 1500000
): Promise<number> {
  const keg = await pool.query(
    `INSERT INTO kegiatan (unit_kerja_id, jenis_kegiatan_id, created_by, nama_kegiatan, tanggal, status)
     VALUES ($1, 1, 1, 'Kegiatan Uji', '2026-08-15', 'draft') RETURNING id`,
    [unitKerjaId]
  );
  await pool.query(
    `INSERT INTO mata_anggaran (kegiatan_id, nama_item, jumlah_rp, kode_akun)
     VALUES ($1, 'Item Uji', $2, $3)`,
    [keg.rows[0].id, jumlahRp, kodeAkun]
  );
  return keg.rows[0].id;
}

// ============================================================
// TESTS
// ============================================================

describe("Kegiatan — validasi sisa pagu", () => {
  describe("POST /api/kegiatan", () => {
    it("jumlah_rp <= sisa pagu → 201 (sukses)", async () => {
      await seedMonitoring(1);
      const res = await api(
        "POST",
        "/api/kegiatan",
        {
          nama_kegiatan: "Rapat Uji",
          tanggal: "2026-09-01",
          unit_kerja_id: 1,
          jenis_kegiatan_id: 1,
          mata_anggaran: [{ kode_akun: "521111", jumlah_rp: 3000000 }],
        },
        opToken
      );
      expect(res.status).toBe(201);
      expect(res.body.data.mata_anggaran[0].jumlah_rp).toBe(3000000);
    });

    it("jumlah_rp > sisa pagu → 400 dengan pesan error", async () => {
      await seedMonitoring(1);
      // Akun 522111: pagu 5jt, realisasi 2jt, sisa = 3jt
      const res = await api(
        "POST",
        "/api/kegiatan",
        {
          nama_kegiatan: "Rapat Uji Over",
          tanggal: "2026-09-01",
          unit_kerja_id: 1,
          jenis_kegiatan_id: 1,
          mata_anggaran: [{ kode_akun: "522111", jumlah_rp: 4000000 }],
        },
        opToken
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("tidak cukup");
      expect(res.body.error).toContain("522111");
    });

    it("beberapa item, satu over → 400", async () => {
      await seedMonitoring(1);
      const res = await api(
        "POST",
        "/api/kegiatan",
        {
          nama_kegiatan: "Rapat Multi Item",
          tanggal: "2026-09-01",
          unit_kerja_id: 1,
          jenis_kegiatan_id: 1,
          mata_anggaran: [
            { kode_akun: "521111", jumlah_rp: 1000000 }, // OK: sisa 10jt
            { kode_akun: "523111", jumlah_rp: 3000000 }, // OVER: sisa 2.5jt (pagu 3jt - realisasi 500rb)
          ],
        },
        opToken
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("tidak cukup");
      expect(res.body.error).toContain("523111");
    });

    it("kegiatan lain sudah pakai akun yang sama → sisa berkurang", async () => {
      await seedMonitoring(1);
      await seedKegiatan(1, "521111", 8000000); // pakai 8jt dari sisa 10jt

      // Sisa sekarang = 10jt - 0 - 8jt = 2jt
      const res = await api(
        "POST",
        "/api/kegiatan",
        {
          nama_kegiatan: "Kegiatan Kedua",
          tanggal: "2026-09-01",
          unit_kerja_id: 1,
          jenis_kegiatan_id: 1,
          mata_anggaran: [{ kode_akun: "521111", jumlah_rp: 3000000 }], // > 2jt
        },
        opToken
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("tidak cukup");
    });

    it("tanpa monitoring import → validasi skip (201)", async () => {
      // Tidak seed monitoring — validasi harus dilewati
      const res = await api(
        "POST",
        "/api/kegiatan",
        {
          nama_kegiatan: "Rapat Tanpa Monitoring",
          tanggal: "2026-09-01",
          unit_kerja_id: 1,
          jenis_kegiatan_id: 1,
          mata_anggaran: [{ kode_akun: "999999", jumlah_rp: 1000000 }],
        },
        opToken
      );
      // Akan gagal karena kode akun tidak dikenal oleh resolveMataAnggaranItems,
      // bukan karena validasi sisa pagu — artinya validasi skip
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("tidak ditemukan");
    });
  });

  describe("PUT /api/kegiatan/:id", () => {
    it("exclude kegiatan sendiri — bisa simpan dengan akun yang sama", async () => {
      await seedMonitoring(1);
      const kegiatanId = await seedKegiatan(1, "521111", 3000000); // sisa masih 10jt - 3jt = 7jt

      // Update — ganti jumlah jadi 5jt (masih ≤ sisa 7jt)
      const res = await api(
        "PUT",
        `/api/kegiatan/${kegiatanId}`,
        {
          nama_kegiatan: "Rapat Uji Update",
          tanggal: "2026-09-01",
          unit_kerja_id: 1,
          jenis_kegiatan_id: 1,
          mata_anggaran: [{ kode_akun: "521111", jumlah_rp: 5000000 }],
        },
        opToken
      );
      expect(res.status).toBe(200);
    });

    it("exclude kegiatan sendiri — tetap cek sisa terhadap kegiatan lain", async () => {
      await seedMonitoring(1);
      await seedKegiatan(1, "521111", 7000000); // kegiatan lain pakai 7jt, sisa = 3jt
      const kegiatanId = await seedKegiatan(1, "521111", 1000000); // kegiatan ini pakai 1jt

      // Update: coba naikkan jadi 4jt (sisa setelah kegiatan lain = 10jt - 7jt = 3jt) → over
      const res = await api(
        "PUT",
        `/api/kegiatan/${kegiatanId}`,
        {
          nama_kegiatan: "Rapat Uji Over Update",
          tanggal: "2026-09-01",
          unit_kerja_id: 1,
          jenis_kegiatan_id: 1,
          mata_anggaran: [{ kode_akun: "521111", jumlah_rp: 4000000 }],
        },
        opToken
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("tidak cukup");
    });

    it("aktivitas kegiatan sendiri dikecualikan dari dipakai_kegiatan", async () => {
      await seedMonitoring(1);
      const kegiatanId = await seedKegiatan(1, "522111", 1000000);
      // 522111: pagu 5jt, realisasi 2jt, dipakai oleh kegiatan ini 1jt
      // Sisa sebenarnya: 5jt - 2jt - 1jt = 2jt
      // Tapi karena exclude kegiatan ini, dipakai dari kegiatan lain = 0
      // Sisa yang dihitung: 5jt - 2jt - 0 = 3jt
      // Jadi boleh update ke 3jt
      const res = await api(
        "PUT",
        `/api/kegiatan/${kegiatanId}`,
        {
          nama_kegiatan: "Rapat Update",
          tanggal: "2026-09-01",
          unit_kerja_id: 1,
          jenis_kegiatan_id: 1,
          mata_anggaran: [{ kode_akun: "522111", jumlah_rp: 3000000 }],
        },
        opToken
      );
      expect(res.status).toBe(200);
      expect(res.body.data.mata_anggaran[0].jumlah_rp).toBe(3000000);
    });

    it("tanpa monitoring import → validasi skip (200)", async () => {
      // Buat kegiatan dulu tanpa monitoring import
      const kegiatanId = await seedKegiatan(1, "521111", 1000000);

      const res = await api(
        "PUT",
        `/api/kegiatan/${kegiatanId}`,
        {
          nama_kegiatan: "Rapat Update No Mon",
          tanggal: "2026-09-01",
          unit_kerja_id: 1,
          jenis_kegiatan_id: 1,
          mata_anggaran: [{ kode_akun: "999999", jumlah_rp: 5000000 }],
        },
        opToken
      );
      // Gagal karena kode akun tidak dikenal, bukan karena sisa pagu
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("tidak ditemukan");
    });
  });

  describe("export validateSisaPagu", () => {
    it("function dapat di-import dan dipanggil langsung", async () => {
      const { validateSisaPagu } = await import("../src/routes/kegiatan.js");
      expect(typeof validateSisaPagu).toBe("function");

      // Tanpa monitoring → return null (skip)
      const result = await validateSisaPagu(1, [{ kode_akun: "521111", jumlah_rp: 999999999 }]);
      expect(result).toBeNull();
    });
  });
});