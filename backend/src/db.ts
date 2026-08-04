// Database connection pool
import pg from "pg";
import { logger } from "./logger.js";

const { Pool, types } = pg;

// BIGINT (OID 20) → number: PostgreSQL mengembalikan int8 sebagai string
// secara default; dengan parser ini semua total anggaran, jumlah, dan id
// menjadi angka di respons JSON. Aman hingga 2^53 (~9 kuadriliun rupiah).
types.setTypeParser(20, (val: string) => Number(val));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://arthakarya:arthakarya_secret@localhost:5432/arthakarya",
});

// Test connection on startup
pool.query("SELECT 1")
  .then(() => logger.info("db_connected"))
  .catch((err) => {
    logger.error("db_connection_failed", { message: err.message });
    process.exit(1);
  });

export default pool;
