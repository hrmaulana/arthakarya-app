// Auth Routes — Login, Me & Change Password
// (User management admin: lihat src/routes/users.ts — /api/users)
import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import pool from "../db.js";
import { authMiddleware, generateToken } from "../middleware/auth.js";
import { validate, loginSchema, changePasswordSchema } from "../validation.js";
import { registerFailure, clearFailures, isBlocked } from "../middleware/rateLimit.js";
import { logger } from "../logger.js";
import type { AuthPayload } from "../types.js";

const router = Router();

const BCRYPT_COST = 12;

// Hash dummy untuk menyeimbangkan waktu respons saat username tidak ditemukan
// (mencegah username enumeration via timing).
const DUMMY_HASH = bcrypt.hashSync("dummy-password-untuk-timing", BCRYPT_COST);

// POST /api/auth/login
router.post("/login", validate(loginSchema), async (req: Request, res: Response) => {
  const { username, password } = req.body;
  const key = `${req.ip}|${username.toLowerCase()}`;

  if (isBlocked(key)) {
    logger.warn("login_blocked", { key });
    res.status(429).json({
      error: "Terlalu banyak percobaan login gagal. Silakan coba lagi dalam 15 menit.",
    });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT u.id, u.unit_kerja_id, u.username, u.password_hash, u.role, uk.nama_unit
       FROM users u
       JOIN unit_kerja uk ON u.unit_kerja_id = uk.id
       WHERE u.username = $1`,
      [username]
    );

    const user = result.rows[0];

    // Bandingkan dengan dummy hash jika user tidak ditemukan agar timing seragam
    const valid = user
      ? await bcrypt.compare(password, user.password_hash)
      : await bcrypt.compare(password, DUMMY_HASH);

    if (!user || !valid) {
      registerFailure(key);
      res.status(401).json({ error: "Username atau password salah." });
      return;
    }

    clearFailures(key);

    const payload: AuthPayload = {
      userId: user.id,
      username: user.username,
      unit_kerja_id: user.unit_kerja_id,
      role: user.role,
    };

    const token = generateToken(payload);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        unit_kerja_id: user.unit_kerja_id,
        nama_unit: user.nama_unit,
        role: user.role,
      },
    });
  } catch (err: any) {
    logger.error("login_error", { message: err.message });
    res.status(500).json({ error: "Gagal login. Silakan coba lagi." });
  }
});

// GET /api/auth/me — current user info
router.get("/me", authMiddleware, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.unit_kerja_id, u.username, u.role, uk.nama_unit
       FROM users u
       JOIN unit_kerja uk ON u.unit_kerja_id = uk.id
       WHERE u.id = $1`,
      [req.user!.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "User tidak ditemukan." });
      return;
    }

    res.json({ user: result.rows[0] });
  } catch (err: any) {
    logger.error("auth_me_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data user." });
  }
});

// PUT /api/auth/change-password — user changes own password (must verify old password)
router.put(
  "/change-password",
  authMiddleware,
  validate(changePasswordSchema),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { old_password, new_password } = req.body;

      // Verify old password
      const result = await pool.query("SELECT password_hash FROM users WHERE id = $1", [user.userId]);

      if (result.rows.length === 0) {
        res.status(404).json({ error: "User tidak ditemukan." });
        return;
      }

      const valid = await bcrypt.compare(old_password, result.rows[0].password_hash);
      if (!valid) {
        res.status(401).json({ error: "Password lama salah." });
        return;
      }

      // Hash dan simpan password baru
      const hash = await bcrypt.hash(new_password, BCRYPT_COST);
      await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, user.userId]);

      res.json({ message: "Password berhasil diubah." });
    } catch (err: any) {
      logger.error("change_password_error", { message: err.message });
      res.status(500).json({ error: "Gagal mengubah password." });
    }
  }
);

export default router;
