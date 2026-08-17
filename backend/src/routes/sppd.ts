// SPPD Routes — Surat Perintah Perjalanan Dinas
// v2: Extended workflow (dilaksanakan → pertanggungjawaban → dibayar)
// + Dokumen upload (boarding pass, kwitansi hotel, SPPD cap, laporan)
import { Router, Request, Response } from "express";
import multer from "multer";
import { mkdir, unlink, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pool from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { logger } from "../logger.js";

const router = Router();
router.use(authMiddleware);

// ============================================================
// FILE UPLOAD SETUP
// ============================================================

const UPLOAD_BASE = process.env.SPPD_UPLOAD_DIR || "/var/arthakarya/uploads/sppd";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const dokumenStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const dir = join(UPLOAD_BASE, String((_req as any).sppdId || "tmp"));
    await mkdir(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${extname(file.originalname)}`);
  },
});

const dokumenUpload = multer({
  storage: dokumenStorage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("HANYA_PDF_IMAGE"));
    }
  },
});

function catchDokumenUploadErr(req: Request, res: Response, next: any) {
  return (err: any) => {
    if (err) {
      if (err.message === "HANYA_PDF_IMAGE") {
        return res.status(400).json({ error: "Hanya file PDF dan gambar yang diizinkan." });
      }
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Ukuran file maksimal 10MB." });
      }
      logger.error("sppd_multer_error", { message: err.message, code: err.code });
      return res.status(500).json({ error: "Gagal mengupload file." });
    }
    next();
  };
}

// ============================================================
// HELPERS
// ============================================================

function isAdmin(req: Request): boolean {
  return req.user?.role === "admin";
}

async function getSppdOr404(id: string) {
  const result = await pool.query("SELECT * FROM sppd_kegiatan WHERE id = $1", [id]);
  return result.rows[0] ?? null;
}

// ============================================================
// GET /api/sppd/alerts — badge counts for sidebar
// ============================================================

router.get("/alerts", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const isAdminUser = isAdmin(req);

    // Overdue pertanggungjawaban: status dilaksanakan & tanggal_pulang+5 hari kerja sudah lewat
    // Weekend Indonesia: Sabtu (DOW=6) + Minggu (DOW=0)
    const overdueResult = await pool.query(
      `SELECT COUNT(*) FROM sppd_kegiatan sk
       WHERE sk.status = 'dilaksanakan'
       AND (
         SELECT COUNT(*) FROM generate_series(sk.tanggal_pulang::date + 1, sk.tanggal_pulang::date + 60, '1 day') d
         WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
           AND NOT EXISTS (SELECT 1 FROM hari_libur hl WHERE hl.tanggal = d::date)
       ) <= 5
       ${isAdminUser ? "" : "AND sk.created_by = $1"}`,
      isAdminUser ? [] : [userId]
    );

    // Perlu revisi: status dilaksanakan + ada approval revisi
    const revisiResult = await pool.query(
      `SELECT COUNT(*) FROM sppd_kegiatan sk
       WHERE sk.status = 'dilaksanakan'
       AND EXISTS (
         SELECT 1 FROM sppd_approval sa
         WHERE sa.sppd_kegiatan_id = sk.id AND sa.keputusan = 'revisi'
       )
       ${isAdminUser ? "" : "AND sk.created_by = $1"}`,
      isAdminUser ? [] : [userId]
    );

    // Pending approval: diajukan
    const pendingResult = await pool.query(
      `SELECT COUNT(*) FROM sppd_kegiatan sk
       WHERE sk.status = 'diajukan'
       ${isAdminUser ? "" : "AND sk.created_by = $1"}`,
      isAdminUser ? [] : [userId]
    );

    // Menunggu pertanggungjawaban: status dilaksanakan (operator needs to upload docs)
    const pertanggungjawabanResult = await pool.query(
      `SELECT COUNT(*) FROM sppd_kegiatan sk
       WHERE sk.status = 'dilaksanakan'
       ${isAdminUser ? "" : "AND sk.created_by = $1"}`,
      isAdminUser ? [] : [userId]
    );

    // Pending verifikasi: status pertanggungjawaban (admin bendahara needs to check)
    const verifikasiResult = isAdminUser
      ? (await pool.query(`SELECT COUNT(*) FROM sppd_kegiatan WHERE status = 'pertanggungjawaban'`))
      : { rows: [{ count: 0 }] };

    res.json({
      data: {
        overdue_pertanggungjawaban: parseInt(overdueResult.rows[0].count),
        perlu_revisi: parseInt(revisiResult.rows[0].count),
        pending_approval: parseInt(pendingResult.rows[0].count),
        menunggu_unggahan: parseInt(pertanggungjawabanResult.rows[0].count),
        pending_verifikasi: parseInt(verifikasiResult.rows[0].count),
      },
    });
  } catch (err: any) {
    logger.error("sppd_alerts_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data alert." });
  }
});

// ============================================================
// GET /api/sppd — list kegiatan SPPD
// ============================================================

router.get("/", async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT sk.*,
             u.username AS created_by_username,
             (SELECT COUNT(*) FROM sppd_peserta sp WHERE sp.sppd_kegiatan_id = sk.id) AS jumlah_peserta
      FROM sppd_kegiatan sk
      JOIN users u ON sk.created_by = u.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIdx = 1;

    if (!isAdmin(req)) {
      query += ` AND sk.created_by = $${paramIdx++}`;
      params.push(req.user!.userId);
    }

    if (status && typeof status === "string") {
      query += ` AND sk.status = $${paramIdx++}`;
      params.push(status);
    }

    query += " ORDER BY sk.created_at DESC";
    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  } catch (err: any) {
    logger.error("sppd_list_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data SPPD." });
  }
});

// ============================================================
// GET /api/sppd/:id — detail kegiatan + peserta + dokumen
// ============================================================

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });

    if (!isAdmin(req) && keg.created_by !== req.user!.userId) {
      return res.status(403).json({ error: "Anda tidak memiliki akses." });
    }

    const peserta = await pool.query(
      "SELECT * FROM sppd_peserta WHERE sppd_kegiatan_id = $1 ORDER BY id",
      [req.params.id]
    );

    const approvals = await pool.query(
      `SELECT sa.*, u.username AS actor_username
       FROM sppd_approval sa
       JOIN users u ON sa.actor_id = u.id
       WHERE sa.sppd_kegiatan_id = $1
       ORDER BY sa.created_at DESC`,
      [req.params.id]
    );

    const dokumen = await pool.query(
      `SELECT sd.*, u.username AS uploaded_by_username
       FROM sppd_dokumen sd
       JOIN users u ON sd.uploaded_by = u.id
       WHERE sd.sppd_kegiatan_id = $1
       ORDER BY sd.created_at DESC`,
      [req.params.id]
    );

    res.json({
      data: { ...keg, peserta: peserta.rows, approvals: approvals.rows, dokumen: dokumen.rows },
    });
  } catch (err: any) {
    logger.error("sppd_detail_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil detail SPPD." });
  }
});

// ============================================================
// POST /api/sppd — buat kegiatan SPPD baru
// ============================================================

router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      nama_kegiatan, alat_angkutan, tempat_berangkat, tempat_tujuan,
      tanggal_berangkat, tanggal_pulang, lama_hari, tanggal_surat,
      kota_dikeluarkan, mata_anggaran, keterangan,
      ppk_nama, ppk_nip, ppk_jabatan, peserta,
      surat_tugas_id,
    } = req.body;

    if (!nama_kegiatan || !tempat_berangkat || !tempat_tujuan || !tanggal_berangkat || !tanggal_pulang) {
      return res.status(400).json({ error: "Field wajib belum lengkap." });
    }

    // Validasi panjang input
    if (nama_kegiatan.length > 500) return res.status(400).json({ error: "Nama kegiatan maksimal 500 karakter." });
    if (tempat_berangkat.length > 200) return res.status(400).json({ error: "Tempat berangkat maksimal 200 karakter." });
    if (tempat_tujuan.length > 200) return res.status(400).json({ error: "Tempat tujuan maksimal 200 karakter." });
    if (tanggal_pulang < tanggal_berangkat) return res.status(400).json({ error: "Tanggal pulang harus setelah tanggal berangkat." });
    if (ppk_nama && ppk_nama.length > 200) return res.status(400).json({ error: "Nama PPK maksimal 200 karakter." });
    if (kota_dikeluarkan && kota_dikeluarkan.length > 100) return res.status(400).json({ error: "Kota dikeluarkan maksimal 100 karakter." });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const kegResult = await client.query(
        `INSERT INTO sppd_kegiatan
         (created_by, nama_kegiatan, alat_angkutan, tempat_berangkat, tempat_tujuan,
          tanggal_berangkat, tanggal_pulang, lama_hari, tanggal_surat, kota_dikeluarkan,
          mata_anggaran, keterangan, ppk_nama, ppk_nip, ppk_jabatan, surat_tugas_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING *`,
        [
          req.user!.userId, nama_kegiatan, alat_angkutan || null,
          tempat_berangkat, tempat_tujuan, tanggal_berangkat, tanggal_pulang,
          lama_hari, tanggal_surat || new Date().toISOString().slice(0, 10),
          kota_dikeluarkan, mata_anggaran || null, keterangan || null,
          ppk_nama, ppk_nip || null, ppk_jabatan,
          surat_tugas_id || null,
        ]
      );

      const kegiatanId = kegResult.rows[0].id;

      if (Array.isArray(peserta) && peserta.length > 0) {
        for (const p of peserta) {
          if (!p.nama || typeof p.nama !== "string" || p.nama.trim().length === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Nama peserta wajib diisi." });
          }
          if (p.nama.length > 200) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Nama peserta maksimal 200 karakter." });
          }
          await client.query(
            `INSERT INTO sppd_peserta
             (sppd_kegiatan_id, nama, nip, golongan, jabatan, status_kepegawaian,
              uang_harian_hari, uang_harian_satuan, transport, tiket_pp,
              penginapan_malam, penginapan_satuan, honor_paket_meeting, representatif)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              kegiatanId, p.nama, p.nip || null, p.golongan || null,
              p.jabatan || null, p.status_kepegawaian || "PPNPN",
              p.uang_harian_hari ?? 0, p.uang_harian_satuan ?? 0,
              p.transport ?? 0, p.tiket_pp ?? 0,
              p.penginapan_malam ?? 0, p.penginapan_satuan ?? 0,
              p.honor_paket_meeting ?? 0, p.representatif ?? 0,
            ]
          );
        }
      }

      await client.query("COMMIT");
      res.status(201).json({ data: kegResult.rows[0] });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    logger.error("sppd_create_error", { message: err.message });
    res.status(500).json({ error: "Gagal membuat SPPD." });
  }
});

// ============================================================
// PUT /api/sppd/:id — update kegiatan (draft only)
// ============================================================

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });
    if (keg.created_by !== req.user!.userId && !isAdmin(req)) {
      return res.status(403).json({ error: "Anda tidak memiliki akses." });
    }
    if (keg.status !== "draft") {
      return res.status(400).json({ error: "Hanya SPPD draft yang bisa diedit." });
    }

    const fields = [
      "nama_kegiatan", "alat_angkutan", "tempat_berangkat", "tempat_tujuan",
      "tanggal_berangkat", "tanggal_pulang", "lama_hari", "tanggal_surat",
      "kota_dikeluarkan", "mata_anggaran", "keterangan",
      "ppk_nama", "ppk_nip", "ppk_jabatan", "surat_tugas_id",
    ];

    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = $${idx++}`);
        params.push(req.body[f]);
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "Tidak ada field yang diubah." });
    }

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE sppd_kegiatan SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      params
    );

    res.json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error("sppd_update_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengupdate SPPD." });
  }
});

// ============================================================
// DELETE /api/sppd/:id — hapus kegiatan (draft only)
// ============================================================

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });
    if (keg.created_by !== req.user!.userId && !isAdmin(req)) {
      return res.status(403).json({ error: "Anda tidak memiliki akses." });
    }
    if (keg.status !== "draft") {
      return res.status(400).json({ error: "Hanya SPPD draft yang bisa dihapus." });
    }

    // Bersihkan file dokumen
    const docs = await pool.query("SELECT path_file FROM sppd_dokumen WHERE sppd_kegiatan_id = $1", [req.params.id]);
    for (const d of docs.rows) {
      await unlink(d.path_file).catch(() => {});
    }

    await pool.query("DELETE FROM sppd_kegiatan WHERE id = $1", [req.params.id]);
    res.json({ message: "SPPD berhasil dihapus." });
  } catch (err: any) {
    logger.error("sppd_delete_error", { message: err.message });
    res.status(500).json({ error: "Gagal menghapus SPPD." });
  }
});

// ============================================================
// POST /api/sppd/:id/submit — ajukan ke approval
// ============================================================

router.post("/:id/submit", async (req: Request, res: Response) => {
  try {
    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });
    if (keg.created_by !== req.user!.userId && !isAdmin(req)) {
      return res.status(403).json({ error: "Anda tidak memiliki akses." });
    }
    if (keg.status !== "draft") {
      return res.status(400).json({ error: "Hanya SPPD draft yang bisa diajukan." });
    }

    const count = await pool.query(
      "SELECT COUNT(*) FROM sppd_peserta WHERE sppd_kegiatan_id = $1",
      [req.params.id]
    );
    if (parseInt(count.rows[0].count) === 0) {
      return res.status(400).json({ error: "Tambahkan minimal 1 peserta." });
    }

    const result = await pool.query(
      `UPDATE sppd_kegiatan SET status = 'diajukan', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error("sppd_submit_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengajukan SPPD." });
  }
});

// ============================================================
// POST /api/sppd/:id/approve — approve / reject (admin)
// ============================================================

router.post("/:id/approve", async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "Hanya admin yang bisa menyetujui." });
    }

    const { keputusan, catatan } = req.body;
    if (!["disetujui", "ditolak"].includes(keputusan)) {
      return res.status(400).json({ error: "Keputusan tidak valid." });
    }

    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });

    if (keg.status !== "diajukan") {
      return res.status(400).json({ error: `Tidak bisa ${keputusan} dari status ${keg.status}.` });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Re-check status di dalam transaksi untuk mencegah race condition
      const lockCheck = await client.query(
        "SELECT status FROM sppd_kegiatan WHERE id = $1 FOR UPDATE",
        [req.params.id]
      );
      if (!lockCheck.rows[0] || lockCheck.rows[0].status !== "diajukan") {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Status SPPD sudah berubah. Silakan refresh." });
      }

      await client.query(
        `INSERT INTO sppd_approval (sppd_kegiatan_id, actor_id, keputusan, catatan)
         VALUES ($1, $2, $3, $4)`,
        [req.params.id, req.user!.userId, keputusan, catatan || null]
      );

      const result = await client.query(
        `UPDATE sppd_kegiatan SET status = $1, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [keputusan, req.params.id]
      );

      if (keputusan === "disetujui") {
        const peserta = await client.query(
          "SELECT id FROM sppd_peserta WHERE sppd_kegiatan_id = $1 ORDER BY id",
          [req.params.id]
        );
        for (let i = 0; i < peserta.rows.length; i++) {
          const nomor = `SPPD-${String(req.params.id).padStart(3, "0")}-${String(i + 1).padStart(2, "0")}`;
          await client.query(
            "UPDATE sppd_peserta SET nomor_sppd = $1 WHERE id = $2",
            [nomor, peserta.rows[i].id]
          );
        }
      }

      await client.query("COMMIT");
      res.json({ data: result.rows[0] });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    logger.error("sppd_approve_error", { message: err.message });
    res.status(500).json({ error: "Gagal memproses approval." });
  }
});

// ============================================================
// POST /api/sppd/:id/ajukan-pertanggungjawaban
// Operator submits all uploaded docs for verification
// ============================================================

router.post("/:id/ajukan-pertanggungjawaban", async (req: Request, res: Response) => {
  try {
    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });
    if (keg.created_by !== req.user!.userId && !isAdmin(req)) {
      return res.status(403).json({ error: "Anda tidak memiliki akses." });
    }
    // Status yang diizinkan untuk submit pertanggungjawaban:
    // - 'dilaksanakan' → langsung lanjut
    // - 'disetujui' + tanggal_berangkat sudah lewat (WIB) → otomatis dimajukan
    //   ke 'dilaksanakan' dulu (selaras dengan cron sppd-cron.ts), supaya
    //   operator tidak perlu menunggu cron harian. Pengecekan tanggal dilakukan
    //   di dalam transaksi (SQL), bukan di sini.
    const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (keg.status !== "dilaksanakan" && keg.status !== "disetujui") {
      return res.status(400).json({ error: "Hanya SPPD dengan status 'dilaksanakan' yang bisa diajukan pertanggungjawaban." });
    }

    // Cek minimal SPPD cap sudah diupload (per peserta)
    const pesertaResult = await pool.query(
      "SELECT id FROM sppd_peserta WHERE sppd_kegiatan_id = $1",
      [req.params.id]
    );
    for (const p of pesertaResult.rows) {
      const capCount = await pool.query(
        "SELECT COUNT(*) FROM sppd_dokumen WHERE sppd_kegiatan_id = $1 AND sppd_peserta_id = $2 AND jenis = 'sppd_cap'",
        [req.params.id, p.id]
      );
      if (parseInt(capCount.rows[0].count) === 0) {
        return res.status(400).json({
          error: `SPPD cap untuk peserta ${p.id} belum diupload. Semua peserta wajib memiliki SPPD cap.`,
        });
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Re-check status di dalam transaksi (anti race condition, pola sama
      // dengan endpoint /approve).
      const lockCheck = await client.query(
        "SELECT status FROM sppd_kegiatan WHERE id = $1 FOR UPDATE",
        [req.params.id]
      );
      if (!lockCheck.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "SPPD tidak ditemukan." });
      }

      const currentStatus = lockCheck.rows[0].status;
      if (currentStatus === "disetujui") {
        // Auto-catch-up: majukan ke 'dilaksanakan' kalau tanggal berangkat
        // sudah lewat. Dibandingkan di SQL agar konsisten dengan tipe DATE.
        const lewat = await client.query(
          `SELECT (tanggal_berangkat <= $1::date) AS lewat
           FROM sppd_kegiatan WHERE id = $2`,
          [today, req.params.id]
        );
        if (!lewat.rows[0]?.lewat) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "SPPD belum dilaksanakan." });
        }
        await client.query(
          `UPDATE sppd_kegiatan SET status = 'dilaksanakan', updated_at = NOW()
           WHERE id = $1`,
          [req.params.id]
        );
      } else if (currentStatus !== "dilaksanakan") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Hanya SPPD dengan status 'dilaksanakan' yang bisa diajukan pertanggungjawaban." });
      }

      await client.query(
        `INSERT INTO sppd_approval (sppd_kegiatan_id, actor_id, keputusan, catatan)
         VALUES ($1, $2, 'diajukan_pertanggungjawaban', 'Dokumen pertanggungjawaban diajukan oleh operator.')`,
        [req.params.id, req.user!.userId]
      );

      const result = await client.query(
        `UPDATE sppd_kegiatan SET status = 'pertanggungjawaban', updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [req.params.id]
      );

      await client.query("COMMIT");
      res.json({ data: result.rows[0] });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    logger.error("sppd_ajukan_pertanggungjawaban_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengajukan pertanggungjawaban." });
  }
});

// ============================================================
// POST /api/sppd/:id/verifikasi-dokumen
// Admin bendahara verifikasi dokumen → dibayar atau revisi
// ============================================================

router.post("/:id/verifikasi-dokumen", async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "Hanya admin yang bisa memverifikasi." });
    }

    const { keputusan, catatan } = req.body;
    if (!["dibayar", "revisi"].includes(keputusan)) {
      return res.status(400).json({ error: "Keputusan harus 'dibayar' atau 'revisi'." });
    }

    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });

    if (keg.status !== "pertanggungjawaban") {
      return res.status(400).json({ error: `Tidak bisa verifikasi dari status ${keg.status}.` });
    }

    if (keputusan === "revisi" && (!catatan || !catatan.trim())) {
      return res.status(400).json({ error: "Catatan wajib diisi jika meminta revisi." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO sppd_approval (sppd_kegiatan_id, actor_id, keputusan, catatan)
         VALUES ($1, $2, $3, $4)`,
        [req.params.id, req.user!.userId, keputusan, catatan || null]
      );

      const newStatus = keputusan === "dibayar" ? "dibayar" : "dilaksanakan";
      const result = await client.query(
        `UPDATE sppd_kegiatan SET status = $1, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [newStatus, req.params.id]
      );

      await client.query("COMMIT");
      res.json({ data: result.rows[0] });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    logger.error("sppd_verifikasi_dokumen_error", { message: err.message });
    res.status(500).json({ error: "Gagal memverifikasi dokumen." });
  }
});

// ============================================================
// DOKUMEN UPLOAD — POST /api/sppd/:id/dokumen
// ============================================================

router.post("/:id/dokumen", async (req: Request, res: Response) => {
  try {
    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });
    if (keg.created_by !== req.user!.userId && !isAdmin(req)) {
      return res.status(403).json({ error: "Anda tidak memiliki akses." });
    }

    // Set sppdId on request for multer destination
    (req as any).sppdId = req.params.id;

    await new Promise<void>((resolve, reject) => {
      dokumenUpload.single("file")(req, res, (err: any) => {
        if (err) {
          if (err.message === "HANYA_PDF_IMAGE") return reject({ status: 400, message: "Hanya file PDF dan gambar yang diizinkan." });
          if (err.code === "LIMIT_FILE_SIZE") return reject({ status: 400, message: "Ukuran file maksimal 10MB." });
          return reject(err);
        }
        resolve();
      });
    });

    const file = (req as any).file;
    if (!file) {
      return res.status(400).json({ error: "File tidak ditemukan." });
    }

    const { jenis, sppd_peserta_id } = req.body;
    if (!jenis || !["boarding_pass", "kwitansi_hotel", "sppd_cap", "laporan_kegiatan"].includes(jenis)) {
      await unlink(file.path).catch(() => {});
      return res.status(400).json({ error: "Jenis dokumen tidak valid." });
    }

    // Validasi: boarding_pass, kwitansi_hotel, sppd_cap harus punya peserta_id
    if (["boarding_pass", "kwitansi_hotel", "sppd_cap"].includes(jenis) && !sppd_peserta_id) {
      await unlink(file.path).catch(() => {});
      return res.status(400).json({ error: "Dokumen ini membutuhkan peserta." });
    }

    // Validasi: sppd_peserta_id harus valid dan milik SPPD ini
    if (sppd_peserta_id) {
      const p = await pool.query(
        "SELECT id FROM sppd_peserta WHERE id = $1 AND sppd_kegiatan_id = $2",
        [sppd_peserta_id, req.params.id]
      );
      if (!p.rows[0]) {
        await unlink(file.path).catch(() => {});
        return res.status(400).json({ error: "Peserta tidak valid untuk SPPD ini." });
      }
    }

    // Hapus file lama dengan jenis yang sama (jika ada)
    const existing = await pool.query(
      `SELECT id, path_file FROM sppd_dokumen
       WHERE sppd_kegiatan_id = $1 AND jenis = $2
       AND (sppd_peserta_id = $3 OR (sppd_peserta_id IS NULL AND $3 IS NULL))`,
      [req.params.id, jenis, sppd_peserta_id || null]
    );
    for (const d of existing.rows) {
      await unlink(d.path_file).catch(() => {});
      await pool.query("DELETE FROM sppd_dokumen WHERE id = $1", [d.id]);
    }

    const result = await pool.query(
      `INSERT INTO sppd_dokumen (sppd_kegiatan_id, sppd_peserta_id, jenis, nama_file, path_file, ukuran_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.id, sppd_peserta_id || null, jenis, file.originalname, file.path, file.size, req.user!.userId]
    );

    logger.info("sppd_dokumen_uploaded", {
      sppd_id: req.params.id,
      jenis,
      file: file.originalname,
      by: req.user!.username,
    });

    res.status(201).json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error("sppd_dokumen_upload_error", { message: err.message });
    const status = err.status || 500;
    const message = err.message || "Gagal mengupload dokumen.";
    res.status(status).json({ error: message });
  }
});

// ============================================================
// DOKUMEN — DELETE /api/sppd/:id/dokumen/:did
// ============================================================

router.delete("/:id/dokumen/:did", async (req: Request, res: Response) => {
  try {
    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });
    if (keg.created_by !== req.user!.userId && !isAdmin(req)) {
      return res.status(403).json({ error: "Anda tidak memiliki akses." });
    }
    if (!["draft", "dilaksanakan"].includes(keg.status)) {
      return res.status(400).json({ error: "Dokumen hanya bisa dihapus pada status draft atau dilaksanakan." });
    }

    const doc = await pool.query(
      "SELECT * FROM sppd_dokumen WHERE id = $1 AND sppd_kegiatan_id = $2",
      [req.params.did, req.params.id]
    );
    if (!doc.rows[0]) {
      return res.status(404).json({ error: "Dokumen tidak ditemukan." });
    }

    await unlink(doc.rows[0].path_file).catch(() => {});
    await pool.query("DELETE FROM sppd_dokumen WHERE id = $1", [req.params.did]);

    res.json({ message: "Dokumen berhasil dihapus." });
  } catch (err: any) {
    logger.error("sppd_dokumen_delete_error", { message: err.message });
    res.status(500).json({ error: "Gagal menghapus dokumen." });
  }
});

// ============================================================
// DOKUMEN — GET /api/sppd/:id/dokumen/:did/file — serve file
// ============================================================

router.get("/:id/dokumen/:did/file", async (req: Request, res: Response) => {
  try {
    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });
    if (keg.created_by !== req.user!.userId && !isAdmin(req)) {
      return res.status(403).json({ error: "Anda tidak memiliki akses." });
    }

    const doc = await pool.query(
      "SELECT * FROM sppd_dokumen WHERE id = $1 AND sppd_kegiatan_id = $2",
      [req.params.did, req.params.id]
    );
    if (!doc.rows[0]) {
      return res.status(404).json({ error: "Dokumen tidak ditemukan." });
    }

    const buffer = await readFile(doc.rows[0].path_file);
    const mime = doc.rows[0].nama_file.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg";
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", "inline");
    res.send(buffer);
  } catch (err: any) {
    logger.error("sppd_dokumen_serve_error", { message: err.message });
    res.status(500).json({ error: "Gagal membaca file." });
  }
});

// ============================================================
// PESERTA CRUD (unchanged from original)
// ============================================================

router.get("/:id/peserta", async (req: Request, res: Response) => {
  try {
    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });

    const result = await pool.query(
      "SELECT * FROM sppd_peserta WHERE sppd_kegiatan_id = $1 ORDER BY id",
      [req.params.id]
    );
    res.json({ data: result.rows });
  } catch (err: any) {
    logger.error("sppd_peserta_list_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data peserta." });
  }
});

router.post("/:id/peserta", async (req: Request, res: Response) => {
  try {
    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });
    if (keg.created_by !== req.user!.userId && !isAdmin(req)) {
      return res.status(403).json({ error: "Anda tidak memiliki akses." });
    }
    if (keg.status !== "draft") {
      return res.status(400).json({ error: "Hanya SPPD draft yang bisa diubah." });
    }

    const p = req.body;
    const result = await pool.query(
      `INSERT INTO sppd_peserta
       (sppd_kegiatan_id, nama, nip, golongan, jabatan, status_kepegawaian,
        uang_harian_hari, uang_harian_satuan, transport, tiket_pp,
        penginapan_malam, penginapan_satuan, honor_paket_meeting, representatif)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        req.params.id, p.nama, p.nip || null, p.golongan || null,
        p.jabatan || null, p.status_kepegawaian || "PPNPN",
        p.uang_harian_hari ?? 0, p.uang_harian_satuan ?? 0,
        p.transport ?? 0, p.tiket_pp ?? 0,
        p.penginapan_malam ?? 0, p.penginapan_satuan ?? 0,
        p.honor_paket_meeting ?? 0, p.representatif ?? 0,
      ]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error("sppd_peserta_create_error", { message: err.message });
    res.status(500).json({ error: "Gagal menambah peserta." });
  }
});

router.put("/:id/peserta/:pid", async (req: Request, res: Response) => {
  try {
    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });
    if (keg.created_by !== req.user!.userId && !isAdmin(req)) {
      return res.status(403).json({ error: "Anda tidak memiliki akses." });
    }
    if (keg.status !== "draft") {
      return res.status(400).json({ error: "Hanya SPPD draft yang bisa diubah." });
    }

    const fields = [
      "nama", "nip", "golongan", "jabatan", "status_kepegawaian",
      "uang_harian_hari", "uang_harian_satuan", "transport", "tiket_pp",
      "penginapan_malam", "penginapan_satuan", "honor_paket_meeting", "representatif",
    ];

    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = $${idx++}`);
        params.push(req.body[f]);
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "Tidak ada field yang diubah." });
    }

    params.push(req.params.pid, req.params.id);
    const result = await pool.query(
      `UPDATE sppd_peserta SET ${sets.join(", ")}
       WHERE id = $${idx++} AND sppd_kegiatan_id = $${idx}
       RETURNING *`,
      params
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Peserta tidak ditemukan." });
    }
    res.json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error("sppd_peserta_update_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengupdate peserta." });
  }
});

router.delete("/:id/peserta/:pid", async (req: Request, res: Response) => {
  try {
    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });
    if (keg.created_by !== req.user!.userId && !isAdmin(req)) {
      return res.status(403).json({ error: "Anda tidak memiliki akses." });
    }
    if (keg.status !== "draft") {
      return res.status(400).json({ error: "Hanya SPPD draft yang bisa diubah." });
    }

    // Hapus file dokumen milik peserta ini dari filesystem
    const docs = await pool.query(
      "SELECT path_file FROM sppd_dokumen WHERE sppd_peserta_id = $1",
      [req.params.pid]
    );
    for (const d of docs.rows) {
      await unlink(d.path_file).catch(() => {});
    }

    await pool.query(
      "DELETE FROM sppd_peserta WHERE id = $1 AND sppd_kegiatan_id = $2",
      [req.params.pid, req.params.id]
    );
    res.json({ message: "Peserta berhasil dihapus." });
  } catch (err: any) {
    logger.error("sppd_peserta_delete_error", { message: err.message });
    res.status(500).json({ error: "Gagal menghapus peserta." });
  }
});

// ============================================================
// GET /api/sppd/:id/cetak/:pid — generate PDF SPPD
// ============================================================

router.get("/:id/cetak/:pid", async (req: Request, res: Response) => {
  try {
    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });
    if (keg.created_by !== req.user!.userId && !isAdmin(req)) {
      return res.status(403).json({ error: "Anda tidak memiliki akses." });
    }

    const pesertaResult = await pool.query(
      "SELECT * FROM sppd_peserta WHERE id = $1 AND sppd_kegiatan_id = $2",
      [req.params.pid, req.params.id]
    );
    const peserta = pesertaResult.rows[0];
    if (!peserta) return res.status(404).json({ error: "Peserta tidak ditemukan." });

    const tgl = (d: string) => {
      if (!d) return "—";
      const datePart = String(d).split("T")[0];
      const date = new Date(datePart + "T00:00:00");
      if (isNaN(date.getTime())) return "—";
      return date.toLocaleDateString("id-ID", {
        day: "numeric", month: "long", year: "numeric",
      });
    };

    const data = {
      nomor_sppd: peserta.nomor_sppd || "—",
      nama: peserta.nama,
      nip: peserta.nip || "—",
      golongan: peserta.golongan || peserta.status_kepegawaian,
      jabatan: peserta.jabatan || "—",
      maksud: keg.nama_kegiatan,
      alat_angkutan: keg.alat_angkutan || "—",
      tempat_berangkat: keg.tempat_berangkat,
      tempat_tujuan: keg.tempat_tujuan,
      lama_hari: `${keg.lama_hari} Hari`,
      tgl_berangkat: tgl(keg.tanggal_berangkat),
      tgl_pulang: tgl(keg.tanggal_pulang),
      tgl_surat: tgl(keg.tanggal_surat),
      kota_dikeluarkan: keg.kota_dikeluarkan,
      mata_anggaran: keg.mata_anggaran || "—",
      keterangan: keg.keterangan || "—",
      ppk_nama: keg.ppk_nama,
      ppk_nip: keg.ppk_nip || "……………………",
      ppk_jabatan: keg.ppk_jabatan,
    };

    const { execFile } = await import("node:child_process");
    const { writeFile, readFile: rf } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");

    const tmpDir = tmpdir();
    const jsonPath = join(tmpDir, `sppd-${req.params.pid}.json`);
    const pdfPath = join(tmpDir, `sppd-${req.params.pid}.pdf`);
    const templatePath = join(import.meta.dirname, "..", "templates", "template-sppd.docx");

    try {
      await writeFile(jsonPath, JSON.stringify(data, null, 2));

      await new Promise<void>((resolve, reject) => {
        execFile(
          "python3",
          [join(import.meta.dirname, "..", "templates", "generate-pdf.py"), templatePath, jsonPath, pdfPath],
          { timeout: 30000 },
          (err) => (err ? reject(err) : resolve())
        );
      });

      const pdfBuffer = await rf(pdfPath);
      await unlink(jsonPath).catch(() => {});
      await unlink(pdfPath).catch(() => {});

      logger.info("sppd_cetak_pdf", {
        sppd_id: req.params.id,
        peserta_id: req.params.pid,
        by: req.user!.username,
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="SPPD-${peserta.nomor_sppd || peserta.nama}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      await unlink(jsonPath).catch(() => {});
      logger.error("sppd_pdf_error", { message: err.message });
      res.status(500).json({ error: "Gagal generate PDF." });
    }
  } catch (err: any) {
    logger.error("sppd_cetak_error", { message: err.message });
    res.status(500).json({ error: "Gagal mencetak SPPD." });
  }
});

export default router;
