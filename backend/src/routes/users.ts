// User Management Routes — admin only (daftar user & reset password)
import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import pool from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/authorize.js";
import { validate, resetPasswordSchema, userCreateSchema, userStatusSchema } from "../validation.js";
import { logger } from "../logger.js";
import type { AuthPayload } from "../types.js";

const router = Router();

const BCRYPT_COST = Number(process.env.BCRYPT_COST || 12);

router.use(authMiddleware, requireRole("admin"));

// GET /api/users — list all users (admin only, for user management)
router.get("/", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.unit_kerja_id, u.username, u.role, u.is_active, u.created_at, uk.nama_unit
       FROM users u
       JOIN unit_kerja uk ON u.unit_kerja_id = uk.id
       ORDER BY u.role, u.username`
    );
    res.json({ data: result.rows });
  } catch (err: any) {
    logger.error("list_users_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data user." });
  }
});

// POST /api/users — admin creates a new user
router.post(
  "/",
  validate(userCreateSchema),
  async (req: Request, res: Response) => {
    try {
      const { username, password, role, unit_kerja_id } = req.body;

      // Unit kerja harus benar-benar ada (pesan jelas, bukan error FK)
      const unitResult = await pool.query(
        "SELECT id FROM unit_kerja WHERE id = $1",
        [unit_kerja_id]
      );
      if (unitResult.rows.length === 0) {
        res.status(400).json({ error: "Unit kerja tidak ditemukan." });
        return;
      }

      // Username unik
      const existing = await pool.query(
        "SELECT id FROM users WHERE username = $1",
        [username]
      );
      if (existing.rows.length > 0) {
        res.status(409).json({ error: "Username sudah digunakan." });
        return;
      }

      const hash = await bcrypt.hash(password, BCRYPT_COST);
      const result = await pool.query(
        `INSERT INTO users (unit_kerja_id, username, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, role, unit_kerja_id`,
        [unit_kerja_id, username, hash, role]
      );

      const created = result.rows[0];
      const unitName = await pool.query(
        "SELECT nama_unit FROM unit_kerja WHERE id = $1",
        [created.unit_kerja_id]
      );
      logger.info("user_created", { id: created.id, username: created.username, role: created.role });

      res.status(201).json({
        message: `User "${created.username}" berhasil dibuat.`,
        data: {
          id: created.id,
          username: created.username,
          role: created.role,
          nama_unit: unitName.rows[0]?.nama_unit ?? null,
        },
      });
    } catch (err: any) {
      logger.error("create_user_error", { message: err.message });
      res.status(500).json({ error: "Gagal membuat user." });
    }
  }
);

// PATCH /api/users/:id/status — admin menonaktifkan/mengaktifkan user (soft delete)
router.patch(
  "/:id/status",
  validate(userStatusSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { is_active } = req.body;

      const userId = Number(id);
      if (!Number.isInteger(userId) || userId <= 0) {
        res.status(400).json({ error: "ID user tidak valid." });
        return;
      }

      const userResult = await pool.query(
        "SELECT id, username, role, is_active FROM users WHERE id = $1",
        [userId]
      );
      if (userResult.rows.length === 0) {
        res.status(404).json({ error: "User tidak ditemukan." });
        return;
      }
      const target = userResult.rows[0];

      // Tidak bisa menonaktifkan akun sendiri
      if (!is_active && target.id === req.user!.userId) {
        res.status(400).json({ error: "Tidak bisa menonaktifkan akun sendiri." });
        return;
      }

      // Tidak bisa menonaktifkan admin terakhir yang masih aktif —
      // token admin yang dinonaktifkan masih berlaku s.d. 8 jam,
      // jadi admin lain bisa "membalas" via token lamanya.
      if (!is_active && target.role === "admin" && target.is_active) {
        const admins = await pool.query(
          "SELECT COUNT(*)::int AS total FROM users WHERE role = 'admin' AND is_active = TRUE"
        );
        if (admins.rows[0].total <= 1) {
          res.status(400).json({ error: "Admin terakhir tidak bisa dinonaktifkan." });
          return;
        }
      }

      await pool.query("UPDATE users SET is_active = $1 WHERE id = $2", [is_active, userId]);

      const action = is_active ? "diaktifkan" : "dinonaktifkan";
      logger.info("user_status_changed", { id: userId, is_active, by: req.user!.userId });

      res.json({ message: `User "${target.username}" berhasil ${action}.` });
    } catch (err: any) {
      logger.error("user_status_error", { message: err.message });
      res.status(500).json({ error: "Gagal mengubah status user." });
    }
  }
);

// POST /api/users/:id/reset-password — admin resets a user's password
router.post(
  "/:id/reset-password",
  validate(resetPasswordSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { new_password } = req.body;

      const userId = Number(id);
      if (!Number.isInteger(userId) || userId <= 0) {
        res.status(400).json({ error: "ID user tidak valid." });
        return;
      }

      // Check user exists
      const userResult = await pool.query("SELECT id, username FROM users WHERE id = $1", [userId]);

      if (userResult.rows.length === 0) {
        res.status(404).json({ error: "User tidak ditemukan." });
        return;
      }

      const hash = await bcrypt.hash(new_password, BCRYPT_COST);
      await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, userId]);

      res.json({
        message: `Password untuk "${userResult.rows[0].username}" berhasil direset.`,
        username: userResult.rows[0].username,
      });
    } catch (err: any) {
      logger.error("reset_password_error", { message: err.message });
      res.status(500).json({ error: "Gagal mereset password." });
    }
  }
);

export default router;
