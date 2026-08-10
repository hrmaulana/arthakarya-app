// SPPD Routes — Surat Perintah Perjalanan Dinas
import { Router, Request, Response } from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { logger } from "../logger.js";

const router = Router();
router.use(authMiddleware);

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

    // Operator hanya lihat punya sendiri
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
// GET /api/sppd/:id — detail kegiatan + peserta
// ============================================================

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });

    // Scope check
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

    res.json({
      data: { ...keg, peserta: peserta.rows, approvals: approvals.rows },
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
    } = req.body;

    if (!nama_kegiatan || !tempat_berangkat || !tempat_tujuan || !tanggal_berangkat || !tanggal_pulang) {
      return res.status(400).json({ error: "Field wajib belum lengkap." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const kegResult = await client.query(
        `INSERT INTO sppd_kegiatan
         (created_by, nama_kegiatan, alat_angkutan, tempat_berangkat, tempat_tujuan,
          tanggal_berangkat, tanggal_pulang, lama_hari, tanggal_surat, kota_dikeluarkan,
          mata_anggaran, keterangan, ppk_nama, ppk_nip, ppk_jabatan)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          req.user!.userId, nama_kegiatan, alat_angkutan || null,
          tempat_berangkat, tempat_tujuan, tanggal_berangkat, tanggal_pulang,
          lama_hari, tanggal_surat || new Date().toISOString().slice(0, 10),
          kota_dikeluarkan, mata_anggaran || null, keterangan || null,
          ppk_nama, ppk_nip || null, ppk_jabatan,
        ]
      );

      const kegiatanId = kegResult.rows[0].id;

      // Insert peserta jika ada
      if (Array.isArray(peserta) && peserta.length > 0) {
        for (const p of peserta) {
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
      "ppk_nama", "ppk_nip", "ppk_jabatan",
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

    // Cek minimal ada 1 peserta
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
// POST /api/sppd/:id/approve — approve / reject / bayar (admin)
// ============================================================

router.post("/:id/approve", async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "Hanya admin yang bisa menyetujui." });
    }

    const { keputusan, catatan } = req.body;
    if (!["disetujui", "ditolak", "dibayar"].includes(keputusan)) {
      return res.status(400).json({ error: "Keputusan tidak valid." });
    }

    const keg = await getSppdOr404(req.params.id);
    if (!keg) return res.status(404).json({ error: "SPPD tidak ditemukan." });

    const validTransitions: Record<string, string[]> = {
      disetujui: ["diajukan"],
      ditolak: ["diajukan"],
      dibayar: ["disetujui"],
    };

    if (!validTransitions[keputusan].includes(keg.status)) {
      return res.status(400).json({
        error: `Tidak bisa ${keputusan} dari status ${keg.status}.`,
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

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

      // Assign nomor SPPD saat disetujui
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
// PESERTA CRUD
// ============================================================

// GET /api/sppd/:id/peserta
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

// POST /api/sppd/:id/peserta
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

// PUT /api/sppd/:id/peserta/:pid
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

// DELETE /api/sppd/:id/peserta/:pid
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

    const pesertaResult = await pool.query(
      "SELECT * FROM sppd_peserta WHERE id = $1 AND sppd_kegiatan_id = $2",
      [req.params.pid, req.params.id]
    );
    const peserta = pesertaResult.rows[0];
    if (!peserta) return res.status(404).json({ error: "Peserta tidak ditemukan." });

    // Format data untuk cetak
    const tgl = (d: string) =>
      new Date(d + "T00:00:00").toLocaleDateString("id-ID", {
        day: "numeric", month: "long", year: "numeric",
      });

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
    const { writeFile, unlink, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const tmpDir = tmpdir();
    const jsonPath = join(tmpDir, `sppd-${req.params.pid}.json`);
    const pdfPath = join(tmpDir, `sppd-${req.params.pid}.pdf`);
    // Template path: inside backend/templates dir
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

      const pdfBuffer = await readFile(pdfPath);
      await unlink(jsonPath).catch(() => {});
      await unlink(pdfPath).catch(() => {});

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
