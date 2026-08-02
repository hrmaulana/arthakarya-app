// Auth Routes — Login & Me
import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import pool from "../db.js";
import { authMiddleware, generateToken } from "../middleware/auth.js";
import { requireRole } from "../middleware/authorize.js";
import type { AuthPayload } from "../types.js";

const router = Router();

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: "Username dan password wajib diisi." });
      return;
    }

    const result = await pool.query(
      `SELECT u.id, u.unit_kerja_id, u.username, u.password_hash, u.role, uk.nama_unit
       FROM users u
       JOIN unit_kerja uk ON u.unit_kerja_id = uk.id
       WHERE u.username = $1`,
      [username]
    );

    const user = result.rows[0];

    if (!user) {
      res.status(401).json({ error: "Username atau password salah." });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Username atau password salah." });
      return;
    }

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
    console.error("[Auth] Login error:", err.message);
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
    console.error("[Auth] Me error:", err.message);
    res.status(500).json({ error: "Gagal mengambil data user." });
  }
});

// PUT /api/auth/change-password — user changes own password (must verify old password)
router.put("/change-password", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { old_password, new_password } = req.body;

    if (!old_password || !new_password) {
      res.status(400).json({ error: "Password lama dan password baru wajib diisi." });
      return;
    }

    if (new_password.length < 6) {
      res.status(400).json({ error: "Password baru minimal 6 karakter." });
      return;
    }

    if (old_password === new_password) {
      res.status(400).json({ error: "Password baru tidak boleh sama dengan password lama." });
      return;
    }

    // Verify old password
    const result = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [user.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "User tidak ditemukan." });
      return;
    }

    const valid = await bcrypt.compare(old_password, result.rows[0].password_hash);
    if (!valid) {
      res.status(401).json({ error: "Password lama salah." });
      return;
    }

    // Hash and save new password
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [hash, user.userId]
    );

    res.json({ message: "Password berhasil diubah." });
  } catch (err: any) {
    console.error("[Auth] Change password error:", err.message);
    res.status(500).json({ error: "Gagal mengubah password." });
  }
});

// POST /api/users/:id/reset-password — admin manually resets a user's password

// GET /api/users — list all users (admin only, for user management)
router.get("/users", authMiddleware, requireRole("admin"), async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.unit_kerja_id, u.username, u.role, u.created_at, uk.nama_unit
       FROM users u
       JOIN unit_kerja uk ON u.unit_kerja_id = uk.id
       ORDER BY u.role, u.username`
    );
    res.json({ data: result.rows });
  } catch (err: any) {
    console.error("[Auth] List users error:", err.message);
    res.status(500).json({ error: "Gagal mengambil data user." });
  }
});

router.post("/users/:id/reset-password", authMiddleware, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;

    if (!new_password || new_password.length < 6) {
      res.status(400).json({ error: "Password baru minimal 6 karakter." });
      return;
    }

    // Check user exists
    const userResult = await pool.query(
      "SELECT id, username FROM users WHERE id = $1",
      [id]
    );

    if (userResult.rows.length === 0) {
      res.status(404).json({ error: "User tidak ditemukan." });
      return;
    }

    const hash = await bcrypt.hash(new_password, 10);
    await pool.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [hash, id]
    );

    res.json({
      message: `Password untuk "${userResult.rows[0].username}" berhasil direset.`,
      username: userResult.rows[0].username,
    });
  } catch (err: any) {
    console.error("[Auth] Reset password error:", err.message);
    res.status(500).json({ error: "Gagal mereset password." });
  }
});

export default router;
