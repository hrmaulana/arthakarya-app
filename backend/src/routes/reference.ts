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

// GET /api/reference/akun — daftar kode akun dengan sisa pagu per unit kerja
router.get("/akun", async (req: Request, res: Response) => {
  try {
    const unitKerjaId = req.query.unit_kerja_id as string | undefined;
    if (!unitKerjaId) {
      res.status(400).json({ error: "Parameter unit_kerja_id wajib diisi." });
      return;
    }
    const excludeKegiatanId = req.query.exclude_kegiatan_id as string | undefined;

    const unitKerjaNum = Number(unitKerjaId);
    if (isNaN(unitKerjaNum)) {
      res.status(400).json({ error: "Parameter unit_kerja_id harus berupa angka." });
      return;
    }
    const excludeNum = excludeKegiatanId ? Number(excludeKegiatanId) : undefined;
    if (excludeKegiatanId !== undefined && (isNaN(excludeNum!) || excludeNum! <= 0)) {
      res.status(400).json({ error: "Parameter exclude_kegiatan_id harus berupa angka positif." });
      return;
    }

    const query = `
      SELECT
        ma.kode_akun,
        ma.nama_akun,
        ma.pagu_revisi,
        ma.realisasi_sd_periode,
        COALESCE(SUM(ma2.jumlah_rp), 0)::BIGINT AS dipakai_kegiatan,
        (ma.pagu_revisi - ma.realisasi_sd_periode - COALESCE(SUM(ma2.jumlah_rp), 0))::BIGINT AS sisa_pagu
      FROM monitoring_anggaran ma
      LEFT JOIN mata_anggaran ma2
        ON ma2.kode_akun = ma.kode_akun
       AND ma2.kegiatan_id IN (
           SELECT id FROM kegiatan
           WHERE unit_kerja_id = $1
           AND status IN ('draft', 'diajukan', 'disetujui')
           ${excludeNum ? "AND id <> $2" : ""}
         )
      WHERE ma.import_id = (SELECT MAX(id) FROM monitoring_imports)
        AND ma.unit_kerja_id = $1
      GROUP BY ma.kode_akun, ma.nama_akun, ma.pagu_revisi, ma.realisasi_sd_periode
      ORDER BY sisa_pagu DESC
    `;

    const params = excludeNum ? [unitKerjaNum, excludeNum] : [unitKerjaNum];
    const result = await pool.query(query, params);

    res.json({ data: result.rows });
  } catch (err: any) {
    logger.error("ref_akun_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data kode akun." });
  }
});

export default router;
