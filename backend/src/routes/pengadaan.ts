// Pengadaan Routes — Rencana Pengadaan Barang/Jasa
// CRUD + status workflow + auto-create dari risiko pagu tidak teralokasi
import { Router, Request, Response } from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { getUnitKerjaFilter, requireRole } from "../middleware/authorize.js";
import { logger } from "../logger.js";

const router = Router();
router.use(authMiddleware);
router.use(requireRole("admin", "operator"));

// ============================================================
// HELPERS
// ============================================================

function isAdmin(req: Request): boolean {
  return req.user?.role === "admin";
}

async function getPengadaanOr404(id: string) {
  const result = await pool.query("SELECT * FROM pengadaan WHERE id = $1", [id]);
  return result.rows[0] ?? null;
}

/**
 * Validasi sisa pagu untuk kode_akun tertentu.
 * Mengembalikan { cukup: boolean, sisa_pagu: number }.
 */
async function checkSisaPagu(kode_akun: string, estimasi: number, unit_kerja_id: number): Promise<{ cukup: boolean; sisa_pagu: number }> {
  if (!kode_akun) return { cukup: true, sisa_pagu: Infinity };

  const result = await pool.query(
    `SELECT (pagu_revisi - realisasi_sd_periode)::BIGINT AS sisa_pagu
     FROM monitoring_anggaran
     WHERE kode_akun = $1
       AND unit_kerja_id = $2
       AND import_id = (SELECT MAX(id) FROM monitoring_imports)
     LIMIT 1`,
    [kode_akun, unit_kerja_id]
  );

  if (result.rows.length === 0) return { cukup: true, sisa_pagu: Infinity };

  const sisa_pagu = Number(result.rows[0].sisa_pagu);
  return { cukup: estimasi <= sisa_pagu, sisa_pagu };
}

// ============================================================
// GET /api/pengadaan — list
// ============================================================

router.get("/", async (req: Request, res: Response) => {
  try {
    const { status, kegiatan_id } = req.query;
    const { unitKerjaId } = getUnitKerjaFilter(req);

    let query = `
      SELECT p.*,
             k.nama_kegiatan,
             uk.nama_unit,
             u.username AS created_by_username
      FROM pengadaan p
      LEFT JOIN kegiatan k ON k.id = p.kegiatan_id
      LEFT JOIN unit_kerja uk ON uk.id = p.unit_kerja_id
      LEFT JOIN users u ON u.id = p.created_by
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIdx = 1;

    if (unitKerjaId !== null) {
      query += ` AND p.unit_kerja_id = $${paramIdx++}`;
      params.push(unitKerjaId);
    }

    if (status && typeof status === "string") {
      query += ` AND p.status = $${paramIdx++}`;
      params.push(status);
    }

    if (kegiatan_id && typeof kegiatan_id === "string") {
      query += ` AND p.kegiatan_id = $${paramIdx++}`;
      params.push(Number(kegiatan_id));
    }

    query += " ORDER BY p.created_at DESC";
    const result = await pool.query(query, params);

    // Hitung per_status
    const perStatus: Record<string, number> = { rencana: 0, proses_lelang: 0, kontrak: 0, selesai: 0 };
    for (const row of result.rows) {
      const s = row.status;
      perStatus[s] = (perStatus[s] || 0) + 1;
    }

    // Tambah sisa_pagu dari monitoring_anggaran
    const data = await Promise.all(
      result.rows.map(async (row: any) => {
        let sisa_pagu: number | null = null;
        if (row.kode_akun) {
          const paguResult = await pool.query(
            `SELECT (pagu_revisi - realisasi_sd_periode)::BIGINT AS sisa_pagu
             FROM monitoring_anggaran
             WHERE kode_akun = $1 AND unit_kerja_id = $2
               AND import_id = (SELECT MAX(id) FROM monitoring_imports)
             LIMIT 1`,
            [row.kode_akun, row.unit_kerja_id]
          );
          if (paguResult.rows.length > 0) {
            sisa_pagu = Number(paguResult.rows[0].sisa_pagu);
          }
        }
        return { ...row, sisa_pagu };
      })
    );

    res.json({
      data,
      meta: {
        total: result.rows.length,
        per_status: perStatus,
      },
    });
  } catch (err: any) {
    logger.error("pengadaan_list_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil data pengadaan." });
  }
});

// ============================================================
// GET /api/pengadaan/:id — detail
// ============================================================

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const row = await getPengadaanOr404(req.params.id);
    if (!row) return res.status(404).json({ error: "Pengadaan tidak ditemukan." });

    if (!isAdmin(req) && row.created_by !== req.user!.userId) {
      return res.status(403).json({ error: "Anda tidak memiliki akses." });
    }

    // Ambil nama_kegiatan & nama_unit
    const detailResult = await pool.query(
      `SELECT p.*,
              k.nama_kegiatan,
              uk.nama_unit,
              u.username AS created_by_username
       FROM pengadaan p
       LEFT JOIN kegiatan k ON k.id = p.kegiatan_id
       LEFT JOIN unit_kerja uk ON uk.id = p.unit_kerja_id
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.id = $1`,
      [req.params.id]
    );

    const detail = detailResult.rows[0];

    // Sisa pagu
    let sisa_pagu: number | null = null;
    if (detail.kode_akun) {
      const paguResult = await pool.query(
        `SELECT (pagu_revisi - realisasi_sd_periode)::BIGINT AS sisa_pagu
         FROM monitoring_anggaran
         WHERE kode_akun = $1 AND unit_kerja_id = $2
           AND import_id = (SELECT MAX(id) FROM monitoring_imports)
         LIMIT 1`,
        [detail.kode_akun, detail.unit_kerja_id]
      );
      if (paguResult.rows.length > 0) {
        sisa_pagu = Number(paguResult.rows[0].sisa_pagu);
      }
    }

    res.json({ data: { ...detail, sisa_pagu } });
  } catch (err: any) {
    logger.error("pengadaan_detail_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengambil detail pengadaan." });
  }
});

// ============================================================
// POST /api/pengadaan — create
// ============================================================

router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      kegiatan_id, nama_pengadaan, jenis, jumlah, satuan,
      estimasi_biaya, kode_akun, tanggal_mulai, tanggal_selesai,
    } = req.body;

    // Validasi field wajib
    if (!nama_pengadaan || typeof nama_pengadaan !== "string" || nama_pengadaan.trim().length === 0) {
      return res.status(400).json({ error: "Nama pengadaan wajib diisi." });
    }
    if (nama_pengadaan.length > 500) {
      return res.status(400).json({ error: "Nama pengadaan maksimal 500 karakter." });
    }
    if (estimasi_biaya === undefined || estimasi_biaya === null || Number(estimasi_biaya) <= 0) {
      return res.status(400).json({ error: "Estimasi biaya harus berupa angka positif." });
    }

    const estimasi = Number(estimasi_biaya);
    const userId = req.user!.userId;
    const unit_kerja_id = req.user!.unit_kerja_id;

    // Jika admin dan body menyertakan unit_kerja_id, gunakan itu
    const effectiveUnitKerjaId = isAdmin(req) && req.body.unit_kerja_id
      ? Number(req.body.unit_kerja_id)
      : unit_kerja_id;

    // Validasi kegiatan exists (jika diberikan)
    if (kegiatan_id) {
      const keg = await pool.query("SELECT id FROM kegiatan WHERE id = $1", [kegiatan_id]);
      if (keg.rows.length === 0) {
        return res.status(400).json({ error: "Kegiatan tidak ditemukan." });
      }
    }

    // Validasi sisa pagu cukup
    if (kode_akun) {
      const { cukup, sisa_pagu } = await checkSisaPagu(kode_akun, estimasi, effectiveUnitKerjaId);
      if (!cukup) {
        return res.status(400).json({
          error: `Estimasi biaya melebihi sisa pagu. Sisa pagu: Rp ${sisa_pagu.toLocaleString("id-ID")}`,
        });
      }
    }

    // Riwayat status awal
    const riwayat_status = JSON.stringify([
      { status: "rencana", tgl: new Date().toISOString(), oleh: req.user!.username },
    ]);

    const result = await pool.query(
      `INSERT INTO pengadaan
       (kegiatan_id, unit_kerja_id, kode_akun, nama_pengadaan, jenis, jumlah, satuan,
        estimasi_biaya, riwayat_status, status, tanggal_mulai, tanggal_selesai, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        kegiatan_id || null,
        effectiveUnitKerjaId,
        kode_akun || null,
        nama_pengadaan.trim(),
        jenis || "barang",
        jumlah ?? 1,
        satuan || null,
        estimasi,
        riwayat_status,
        "rencana",
        tanggal_mulai || null,
        tanggal_selesai || null,
        userId,
      ]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error("pengadaan_create_error", { message: err.message });
    res.status(500).json({ error: "Gagal membuat pengadaan." });
  }
});

// ============================================================
// PUT /api/pengadaan/:id — update (owner or admin only)
// ============================================================

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const row = await getPengadaanOr404(req.params.id);
    if (!row) return res.status(404).json({ error: "Pengadaan tidak ditemukan." });

    if (row.created_by !== req.user!.userId && !isAdmin(req)) {
      return res.status(403).json({ error: "Anda tidak memiliki akses." });
    }

    if (row.status === "selesai") {
      return res.status(400).json({ error: "Pengadaan selesai tidak bisa diedit." });
    }

    const {
      kegiatan_id, nama_pengadaan, jenis, jumlah, satuan,
      estimasi_biaya, kode_akun, tanggal_mulai, tanggal_selesai,
    } = req.body;

    // Validasi field wajib
    if (nama_pengadaan !== undefined && (typeof nama_pengadaan !== "string" || nama_pengadaan.trim().length === 0)) {
      return res.status(400).json({ error: "Nama pengadaan tidak boleh kosong." });
    }

    const estimasi = estimasi_biaya !== undefined ? Number(estimasi_biaya) : row.estimasi_biaya;
    const effectiveKodeAkun = kode_akun !== undefined ? kode_akun : row.kode_akun;
    const effectiveUnitKerjaId = row.unit_kerja_id;

    // Validasi sisa pagu
    if (effectiveKodeAkun && estimasi) {
      const { cukup, sisa_pagu } = await checkSisaPagu(effectiveKodeAkun, estimasi, effectiveUnitKerjaId);
      if (!cukup) {
        return res.status(400).json({
          error: `Estimasi biaya melebihi sisa pagu. Sisa pagu: Rp ${sisa_pagu.toLocaleString("id-ID")}`,
        });
      }
    }

    // Validasi kegiatan exists
    const effKegiatanId = kegiatan_id !== undefined ? kegiatan_id : row.kegiatan_id;
    if (effKegiatanId) {
      const keg = await pool.query("SELECT id FROM kegiatan WHERE id = $1", [effKegiatanId]);
      if (keg.rows.length === 0) {
        return res.status(400).json({ error: "Kegiatan tidak ditemukan." });
      }
    }

    const result = await pool.query(
      `UPDATE pengadaan SET
        kegiatan_id = $1,
        kode_akun = $2,
        nama_pengadaan = $3,
        jenis = $4,
        jumlah = $5,
        satuan = $6,
        estimasi_biaya = $7,
        tanggal_mulai = $8,
        tanggal_selesai = $9,
        updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        effKegiatanId || null,
        effectiveKodeAkun || null,
        nama_pengadaan !== undefined ? nama_pengadaan.trim() : row.nama_pengadaan,
        jenis !== undefined ? jenis : row.jenis,
        jumlah !== undefined ? jumlah : row.jumlah,
        satuan !== undefined ? satuan : row.satuan,
        estimasi,
        tanggal_mulai !== undefined ? tanggal_mulai : row.tanggal_mulai,
        tanggal_selesai !== undefined ? tanggal_selesai : row.tanggal_selesai,
        req.params.id,
      ]
    );

    res.json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error("pengadaan_update_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengupdate pengadaan." });
  }
});

// ============================================================
// DELETE /api/pengadaan/:id — delete (owner or admin only)
// ============================================================

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const row = await getPengadaanOr404(req.params.id);
    if (!row) return res.status(404).json({ error: "Pengadaan tidak ditemukan." });

    if (row.created_by !== req.user!.userId && !isAdmin(req)) {
      return res.status(403).json({ error: "Anda tidak memiliki akses." });
    }

    if (row.status === "selesai") {
      return res.status(400).json({ error: "Pengadaan selesai tidak bisa dihapus." });
    }

    await pool.query("DELETE FROM pengadaan WHERE id = $1", [req.params.id]);
    res.json({ message: "Pengadaan berhasil dihapus." });
  } catch (err: any) {
    logger.error("pengadaan_delete_error", { message: err.message });
    res.status(500).json({ error: "Gagal menghapus pengadaan." });
  }
});

// ============================================================
// PATCH /api/pengadaan/:id/status — change status dengan logging
// ============================================================

router.patch("/:id/status", async (req: Request, res: Response) => {
  try {
    const { status: newStatus } = req.body;

    const validStatuses = ["rencana", "proses_lelang", "kontrak", "selesai"];
    if (!newStatus || !validStatuses.includes(newStatus)) {
      return res.status(400).json({
        error: `Status tidak valid. Pilihan: ${validStatuses.join(", ")}`,
      });
    }

    const row = await getPengadaanOr404(req.params.id);
    if (!row) return res.status(404).json({ error: "Pengadaan tidak ditemukan." });

    if (row.created_by !== req.user!.userId && !isAdmin(req)) {
      return res.status(403).json({ error: "Anda tidak memiliki akses." });
    }

    // Valid transisi: rencana → proses_lelang → kontrak → selesai (no skipping)
    const statusOrder = ["rencana", "proses_lelang", "kontrak", "selesai"];
    const currentIdx = statusOrder.indexOf(row.status);
    const newIdx = statusOrder.indexOf(newStatus);

    if (newIdx !== currentIdx + 1) {
      return res.status(400).json({
        error: `Transisi status tidak valid. Dari "${row.status}" hanya bisa ke "${statusOrder[currentIdx + 1] || '-'}".`,
      });
    }

    // Log ke riwayat_status
    const riwayatBaru = {
      status: newStatus,
      tgl: new Date().toISOString(),
      oleh: req.user!.username,
    };

    const riwayatLama = Array.isArray(row.riwayat_status) ? row.riwayat_status : [];
    const riwayatUpdate = [...riwayatLama, riwayatBaru];

    const result = await pool.query(
      `UPDATE pengadaan SET
        status = $1,
        riwayat_status = $2::jsonb,
        updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [newStatus, JSON.stringify(riwayatUpdate), req.params.id]
    );

    res.json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error("pengadaan_status_error", { message: err.message });
    res.status(500).json({ error: "Gagal mengubah status pengadaan." });
  }
});

// ============================================================
// POST /api/pengadaan/buat-dari-risiko — auto-create from risk item
// ============================================================

router.post("/buat-dari-risiko", async (req: Request, res: Response) => {
  try {
    const { kode_akun, unit_kerja_id, estimasi_biaya, kegiatan_id, tanggal_mulai, tanggal_selesai } = req.body;

    if (!kode_akun) {
      return res.status(400).json({ error: "kode_akun wajib diisi." });
    }

    // Ambil nama akun dari monitoring_anggaran
    const akunResult = await pool.query(
      `SELECT nama_akun FROM monitoring_anggaran
       WHERE kode_akun = $1 AND unit_kerja_id = $2
         AND import_id = (SELECT MAX(id) FROM monitoring_imports)
       LIMIT 1`,
      [kode_akun, unit_kerja_id]
    );

    const namaAkun = akunResult.rows.length > 0 ? akunResult.rows[0].nama_akun : kode_akun;
    const tahun = new Date().getFullYear();
    const namaPengadaan = `${namaAkun} - ${tahun}`;

    // Hitung estimasi dari sisa pagu jika tidak disediakan
    let estimasi = estimasi_biaya;
    if (!estimasi) {
      const paguResult = await pool.query(
        `SELECT (pagu_revisi - realisasi_sd_periode)::BIGINT AS sisa_pagu
         FROM monitoring_anggaran
         WHERE kode_akun = $1 AND unit_kerja_id = $2
           AND import_id = (SELECT MAX(id) FROM monitoring_imports)
         LIMIT 1`,
        [kode_akun, unit_kerja_id]
      );
      estimasi = paguResult.rows.length > 0 ? Number(paguResult.rows[0].sisa_pagu) : 0;
    }

    if (estimasi <= 0) {
      return res.status(400).json({ error: "Estimasi biaya harus positif. Tidak ada sisa pagu untuk akun ini." });
    }

    const userId = req.user!.userId;

    const result = await pool.query(
      `INSERT INTO pengadaan
       (kegiatan_id, unit_kerja_id, kode_akun, nama_pengadaan, jenis, jumlah, satuan,
        estimasi_biaya, riwayat_status, status, tanggal_mulai, tanggal_selesai, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        kegiatan_id || null,
        unit_kerja_id,
        kode_akun,
        namaPengadaan,
        "barang",
        1,
        null,
        estimasi,
        JSON.stringify([{ status: "rencana", tgl: new Date().toISOString(), oleh: req.user!.username }]),
        "rencana",
        tanggal_mulai || null,
        tanggal_selesai || null,
        userId,
      ]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error("pengadaan_create_from_risk_error", { message: err.message });
    res.status(500).json({ error: "Gagal membuat pengadaan dari risiko." });
  }
});

export default router;