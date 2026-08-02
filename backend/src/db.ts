// Database connection pool
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://arthakarya:arthakarya_secret@localhost:5432/arthakarya",
});

// Test connection on startup
pool.query("SELECT 1")
  .then(() => console.log("[DB] PostgreSQL connected"))
  .catch((err) => {
    console.error("[DB] Connection failed:", err.message);
    process.exit(1);
  });

export default pool;
