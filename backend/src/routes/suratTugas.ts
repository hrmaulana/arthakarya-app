// Surat Tugas Routes — upload Surat Tugas & Undangan sebelum SPPD
import { Router, Request, Response } from "express";
import multer from "multer";
import { mkdir, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import pool from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { logger } from "../logger.js";

const router = Router();
router.use(authMiddleware);

// ============================================================
// FILE UPLOAD SETUP
// ============================================================

const UPLOAD_DIR = process.env.SPPD_UPLOAD_DIR || "/var/arthakarya/uploads/surat_tugas";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Ensure upload dir exists
mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    mkdir(UPLOAD_DIR, { recursive: true })
      .then(() => cb(null, UPLOAD_DIR))
      .catch((err) => cb(err, UPLOAD_DIR));
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Hanya file PDF yang diizinkan."));
    }
  },
});

function isAdmin(req: Request): boolean {
  return req.user?.role === "admin";
}

// ============================================================
// GET /api/surat-tugas — list all
// ============================================================

router.get("/", async (req: Request, res: Response) => {
  try {
    let query = `
      SELECT st.*, u.username AS created_by_username,
             (SELECT COUNT(*) FROM sppd_kegiatan sk WHERE sk.surat_tugas_id = st.id) AS jumlah_sppd
      FROM surat_tugas st
      JOIN users u ON st.created_by = u.id
      ORDER BY st.created_at DESC
    `;
    const result = await pool.query(query);
    res.json({ data: result.rows });
  } catch (err: any) {
    logger.error("surat_tugas_list_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data Surat Tugas." });
  }
});

// ============================================================
// GET /api/surat-tugas/:id — detail + linked SPPDs
// ============================================================

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT st.*, u.username AS created_by_username
       FROM surat_tugas st
       JOIN users u ON st.created_by = u.id
       WHERE st.id = $1`,
      [req.params.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Surat Tugas tidak ditemukan." });
    }

    // Linked SPPDs
    const sppdResult = await pool.query(
      `SELECT id, nama_kegiatan, status, tanggal_berangkat, tanggal_pulang, created_at
       FROM sppd_kegiatan WHERE surat_tugas_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );

    res.json({
      data: {
        ...result.rows[0],
        sppd_list: sppdResult.rows,
      },
    });
  } catch (err: any) {
    logger.error("surat_tugas_detail_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil detail Surat Tugas." });
  }
});

// ============================================================
// POST /api/surat-tugas — create with file uploads
// ============================================================

router.post(
  "/",
  upload.fields([
    { name: "file_surat", maxCount: 1 },
    { name: "file_undangan", maxCount: 1 },
  ]),
  async (req: Request, res: Response) => {
    try {
      const { nomor_surat, tanggal_surat, perihal } = req.body;

      if (!nomor_surat || !tanggal_surat || !perihal) {
        return res.status(400).json({ error: "Nomor, tanggal, dan perihal wajib diisi." });
      }

      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const file_surat_path = files?.file_surat?.[0]?.path || null;
      const file_undangan_path = files?.file_undangan?.[0]?.path || null;

      const result = await pool.query(
        `INSERT INTO surat_tugas (nomor_surat, tanggal_surat, perihal, file_surat_path, file_undangan_path, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [nomor_surat, tanggal_surat, perihal, file_surat_path, file_undangan_path, req.user!.userId]
      );

      logger.info("surat_tugas_created", { id: result.rows[0].id, by: req.user!.username });
      res.status(201).json({ data: result.rows[0] });
    } catch (err: any) {
      logger.error("surat_tugas_create_error", { message: err.message });
      res.status(500).json({ error: "Gagal menyimpan Surat Tugas." });
    }
  }
);

// ============================================================
// PUT /api/surat-tugas/:id — update (termasuk replace file)
// ============================================================

router.put(
  "/:id",
  upload.fields([
    { name: "file_surat", maxCount: 1 },
    { name: "file_undangan", maxCount: 1 },
  ]),
  async (req: Request, res: Response) => {
    try {
      const existing = await pool.query("SELECT * FROM surat_tugas WHERE id = $1", [req.params.id]);
      if (!existing.rows[0]) {
        return res.status(404).json({ error: "Surat Tugas tidak ditemukan." });
      }

      const { nomor_surat, tanggal_surat, perihal } = req.body;
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

      // Replace file if new uploaded, else keep old
      let file_surat_path = existing.rows[0].file_surat_path;
      let file_undangan_path = existing.rows[0].file_undangan_path;

      if (files?.file_surat?.[0]) {
        // Hapus file lama
        if (file_surat_path) await unlink(file_surat_path).catch(() => {});
        file_surat_path = files.file_surat[0].path;
      }
      if (files?.file_undangan?.[0]) {
        if (file_undangan_path) await unlink(file_undangan_path).catch(() => {});
        file_undangan_path = files.file_undangan[0].path;
      }

      const result = await pool.query(
        `UPDATE surat_tugas
         SET nomor_surat = COALESCE($1, nomor_surat),
             tanggal_surat = COALESCE($2, tanggal_surat),
             perihal = COALESCE($3, perihal),
             file_surat_path = $4,
             file_undangan_path = $5
         WHERE id = $6 RETURNING *`,
        [
          nomor_surat || null,
          tanggal_surat || null,
          perihal || null,
          file_surat_path,
          file_undangan_path,
          req.params.id,
        ]
      );

      res.json({ data: result.rows[0] });
    } catch (err: any) {
      logger.error("surat_tugas_update_error", { message: err.message });
      res.status(500).json({ error: "Gagal mengupdate Surat Tugas." });
    }
  }
);

// ============================================================
// DELETE /api/surat-tugas/:id — hapus + bersihkan file
// ============================================================

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const existing = await pool.query("SELECT * FROM surat_tugas WHERE id = $1", [req.params.id]);
    if (!existing.rows[0]) {
      return res.status(404).json({ error: "Surat Tugas tidak ditemukan." });
    }

    // Cek apakah ada SPPD linked — warn via error
    const linked = await pool.query(
      "SELECT COUNT(*) FROM sppd_kegiatan WHERE surat_tugas_id = $1",
      [req.params.id]
    );
    if (parseInt(linked.rows[0].count) > 0) {
      return res.status(400).json({
        error: `Surat Tugas tidak bisa dihapus karena masih terhubung ke ${linked.rows[0].count} SPPD.`,
      });
    }

    // Hapus file dari filesystem
    if (existing.rows[0].file_surat_path) {
      await unlink(existing.rows[0].file_surat_path).catch(() => {});
    }
    if (existing.rows[0].file_undangan_path) {
      await unlink(existing.rows[0].file_undangan_path).catch(() => {});
    }

    await pool.query("DELETE FROM surat_tugas WHERE id = $1", [req.params.id]);
    res.json({ message: "Surat Tugas berhasil dihapus." });
  } catch (err: any) {
    logger.error("surat_tugas_delete_error", { message: err.message });
    res.status(500).json({ error: "Gagal menghapus Surat Tugas." });
  }
});

// ============================================================
// GET /api/surat-tugas/:id/file/:jenis — serve PDF inline
// ============================================================

router.get("/:id/file/:jenis", async (req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT * FROM surat_tugas WHERE id = $1", [req.params.id]);
    if (!result.rows[0]) {
      return res.status(404).json({ error: "Surat Tugas tidak ditemukan." });
    }

    const field = req.params.jenis === "undangan" ? "file_undangan_path" : "file_surat_path";
    const filePath = result.rows[0][field];

    if (!filePath) {
      return res.status(404).json({ error: "File tidak ditemukan." });
    }

    const { readFile } = await import("node:fs/promises");
    const buffer = await readFile(filePath);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline");
    res.send(buffer);
  } catch (err: any) {
    logger.error("surat_tugas_file_error", { message: err.message });
    res.status(500).json({ error: "Gagal membaca file." });
  }
});

export default router;
