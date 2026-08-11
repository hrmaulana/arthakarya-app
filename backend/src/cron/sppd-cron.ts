/**
 * SPPD Cronjob — run daily via crontab
 *
 * Tasks:
 * 1. Status disetujui → dilaksanakan for SPPD where tanggal_berangkat = today
 * 2. (Future: overdue alert checks — currently handled by /api/sppd/alerts endpoint)
 *
 * Usage: bun run backend/src/cron/sppd-cron.ts
 */

import pool from "../db.js";
import { logger } from "../logger.js";

async function main() {
  logger.info("sppd_cron_start");

  try {
    // 1. disetujui → dilaksanakan when tanggal_berangkat = today (WIB, UTC+7)
    const now = new Date();
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const today = wib.toISOString().slice(0, 10);

    const result = await pool.query(
      `UPDATE sppd_kegiatan
       SET status = 'dilaksanakan', updated_at = NOW()
       WHERE status = 'disetujui'
         AND tanggal_berangkat <= $1
       RETURNING id, nama_kegiatan`,
      [today]
    );

    for (const row of result.rows) {
      logger.info("sppd_cron_status_updated", {
        id: row.id,
        nama_kegiatan: row.nama_kegiatan,
        new_status: "dilaksanakan",
      });
    }

    if (result.rows.length === 0) {
      logger.info("sppd_cron_no_changes");
    } else {
      logger.info("sppd_cron_updated_count", { count: result.rows.length });
    }
  } catch (err: any) {
    logger.error("sppd_cron_error", { message: err.message });
    process.exit(1);
  }

  await pool.end();
  logger.info("sppd_cron_end");
}

main();
