// User Management Routes — admin only (daftar user & reset password)
import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import pool from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/authorize.js";
import { validate, resetPasswordSchema } from "../validation.js";
import { logger } from "../logger.js";

const router = Router();

const BCRYPT_COST = 12;

router.use(authMiddleware, requireRole("admin"));

// GET /api/users — list all users (admin only, for user management)
router.get("/", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.unit_kerja_id, u.username, u.role, u.created_at, uk.nama_unit
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
