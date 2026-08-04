// Reference Routes — Unit Kerja & Jenis Kegiatan
import { Router, Request, Response } from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { logger } from "../logger.js";

const router = Router();

// All reference routes require authentication
router.use(authMiddleware);

// GET /api/reference/unit-kerja
router.get("/unit-kerja", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT id, kode_unit, nama_unit FROM unit_kerja ORDER BY kode_unit"
    );
    res.json({ data: result.rows });
  } catch (err: any) {
    logger.error("ref_unit_kerja_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data unit kerja." });
  }
});

// GET /api/reference/jenis-kegiatan
router.get("/jenis-kegiatan", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT id, nama_jenis FROM jenis_kegiatan ORDER BY nama_jenis"
    );
    res.json({ data: result.rows });
  } catch (err: any) {
    logger.error("ref_jenis_kegiatan_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data jenis kegiatan." });
  }
});

export default router;
