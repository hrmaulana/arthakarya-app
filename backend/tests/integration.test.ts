// Test integrasi jalur kritikal Arthakarya backend.
//
// Menjalankan:  bun test            (di folder backend)
//
// Membutuhkan PostgreSQL dengan database test. URL dikontrol via
// TEST_DATABASE_URL (default: localhost:5433/arthakarya_test).
// Skema dibuat otomatis oleh runner migrasi (scripts/migrate.ts).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import type { Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import bcrypt from "bcryptjs";
import * as XLSX from "xlsx";
import { parseRpdTargetExcel } from "../src/rpd_target/importExcel.js";

// Harus di-set SEBELUM import app (db.ts membaca env saat module load)
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://arthakarya:arthakarya_secret@localhost:5433/arthakarya_test";

process.env.DATABASE_URL = TEST_DATABASE_URL;
// bcrypt cost rendah untuk test (produksi default 12) — cost 12 membuat
// beberapa test melampaui timeout 5s di mesin lambat/Docker Windows
process.env.BCRYPT_COST = "4";

const { default: app } = await import("../src/app.js");
const pool = (await import("../src/db.js")).default;
const { runMigrations } = await import("../scripts/migrate.js");

const TEST_BCRYPT_COST = 4; // lebih cepat untuk test setup
let server: Server;
let baseUrl: string;

// ============================================================
// HELPERS
// ============================================================

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

// Seed data uji: 2 unit kerja, 1 jenis kegiatan, 3 user
let adminToken = "";
let op1Token = ""; // operator unit 1
let op2Token = ""; // operator unit 2

beforeAll(async () => {
  // Reset total agar test idempotent walau dijalankan berulang kali
  await pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);

  // Skema dibuat dari db/init.sql (sama persis dengan urutan produksi:
  // entrypoint postgres → init.sql → migrasi).
  const initSql = await readFile(path.resolve(import.meta.dir, "../../db/init.sql"), "utf8");
  await pool.query(initSql);
  await runMigrations(pool);

  const hash = await bcrypt.hash("password-uji-123", TEST_BCRYPT_COST);

  await pool.query(
    `INSERT INTO users (unit_kerja_id, username, password_hash, role) VALUES
     (1, 'admin_uji', $1, 'admin'),
     (1, 'operator_uji_1', $1, 'operator'),
     (2, 'operator_uji_2', $1, 'operator')`,
    [hash]
  );

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${(addr as { port: number }).port}`;

  adminToken = (await login("admin_uji", "password-uji-123")).token;
  op1Token = (await login("operator_uji_1", "password-uji-123")).token;
  op2Token = (await login("operator_uji_2", "password-uji-123")).token;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE kegiatan, mata_anggaran, monitoring_imports, monitoring_anggaran,
     rpd_target_imports, rpd_target, users, unit_kerja, jenis_kegiatan RESTART IDENTITY CASCADE`
  );
  // Re-seed data dasar setelah truncate
  const hash = await bcrypt.hash("password-uji-123", TEST_BCRYPT_COST);
  await pool.query(`INSERT INTO unit_kerja (kode_unit, nama_unit) VALUES
    ('UK01', 'Unit Uji Satu'), ('UK02', 'Unit Uji Dua')`);
  await pool.query(`INSERT INTO jenis_kegiatan (nama_jenis) VALUES ('Rapat Uji')`);
  await pool.query(
    `INSERT INTO users (unit_kerja_id, username, password_hash, role) VALUES
     (1, 'admin_uji', $1, 'admin'),
     (1, 'operator_uji_1', $1, 'operator'),
     (2, 'operator_uji_2', $1, 'operator')`,
    [hash]
  );
  // Token tetap valid (JWT tidak tergantung data DB yang di-truncate)
});

const kegiatanPayload = {
  nama_kegiatan: "Rapat Koordinasi Uji",
  tanggal: "2026-08-10",
  unit_kerja_id: 1,
  jenis_kegiatan_id: 1,
  status: "draft",
  mata_anggaran: [
    { kode_akun: "522111", jumlah_rp: 500000, keterangan: "snack" },
    { kode_akun: "522131", jumlah_rp: 250000 },
  ],
};

// Seed monitoring (import + 2 kode akun) agar resolve nama_akun bekerja
async function seedMonitoring() {
  const imp = await pool.query(
    `INSERT INTO monitoring_imports (filename, uploaded_by, total_rows, periode)
     VALUES ('uji.xlsx', 1, 2, 'Periode Uji') RETURNING id`
  );
  await pool.query(
    `INSERT INTO monitoring_anggaran
       (import_id, unit_kerja_id, kode_akun, nama_akun, pagu_revisi, realisasi_periode_lalu, realisasi_periode_ini, realisasi_sd_periode)
     VALUES ($1, 1, '522111', 'Belanja Barang Non Operasional', 1000000, 0, 0, 0),
            ($1, 1, '522131', 'Belanja Jasa Profesi', 500000, 0, 0, 0)`,
    [imp.rows[0].id]
  );
}

// ============================================================
// AUTH
// ============================================================

describe("Auth", () => {
  it("login sukses mengembalikan token + user", async () => {
    const res = await login("admin_uji", "password-uji-123");
    expect(res.status).toBe(200);
    expect(res.token).toBeTruthy();
    expect(res.body.user.username).toBe("admin_uji");
    expect(res.body.user.role).toBe("admin");
  });

  it("login gagal dengan password salah → 401", async () => {
    const res = await login("admin_uji", "salah-salah");
    expect(res.status).toBe(401);
  });

  it("login tanpa username/password → 400 (zod)", async () => {
    const res = await api("POST", "/api/auth/login", { username: "" });
    expect(res.status).toBe(400);
  });

  it("GET /auth/me tanpa token → 401; dengan token → 200", async () => {
    const noToken = await api("GET", "/api/auth/me");
    expect(noToken.status).toBe(401);

    const withToken = await api("GET", "/api/auth/me", undefined, adminToken);
    expect(withToken.status).toBe(200);
    expect(withToken.body.user.username).toBe("admin_uji");
  });

  it("change-password: password lama salah → 401; sukses → bisa login dengan baru", async () => {
    const wrong = await api(
      "PUT",
      "/api/auth/change-password",
      { old_password: "salah-lama", new_password: "password-baru-123" },
      op1Token
    );
    expect(wrong.status).toBe(401);

    const ok = await api(
      "PUT",
      "/api/auth/change-password",
      { old_password: "password-uji-123", new_password: "password-baru-123" },
      op1Token
    );
    expect(ok.status).toBe(200);

    const relogin = await login("operator_uji_1", "password-baru-123");
    expect(relogin.status).toBe(200);
  });

  it("change-password: password baru < 8 karakter → 400", async () => {
    const res = await api(
      "PUT",
      "/api/auth/change-password",
      { old_password: "password-uji-123", new_password: "pendek" },
      op1Token
    );
    expect(res.status).toBe(400);
  });

  it("GET /users: operator → 403, admin → 200", async () => {
    const asOp = await api("GET", "/api/users", undefined, op1Token);
    expect(asOp.status).toBe(403);

    const asAdmin = await api("GET", "/api/users", undefined, adminToken);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.data.length).toBeGreaterThanOrEqual(3);
  });

  it("reset-password oleh admin: sukses → login dengan password baru", async () => {
    const userResult = await pool.query(
      "SELECT id FROM users WHERE username = 'operator_uji_2'"
    );
    const userId = userResult.rows[0].id;

    const res = await api(
      "POST",
      `/api/users/${userId}/reset-password`,
      { new_password: "password-reset-123" },
      adminToken
    );
    expect(res.status).toBe(200);

    const relogin = await login("operator_uji_2", "password-reset-123");
    expect(relogin.status).toBe(200);
  });

  it("POST /users oleh admin: 201, user baru bisa login", async () => {
    const res = await api(
      "POST",
      "/api/users",
      { username: "user_baru_uji", password: "password-baru-123", role: "operator", unit_kerja_id: 2 },
      adminToken
    );
    expect(res.status).toBe(201);
    expect(res.body.data.username).toBe("user_baru_uji");
    expect(res.body.data.role).toBe("operator");
    expect(res.body.data.nama_unit).toBe("Unit Uji Dua");

    const relogin = await login("user_baru_uji", "password-baru-123");
    expect(relogin.status).toBe(200);
  });

  it("POST /users: username duplikat → 409", async () => {
    const res = await api(
      "POST",
      "/api/users",
      { username: "admin_uji", password: "password-baru-123", role: "operator", unit_kerja_id: 1 },
      adminToken
    );
    expect(res.status).toBe(409);
  });

  it("POST /users oleh operator → 403", async () => {
    const res = await api(
      "POST",
      "/api/users",
      { username: "user_baru_uji", password: "password-baru-123", role: "operator", unit_kerja_id: 1 },
      op1Token
    );
    expect(res.status).toBe(403);
  });

  it("POST /users: role tidak valid → 400 (zod)", async () => {
    const res = await api(
      "POST",
      "/api/users",
      { username: "user_baru_uji", password: "password-baru-123", role: "boss", unit_kerja_id: 1 },
      adminToken
    );
    expect(res.status).toBe(400);
  });

  it("POST /users: unit_kerja_id tidak ada → 400", async () => {
    const res = await api(
      "POST",
      "/api/users",
      { username: "user_baru_uji", password: "password-baru-123", role: "operator", unit_kerja_id: 999 },
      adminToken
    );
    expect(res.status).toBe(400);
  });

  it("PATCH /users/:id/status: nonaktifkan → login 401; aktifkan → login 200", async () => {
    const opId = (
      await pool.query("SELECT id FROM users WHERE username = 'operator_uji_1'")
    ).rows[0].id;

    const off = await api("PATCH", `/api/users/${opId}/status`, { is_active: false }, adminToken);
    expect(off.status).toBe(200);

    const blocked = await login("operator_uji_1", "password-uji-123");
    expect(blocked.status).toBe(401);

    const on = await api("PATCH", `/api/users/${opId}/status`, { is_active: true }, adminToken);
    expect(on.status).toBe(200);

    const ok = await login("operator_uji_1", "password-uji-123");
    expect(ok.status).toBe(200);
  });

  it("PATCH /users/:id/status: tidak bisa nonaktifkan akun sendiri → 400", async () => {
    const adminId = (
      await pool.query("SELECT id FROM users WHERE username = 'admin_uji'")
    ).rows[0].id;

    const res = await api("PATCH", `/api/users/${adminId}/status`, { is_active: false }, adminToken);
    expect(res.status).toBe(400);
  });

  it("PATCH /users/:id/status: admin terakhir tidak bisa dinonaktifkan → 400", async () => {
    // Tambah admin kedua agar skenario "membalas via token lama" bisa diuji
    const hash = await bcrypt.hash("password-uji-123", TEST_BCRYPT_COST);
    await pool.query(
      `INSERT INTO users (unit_kerja_id, username, password_hash, role) VALUES
       (1, 'admin_uji_2', $1, 'admin')`,
      [hash]
    );
    const admin2Token = (await login("admin_uji_2", "password-uji-123")).token;
    const admin1Id = (
      await pool.query("SELECT id FROM users WHERE username = 'admin_uji'")
    ).rows[0].id;
    const admin2Id = (
      await pool.query("SELECT id FROM users WHERE username = 'admin_uji_2'")
    ).rows[0].id;

    // Admin 2 menonaktifkan admin 1 → boleh (masih 2 admin aktif)
    const first = await api("PATCH", `/api/users/${admin1Id}/status`, { is_active: false }, admin2Token);
    expect(first.status).toBe(200);

    // Admin 1 (token lamanya masih berlaku) membalas → admin 2 adalah
    // admin aktif terakhir → ditolak
    const second = await api("PATCH", `/api/users/${admin2Id}/status`, { is_active: false }, adminToken);
    expect(second.status).toBe(400);
  });

  it("PATCH /users/:id/status oleh operator → 403", async () => {
    const opId = (
      await pool.query("SELECT id FROM users WHERE username = 'operator_uji_2'")
    ).rows[0].id;

    const res = await api("PATCH", `/api/users/${opId}/status`, { is_active: false }, op1Token);
    expect(res.status).toBe(403);
  });

  it("PATCH /users/:id/status: is_active bukan boolean → 400 (zod)", async () => {
    const opId = (
      await pool.query("SELECT id FROM users WHERE username = 'operator_uji_1'")
    ).rows[0].id;

    const res = await api("PATCH", `/api/users/${opId}/status`, { is_active: "ya" }, adminToken);
    expect(res.status).toBe(400);
  });

  it("PATCH /users/:id/status: user tidak ditemukan → 404", async () => {
    const res = await api("PATCH", "/api/users/9999/status", { is_active: false }, adminToken);
    expect(res.status).toBe(404);
  });

  it("rate limit login: 5 gagal → percobaan ke-6 ditolak 429", async () => {
    // Username unik agar tidak mencemari key rate limit user lain
    const username = "rate_limit_target";
    for (let i = 0; i < 5; i++) {
      const res = await login(username, "salah-salah");
      expect(res.status).toBe(401);
    }
    const blocked = await login(username, "salah-salah");
    expect(blocked.status).toBe(429);
  });
});

// ============================================================
// KEGIATAN + RBAC
// ============================================================

describe("Kegiatan & RBAC", () => {
  beforeEach(seedMonitoring);

  it("operator membuat kegiatan → 201, unit dipaksa ke unitnya sendiri", async () => {
    // operator_uji_1 milik unit 1; kirim unit_kerja_id=2 (unit lain)
    const res = await api(
      "POST",
      "/api/kegiatan",
      { ...kegiatanPayload, unit_kerja_id: 2 },
      op1Token
    );
    expect(res.status).toBe(201);
    expect(res.body.data.unit_kerja_id).toBe(1);
    expect(res.body.data.mata_anggaran.length).toBe(2);
  });

  it("validasi zod: nama_kegiatan kosong → 400", async () => {
    const res = await api(
      "POST",
      "/api/kegiatan",
      { ...kegiatanPayload, nama_kegiatan: "" },
      op1Token
    );
    expect(res.status).toBe(400);
  });

  it("validasi zod: jumlah_rp negatif → 400", async () => {
    const res = await api(
      "POST",
      "/api/kegiatan",
      {
        ...kegiatanPayload,
        mata_anggaran: [{ kode_akun: "522111", jumlah_rp: -5 }],
      },
      op1Token
    );
    expect(res.status).toBe(400);
  });

  it("operator hanya melihat kegiatan unitnya sendiri", async () => {
    await api("POST", "/api/kegiatan", kegiatanPayload, op1Token); // unit 1
    await api("POST", "/api/kegiatan", kegiatanPayload, op2Token); // unit 2 (dipaksa)

    const listOp1 = await api("GET", "/api/kegiatan", undefined, op1Token);
    expect(listOp1.body.data.length).toBe(1);
    expect(listOp1.body.data[0].unit_kerja_id).toBe(1);

    const listAdmin = await api("GET", "/api/kegiatan", undefined, adminToken);
    expect(listAdmin.body.data.length).toBe(2);
  });

  it("operator tidak bisa mengakses detail kegiatan unit lain → 404", async () => {
    const created = await api("POST", "/api/kegiatan", kegiatanPayload, op1Token);
    const id = created.body.data.id;

    const res = await api("GET", `/api/kegiatan/${id}`, undefined, op2Token);
    expect(res.status).toBe(404);
  });

  it("alur status: draft → diajukan → disetujui; disetujui jadi read-only", async () => {
    const created = await api("POST", "/api/kegiatan", kegiatanPayload, op1Token);
    const id = created.body.data.id;

    // Operator ajukan
    const submit = await api("PATCH", `/api/kegiatan/${id}/status`, { status: "diajukan" }, op1Token);
    expect(submit.status).toBe(200);

    // Operator tidak bisa menyetujui sendiri
    const selfApprove = await api("PATCH", `/api/kegiatan/${id}/status`, { status: "disetujui" }, op1Token);
    expect(selfApprove.status).toBe(403);

    // Admin setujui
    const approve = await api("PATCH", `/api/kegiatan/${id}/status`, { status: "disetujui" }, adminToken);
    expect(approve.status).toBe(200);

    // Disetujui → tidak bisa diedit/dihapus oleh operator
    const edit = await api("PUT", `/api/kegiatan/${id}`, kegiatanPayload, op1Token);
    expect(edit.status).toBe(403);

    const del = await api("DELETE", `/api/kegiatan/${id}`, undefined, op1Token);
    expect(del.status).toBe(403);

    // Admin tetap bisa menghapus
    const adminDel = await api("DELETE", `/api/kegiatan/${id}`, undefined, adminToken);
    expect(adminDel.status).toBe(200);
  });

  it("ditolak → operator bisa kembalikan ke draft", async () => {
    const created = await api("POST", "/api/kegiatan", kegiatanPayload, op1Token);
    const id = created.body.data.id;

    await api("PATCH", `/api/kegiatan/${id}/status`, { status: "diajukan" }, op1Token);
    await api("PATCH", `/api/kegiatan/${id}/status`, { status: "ditolak" }, adminToken);

    const backToDraft = await api("PATCH", `/api/kegiatan/${id}/status`, { status: "draft" }, op1Token);
    expect(backToDraft.status).toBe(200);
  });

  it("status tidak valid → 400 (zod)", async () => {
    const created = await api("POST", "/api/kegiatan", kegiatanPayload, op1Token);
    const id = created.body.data.id;

    const res = await api("PATCH", `/api/kegiatan/${id}/status`, { status: "batal" }, op1Token);
    expect(res.status).toBe(400);
  });

  it("POST menyimpan kode_akun & nama_item hasil resolve", async () => {
    const res = await api("POST", "/api/kegiatan", kegiatanPayload, op1Token);
    expect(res.status).toBe(201);
    expect(res.body.data.mata_anggaran[0].kode_akun).toBe("522111");
    expect(res.body.data.mata_anggaran[0].nama_item).toBe("Belanja Barang Non Operasional");
  });

  it("kode akun tidak dikenal → 400", async () => {
    const res = await api(
      "POST",
      "/api/kegiatan",
      { ...kegiatanPayload, mata_anggaran: [{ kode_akun: "999999", jumlah_rp: 1000 }] },
      op1Token
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("tidak ditemukan");
  });

  it("validasi zod: kode_akun kosong → 400", async () => {
    const res = await api(
      "POST",
      "/api/kegiatan",
      { ...kegiatanPayload, mata_anggaran: [{ kode_akun: "", jumlah_rp: 500000 }] },
      op1Token
    );
    expect(res.status).toBe(400);
  });
});

// ============================================================
// REFERENCE AKUN
// ============================================================

describe("Reference Akun", () => {
  beforeEach(async () => {
    // Import lama (tidak boleh muncul) + import terbaru (harus muncul)
    const imp1 = await pool.query(
      `INSERT INTO monitoring_imports (filename, uploaded_by, total_rows, periode)
       VALUES ('lama.xlsx', 1, 1, 'Periode Lama') RETURNING id`
    );
    await pool.query(
      `INSERT INTO monitoring_anggaran
         (import_id, unit_kerja_id, kode_akun, nama_akun, pagu_revisi, realisasi_periode_lalu, realisasi_periode_ini, realisasi_sd_periode)
       VALUES ($1, 1, '111111', 'Akun Lama', 100, 0, 0, 0)`,
      [imp1.rows[0].id]
    );

    const imp2 = await pool.query(
      `INSERT INTO monitoring_imports (filename, uploaded_by, total_rows, periode)
       VALUES ('baru.xlsx', 1, 2, 'Periode Baru') RETURNING id`
    );
    await pool.query(
      `INSERT INTO monitoring_anggaran
         (import_id, unit_kerja_id, kode_akun, nama_akun, pagu_revisi, realisasi_periode_lalu, realisasi_periode_ini, realisasi_sd_periode)
       VALUES ($1, 1, '522111', 'Belanja Barang Non Operasional', 1000000, 0, 0, 0),
              ($1, 2, '522131', 'Belanja Jasa Profesi', 500000, 0, 0, 0)`,
      [imp2.rows[0].id]
    );
  });

  it("GET /reference/akun → distinct dari import terbaru", async () => {
    const res = await api("GET", "/api/reference/akun", undefined, adminToken);
    expect(res.status).toBe(200);
    const akun = res.body.data;
    expect(akun.length).toBe(2);
    expect(akun).toEqual(
      expect.arrayContaining([
        { kode_akun: "522111", nama_akun: "Belanja Barang Non Operasional" },
        { kode_akun: "522131", nama_akun: "Belanja Jasa Profesi" },
      ])
    );
    // Akun dari import lama tidak muncul
    expect(akun.some((a: any) => a.kode_akun === "111111")).toBe(false);
  });
});

// ============================================================
// REKAP
// ============================================================

describe("Rekap", () => {
  beforeEach(seedMonitoring);

  it("summary & per-unit-kerja menghitung total dengan benar", async () => {
    await api("POST", "/api/kegiatan", kegiatanPayload, op1Token); // unit 1: 750.000
    await api("POST", "/api/kegiatan", kegiatanPayload, op2Token); // unit 2: 750.000

    const summary = await api("GET", "/api/rekap/summary", undefined, adminToken);
    expect(summary.body.data.total_kegiatan).toBe(2);
    expect(summary.body.data.total_anggaran).toBe(1500000);

    const perUnit = await api("GET", "/api/rekap/per-unit-kerja", undefined, adminToken);
    const unit1 = perUnit.body.data.find((u: any) => u.kode_unit === "UK01");
    expect(unit1.total_anggaran).toBe(750000);
  });

  it("operator melihat rekap hanya untuk unitnya sendiri", async () => {
    await api("POST", "/api/kegiatan", kegiatanPayload, op1Token); // unit 1
    await api("POST", "/api/kegiatan", kegiatanPayload, op2Token); // unit 2

    const perUnit = await api("GET", "/api/rekap/per-unit-kerja", undefined, op1Token);
    // Hanya 1 baris: unit milik operator (unit 1)
    expect(perUnit.body.data.length).toBe(1);
    expect(perUnit.body.data[0].kode_unit).toBe("UK01");
  });

  it("per-jenis-kegiatan & timeline mengembalikan data", async () => {
    await api("POST", "/api/kegiatan", kegiatanPayload, op1Token);

    const perJenis = await api("GET", "/api/rekap/per-jenis-kegiatan", undefined, adminToken);
    expect(perJenis.body.data[0].nama_jenis).toBe("Rapat Uji");
    expect(perJenis.body.data[0].total_anggaran).toBe(750000);

    const timeline = await api("GET", "/api/rekap/timeline", undefined, adminToken);
    expect(timeline.body.data.length).toBe(1);
  });
});

describe("RPD Target — migrasi", () => {
  it("tabel rpd_target_imports & rpd_target dibuat oleh migrasi", async () => {
    const res = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('rpd_target_imports', 'rpd_target')
       ORDER BY table_name`
    );
    expect(res.rows.map((r) => r.table_name)).toEqual(["rpd_target", "rpd_target_imports"]);
  });
});

describe("RPD Target — import", () => {
  it("import sukses: snapshot + baris tersimpan", async () => {
    const res = await uploadRpdTarget(adminToken, buildXlsx(TARGET_HEADER, TARGET_ROWS), 2026, "Target 2026");
    expect(res.status).toBe(200);
    expect(res.body.data.tahun).toBe(2026);
    expect(res.body.data.total_rows).toBe(6);
    expect(res.body.data.import_id).toBeGreaterThan(0);

    const cnt = await pool.query("SELECT COUNT(*)::int AS n FROM rpd_target");
    expect(cnt.rows[0].n).toBe(6);
    const imp = await pool.query(
      `SELECT filename, tahun, periode, total_rows FROM rpd_target_imports`
    );
    expect(imp.rows).toHaveLength(1);
    expect(imp.rows[0].filename).toBe("target-uji.xlsx");
    expect(imp.rows[0].tahun).toBe(2026);
    expect(imp.rows[0].periode).toBe("Target 2026");
    expect(imp.rows[0].total_rows).toBe(6);
  });

  it("import kedua: snapshot baru menang, riwayat tetap", async () => {
    await uploadRpdTarget(adminToken, buildXlsx(TARGET_HEADER, TARGET_ROWS), 2026);
    const res2 = await uploadRpdTarget(
      adminToken,
      buildXlsx(TARGET_HEADER, [["Unit Uji Satu", 9000000, 0, 0]]),
      2026,
      "Target revisi"
    );
    expect(res2.status).toBe(200);
    expect(res2.body.data.total_rows).toBe(3);

    const imps = await pool.query(`SELECT id FROM rpd_target_imports ORDER BY id`);
    expect(imps.rows).toHaveLength(2);

    const latest = await pool.query(
      `SELECT rt.nilai FROM rpd_target rt
       WHERE rt.import_id = (SELECT MAX(id) FROM rpd_target_imports)
         AND rt.unit_kerja_id = 1 AND rt.bulan = 8`
    );
    expect(Number(latest.rows[0].nilai)).toBe(9000000);
  });

  it("operator → 403; tanpa file → 400; file bukan .xlsx → 400", async () => {
    const buf = buildXlsx(TARGET_HEADER, TARGET_ROWS);
    expect((await uploadRpdTarget(op1Token, buf)).status).toBe(403);
    expect((await api("POST", "/api/rekap/rpd-target/import", undefined, adminToken)).status).toBe(400);

    const form = new FormData();
    form.append("file", new Blob(["hello"], { type: "text/plain" }), "data.txt");
    form.append("tahun", "2026");
    const resTxt = await fetch(`${baseUrl}/api/rekap/rpd-target/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: form,
    });
    expect(resTxt.status).toBe(400);
    expect((await resTxt.json()).error).toContain(".xlsx");
  });

  it("tahun tidak valid → 400", async () => {
    const buf = buildXlsx(TARGET_HEADER, TARGET_ROWS);
    const form = new FormData();
    form.append(
      "file",
      new Blob([buf.buffer as ArrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "target.xlsx"
    );
    form.append("tahun", "abc");
    const res = await fetch(`${baseUrl}/api/rekap/rpd-target/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it("unit tidak dikenal → 400, seluruh import batal", async () => {
    const buf = buildXlsx(TARGET_HEADER, [
      ["Unit Uji Satu", 1000000, 0, 0],
      ["Unit Hantu", 500000, 0, 0],
    ]);
    const res = await uploadRpdTarget(adminToken, buf);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Unit Hantu");
    const cnt = await pool.query("SELECT COUNT(*)::int AS n FROM rpd_target");
    expect(cnt.rows[0].n).toBe(0);
  });

  it("nilai negatif → 400 dengan sebutan sel, import batal", async () => {
    const buf = buildXlsx(TARGET_HEADER, [["Unit Uji Satu", 1000000, -1, 0]]);
    const res = await uploadRpdTarget(adminToken, buf);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/harus angka/);
    const cnt = await pool.query("SELECT COUNT(*)::int AS n FROM rpd_target");
    expect(cnt.rows[0].n).toBe(0);
  });
});

describe("RPD Target — GET", () => {
  // POST /api/kegiatan butuh referensi akun dari monitoring — seed seperti describe lain
  beforeEach(seedMonitoring);

  it("tanpa import → months & units kosong", async () => {
    const res = await api("GET", "/api/rekap/rpd-target?tahun=2026", undefined, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.tahun).toBe(2026);
    expect(res.body.data.months).toEqual([]);
    expect(res.body.data.units).toEqual([]);
  });

  it("target + kumulatif + kegiatan + selisih benar", async () => {
    await uploadRpdTarget(adminToken, buildXlsx(TARGET_HEADER, TARGET_ROWS), 2026);
    // Kegiatan unit 1 bulan Agustus (2 item = 750.000) — kegiatanPayload tanggal 2026-08-10
    await api("POST", "/api/kegiatan", kegiatanPayload, op1Token);

    const res = await api("GET", "/api/rekap/rpd-target?tahun=2026", undefined, adminToken);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.months).toEqual([8, 9, 10]);

    const unit1 = d.units.find((u: any) => u.unit_kerja_id === 1);
    expect(unit1.nama_unit).toBe("Unit Uji Satu");
    const aug = unit1.months.find((m: any) => m.bulan === 8);
    expect(aug.target).toBe(1000000);
    expect(aug.target_kum).toBe(1000000);
    expect(aug.kegiatan).toBe(750000);
    expect(aug.kegiatan_kum).toBe(750000);
    expect(aug.selisih).toBe(250000);

    const sep = unit1.months.find((m: any) => m.bulan === 9);
    expect(sep.target).toBe(1500000);
    expect(sep.target_kum).toBe(2500000);
    expect(sep.kegiatan).toBe(0);
    expect(sep.kegiatan_kum).toBe(750000);
    expect(sep.selisih).toBe(1750000);

    // Unit 2: bulan 10 kosong → target 0, kumulatif tetap berjalan
    const unit2 = d.units.find((u: any) => u.unit_kerja_id === 2);
    expect(unit2.months).toHaveLength(3);
    const oct2 = unit2.months.find((m: any) => m.bulan === 10);
    expect(oct2.target).toBe(0);
    expect(oct2.target_kum).toBe(1100000);
    expect(oct2.kegiatan_kum).toBe(0);
    expect(oct2.selisih).toBe(1100000);
  });

  it("operator hanya melihat unitnya sendiri", async () => {
    await uploadRpdTarget(adminToken, buildXlsx(TARGET_HEADER, TARGET_ROWS), 2026);
    const res = await api("GET", "/api/rekap/rpd-target?tahun=2026", undefined, op1Token);
    expect(res.status).toBe(200);
    expect(res.body.data.units).toHaveLength(1);
    expect(res.body.data.units[0].nama_unit).toBe("Unit Uji Satu");
  });

  it("tahun berbeda → kosong", async () => {
    await uploadRpdTarget(adminToken, buildXlsx(TARGET_HEADER, TARGET_ROWS), 2026);
    const res = await api("GET", "/api/rekap/rpd-target?tahun=2025", undefined, adminToken);
    expect(res.body.data.months).toEqual([]);
    expect(res.body.data.units).toEqual([]);
  });

  it("tanpa token → 401", async () => {
    const res = await api("GET", "/api/rekap/rpd-target?tahun=2026");
    expect(res.status).toBe(401);
  });
});

// ============================================================
// SECURITY HEADERS & HELMET
// ============================================================

// ============================================================
// MONITORING ANGGARAN (import Excel + ringkasan)
// ============================================================

const MON_HEADER = [
  "Kode Program", "Nama Program", "Kode Kegiatan", "Nama Kegiatan", "Unit Kerja",
  "Kode Output", "Nama Output", "Kode SubOutput", "Nama SubOutput",
  "Kode Komponen", "Nama Komponen", "Kode SubKomponen", "Nama SubKomponen",
  "Kode Akun", "Nama Akun", "Pagu Revisi", "Realisasi Periode Lalu",
  "Realisasi Periode Ini", "Realisasi sd Periode",
];

// Baris fixture: Unit Uji Satu (unit 1) & Unit Uji Dua (unit 2)
const MON_ROWS = [
  ["CK", "Program Perencanaan", "CK6262", "Kegiatan Alpha", "Unit Uji Satu",
   "AAC", "Output A", "AAC150", "SubOutput A1", "151", "Komponen A", "1510A", "SubKomponen A",
   "521211", "Belanja Bahan", 1000000, 100000, 50000, 150000],
  ["CK", "Program Perencanaan", "CK6262", "Kegiatan Alpha", "Unit Uji Satu",
   "AAC", "Output A", "AAC150", "SubOutput A1", "151", "Komponen A", "1510A", "SubKomponen A",
   "521211", "Belanja Bahan", 2000000, 0, 0, 0],
  ["CK", "Program Perencanaan", "CK6263", "Kegiatan Beta", "Unit Uji Dua",
   "ABA", "Output B", "ABA210", "SubOutput B2", "211", "Komponen B", "2110A", "SubKomponen B",
   "522151", "Belanja Jasa Profesi", 5000000, 1000000, 500000, 1500000],
];

function buildXlsx(header: string[], rows: (string | number)[][], sheetName = "Data Detail"): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function uploadXlsx(token: string, buf: Buffer, periode?: string) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([buf.buffer as ArrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "data-uji.xlsx"
  );
  if (periode) form.append("periode", periode);
  const res = await fetch(`${baseUrl}/api/monitoring/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // body kosong / bukan JSON
  }
  return { status: res.status, body: json };
}

const TARGET_HEADER = ["Unit Kerja", "Agustus", "September", "Oktober"];
const TARGET_ROWS = [
  ["Unit Uji Satu", 1000000, 1500000, 2000000],
  ["Unit Uji Dua", 500000, 600000, 0],
];

async function uploadRpdTarget(token: string, buf: Buffer, tahun = 2026, periode?: string) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([buf.buffer as ArrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "target-uji.xlsx"
  );
  form.append("tahun", String(tahun));
  if (periode) form.append("periode", periode);
  const res = await fetch(`${baseUrl}/api/rekap/rpd-target/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // body kosong / bukan JSON
  }
  return { status: res.status, body: json };
}

describe("Monitoring Anggaran", () => {
  it("GET /latest → null sebelum ada import", async () => {
    const res = await api("GET", "/api/monitoring/latest", undefined, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it("import oleh admin: 201, ringkasan & latest benar", async () => {
    const buf = buildXlsx(MON_HEADER, MON_ROWS);
    const imp = await uploadXlsx(adminToken, buf, "Periode Uji");
    expect(imp.status).toBe(201);
    expect(imp.body.data.total_rows).toBe(3);
    expect(imp.body.data.pagu).toBe(8000000);
    expect(imp.body.data.realisasi).toBe(1650000);

    const summary = await api("GET", "/api/monitoring/summary", undefined, adminToken);
    expect(summary.status).toBe(200);
    const d = summary.body.data;
    expect(d.total.pagu).toBe(8000000);
    expect(d.total.realisasi).toBe(1650000);
    expect(d.total.sisa).toBe(6350000);
    expect(d.total.persentase).toBeCloseTo(20.63, 1);

    // per unit: unit 1 = 3jt/150rb, unit 2 = 5jt/1,5jt
    const byName = Object.fromEntries(d.per_unit.map((u: any) => [u.nama_unit, u]));
    expect(byName["Unit Uji Satu"].pagu).toBe(3000000);
    expect(byName["Unit Uji Satu"].realisasi).toBe(150000);
    expect(byName["Unit Uji Dua"].pagu).toBe(5000000);
    expect(byName["Unit Uji Dua"].realisasi).toBe(1500000);

    // per akun: 2 akun
    expect(d.per_akun.length).toBe(2);
    const konsultan = d.per_akun.find((a: any) => a.nama_akun === "Belanja Jasa Profesi");
    expect(konsultan.pagu).toBe(5000000);

    const latest = await api("GET", "/api/monitoring/latest", undefined, adminToken);
    expect(latest.body.data.filename).toBe("data-uji.xlsx");
    expect(latest.body.data.periode).toBe("Periode Uji");
    expect(latest.body.data.total_rows).toBe(3);
    expect(latest.body.data.uploaded_by).toBe("admin_uji");
  });

  it("import kedua: latest = import baru, riwayat terjaga", async () => {
    await uploadXlsx(adminToken, buildXlsx(MON_HEADER, MON_ROWS));
    const buf2 = buildXlsx(MON_HEADER, [
      ["CK", "Program Perencanaan", "CK6264", "Kegiatan Gamma", "Unit Uji Dua",
       "ABA", "Output B", "ABA210", "SubOutput B2", "211", "Komponen B", "2110A", "SubKomponen B",
       "522151", "Belanja Jasa Profesi", 9000000, 1000000, 0, 1000000],
    ]);
    const imp2 = await uploadXlsx(adminToken, buf2, "Periode Uji 2");
    expect(imp2.status).toBe(201);
    expect(imp2.body.data.total_rows).toBe(1);

    const summary = await api("GET", "/api/monitoring/summary", undefined, adminToken);
    expect(summary.body.data.total.pagu).toBe(9000000);

    const count = await pool.query("SELECT COUNT(*)::int AS n FROM monitoring_imports");
    expect(count.rows[0].n).toBe(2);
  });

  it("operator tidak bisa import → 403; tanpa file → 400", async () => {
    const buf = buildXlsx(MON_HEADER, MON_ROWS);
    const asOp = await uploadXlsx(op1Token, buf);
    expect(asOp.status).toBe(403);

    const noFile = await api("POST", "/api/monitoring/import", undefined, adminToken);
    expect(noFile.status).toBe(400);
  });

  it("file tanpa sheet Data Detail → 400", async () => {
    const buf = buildXlsx(MON_HEADER, MON_ROWS, "Sheet Lain");
    const res = await uploadXlsx(adminToken, buf);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Data Detail");
  });

  it("unit kerja tidak dikenal → 400 dengan nama unit", async () => {
    const rows = [
      ["CK", "Program Perencanaan", "CK6264", "Kegiatan X", "Unit Tidak Dikenal",
       "ABA", "Output B", "ABA210", "SubOutput B2", "211", "Komponen B", "2110A", "SubKomponen B",
       "522151", "Belanja Jasa Profesi", 1000000, 0, 0, 0],
    ];
    const res = await uploadXlsx(adminToken, buildXlsx(MON_HEADER, rows));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Unit Tidak Dikenal");
  });

  it("operator: summary & detail hanya unitnya sendiri", async () => {
    await uploadXlsx(adminToken, buildXlsx(MON_HEADER, MON_ROWS));

    const summary = await api("GET", "/api/monitoring/summary", undefined, op1Token);
    expect(summary.body.data.per_unit.length).toBe(1);
    expect(summary.body.data.per_unit[0].nama_unit).toBe("Unit Uji Satu");
    expect(summary.body.data.total.pagu).toBe(3000000);
    // per_akun ikut terscope
    expect(summary.body.data.per_akun.length).toBe(1);

    const detail = await api("GET", "/api/monitoring/detail", undefined, op1Token);
    expect(detail.status).toBe(200);
    expect(detail.body.data.length).toBe(2); // hanya 2 baris unit 1
    expect(detail.body.data.every((r: any) => r.nama_unit === "Unit Uji Satu")).toBe(true);
  });

  it("detail: pencarian ?q= menyaring baris", async () => {
    await uploadXlsx(adminToken, buildXlsx(MON_HEADER, MON_ROWS));

    const res = await api("GET", "/api/monitoring/detail?q=Beta", undefined, adminToken);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].nama_kegiatan).toBe("Kegiatan Beta");
  });

  it("public-summary tanpa token: null sebelum import, total benar setelah import", async () => {
    // Sebelum import
    const before = await api("GET", "/api/monitoring/public-summary", undefined);
    expect(before.status).toBe(200);
    expect(before.body.data).toBeNull();

    await uploadXlsx(adminToken, buildXlsx(MON_HEADER, MON_ROWS));

    const after = await api("GET", "/api/monitoring/public-summary", undefined);
    expect(after.status).toBe(200);
    expect(after.body.data.pagu).toBe(8000000);
    expect(after.body.data.realisasi).toBe(1650000);
    expect(after.body.data.sisa).toBe(6350000);
    expect(after.body.data.persentase).toBeCloseTo(20.63, 1);
    // Tidak bocor rincian
    expect(after.body.data.per_unit).toBeUndefined();
    expect(after.body.data.per_akun).toBeUndefined();
  });

  it("endpoint auth tetap terlindungi tanpa token → 401", async () => {
    const summary = await api("GET", "/api/monitoring/summary", undefined);
    expect(summary.status).toBe(401);
    const detail = await api("GET", "/api/monitoring/detail", undefined);
    expect(detail.status).toBe(401);
    const latest = await api("GET", "/api/monitoring/latest", undefined);
    expect(latest.status).toBe(401);
  });
});

describe("Security", () => {
  it("response memiliki security headers (helmet)", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });
});

describe("RPD Target Excel — parser", () => {
  const units = [
    { id: 1, kode_unit: "UK01", nama_unit: "Unit Uji Satu" },
    { id: 2, kode_unit: "UK02", nama_unit: "Unit Uji Dua" },
  ];

  it("parse header nama bulan + nilai → baris per (unit, bulan)", () => {
    const buf = buildXlsx(["Unit Kerja", "Agustus", "September", "Oktober"], [
      ["Unit Uji Satu", 1000000, 1500000, 2000000],
      ["Unit Uji Dua", "500000", "", 0],
    ]);
    const { rows } = parseRpdTargetExcel(buf, units);
    expect(rows).toHaveLength(6);
    const val = (id: number, b: number) =>
      rows.find((r) => r.unit_kerja_id === id && r.bulan === b)?.nilai;
    expect(val(1, 8)).toBe(1000000);
    expect(val(1, 9)).toBe(1500000);
    expect(val(1, 10)).toBe(2000000);
    expect(val(2, 8)).toBe(500000); // string "500000"
    expect(val(2, 9)).toBe(0);      // kosong = 0
    expect(val(2, 10)).toBe(0);     // 0 eksplisit
  });

  it("header bulan bisa angka 1-12", () => {
    const buf = buildXlsx(["Unit", "8", "9"], [["Unit Uji Satu", 100, 200]]);
    const { rows } = parseRpdTargetExcel(buf, units);
    expect(rows.map((r) => r.bulan)).toEqual([8, 9]);
  });

  it("cocok unit via kode_unit", () => {
    const buf = buildXlsx(["Unit", "Agustus"], [["UK01", 700]]);
    const { rows } = parseRpdTargetExcel(buf, units);
    expect(rows[0].unit_kerja_id).toBe(1);
  });

  it("unit tidak dikenal → ImportError", () => {
    const buf = buildXlsx(["Unit", "Agustus"], [["Unit Xyz", 700]]);
    expect(() => parseRpdTargetExcel(buf, units)).toThrow(/Unit Xyz/);
  });

  it("nilai negatif / non-angka → ImportError", () => {
    const bufNeg = buildXlsx(["Unit", "Agustus"], [["Unit Uji Satu", -5]]);
    expect(() => parseRpdTargetExcel(bufNeg, units)).toThrow(/harus angka/);
    const bufStr = buildXlsx(["Unit", "Agustus"], [["Unit Uji Satu", "abc"]]);
    expect(() => parseRpdTargetExcel(bufStr, units)).toThrow(/harus angka/);
  });

  it("header bulan tidak dikenal → ImportError", () => {
    const buf = buildXlsx(["Unit", "Hujan"], [["Unit Uji Satu", 700]]);
    expect(() => parseRpdTargetExcel(buf, units)).toThrow(/bulan/);
  });

  it("nilai string dengan titik ribuan diparsing benar", () => {
    const buf = buildXlsx(["Unit", "Agustus"], [["Unit Uji Satu", "1.631.593.430"]]);
    const { rows } = parseRpdTargetExcel(buf, units);
    expect(rows[0].nilai).toBe(1631593430);
  });

  it("header sel kosong dilewati (kolomnya tidak ikut diparsing)", () => {
    const buf = buildXlsx(["Unit", "Agustus", "", "Oktober"], [
      ["Unit Uji Satu", 100, 999, 200],
    ]);
    const { rows } = parseRpdTargetExcel(buf, units);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.bulan)).toEqual([8, 10]);
    const val = (b: number) => rows.find((r) => r.bulan === b)?.nilai;
    expect(val(8)).toBe(100);  // nilai 999 di kolom header kosong dibuang
    expect(val(10)).toBe(200);
  });

  it("bulan duplikat di header: kolom terakhir menang", () => {
    const buf = buildXlsx(["Unit", "Agustus", "Agustus"], [["Unit Uji Satu", 100, 200]]);
    const { rows } = parseRpdTargetExcel(buf, units);
    expect(rows).toHaveLength(1);
    expect(rows[0].bulan).toBe(8);
    expect(rows[0].nilai).toBe(200);
  });

  it("nama pendek unit cocok via token-overlap (PEMPMP → Direktorat PEMPMP)", () => {
    const dirUnits = [
      { id: 1, kode_unit: "UKE01", nama_unit: "Sekretariat Deputi PMP" },
      { id: 2, kode_unit: "UKE02", nama_unit: "Direktorat PEMPMP" },
    ];
    const buf = buildXlsx(["Unit", "Agustus"], [["PEMPMP", 100]]);
    const { rows } = parseRpdTargetExcel(buf, dirUnits);
    expect(rows[0].unit_kerja_id).toBe(2);
  });

  it("alias singkatan: Sesdep → Sekretariat Deputi PMP", () => {
    const dirUnits = [
      { id: 1, kode_unit: "UKE01", nama_unit: "Sekretariat Deputi PMP" },
      { id: 2, kode_unit: "UKE02", nama_unit: "Direktorat PEMPMP" },
    ];
    const buf = buildXlsx(["Unit", "Agustus"], [["Sesdep", 100]]);
    const { rows } = parseRpdTargetExcel(buf, dirUnits);
    expect(rows[0].unit_kerja_id).toBe(1);
  });

  it("ke-6 unit resmi (Sesdep, PEMPMP, PFMSK, PHKEI, P4T, SITALA) terpetakan", () => {
    const realUnits = [
      { id: 1, kode_unit: "UKE01", nama_unit: "Sekretariat Deputi PMP" },
      { id: 2, kode_unit: "UKE02", nama_unit: "Direktorat PEMPMP" },
      { id: 3, kode_unit: "UKE03", nama_unit: "Direktorat PFMSK" },
      { id: 4, kode_unit: "UKE04", nama_unit: "Direktorat PHKEI" },
      { id: 5, kode_unit: "UKE05", nama_unit: "Direktorat P4T" },
      { id: 6, kode_unit: "UKE06", nama_unit: "Direktorat SITALA" },
    ];
    const buf = buildXlsx(
      ["Unit", "Agustus"],
      [["Sesdep", 1], ["PEMPMP", 2], ["PFMSK", 3], ["PHKEI", 4], ["P4T", 5], ["SITALA", 6]]
    );
    const { rows } = parseRpdTargetExcel(buf, realUnits);
    expect(rows.map((r) => r.unit_kerja_id).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

// ============================================================
// SSE /api/rekap/events
// ============================================================

// Baca stream SSE sampai mengandung `marker` (dengan batas waktu 2 dtk
// agar test tidak menggantung selamanya bila event tak kunjung tiba).
async function readSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
  timeoutMs = 2000
): Promise<string> {
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) return buf;
    buf += decoder.decode(value, { stream: true });
    if (buf.includes(marker)) return buf;
  }
  return buf;
}

describe("SSE /api/rekap/events", () => {
  beforeEach(seedMonitoring);

  it("menolak tanpa token (401)", async () => {
    const res = await fetch(`${baseUrl}/api/rekap/events`);
    expect(res.status).toBe(401);
  });

  it("dengan token: 200, content-type text/event-stream, terima event connected", async () => {
    const ac = new AbortController();
    const res = await fetch(`${baseUrl}/api/rekap/events?token=${adminToken}`, { signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") || "").toContain("text/event-stream");

    const reader = res.body!.getReader();
    const text = await readSse(reader, '"type":"connected"');
    expect(text).toContain('"type":"connected"');
    ac.abort();
  });

  it("broadcast dari hub sampai ke klien yang terhubung", async () => {
    const { broadcast } = await import("../src/events.js");

    const ac = new AbortController();
    const res = await fetch(`${baseUrl}/api/rekap/events?token=${adminToken}`, { signal: ac.signal });
    const reader = res.body!.getReader();
    await readSse(reader, '"type":"connected"'); // buang event awal

    broadcast({ type: "kegiatan" });

    const text = await readSse(reader, '"type":"kegiatan"');
    expect(text).toContain('"type":"kegiatan"');
    ac.abort();
  });
});
