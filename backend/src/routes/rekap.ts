// Rekap Routes — Aggregation (SUM at SQL level)
import { Router, Request, Response } from "express";
import multer from "multer";
import { authMiddleware } from "../middleware/auth.js";
import { getUnitKerjaFilter, requireRole } from "../middleware/authorize.js";
import { logger } from "../logger.js";
import {
  parseRpdTargetExcel,
  ImportError,
  RpdTargetRow,
} from "../rpd_target/importExcel.js";
import pool from "../db.js";

const router = Router();

router.use(authMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB — sama dengan import monitoring
});

// POST /api/rekap/rpd-target/import — admin; upload Excel target RPD bulanan
router.post(
  "/rpd-target/import",
  requireRole("admin"),
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "File Excel wajib diunggah (field 'file')." });
        return;
      }
      const filename = req.file.originalname || "upload.xlsx";
      if (!/\.xlsx$/i.test(filename)) {
        res.status(400).json({ error: "Format file harus .xlsx." });
        return;
      }

      const tahunRaw = typeof req.body?.tahun === "string" ? req.body.tahun.trim() : "";
      if (!/^\d{4}$/.test(tahunRaw)) {
        res.status(400).json({ error: "tahun wajib diisi dalam format YYYY." });
        return;
      }
      const tahun = Number(tahunRaw);
      if (tahun < 2000 || tahun > 2100) {
        res.status(400).json({ error: "tahun tidak masuk akal (harus 2000–2100)." });
        return;
      }
      const periode =
        typeof req.body?.periode === "string" && req.body.periode.trim()
          ? req.body.periode.trim().slice(0, 100)
          : null;

      const units = (
        await pool.query("SELECT id, kode_unit, nama_unit FROM unit_kerja")
      ).rows;

      let parsed: { rows: RpdTargetRow[] };
      try {
        parsed = parseRpdTargetExcel(req.file.buffer, units);
      } catch (err) {
        if (err instanceof ImportError) {
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const imp = await client.query(
          `INSERT INTO rpd_target_imports (filename, tahun, periode, uploaded_by, total_rows)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [filename, tahun, periode, req.user!.userId, parsed.rows.length]
        );
        const importId = imp.rows[0].id;
        for (const row of parsed.rows) {
          await client.query(
            `INSERT INTO rpd_target (import_id, unit_kerja_id, bulan, nilai)
             VALUES ($1, $2, $3, $4)`,
            [importId, row.unit_kerja_id, row.bulan, row.nilai]
          );
        }
        await client.query("COMMIT");

        logger.info("rpd_target_import", {
          import_id: importId,
          rows: parsed.rows.length,
          by: req.user!.userId,
        });

        res.json({
          message: `Import berhasil: ${parsed.rows.length} baris.`,
          data: { import_id: importId, total_rows: parsed.rows.length, tahun },
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err: any) {
      logger.error("rpd_target_import_error", { message: err.message });
      res.status(500).json({ error: "Gagal mengimpor file." });
    }
  }
);

// GET /api/rekap/per-unit-kerja
// Total anggaran per unit kerja (SUM of mata_anggaran.jumlah_rp)
router.get("/per-unit-kerja", async (req: Request, res: Response) => {
  try {
    const { unitKerjaId } = getUnitKerjaFilter(req);

    let query = `
      SELECT
        uk.id AS unit_kerja_id,
        uk.kode_unit,
        uk.nama_unit,
        COUNT(DISTINCT k.id)::INTEGER AS jumlah_kegiatan,
        COALESCE(SUM(ma.jumlah_rp), 0)::BIGINT AS total_anggaran
      FROM unit_kerja uk
      LEFT JOIN kegiatan k ON k.unit_kerja_id = uk.id
      LEFT JOIN mata_anggaran ma ON ma.kegiatan_id = k.id
      WHERE 1=1
    `;

    const params: any[] = [];
    if (unitKerjaId !== null) {
      query += ` AND uk.id = $1`;
      params.push(unitKerjaId);
    }

    query += ` GROUP BY uk.id, uk.kode_unit, uk.nama_unit
               ORDER BY total_anggaran DESC`;

    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  } catch (err: any) {
    logger.error("rekap_per_unit_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data rekap per unit kerja." });
  }
});

// GET /api/rekap/per-jenis-kegiatan
// Total anggaran per jenis kegiatan (SUM of mata_anggaran.jumlah_rp)
router.get("/per-jenis-kegiatan", async (req: Request, res: Response) => {
  try {
    const { unitKerjaId } = getUnitKerjaFilter(req);

    let query = `
      SELECT
        jk.id AS jenis_kegiatan_id,
        jk.nama_jenis,
        COUNT(DISTINCT k.id)::INTEGER AS jumlah_kegiatan,
        COALESCE(SUM(ma.jumlah_rp), 0)::BIGINT AS total_anggaran
      FROM jenis_kegiatan jk
      LEFT JOIN kegiatan k ON k.jenis_kegiatan_id = jk.id
      LEFT JOIN mata_anggaran ma ON ma.kegiatan_id = k.id
      WHERE 1=1
    `;

    const params: any[] = [];
    if (unitKerjaId !== null) {
      query += ` AND k.unit_kerja_id = $1`;
      params.push(unitKerjaId);
    }

    query += ` GROUP BY jk.id, jk.nama_jenis
               ORDER BY total_anggaran DESC`;

    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  } catch (err: any) {
    logger.error("rekap_per_jenis_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data rekap per jenis kegiatan." });
  }
});

// GET /api/rekap/rpd-bulanan
// Rencana Penarikan Dana — SUM anggaran per bulan (dari kegiatan.tanggal)
router.get("/rpd-bulanan", async (req: Request, res: Response) => {
  try {
    const { unitKerjaId } = getUnitKerjaFilter(req);
    const { tahun } = req.query;

    const currentYear = tahun ? Number(tahun) : new Date().getFullYear();

    let query = `
      SELECT
        EXTRACT(YEAR FROM k.tanggal)::INTEGER AS tahun,
        EXTRACT(MONTH FROM k.tanggal)::INTEGER AS bulan,
        COUNT(DISTINCT k.id)::INTEGER AS jumlah_kegiatan,
        COALESCE(SUM(ma.jumlah_rp), 0)::BIGINT AS total_anggaran
      FROM kegiatan k
      JOIN mata_anggaran ma ON ma.kegiatan_id = k.id
      WHERE EXTRACT(YEAR FROM k.tanggal) = $1
    `;

    const params: any[] = [currentYear];

    let paramIdx = 2;
    if (unitKerjaId !== null) {
      query += ` AND k.unit_kerja_id = $${paramIdx++}`;
      params.push(unitKerjaId);
    }

    query += ` GROUP BY tahun, bulan ORDER BY tahun, bulan`;

    const result = await pool.query(query, params);

    // Fill all 12 months (even empty ones)
    const namaBulan = [
      "Januari", "Februari", "Maret", "April", "Mei", "Juni",
      "Juli", "Agustus", "September", "Oktober", "November", "Desember",
    ];

    const dataMap: Record<number, any> = {};
    for (const row of result.rows) {
      dataMap[row.bulan] = row;
    }

    const data = namaBulan.map((nama, i) => {
      const bulan = i + 1;
      return dataMap[bulan]
        ? { ...dataMap[bulan], nama_bulan: nama }
        : { tahun: currentYear, bulan, nama_bulan: nama, jumlah_kegiatan: 0, total_anggaran: 0 };
    });

    res.json({ data, tahun: currentYear });
  } catch (err: any) {
    logger.error("rekap_rpd_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data RPD bulanan." });
  }
});

// GET /api/rekap/timeline
// Kegiatan with date + total for Gantt chart (sorted by date)
router.get("/timeline", async (req: Request, res: Response) => {
  try {
    const { unitKerjaId } = getUnitKerjaFilter(req);

    let query = `
      SELECT
        k.id, k.nama_kegiatan, k.tanggal, k.status,
        uk.nama_unit AS unit_kerja_nama,
        jk.nama_jenis AS jenis_kegiatan_nama,
        COALESCE(SUM(ma.jumlah_rp), 0)::BIGINT AS total_anggaran
      FROM kegiatan k
      JOIN unit_kerja uk ON k.unit_kerja_id = uk.id
      JOIN jenis_kegiatan jk ON k.jenis_kegiatan_id = jk.id
      LEFT JOIN mata_anggaran ma ON ma.kegiatan_id = k.id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIdx = 1;

    if (unitKerjaId !== null) {
      query += ` AND k.unit_kerja_id = $${paramIdx++}`;
      params.push(unitKerjaId);
    }

    query += ` GROUP BY k.id, uk.nama_unit, jk.nama_jenis
               ORDER BY k.tanggal ASC, k.nama_kegiatan ASC`;

    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  } catch (err: any) {
    logger.error("rekap_timeline_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data timeline." });
  }
});

// GET /api/rekap/summary — total keseluruhan
router.get("/summary", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM unit_kerja) AS total_unit_kerja,
        (SELECT COUNT(*) FROM kegiatan) AS total_kegiatan,
        (SELECT COALESCE(SUM(jumlah_rp), 0)::BIGINT FROM mata_anggaran) AS total_anggaran
    `);
    res.json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error("rekap_summary_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil ringkasan." });
  }
});

export default router;
