// Monitoring Anggaran Routes — import Excel SAKTI + ringkasan penyerapan
import { Router, Request, Response } from "express";
import multer from "multer";
import pool from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole, getUnitKerjaFilter } from "../middleware/authorize.js";
import { parseAnggaranExcel, ImportError, MonitoringRow } from "../monitoring/importExcel.js";
import { logger } from "../logger.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB — file aktual ±111 KB
});

router.use(authMiddleware);

// GET /api/monitoring/latest — metadata import terbaru (null jika belum ada)
router.get("/latest", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT mi.id, mi.filename, mi.periode, mi.total_rows, mi.uploaded_at,
              u.username AS uploaded_by
       FROM monitoring_imports mi
       JOIN users u ON u.id = mi.uploaded_by
       ORDER BY mi.id DESC LIMIT 1`
    );
    res.json({ data: result.rows[0] ?? null });
  } catch (err: any) {
    logger.error("monitoring_latest_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil informasi import terbaru." });
  }
});

// POST /api/monitoring/import — admin only; upload .xlsx → snapshot baru
router.post("/import", requireRole("admin"), upload.single("file"), async (req: Request, res: Response) => {
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
    const periode =
      typeof req.body?.periode === "string" && req.body.periode.trim()
        ? req.body.periode.trim().slice(0, 100)
        : null;

    const units = (await pool.query("SELECT id, nama_unit FROM unit_kerja")).rows;

    let rows: MonitoringRow[];
    try {
      rows = parseAnggaranExcel(req.file.buffer, units).rows;
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
        `INSERT INTO monitoring_imports (filename, periode, uploaded_by, total_rows)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [filename, periode, req.user!.userId, rows.length]
      );
      const importId = imp.rows[0].id;

      for (const row of rows) {
        await client.query(
          `INSERT INTO monitoring_anggaran
           (import_id, unit_kerja_id, kode_program, nama_program, kode_kegiatan, nama_kegiatan,
            kode_output, nama_output, kode_suboutput, nama_suboutput,
            kode_komponen, nama_komponen, kode_subkomponen, nama_subkomponen,
            kode_akun, nama_akun, pagu_revisi, realisasi_periode_lalu,
            realisasi_periode_ini, realisasi_sd_periode)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [importId, row.unit_kerja_id, row.kode_program, row.nama_program, row.kode_kegiatan,
           row.nama_kegiatan, row.kode_output, row.nama_output, row.kode_suboutput, row.nama_suboutput,
           row.kode_komponen, row.nama_komponen, row.kode_subkomponen, row.nama_subkomponen,
           row.kode_akun, row.nama_akun, row.pagu_revisi, row.realisasi_periode_lalu,
           row.realisasi_periode_ini, row.realisasi_sd_periode]
        );
      }

      await client.query("COMMIT");

      const sums = await pool.query(
        `SELECT COALESCE(SUM(pagu_revisi), 0)::BIGINT AS pagu,
                COALESCE(SUM(realisasi_sd_periode), 0)::BIGINT AS realisasi
         FROM monitoring_anggaran WHERE import_id = $1`,
        [importId]
      );

      logger.info("monitoring_import", { import_id: importId, rows: rows.length, by: req.user!.userId });

      res.status(201).json({
        message: `Import berhasil: ${rows.length} baris.`,
        data: { import_id: importId, total_rows: rows.length, ...sums.rows[0] },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    logger.error("monitoring_import_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengimpor file." });
  }
});

// GET /api/monitoring/summary — total + per unit + per akun dari import terbaru
router.get("/summary", async (req: Request, res: Response) => {
  try {
    const { unitKerjaId } = getUnitKerjaFilter(req);

    const scopeSql = `WHERE import_id = (SELECT MAX(id) FROM monitoring_imports)`;
    const params: any[] = [];
    let unitScope = "";
    if (unitKerjaId !== null) {
      params.push(unitKerjaId);
      unitScope = ` AND unit_kerja_id = $1`;
    }

    const totalResult = await pool.query(
      `SELECT
         COALESCE(SUM(pagu_revisi), 0)::BIGINT AS pagu,
         COALESCE(SUM(realisasi_sd_periode), 0)::BIGINT AS realisasi
       FROM monitoring_anggaran
       ${scopeSql}${unitScope}`,
      params
    );
    const total = totalResult.rows[0];

    const perUnitResult = await pool.query(
      `SELECT uk.id AS unit_kerja_id, uk.kode_unit, uk.nama_unit,
         COALESCE(SUM(ma.pagu_revisi), 0)::BIGINT AS pagu,
         COALESCE(SUM(ma.realisasi_sd_periode), 0)::BIGINT AS realisasi
       FROM monitoring_anggaran ma
       JOIN unit_kerja uk ON uk.id = ma.unit_kerja_id
       ${scopeSql}${unitScope}
       GROUP BY uk.id, uk.kode_unit, uk.nama_unit
       ORDER BY uk.kode_unit`,
      params
    );

    const perAkunResult = await pool.query(
      `SELECT nama_akun,
         COALESCE(SUM(pagu_revisi), 0)::BIGINT AS pagu,
         COALESCE(SUM(realisasi_sd_periode), 0)::BIGINT AS realisasi
       FROM monitoring_anggaran
       ${scopeSql}${unitScope}
       GROUP BY nama_akun
       ORDER BY pagu DESC`,
      params
    );

    const decorate = (r: any) => ({
      ...r,
      sisa: Number(r.pagu) - Number(r.realisasi),
      persentase:
        Number(r.pagu) > 0 ? Math.round((Number(r.realisasi) / Number(r.pagu)) * 10000) / 100 : 0,
    });

    res.json({
      data: {
        total: decorate(total),
        per_unit: perUnitResult.rows.map(decorate),
        per_akun: perAkunResult.rows.map(decorate),
      },
    });
  } catch (err: any) {
    logger.error("monitoring_summary_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil ringkasan monitoring." });
  }
});

// GET /api/monitoring/detail — baris detail hierarki + angka (import terbaru)
// Query param: ?unit_kerja_id= (admin), ?q= (cari nama kegiatan/akun/kode akun)
router.get("/detail", async (req: Request, res: Response) => {
  try {
    const { unitKerjaId } = getUnitKerjaFilter(req);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const params: any[] = [];
    let conditions = `import_id = (SELECT MAX(id) FROM monitoring_imports)`;
    let paramIdx = 1;
    if (unitKerjaId !== null) {
      params.push(unitKerjaId);
      conditions += ` AND ma.unit_kerja_id = $${paramIdx++}`;
    }
    if (q) {
      params.push(`%${q}%`);
      conditions += ` AND (ma.nama_kegiatan ILIKE $${paramIdx} OR ma.nama_akun ILIKE $${paramIdx} OR ma.kode_akun ILIKE $${paramIdx})`;
    }

    const result = await pool.query(
      `SELECT ma.id, uk.kode_unit, uk.nama_unit,
         ma.kode_program, ma.nama_program, ma.kode_kegiatan, ma.nama_kegiatan,
         ma.kode_output, ma.nama_output, ma.kode_suboutput, ma.nama_suboutput,
         ma.kode_komponen, ma.nama_komponen, ma.kode_subkomponen, ma.nama_subkomponen,
         ma.kode_akun, ma.nama_akun,
         ma.pagu_revisi, ma.realisasi_periode_lalu, ma.realisasi_periode_ini,
         ma.realisasi_sd_periode,
         (ma.pagu_revisi - ma.realisasi_sd_periode)::BIGINT AS sisa,
         CASE WHEN ma.pagu_revisi > 0
              THEN ROUND(ma.realisasi_sd_periode * 100.0 / ma.pagu_revisi, 2)
              ELSE 0 END AS persentase
       FROM monitoring_anggaran ma
       JOIN unit_kerja uk ON uk.id = ma.unit_kerja_id
       WHERE ${conditions}
       ORDER BY uk.kode_unit, ma.kode_kegiatan, ma.kode_akun`,
      params
    );

    res.json({ data: result.rows });
  } catch (err: any) {
    logger.error("monitoring_detail_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil detail monitoring." });
  }
});

export default router;
