// Kegiatan CRUD Routes
import { Router, Request, Response } from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole, getUnitKerjaFilter } from "../middleware/authorize.js";
import type { MataAnggaran } from "../types.js";

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// ============================================================
// VALIDATION HELPERS
// ============================================================

function validateMataAnggaran(items: MataAnggaran[]): string | null {
  if (!Array.isArray(items) || items.length === 0) {
    return "Minimal satu item mata anggaran diperlukan.";
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.nama_item || typeof item.nama_item !== "string" || item.nama_item.trim() === "") {
      return `Item ke-${i + 1}: nama_item wajib diisi.`;
    }
    if (item.jumlah_rp === undefined || item.jumlah_rp === null) {
      return `Item ke-${i + 1}: jumlah_rp wajib diisi.`;
    }
    const rp = Number(item.jumlah_rp);
    if (!Number.isInteger(rp) || rp < 0) {
      return `Item ke-${i + 1}: jumlah_rp harus berupa angka bulat >= 0.`;
    }
  }

  return null; // Valid
}

function validateKegiatanBody(body: any): string | null {
  if (!body.nama_kegiatan || typeof body.nama_kegiatan !== "string" || body.nama_kegiatan.trim() === "") {
    return "nama_kegiatan wajib diisi.";
  }
  if (!body.tanggal) {
    return "tanggal wajib diisi.";
  }
  if (!body.unit_kerja_id || !Number.isInteger(Number(body.unit_kerja_id))) {
    return "unit_kerja_id wajib diisi (angka).";
  }
  if (!body.jenis_kegiatan_id || !Number.isInteger(Number(body.jenis_kegiatan_id))) {
    return "jenis_kegiatan_id wajib diisi (angka).";
  }
  return null;
}

// ============================================================
// GET /api/kegiatan — list (scoped for operator)
// ============================================================

router.get("/", async (req: Request, res: Response) => {
  try {
    const { unitKerjaId } = getUnitKerjaFilter(req);
    const { status } = req.query;

    let query = `
      SELECT k.*, uk.nama_unit AS unit_kerja_nama, jk.nama_jenis AS jenis_kegiatan_nama,
             u.username AS created_by_username,
             COALESCE(SUM(ma.jumlah_rp), 0) AS total_anggaran
      FROM kegiatan k
      JOIN unit_kerja uk ON k.unit_kerja_id = uk.id
      JOIN jenis_kegiatan jk ON k.jenis_kegiatan_id = jk.id
      JOIN users u ON k.created_by = u.id
      LEFT JOIN mata_anggaran ma ON ma.kegiatan_id = k.id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIdx = 1;

    if (unitKerjaId !== null) {
      query += ` AND k.unit_kerja_id = $${paramIdx++}`;
      params.push(unitKerjaId);
    }

    if (status && typeof status === "string") {
      query += ` AND k.status = $${paramIdx++}`;
      params.push(status);
    }

    query += ` GROUP BY k.id, uk.nama_unit, jk.nama_jenis, u.username
               ORDER BY k.tanggal DESC, k.created_at DESC`;

    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  } catch (err: any) {
    console.error("[Kegiatan] List error:", err.message);
    res.status(500).json({ error: "Gagal mengambil data kegiatan." });
  }
});

// ============================================================
// GET /api/kegiatan/:id — detail with mata_anggaran
// ============================================================

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { unitKerjaId } = getUnitKerjaFilter(req);

    let query = `
      SELECT k.*, uk.nama_unit AS unit_kerja_nama, jk.nama_jenis AS jenis_kegiatan_nama,
             u.username AS created_by_username
      FROM kegiatan k
      JOIN unit_kerja uk ON k.unit_kerja_id = uk.id
      JOIN jenis_kegiatan jk ON k.jenis_kegiatan_id = jk.id
      JOIN users u ON k.created_by = u.id
      WHERE k.id = $1
    `;
    const params: any[] = [id];

    if (unitKerjaId !== null) {
      query += ` AND k.unit_kerja_id = $2`;
      params.push(unitKerjaId);
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Kegiatan tidak ditemukan." });
      return;
    }

    const kegiatan = result.rows[0];

    // Fetch mata_anggaran
    const mataResult = await pool.query(
      "SELECT * FROM mata_anggaran WHERE kegiatan_id = $1 ORDER BY id",
      [id]
    );

    res.json({ data: { ...kegiatan, mata_anggaran: mataResult.rows } });
  } catch (err: any) {
    console.error("[Kegiatan] Detail error:", err.message);
    res.status(500).json({ error: "Gagal mengambil detail kegiatan." });
  }
});

// ============================================================
// POST /api/kegiatan — create with nested mata_anggaran
// ============================================================

router.post("/", async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const body = req.body;
    const user = req.user!;

    // For operator, force their own unit_kerja_id
    if (user.role === "operator") {
      body.unit_kerja_id = user.unit_kerja_id;
    }

    // Validate header
    const headerError = validateKegiatanBody(body);
    if (headerError) {
      res.status(400).json({ error: headerError });
      return;
    }

    // Validate mata_anggaran
    const mataError = validateMataAnggaran(body.mata_anggaran);
    if (mataError) {
      res.status(400).json({ error: mataError });
      return;
    }

    await client.query("BEGIN");

    // Insert kegiatan
    const kegiatanResult = await client.query(
      `INSERT INTO kegiatan (unit_kerja_id, jenis_kegiatan_id, created_by, nama_kegiatan, tanggal, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        body.unit_kerja_id,
        body.jenis_kegiatan_id,
        user.userId,
        body.nama_kegiatan.trim(),
        body.tanggal,
        body.status || "draft",
      ]
    );

    const kegiatan = kegiatanResult.rows[0];

    // Insert mata_anggaran items
    const mataItems: MataAnggaran[] = [];
    for (const item of body.mata_anggaran) {
      const mataResult = await client.query(
        `INSERT INTO mata_anggaran (kegiatan_id, nama_item, jumlah_rp, keterangan)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [kegiatan.id, item.nama_item.trim(), Number(item.jumlah_rp), item.keterangan || null]
      );
      mataItems.push(mataResult.rows[0]);
    }

    await client.query("COMMIT");

    res.status(201).json({
      data: { ...kegiatan, mata_anggaran: mataItems },
      message: "Kegiatan berhasil dibuat.",
    });
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("[Kegiatan] Create error:", err.message);
    res.status(500).json({ error: "Gagal membuat kegiatan." });
  } finally {
    client.release();
  }
});

// ============================================================
// PUT /api/kegiatan/:id — update header + sync mata_anggaran
// ============================================================

router.put("/:id", async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const body = req.body;
    const user = req.user!;
    const { unitKerjaId } = getUnitKerjaFilter(req);

    // Check kegiatan exists and is accessible
    let checkQuery = "SELECT * FROM kegiatan WHERE id = $1";
    const checkParams: any[] = [id];
    if (unitKerjaId !== null) {
      checkQuery += " AND unit_kerja_id = $2";
      checkParams.push(unitKerjaId);
    }

    const existing = await client.query(checkQuery, checkParams);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Kegiatan tidak ditemukan atau tidak dapat diakses." });
      return;
    }

    // Block edit if status is "disetujui" (anggaran sudah final)
    const current = existing.rows[0];
    if (current.status === "disetujui") {
      res.status(403).json({ error: "Kegiatan yang sudah disetujui tidak dapat diedit." });
      return;
    }

    // For operator, force their own unit_kerja_id
    if (user.role === "operator") {
      body.unit_kerja_id = user.unit_kerja_id;
    }

    // Validate header
    const headerError = validateKegiatanBody(body);
    if (headerError) {
      res.status(400).json({ error: headerError });
      return;
    }

    // Validate mata_anggaran if provided
    if (body.mata_anggaran) {
      const mataError = validateMataAnggaran(body.mata_anggaran);
      if (mataError) {
        res.status(400).json({ error: mataError });
        return;
      }
    }

    await client.query("BEGIN");

    // Update kegiatan header
    const kegiatanResult = await client.query(
      `UPDATE kegiatan
       SET unit_kerja_id = $1, jenis_kegiatan_id = $2, nama_kegiatan = $3,
           tanggal = $4, status = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [
        body.unit_kerja_id,
        body.jenis_kegiatan_id,
        body.nama_kegiatan.trim(),
        body.tanggal,
        body.status || "draft",
        id,
      ]
    );

    const kegiatan = kegiatanResult.rows[0];

    // Sync mata_anggaran: delete old, insert new
    if (body.mata_anggaran) {
      await client.query("DELETE FROM mata_anggaran WHERE kegiatan_id = $1", [id]);

      const mataItems: MataAnggaran[] = [];
      for (const item of body.mata_anggaran) {
        const mataResult = await client.query(
          `INSERT INTO mata_anggaran (kegiatan_id, nama_item, jumlah_rp, keterangan)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [Number(id), item.nama_item.trim(), Number(item.jumlah_rp), item.keterangan || null]
        );
        mataItems.push(mataResult.rows[0]);
      }

      await client.query("COMMIT");
      res.json({
        data: { ...kegiatan, mata_anggaran: mataItems },
        message: "Kegiatan berhasil diperbarui.",
      });
    } else {
      // No mata_anggaran in request — return existing ones
      await client.query("COMMIT");
      const mataResult = await pool.query(
        "SELECT * FROM mata_anggaran WHERE kegiatan_id = $1 ORDER BY id",
        [id]
      );
      res.json({
        data: { ...kegiatan, mata_anggaran: mataResult.rows },
        message: "Kegiatan berhasil diperbarui.",
      });
    }
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("[Kegiatan] Update error:", err.message);
    res.status(500).json({ error: "Gagal memperbarui kegiatan." });
  } finally {
    client.release();
  }
});

// ============================================================
// DELETE /api/kegiatan/:id
// Admin: can delete any kegiatan
// Operator: can delete only draft kegiatan in their own unit
// ============================================================

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const { unitKerjaId } = getUnitKerjaFilter(req);

    // Fetch kegiatan to check permissions
    let checkQuery = "SELECT * FROM kegiatan WHERE id = $1";
    const checkParams: any[] = [id];

    if (unitKerjaId !== null) {
      checkQuery += " AND unit_kerja_id = $2";
      checkParams.push(unitKerjaId);
    }

    const existing = await pool.query(checkQuery, checkParams);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Kegiatan tidak ditemukan atau tidak dapat diakses." });
      return;
    }

    const kegiatan = existing.rows[0];

    // Operator: only draft can be deleted
    if (user.role === "operator" && kegiatan.status !== "draft") {
      res.status(403).json({
        error: `Tidak dapat menghapus kegiatan dengan status "${kegiatan.status}". Hanya kegiatan draft yang dapat dihapus.`,
      });
      return;
    }

    // Admin: can delete any status
    await pool.query("DELETE FROM kegiatan WHERE id = $1", [id]);

    res.json({ message: "Kegiatan berhasil dihapus." });
  } catch (err: any) {
    console.error("[Kegiatan] Delete error:", err.message);
    res.status(500).json({ error: "Gagal menghapus kegiatan." });
  }
});

// ============================================================
// PATCH /api/kegiatan/:id/status — change status
// ============================================================

router.patch("/:id/status", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { unitKerjaId } = getUnitKerjaFilter(req);

    const validStatuses = ["draft", "diajukan", "disetujui", "ditolak"];
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({
        error: `Status tidak valid. Pilih salah satu: ${validStatuses.join(", ")}.`,
      });
      return;
    }

    // Check accessibility
    let checkQuery = "SELECT * FROM kegiatan WHERE id = $1";
    const checkParams: any[] = [id];
    if (unitKerjaId !== null) {
      checkQuery += " AND unit_kerja_id = $2";
      checkParams.push(unitKerjaId);
    }

    const existing = await pool.query(checkQuery, checkParams);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Kegiatan tidak ditemukan atau tidak dapat diakses." });
      return;
    }

    const currentStatus = existing.rows[0].status;

    // Only admin can approve/reject
    if ((status === "disetujui" || status === "ditolak") && req.user!.role !== "admin") {
      res.status(403).json({ error: "Hanya admin yang dapat menyetujui atau menolak kegiatan." });
      return;
    }

    // Operator: allow ditolak → draft (revisi setelah ditolak)
    if (status === "draft" && currentStatus !== "ditolak" && req.user!.role === "operator") {
      res.status(403).json({
        error: `Tidak dapat mengubah status "${currentStatus}" menjadi "draft".`,
      });
      return;
    }

    // Validate meaningful status transitions
    const validTransitions: Record<string, string[]> = {
      draft: ["diajukan"],
      diajukan: ["disetujui", "ditolak"],
      ditolak: ["draft"],
      disetujui: [],
    };

    const allowed = validTransitions[currentStatus] || [];
    if (!allowed.includes(status) && req.user!.role !== "admin") {
      res.status(400).json({
        error: `Transisi status dari "${currentStatus}" ke "${status}" tidak diizinkan.`,
      });
      return;
    }

    const result = await pool.query(
      `UPDATE kegiatan SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [status, id]
    );

    res.json({
      data: result.rows[0],
      message: `Status kegiatan berhasil diubah menjadi "${status}".`,
    });
  } catch (err: any) {
    console.error("[Kegiatan] Status error:", err.message);
    res.status(500).json({ error: "Gagal mengubah status kegiatan." });
  }
});

export default router;
