/**
 * Risk Summary Cron — generate weekly risk briefing
 *
 * Task: Detect risks (same logic as auto-detect) and log a markdown briefing.
 * Designed to be called by an external cron job (crontab, systemd timer, etc.).
 *
 * Usage: bun run backend/src/cron/risk-summary.ts
 *
 * Cron schedule example (weekly, Monday 08:00 WIB):
 *   0 1 * * 1 cd /home/hrmaulana/arthakarya && bun run backend/src/cron/risk-summary.ts >> risk-summary.log 2>&1
 */

import pool from "../db.js";
import { logger } from "../logger.js";
import {
  generateRiskDescription,
  generateRiskRecommendation,
  generateRiskAnalisis,
} from "../lib/llm.js";

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

async function main() {
  logger.info("risk_summary_cron_start");

  try {
    const currentMonth = new Date().getMonth() + 1;
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const risks: any[] = [];
    const nowString = nowISO();

    // 1. SERAPAN RENDAH
    {
      const { rows } = await pool.query(
        `SELECT ma.id, ma.kode_akun, ma.nama_akun, ma.unit_kerja_id,
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
         ORDER BY persentase ASC
         LIMIT 20`
      );
      for (const row of rows) {
        risks.push({
          jenis: "serapan_rendah",
          level: "tinggi",
          unit: `${row.kode_unit} - ${row.nama_unit}`,
          akun: `${row.kode_akun} - ${row.nama_akun}`,
          detail: `Realisasi ${Number(row.persentase)}% dari pagu Rp${(Number(row.pagu_revisi)).toLocaleString("id-ID")}`,
        });
      }
    }

    // 2. AKUN HAMPIR HABIS
    {
      const { rows } = await pool.query(
        `SELECT ma.id, ma.kode_akun, ma.nama_akun, ma.unit_kerja_id,
                uk.kode_unit, uk.nama_unit, ma.pagu_revisi, ma.realisasi_sd_periode,
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
         ORDER BY persentase_sisa ASC
         LIMIT 20`
      );
      for (const row of rows) {
        const pct = Number(row.persentase_sisa);
        risks.push({
          jenis: "akun_hampir_habis",
          level: pct < 5 ? "tinggi" : "sedang",
          unit: `${row.kode_unit} - ${row.nama_unit}`,
          akun: `${row.kode_akun} - ${row.nama_akun}`,
          detail: `Sisa pagu Rp${(Number(row.sisa_pagu)).toLocaleString("id-ID")} (${pct}%)`,
        });
      }
    }

    // 3. OVER ALOKASI
    {
      const { rows } = await pool.query(
        `SELECT ma.id, ma.kode_akun, ma.nama_akun, ma.unit_kerja_id,
                uk.kode_unit, uk.nama_unit,
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
         ORDER BY (rencana.total_rencana - (ma.pagu_revisi - ma.realisasi_sd_periode)) DESC
         LIMIT 20`
      );
      for (const row of rows) {
        risks.push({
          jenis: "over_alokasi",
          level: Number(row.total_rencana) > Number(row.sisa_pagu) * 1.5 ? "tinggi" : "sedang",
          unit: `${row.kode_unit} - ${row.nama_unit}`,
          akun: `${row.kode_akun} - ${row.nama_akun}`,
          detail: `Rencana Rp${(Number(row.total_rencana)).toLocaleString("id-ID")} vs sisa Rp${(Number(row.sisa_pagu)).toLocaleString("id-ID")}`,
        });
      }
    }

    // 4. DATA USANG
    {
      const { rows } = await pool.query(`SELECT MAX(created_at) AS last_import FROM monitoring_imports`);
      if (rows.length > 0 && rows[0].last_import) {
        const lastImport = new Date(rows[0].last_import);
        const daysSince = Math.floor((now.getTime() - lastImport.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSince > 30) {
          risks.push({
            jenis: "data_usang",
            level: daysSince > 60 ? "tinggi" : "sedang",
            unit: "Seluruh Unit",
            akun: "-",
            detail: `${daysSince} hari sejak import terakhir (${formatDate(lastImport)})`,
          });
        }
      }
    }

    // 5. SPPD OVERDUE
    {
      const { rows } = await pool.query(
        `SELECT sk.id, sk.nama_kegiatan, sk.tanggal_pulang, sk.unit_kerja_id,
                uk.kode_unit, uk.nama_unit
         FROM sppd_kegiatan sk
         JOIN unit_kerja uk ON uk.id = sk.unit_kerja_id
         WHERE sk.status = 'dilaksanakan'
           AND sk.tanggal_pulang <= $1
           AND NOT EXISTS (
             SELECT 1 FROM sppd_approval sa
             WHERE sa.sppd_kegiatan_id = sk.id
               AND sa.keputusan = 'diajukan_pertanggungjawaban'
           )
         ORDER BY sk.tanggal_pulang ASC
         LIMIT 20`,
        [formatDate(sevenDaysAgo)]
      );
      for (const row of rows) {
        const selesai = new Date(row.tanggal_pulang);
        const days = Math.floor((now.getTime() - selesai.getTime()) / (1000 * 60 * 60 * 24));
        risks.push({
          jenis: "sppd_overdue",
          level: days > 30 ? "tinggi" : days > 14 ? "sedang" : "rendah",
          unit: `${row.kode_unit} - ${row.nama_unit}`,
          akun: "-",
          detail: `"${row.nama_kegiatan}" — ${days} hari overdue`,
        });
      }
    }

    // 6. PAGU TIDAK TERALOKASI
    {
      const { rows } = await pool.query(
        `SELECT ma.id, ma.kode_akun, ma.nama_akun, ma.unit_kerja_id,
                uk.kode_unit, uk.nama_unit, ma.pagu_revisi
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
         ORDER BY ma.pagu_revisi DESC
         LIMIT 20`
      );
      for (const row of rows) {
        risks.push({
          jenis: "pagu_tidak_teralokasi",
          level: "sedang",
          unit: `${row.kode_unit} - ${row.nama_unit}`,
          akun: `${row.kode_akun} - ${row.nama_akun}`,
          detail: `Pagu Rp${(Number(row.pagu_revisi)).toLocaleString("id-ID")} — belum ada kegiatan`,
        });
      }
    }

    // Build markdown briefing
    const total = risks.length;
    const tinggi = risks.filter((r) => r.level === "tinggi").length;
    const sedang = risks.filter((r) => r.level === "sedang").length;
    const rendah = risks.filter((r) => r.level === "rendah").length;

    const lines: string[] = [];
    lines.push("# ⚠️ Ringkasan Risiko Mingguan");
    lines.push(`Dibuat: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`);
    lines.push("");
    lines.push("## Ringkasan");
    lines.push(`- Total risiko terdeteksi: **${total}**`);
    lines.push(`- 🔴 Tinggi: **${tinggi}**`);
    lines.push(`- 🟡 Sedang: **${sedang}**`);
    lines.push(`- 🟢 Rendah: **${rendah}**`);
    lines.push("");

    // Group by jenis
    const byJenis = new Map<string, typeof risks>();
    for (const r of risks) {
      const list = byJenis.get(r.jenis) || [];
      list.push(r);
      byJenis.set(r.jenis, list);
    }

    for (const [jenis, items] of byJenis) {
      const labelMap: Record<string, string> = {
        serapan_rendah: "🔴 Serapan Rendah",
        akun_hampir_habis: "🟡 Akun Hampir Habis",
        over_alokasi: "🔴 Over-Alokasi",
        data_usang: "🟡 Data Usang",
        sppd_overdue: "⚠️ SPPD Overdue",
        pagu_tidak_teralokasi: "🟡 Pagu Tidak Teralokasi",
      };
      lines.push(`## ${labelMap[jenis] || jenis} (${items.length})`);
      lines.push("");
      for (const item of items) {
        const levelIcon = item.level === "tinggi" ? "🔴" : item.level === "sedang" ? "🟡" : "🟢";
        lines.push(`- ${levelIcon} **${item.unit}** — ${item.akun}`);
        lines.push(`  - ${item.detail}`);
      }
      lines.push("");
    }

    // Analisis keseluruhan
    {
      const analisis = generateRiskAnalisis(
        risks.map((r) => ({ jenis: r.jenis, level: r.level, unit: r.unit }))
      );
      lines.push("## Analisis & Rekomendasi");
      lines.push("");
      lines.push(analisis);
      lines.push("");
    }

    lines.push("---");
    lines.push(`*Laporan dibuat otomatis oleh Arthakarya Risk Monitor*`);

    const markdown = lines.join("\n");

    // Log as structured JSON with the markdown as a single-line payload
    logger.info("risk_summary_briefing", {
      total,
      tinggi,
      sedang,
      rendah,
      markdown,
    });

    logger.info("risk_summary_cron_end", { total_risks: total });

    // Print to stdout as well (for cron job output capture)
    console.log(markdown);
  } catch (err: any) {
    logger.error("risk_summary_cron_error", { message: err.message });
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();