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

// GET /api/monitoring/public-summary — TANPA auth (untuk halaman login).
// Hanya total agregat untuk jenis akrual — tanpa rincian
router.get("/public-summary", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(ma.pagu_revisi), 0)::BIGINT AS pagu,
         COALESCE(SUM(ma.realisasi_sd_periode), 0)::BIGINT AS realisasi
       FROM monitoring_anggaran ma
       JOIN monitoring_imports mi ON mi.id = ma.import_id
       WHERE mi.jenis = 'akrual'
         AND ma.import_id = (SELECT MAX(id) FROM monitoring_imports WHERE jenis = 'akrual')`
    );
    const row = result.rows[0];
    if (row.pagu === 0 && row.realisasi === 0) {
      res.json({ data: null });
      return;
    }
    res.json({
      data: {
        pagu: row.pagu,
        realisasi: row.realisasi,
        sisa: Number(row.pagu) - Number(row.realisasi),
        persentase:
          Number(row.pagu) > 0
            ? Math.round((Number(row.realisasi) / Number(row.pagu)) * 10000) / 100
            : 0,
      },
    });
  } catch (err: any) {
    logger.error("monitoring_public_summary_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil ringkasan." });
  }
});

router.use(authMiddleware);

// GET /api/monitoring/latest — metadata import terbaru (null jika belum ada)
// Query param: ?jenis=akrual (default)
router.get("/latest", async (req: Request, res: Response) => {
  try {
    const jenisRaw = typeof req.query.jenis === "string" ? req.query.jenis.trim().toLowerCase() : "";
    const jenis = ["akrual", "spp", "sp2d"].includes(jenisRaw) ? jenisRaw : "akrual";
    const result = await pool.query(
      `SELECT mi.id, mi.filename, mi.periode, mi.total_rows, mi.uploaded_at,
              u.username AS uploaded_by
       FROM monitoring_imports mi
       JOIN users u ON u.id = mi.uploaded_by
       WHERE mi.jenis = $1
       ORDER BY mi.id DESC LIMIT 1`,
      [jenis]
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

    const jenisRaw = typeof req.body?.jenis === "string" ? req.body.jenis.trim().toLowerCase() : "";
    const jenis = ["akrual", "spp", "sp2d"].includes(jenisRaw) ? jenisRaw : "akrual";

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
        `INSERT INTO monitoring_imports (filename, periode, jenis, uploaded_by, total_rows)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [filename, periode, jenis, req.user!.userId, rows.length]
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
// Query param: ?jenis=akrual (default)
router.get("/summary", async (req: Request, res: Response) => {
  try {
    const { unitKerjaId } = getUnitKerjaFilter(req);
    const jenisRaw = typeof req.query.jenis === "string" ? req.query.jenis.trim().toLowerCase() : "";
    const jenis = ["akrual", "spp", "sp2d"].includes(jenisRaw) ? jenisRaw : "akrual";

    const params: any[] = [jenis];
    const scopeSql = `WHERE import_id = (SELECT MAX(id) FROM monitoring_imports WHERE jenis = $1)`;
    let unitScope = "";
    let paramIdx = 1;
    if (unitKerjaId !== null) {
      paramIdx++;
      params.push(unitKerjaId);
      unitScope = ` AND unit_kerja_id = $${paramIdx}`;
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
// Query param: ?unit_kerja_id= (admin), ?q= (cari), ?jenis=akrual (default)
router.get("/detail", async (req: Request, res: Response) => {
  try {
    const { unitKerjaId } = getUnitKerjaFilter(req);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const jenisRaw = typeof req.query.jenis === "string" ? req.query.jenis.trim().toLowerCase() : "";
    const jenis = ["akrual", "spp", "sp2d"].includes(jenisRaw) ? jenisRaw : "akrual";

    const params: any[] = [jenis];
    let conditions = `import_id = (SELECT MAX(id) FROM monitoring_imports WHERE jenis = $1)`;
    let paramIdx = 2;
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

// GET /api/monitoring/per-jenis-akun — ringkasan per kelompok akun (3 digit)
// Query param: ?jenis=akrual (default)
router.get("/per-jenis-akun", async (req: Request, res: Response) => {
  try {
    const { unitKerjaId } = getUnitKerjaFilter(req);
    const jenisRaw = typeof req.query.jenis === "string" ? req.query.jenis.trim().toLowerCase() : "";
    const jenis = ["akrual", "spp", "sp2d"].includes(jenisRaw) ? jenisRaw : "akrual";

    let sql = `
      SELECT LEFT(ma.kode_akun::text, 3) AS kelompok,
             COUNT(*)::int AS count,
             SUM(ma.pagu_revisi)::BIGINT AS total_pagu,
             SUM(ma.realisasi_sd_periode)::BIGINT AS total_realisasi,
             ROUND(CASE WHEN SUM(ma.pagu_revisi) > 0
               THEN SUM(ma.realisasi_sd_periode)::NUMERIC / SUM(ma.pagu_revisi) * 100
               ELSE 0 END, 1) AS persentase
      FROM monitoring_anggaran ma
      JOIN monitoring_imports mi ON mi.id = ma.import_id
      WHERE mi.jenis = $1
        AND ma.import_id = (SELECT MAX(id) FROM monitoring_imports WHERE jenis = $1)
    `;
    const params: unknown[] = [jenis];
    let paramIdx = 2;

    if (unitKerjaId !== null) {
      sql += ` AND ma.unit_kerja_id = $${paramIdx++}`;
      params.push(unitKerjaId);
    }

    sql += ` GROUP BY LEFT(ma.kode_akun::text, 3) ORDER BY kelompok`;

    const result = await pool.query(sql, params);
    res.json({ data: result.rows });
  } catch (err: any) {
    logger.error("monitoring_per_jenis_akun_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data per jenis akun." });
  }
});

export default router;

// GET /api/monitoring/data-manual — data input manual (SPP & kegiatan belum berkas)
// Query param: ?jenis=akrual (default)
router.get("/data-manual", async (req: Request, res: Response) => {
  try {
    const jenisRaw = typeof req.query.jenis === "string" ? req.query.jenis.trim().toLowerCase() : "";
    const jenis = ["akrual", "spp", "sp2d"].includes(jenisRaw) ? jenisRaw : "akrual";
    const result = await pool.query(
      `SELECT mim.id, mim.spp_persen, mim.kegiatan_belum_berkaskan,
              mim.updated_by, mim.updated_at
       FROM monitoring_input_manual mim
       WHERE mim.import_id = (SELECT MAX(id) FROM monitoring_imports WHERE jenis = $1)
       LIMIT 1`,
      [jenis]
    );
    res.json({ data: result.rows[0] ?? null });
  } catch (err: any) {
    logger.error("monitoring_data_manual_get_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data manual." });
  }
});

// PUT /api/monitoring/data-manual — admin update data input manual
// Query param: ?jenis=akrual (default)
router.put("/data-manual", requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const sppPersen = Number(req.body.spp_persen);
    const kegiatanBelum = Number(req.body.kegiatan_belum_berkaskan);
    const jenisRaw = typeof req.query.jenis === "string" ? req.query.jenis.trim().toLowerCase() : "";
    const jenis = ["akrual", "spp", "sp2d"].includes(jenisRaw) ? jenisRaw : "akrual";

    if (isNaN(sppPersen) || sppPersen < 0 || sppPersen > 100) {
      res.status(400).json({ error: "spp_persen harus angka 0–100." });
      return;
    }
    if (isNaN(kegiatanBelum) || kegiatanBelum < 0 || !Number.isInteger(kegiatanBelum)) {
      res.status(400).json({ error: "kegiatan_belum_berkaskan harus bilangan bulat >= 0." });
      return;
    }

    // Cari import_id terbaru untuk jenis ini
    const impResult = await pool.query(
      `SELECT MAX(id) AS import_id FROM monitoring_imports WHERE jenis = $1`,
      [jenis]
    );
    const importId = impResult.rows[0]?.import_id;
    if (!importId) {
      res.status(400).json({ error: "Belum ada data import monitoring. Upload Excel terlebih dahulu." });
      return;
    }

    const existing = await pool.query(
      `SELECT id FROM monitoring_input_manual WHERE import_id = $1`, [importId]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE monitoring_input_manual
         SET spp_persen = $1, kegiatan_belum_berkaskan = $2, updated_by = $3, updated_at = NOW()
         WHERE import_id = $4`,
        [sppPersen, kegiatanBelum, req.user!.userId, importId]
      );
    } else {
      await pool.query(
        `INSERT INTO monitoring_input_manual (import_id, spp_persen, kegiatan_belum_berkaskan, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [importId, sppPersen, kegiatanBelum, req.user!.userId, req.user!.userId]
      );
    }

    logger.info("monitoring_data_manual_update", {
      import_id: importId,
      spp_persen: sppPersen,
      kegiatan_belum_berkaskan: kegiatanBelum,
      by: req.user!.userId,
    });

    res.json({
      message: "Data manual berhasil disimpan.",
      data: { import_id: importId, spp_persen: sppPersen, kegiatan_belum_berkaskan: kegiatanBelum },
    });
  } catch (err: any) {
    logger.error("monitoring_data_manual_put_error", { message: err.message });
    res.status(500).json({ error: "Gagal menyimpan data manual." });
  }
});
