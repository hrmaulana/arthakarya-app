// Test reference endpoint — khususnya GET /api/reference/akun dengan sisa pagu
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

beforeAll(async () => {
  await pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);

  const initSql = await readFile(path.resolve(import.meta.dir, "../../db/init.sql"), "utf8");
  await pool.query(initSql);
  await runMigrations(pool);

  const hash = await bcrypt.hash("password-uji-123", TEST_BCRYPT_COST);

  // Seed unit kerja + jenis kegiatan + users
  await pool.query(`INSERT INTO unit_kerja (kode_unit, nama_unit) VALUES
    ('UK01', 'Unit Uji Satu'), ('UK02', 'Unit Uji Dua')`);
  await pool.query(`INSERT INTO jenis_kegiatan (nama_jenis) VALUES ('Rapat Uji')`);
  await pool.query(
    `INSERT INTO users (unit_kerja_id, username, password_hash, role) VALUES
     (1, 'admin_uji', $1, 'admin')`,
    [hash]
  );

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${(addr as { port: number }).port}`;

  adminToken = (await login("admin_uji", "password-uji-123")).token;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE kegiatan, mata_anggaran, monitoring_imports, monitoring_anggaran,
     users, unit_kerja, jenis_kegiatan RESTART IDENTITY CASCADE`
  );
  // Re-seed data dasar
  const hash = await bcrypt.hash("password-uji-123", TEST_BCRYPT_COST);
  await pool.query(`INSERT INTO unit_kerja (kode_unit, nama_unit) VALUES
    ('UK01', 'Unit Uji Satu'), ('UK02', 'Unit Uji Dua')`);
  await pool.query(`INSERT INTO jenis_kegiatan (nama_jenis) VALUES ('Rapat Uji')`);
  await pool.query(
    `INSERT INTO users (unit_kerja_id, username, password_hash, role) VALUES
     (1, 'admin_uji', $1, 'admin')`,
    [hash]
  );
});

/** Seed data monitoring anggaran dengan 3 akun untuk unit 1 */
async function seedMonitoring(unitKerjaId = 1) {
  const imp = await pool.query(
    `INSERT INTO monitoring_imports (filename, uploaded_by, total_rows, periode)
     VALUES ('uji-akun.xlsx', 1, 3, 'Periode Uji Akun') RETURNING id`
  );
  // Akun A: pagu besar, tanpa realisasi
  // Akun B: pagu sedang, ada realisasi
  // Akun C: pagu kecil
  await pool.query(
    `INSERT INTO monitoring_anggaran
       (import_id, unit_kerja_id, kode_akun, nama_akun, pagu_revisi,
        realisasi_periode_lalu, realisasi_periode_ini, realisasi_sd_periode)
     VALUES
       ($1, $2, '521111', 'Belanja Bahan Habis Pakai', 10000000, 0, 0, 0),
       ($1, $2, '522111', 'Belanja Barang Non Operasional', 5000000, 0, 0, 2000000),
       ($1, $2, '523111', 'Belanja Jasa Lainnya', 3000000, 0, 0, 500000)`,
    [imp.rows[0].id, unitKerjaId]
  );
}

/** Seed kegiatan dengan mata_anggaran yang mengurangi sisa pagu akun tertentu */
async function seedKegiatan(unitKerjaId = 1, kodeAkun = "521111", jumlahRp = 1500000) {
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

describe("Reference — GET /api/reference/akun", () => {
  it("tanpa parameter unit_kerja_id → 400", async () => {
    const res = await api("GET", "/api/reference/akun", undefined, adminToken);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("unit_kerja_id dengan angka valid — mengembalikan data akun dengan sisa_pagu", async () => {
    await seedMonitoring(1);
    const res = await api("GET", "/api/reference/akun?unit_kerja_id=1", undefined, adminToken);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(res.body.data.length).toBeGreaterThan(0);

    // Setiap item harus punya properti yang diharapkan
    for (const item of res.body.data) {
      expect(item).toHaveProperty("kode_akun");
      expect(item).toHaveProperty("nama_akun");
      expect(item).toHaveProperty("pagu_revisi");
      expect(item).toHaveProperty("realisasi_sd_periode");
      expect(item).toHaveProperty("dipakai_kegiatan");
      expect(item).toHaveProperty("sisa_pagu");
    }
  });

  it("sisa_pagu = pagu_revisi - realisasi_sd_periode - dipakai_kegiatan (tanpa kegiatan)", async () => {
    await seedMonitoring(1);

    const res = await api("GET", "/api/reference/akun?unit_kerja_id=1", undefined, adminToken);

    // Akun 521111: pagu 10jt, realisasi 0, dipakai 0, sisa = 10jt
    const akun521111 = res.body.data.find((a: any) => a.kode_akun === "521111");
    expect(akun521111).toBeDefined();
    expect(akun521111.pagu_revisi).toBe(10000000);
    expect(akun521111.realisasi_sd_periode).toBe(0);
    expect(akun521111.dipakai_kegiatan).toBe(0);
    expect(akun521111.sisa_pagu).toBe(10000000);

    // Akun 522111: pagu 5jt, realisasi 2jt, dipakai 0, sisa = 3jt
    const akun522111 = res.body.data.find((a: any) => a.kode_akun === "522111");
    expect(akun522111).toBeDefined();
    expect(akun522111.pagu_revisi).toBe(5000000);
    expect(akun522111.realisasi_sd_periode).toBe(2000000);
    expect(akun522111.dipakai_kegiatan).toBe(0);
    expect(akun522111.sisa_pagu).toBe(3000000);
  });

  it("dipakai_kegiatan dan sisa_pagu dipengaruhi oleh kegiatan yang ada", async () => {
    await seedMonitoring(1);
    await seedKegiatan(1, "521111", 1500000);

    const res = await api("GET", "/api/reference/akun?unit_kerja_id=1", undefined, adminToken);

    // Akun 521111: pagu 10jt, realisasi 0, dipakai 1.5jt, sisa = 8.5jt
    const akun521111 = res.body.data.find((a: any) => a.kode_akun === "521111");
    expect(akun521111).toBeDefined();
    expect(akun521111.sisa_pagu).toBe(8500000);
    expect(akun521111.dipakai_kegiatan).toBe(1500000);
  });

  it("exclude_kegiatan_id mengecualikan kegiatan tertentu dari dipakai_kegiatan", async () => {
    await seedMonitoring(1);
    const kegiatanId = await seedKegiatan(1, "521111", 2000000);

    // Tanpa exclude: dipakai = 2jt
    const resTanpa = await api("GET", "/api/reference/akun?unit_kerja_id=1", undefined, adminToken);
    const akun521111Tanpa = resTanpa.body.data.find((a: any) => a.kode_akun === "521111");
    expect(akun521111Tanpa.dipakai_kegiatan).toBe(2000000);

    // Dengan exclude kegiatan_id: dipakai = 0
    const resDengan = await api(
      "GET",
      `/api/reference/akun?unit_kerja_id=1&exclude_kegiatan_id=${kegiatanId}`,
      undefined,
      adminToken
    );
    const akun521111Dengan = resDengan.body.data.find((a: any) => a.kode_akun === "521111");
    expect(akun521111Dengan.dipakai_kegiatan).toBe(0);
    expect(akun521111Dengan.sisa_pagu).toBe(10000000);
  });

  it("data diurutkan berdasarkan sisa_pagu descending", async () => {
    await seedMonitoring(1);
    // 521111: sisa 10jt, 522111: sisa 3jt, 523111: sisa 2.5jt
    // Urutan: 521111 → 522111 → 523111

    const res = await api("GET", "/api/reference/akun?unit_kerja_id=1", undefined, adminToken);
    const sisaList = res.body.data.map((a: any) => a.sisa_pagu);

    for (let i = 1; i < sisaList.length; i++) {
      expect(sisaList[i]).toBeLessThanOrEqual(sisaList[i - 1]);
    }
  });

  it("hanya unit_kerja_id yang diminta (tidak menampilkan akun unit lain)", async () => {
    await seedMonitoring(1);
    await seedMonitoring(2);

    const res = await api("GET", "/api/reference/akun?unit_kerja_id=2", undefined, adminToken);
    expect(res.status).toBe(200);
    for (const item of res.body.data) {
      // Filter hanya akun unit 1 tidak akan muncul — semua akun yang disediakan
      // Untuk unit 2, semua akun yang disediakan valid
      expect(item).toBeDefined();
    }
    // Harusnya ada 3 akun (semua di-unit 2)
    expect(res.body.data.length).toBe(3);
  });

  it("tanpa token → 401 (auth middleware)", async () => {
    const res = await api("GET", "/api/reference/akun?unit_kerja_id=1", undefined, undefined);
    expect(res.status).toBe(401);
  });
});