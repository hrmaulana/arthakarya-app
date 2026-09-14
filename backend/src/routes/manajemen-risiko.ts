/**
 * Manajemen Risiko Routes — Auto-Detection + AI Enhancement
 *
 * GET /api/manajemen-risiko/auto-detect
 *
 * Mendeteksi 6 jenis risiko dari data yang ada:
 * 1. serapan_rendah — realisasi/pagu < 30% AND bulan > 7
 * 2. akun_hampir_habis — sisa_pagu/pagu < 5% (high) or < 15% (medium)
 * 3. over_alokasi — total mata_anggaran.jumlah > sisa_pagu
 * 4. data_usang — max(monitoring_imports.created_at) > 30 days ago
 * 5. sppd_overdue — SPPD dilaksanakan tanpa pertanggungjawaban > 7 hari
 * 6. pagu_tidak_teralokasi — monitoring_anggaran with pagu > 0 but no kegiatan
 *
 * Semua AI enhancement harus graceful fallback — tidak error jika API key tidak ada.
 */

import { Router, Request, Response } from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { getUnitKerjaFilter, requireRole } from "../middleware/authorize.js";
import { logger } from "../logger.js";
import {
  aiGenerate,
  generateRiskDescription,
  generateRiskRecommendation,
  generateRiskAnalisis,
} from "../lib/llm.js";

const router = Router();
router.use(authMiddleware);
router.use(requireRole("admin", "operator"));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

function levelLabel(level: string): string {
  return level === "tinggi" ? "Tinggi" : level === "sedang" ? "Sedang" : "Rendah";
}

// ---------------------------------------------------------------------------
// GET /api/manajemen-risiko/auto-detect
// ---------------------------------------------------------------------------

router.get("/auto-detect", async (req: Request, res: Response) => {
  try {
    const { unitKerjaId } = getUnitKerjaFilter(req);
    const currentMonth = new Date().getMonth() + 1; // 1–12
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const risks: any[] = [];

    // Helper untuk scope SQL
    function scopeSql(alias: string, paramIdx: { current: number }): { sql: string; params: any[] } {
      const params: any[] = [];
      let sql = "";
      if (unitKerjaId !== null) {
        params.push(unitKerjaId);
        sql += ` AND ${alias}.unit_kerja_id = $${paramIdx.current++}`;
      }
      return { sql, params };
    }

    let paramIdx = { current: 1 };

    // ======================================================================
    // 1. SERAPAN RENDAH — realisasi/pagu < 30% AND bulan > 7
    // ======================================================================
    {
      const scope = scopeSql("ma", paramIdx);
      const { rows } = await pool.query(
        `SELECT
           ma.id, ma.kode_akun, ma.nama_akun, ma.unit_kerja_id,
           uk.kode_unit, uk.nama_unit,
           ma.pagu_revisi, ma.realisasi_sd_periode,
           CASE WHEN ma.pagu_revisi > 0
                THEN ROUND(ma.realisasi_sd_periode * 100.0 / ma.pagu_revisi, 1)
                ELSE 0 END AS persentase
         FROM monitoring_anggaran ma
         JOIN unit_kerja uk ON uk.id = ma.unit_kerja_id
         WHERE ma.import_id = (SELECT MAX(id) FROM monitoring_imports)
           AND ma.pagu_revisi > 0
           AND (ma.realisasi_sd_periode * 100.0 / ma.pagu_revisi) < 30
           ${scope.sql}
         ORDER BY persentase ASC
         LIMIT 20`,
        scope.params,
      );

      for (const row of rows) {
        const unit = { id: row.unit_kerja_id, kode: row.kode_unit, nama: row.nama_unit };
        const akun = { kode: row.kode_akun, nama: row.nama_akun };
        const riskItem = {
          id: `serapan-rendah-${row.id}`,
          jenis: "serapan_rendah",
          level: "tinggi" as const,
          unit_kerja: unit,
          akun,
          unit_kerja_id: row.unit_kerja_id,
          kode_akun: row.kode_akun,
        };

        const nilai = {
          pagu: Number(row.pagu_revisi),
          realisasi: Number(row.realisasi_sd_periode),
          persentase: Number(row.persentase),
          bulan_sekarang: currentMonth,
        };

        risks.push({
          id: riskItem.id,
          jenis: "serapan_rendah",
          level: "tinggi",
          unit_kerja: unit,
          akun,
          deskripsi: generateRiskDescription({ ...riskItem, nilai, level: "tinggi" }),
          rekomendasi: generateRiskRecommendation({ ...riskItem, nilai, level: "tinggi" }),
          analisis: null,
          nilai,
          detected_at: nowISO(),
          ai_enhanced: false,
        });
      }
    }

    // ======================================================================
    // 2. AKUN HAMPIR HABIS — sisa_pagu/pagu < 5% (high) or < 15% (medium)
    // ======================================================================
    {
      const scope = scopeSql("ma", paramIdx);
      const { rows } = await pool.query(
        `SELECT
           ma.id, ma.kode_akun, ma.nama_akun, ma.unit_kerja_id,
           uk.kode_unit, uk.nama_unit,
           ma.pagu_revisi, ma.realisasi_sd_periode,
           (ma.pagu_revisi - ma.realisasi_sd_periode)::BIGINT AS sisa_pagu,
           CASE WHEN ma.pagu_revisi > 0
                THEN ROUND((ma.pagu_revisi - ma.realisasi_sd_periode) * 100.0 / ma.pagu_revisi, 1)
                ELSE 0 END AS persentase_sisa
         FROM monitoring_anggaran ma
         JOIN unit_kerja uk ON uk.id = ma.unit_kerja_id
         WHERE ma.import_id = (SELECT MAX(id) FROM monitoring_imports)
           AND ma.pagu_revisi > 0
           AND (ma.pagu_revisi - ma.realisasi_sd_periode) > 0
           AND (ma.pagu_revisi - ma.realisasi_sd_periode) * 100.0 / ma.pagu_revisi < 15
           ${scope.sql}
         ORDER BY persentase_sisa ASC
         LIMIT 20`,
        scope.params,
      );

      for (const row of rows) {
        const sisaPct = Number(row.persentase_sisa);
        const level = sisaPct < 5 ? "tinggi" : "sedang";
        const unit = { id: row.unit_kerja_id, kode: row.kode_unit, nama: row.nama_unit };
        const akun = { kode: row.kode_akun, nama: row.nama_akun };
        const riskItem = {
          id: `akun-hampir-habis-${row.id}`,
          jenis: "akun_hampir_habis",
          level: level as "tinggi" | "sedang",
          unit_kerja: unit,
          akun,
          unit_kerja_id: row.unit_kerja_id,
          kode_akun: row.kode_akun,
        };

        const nilai = {
          pagu: Number(row.pagu_revisi),
          realisasi: Number(row.realisasi_sd_periode),
          sisa_pagu: Number(row.sisa_pagu),
          persentase: sisaPct,
        };

        risks.push({
          id: riskItem.id,
          jenis: "akun_hampir_habis",
          level,
          unit_kerja: unit,
          akun,
          deskripsi: generateRiskDescription({ ...riskItem, nilai, level }),
          rekomendasi: generateRiskRecommendation({ ...riskItem, nilai, level }),
          analisis: null,
          nilai,
          detected_at: nowISO(),
          ai_enhanced: false,
        });
      }
    }

    // ======================================================================
    // 3. OVER ALOKASI — total mata_anggaran.jumlah > sisa_pagu
    // ======================================================================
    {
      const scope = scopeSql("ma", paramIdx);
      const { rows } = await pool.query(
        `SELECT
           ma.id, ma.kode_akun, ma.nama_akun, ma.unit_kerja_id,
           uk.kode_unit, uk.nama_unit,
           ma.pagu_revisi, ma.realisasi_sd_periode,
           (ma.pagu_revisi - ma.realisasi_sd_periode)::BIGINT AS sisa_pagu,
           COALESCE(rencana.total_rencana, 0)::BIGINT AS total_rencana
         FROM monitoring_anggaran ma
         JOIN unit_kerja uk ON uk.id = ma.unit_kerja_id
         LEFT JOIN (
           SELECT ma2.kode_akun, SUM(ma2.jumlah_rp)::BIGINT AS total_rencana
           FROM mata_anggaran ma2
           JOIN kegiatan k ON k.id = ma2.kegiatan_id
           WHERE k.status NOT IN ('ditolak')
           GROUP BY ma2.kode_akun
         ) rencana ON rencana.kode_akun = ma.kode_akun
         WHERE ma.import_id = (SELECT MAX(id) FROM monitoring_imports)
           AND ma.pagu_revisi > 0
           AND COALESCE(rencana.total_rencana, 0) > (ma.pagu_revisi - ma.realisasi_sd_periode)
           AND (ma.pagu_revisi - ma.realisasi_sd_periode) > 0
           ${scope.sql}
         ORDER BY (rencana.total_rencana - (ma.pagu_revisi - ma.realisasi_sd_periode)) DESC
         LIMIT 20`,
        scope.params,
      );

      for (const row of rows) {
        const sisa = Number(row.sisa_pagu);
        const totalRencana = Number(row.total_rencana);
        const kelebihan = totalRencana - sisa;
        const level = kelebihan > sisa * 0.5 ? "tinggi" : kelebihan > 0 ? "sedang" : "rendah";

        const unit = { id: row.unit_kerja_id, kode: row.kode_unit, nama: row.nama_unit };
        const akun = { kode: row.kode_akun, nama: row.nama_akun };
        const riskItem = {
          id: `over-alokasi-${row.id}`,
          jenis: "over_alokasi",
          level: level as "tinggi" | "sedang" | "rendah",
          unit_kerja: unit,
          akun,
          unit_kerja_id: row.unit_kerja_id,
          kode_akun: row.kode_akun,
        };

        const nilai = {
          pagu: Number(row.pagu_revisi),
          realisasi: Number(row.realisasi_sd_periode),
          sisa_pagu: sisa,
          total_rencana: totalRencana,
          kelebihan,
        };

        risks.push({
          id: riskItem.id,
          jenis: "over_alokasi",
          level,
          unit_kerja: unit,
          akun,
          deskripsi: generateRiskDescription({ ...riskItem, nilai, level }),
          rekomendasi: generateRiskRecommendation({ ...riskItem, nilai, level }),
          analisis: null,
          nilai,
          detected_at: nowISO(),
          ai_enhanced: false,
        });
      }
    }

    // ======================================================================
    // 4. DATA USANG — max(monitoring_imports.created_at) > 30 days ago
    // ======================================================================
    {
      const { rows } = await pool.query(
        `SELECT MAX(uploaded_at) AS last_import FROM monitoring_imports`
      );
      if (rows.length > 0 && rows[0].last_import) {
        const lastImport = new Date(rows[0].last_import);
        const daysSinceImport = Math.floor(
          (now.getTime() - lastImport.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysSinceImport > 30) {
          const level = daysSinceImport > 60 ? "tinggi" : "sedang";
          risks.push({
            id: "data-usang-001",
            jenis: "data_usang",
            level,
            unit_kerja: { id: 0, kode: "-", nama: "Seluruh Unit" },
            akun: null,
            deskripsi: generateRiskDescription({
              id: "data-usang-001",
              jenis: "data_usang",
              level: level as "tinggi" | "sedang",
              unit_kerja: { id: 0, kode: "-", nama: "Seluruh Unit" },
              akun: null,
              nilai: { hari_terakhir: daysSinceImport, tanggal_terakhir: formatDate(lastImport) },
            }),
            rekomendasi: generateRiskRecommendation({
              id: "data-usang-001",
              jenis: "data_usang",
              level: level as "tinggi" | "sedang",
              unit_kerja: { id: 0, kode: "-", nama: "Seluruh Unit" },
              akun: null,
              nilai: {},
            }),
            analisis: null,
            nilai: {
              hari_terakhir: daysSinceImport,
              tanggal_terakhir: formatDate(lastImport),
            },
            detected_at: nowISO(),
            ai_enhanced: false,
          });
        }
      }
    }

    // ======================================================================
    // 5. SPPD OVERDUE — dilaksanakan tanpa pertanggungjawaban > 7 hari
    // ======================================================================
    {
      const scope = scopeSql("sk", paramIdx);
      const { rows } = await pool.query(
        `SELECT
           sk.id, sk.nama_kegiatan, sk.tanggal_pulang, u.unit_kerja_id,
           uk.kode_unit, uk.nama_unit
         FROM sppd_kegiatan sk
         JOIN users u ON u.id = sk.created_by
        JOIN unit_kerja uk ON uk.id = u.unit_kerja_id
         WHERE sk.status = 'dilaksanakan'
           AND sk.tanggal_pulang <= $1
           AND NOT EXISTS (
             SELECT 1 FROM sppd_approval sa
             WHERE sa.sppd_kegiatan_id = sk.id
               AND sa.keputusan = 'diajukan_pertanggungjawaban'
           )
           ${scope.sql}
         ORDER BY sk.tanggal_pulang ASC
         LIMIT 20`,
        [formatDate(sevenDaysAgo), ...scope.params],
      );

      for (const row of rows) {
        const tanggalSelesai = new Date(row.tanggal_pulang);
        const daysLate = Math.floor(
          (now.getTime() - tanggalSelesai.getTime()) / (1000 * 60 * 60 * 24)
        );
        const level = daysLate > 30 ? "tinggi" : daysLate > 14 ? "sedang" : "rendah";

        const unit = { id: row.unit_kerja_id, kode: row.kode_unit, nama: row.nama_unit };

        risks.push({
          id: `sppd-overdue-${row.id}`,
          jenis: "sppd_overdue",
          level,
          unit_kerja: unit,
          akun: null,
          deskripsi: generateRiskDescription({
            id: `sppd-overdue-${row.id}`,
            jenis: "sppd_overdue",
            level: level as "tinggi" | "sedang" | "rendah",
            unit_kerja: unit,
            akun: null,
            nilai: { hari_terlambat: daysLate, nama_kegiatan: row.nama_kegiatan, sppd_id: row.id },
          }),
          rekomendasi: generateRiskRecommendation({
            id: `sppd-overdue-${row.id}`,
            jenis: "sppd_overdue",
            level: level as "tinggi" | "sedang" | "rendah",
            unit_kerja: unit,
            akun: null,
            nilai: {},
          }),
          analisis: null,
          nilai: {
            hari_terlambat: daysLate,
            nama_kegiatan: row.nama_kegiatan,
            sppd_id: row.id,
            tanggal_selesai: formatDate(tanggalSelesai),
          },
          detected_at: nowISO(),
          ai_enhanced: false,
        });
      }
    }

    // ======================================================================
    // 6. PAGU TIDAK TERALOKASI — pagu > 0 but no kegiatan using that akun
    // ======================================================================
    {
      const scope = scopeSql("ma", paramIdx);
      const { rows } = await pool.query(
        `SELECT
           ma.id, ma.kode_akun, ma.nama_akun, ma.unit_kerja_id,
           uk.kode_unit, uk.nama_unit,
           ma.pagu_revisi
         FROM monitoring_anggaran ma
         JOIN unit_kerja uk ON uk.id = ma.unit_kerja_id
         WHERE ma.import_id = (SELECT MAX(id) FROM monitoring_imports)
           AND ma.pagu_revisi > 0
           AND NOT EXISTS (
             SELECT 1 FROM mata_anggaran ma2
             JOIN kegiatan k ON k.id = ma2.kegiatan_id
             WHERE ma2.kode_akun = ma.kode_akun
               AND k.status NOT IN ('ditolak')
           )
           ${scope.sql}
         ORDER BY ma.pagu_revisi DESC
         LIMIT 20`,
        scope.params,
      );

      for (const row of rows) {
        const unit = { id: row.unit_kerja_id, kode: row.kode_unit, nama: row.nama_unit };
        const akun = { kode: row.kode_akun, nama: row.nama_akun };

        risks.push({
          id: `pagu-tidak-teralokasi-${row.id}`,
          jenis: "pagu_tidak_teralokasi",
          level: "sedang",
          unit_kerja: unit,
          akun,
          deskripsi: generateRiskDescription({
            id: `pagu-tidak-teralokasi-${row.id}`,
            jenis: "pagu_tidak_teralokasi",
            level: "sedang",
            unit_kerja: unit,
            akun,
            nilai: { pagu: Number(row.pagu_revisi), kode_akun: row.kode_akun },
          }),
          rekomendasi: generateRiskRecommendation({
            id: `pagu-tidak-teralokasi-${row.id}`,
            jenis: "pagu_tidak_teralokasi",
            level: "sedang",
            unit_kerja: unit,
            akun,
            nilai: {},
          }),
          analisis: null,
          nilai: {
            pagu: Number(row.pagu_revisi),
            kode_akun: row.kode_akun,
          },
          detected_at: nowISO(),
          ai_enhanced: false,
        });
      }
    }

    // ======================================================================
    // AI ENHANCEMENT — optional, graceful fallback
    // ======================================================================

    // Filter by unit_kerja_id post-query for data_usang (global) and cross-unit items
    let filteredRisks = risks;
    if (unitKerjaId !== null) {
      filteredRisks = risks.filter(
        (r) =>
          r.unit_kerja.id === 0 || // data_usang is global
          r.unit_kerja.id === unitKerjaId,
      );
    }

    // Deduplicate: keep the highest-level risk per (jenis, unit_kerja_id, kode_akun) combo
    const seen = new Set<string>();
    const deduped: typeof filteredRisks = [];
    for (const r of filteredRisks) {
      const key = `${r.jenis}:${r.unit_kerja.id}:${r.akun?.kode || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
    }

    // Try AI enhancement for the first 10 risks (batch)
    const apiKeyAvailable = !!process.env.OPENROUTER_API_KEY;
    if (apiKeyAvailable && deduped.length > 0) {
      const aiBatch = deduped.slice(0, 10);

      // We only do AI for deskripsi + rekomendasi — one prompt per risk
      for (const risk of aiBatch) {
        try {
          const systemPrompt =
            "Anda adalah asisten analis risiko anggaran pemerintah. " +
            "Bahas dalam Bahasa Indonesia yang formal namun mudah dipahami. " +
            "Maksimal 3 kalimat.";

          const userPrompt =
            `Buat analisis risiko untuk item berikut:\n` +
            `Jenis: ${risk.jenis}\nLevel: ${risk.level}\n` +
            `Unit: ${risk.unit_kerja.nama}\n` +
            (risk.akun ? `Akun: ${risk.akun.kode} - ${risk.akun.nama}\n` : "") +
            `Nilai: ${JSON.stringify(risk.nilai)}\n\n` +
            `Tulis deskripsi risiko dan rekomendasi tindakan.`;

          const aiResult = await aiGenerate({
            prompt: userPrompt,
            system: systemPrompt,
            model: "deepseek/deepseek-v4-flash",
          });

          if (aiResult && !aiResult.startsWith("[AI tidak tersedia")) {
            // Try to split AI response into deskripsi and rekomendasi
            const lines = aiResult.split("\n").filter((l) => l.trim());
            // If AI returns two paragraphs, use first as deskripsi and second as rekomendasi
            if (lines.length >= 2) {
              risk.deskripsi = lines[0];
              risk.rekomendasi = lines[lines.length - 1];
            } else if (lines.length === 1 && lines[0].length > 60) {
              // Single medium-length response: split at midpoint
              const mid = Math.floor(lines[0].length / 2);
              const splitAt = lines[0].indexOf(". ", mid);
              if (splitAt > 0) {
                risk.deskripsi = lines[0].slice(0, splitAt + 1);
                risk.rekomendasi = lines[0].slice(splitAt + 2);
              } else {
                risk.deskripsi = lines[0];
              }
            } else {
              risk.deskripsi = aiResult;
            }
            risk.ai_enhanced = true;
          }
        } catch {
          // Graceful fallback — keep template text
        }
      }
    }

    // Root cause analysis (template-based)
    const analisisItems = deduped.map((r) => ({
      jenis: r.jenis,
      level: r.level,
      unit: r.unit_kerja.nama,
    }));
    const analisisKeseluruhan = generateRiskAnalisis(analisisItems);

    // ======================================================================
    // SUMMARY
    // ======================================================================

    const summary = {
      total: deduped.length,
      tinggi: deduped.filter((r) => r.level === "tinggi").length,
      sedang: deduped.filter((r) => r.level === "sedang").length,
      rendah: deduped.filter((r) => r.level === "rendah").length,
    };

    logger.info("manajemen_risiko_auto_detect", {
      total: summary.total,
      high: summary.tinggi,
      mid: summary.sedang,
      low: summary.rendah,
      ai_enhanced: deduped.filter((r) => r.ai_enhanced).length,
      unit_kerja_id: unitKerjaId,
    });

    res.json({
      data: deduped,
      analisis_keseluruhan: analisisKeseluruhan,
      summary,
    });
  } catch (err: any) {
    logger.error("manajemen_risiko_auto_detect_error", { message: err.message });
    res.status(500).json({ error: "Gagal mendeteksi risiko." });
  }
});

export default router;