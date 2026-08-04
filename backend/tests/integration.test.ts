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
    `TRUNCATE kegiatan, mata_anggaran, users, unit_kerja, jenis_kegiatan RESTART IDENTITY CASCADE`
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
    { nama_item: "Konsumsi", jumlah_rp: 500000, keterangan: "snack" },
    { nama_item: "ATK", jumlah_rp: 250000 },
  ],
};

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
        mata_anggaran: [{ nama_item: "X", jumlah_rp: -5 }],
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
});

// ============================================================
// REKAP
// ============================================================

describe("Rekap", () => {
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

// ============================================================
// SECURITY HEADERS & HELMET
// ============================================================

describe("Security", () => {
  it("response memiliki security headers (helmet)", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });
});
