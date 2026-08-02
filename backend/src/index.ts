// Arthakarya Backend — Main Entry Point
import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.js";
import referenceRoutes from "./routes/reference.js";
import kegiatanRoutes from "./routes/kegiatan.js";
import rekapRoutes from "./routes/rekap.js";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:3000", "http://localhost"],
  credentials: true,
}));

app.use(express.json({ limit: "2mb" }));

// Request logging
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================================
// ROUTES
// ============================================================

app.use("/api/auth", authRoutes);
app.use("/api/reference", referenceRoutes);
app.use("/api/kegiatan", kegiatanRoutes);
app.use("/api/rekap", rekapRoutes);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============================================================
// 404 HANDLER
// ============================================================

app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint tidak ditemukan." });
});

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[Server] Unhandled error:", err.message);
  res.status(500).json({ error: "Terjadi kesalahan internal server." });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log(`[Server] Arthakarya backend running on port ${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || "development"}`);
});

export default app;
