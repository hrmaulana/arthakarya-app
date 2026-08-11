// Arthakarya Backend — Express App (dipisah dari entry point agar bisa
// diimpor langsung oleh test integrasi tanpa menyalakan server).
import express from "express";
import cors from "cors";
import helmet from "helmet";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import referenceRoutes from "./routes/reference.js";
import kegiatanRoutes from "./routes/kegiatan.js";
import rekapRoutes from "./routes/rekap.js";
import monitoringRoutes from "./routes/monitoring.js";
import sppdRoutes from "./routes/sppd.js";
import suratTugasRoutes from "./routes/suratTugas.js";
import { logger } from "./logger.js";

const app = express();

// Percaya pada X-Forwarded-* dari nginx (1 hop) agar req.ip = IP klien
app.set("trust proxy", 1);

// Security headers standar (helmet menonaktifkan x-powered-by juga)
app.use(helmet());

// CORS: daftar origin dari env (CORS_ORIGIN), fallback untuk dev lokal
const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173,http://localhost")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({ origin: corsOrigins, credentials: true }));

app.use(express.json({ limit: "2mb" }));

// Request logging (structured JSON)
app.use((req, _res, next) => {
  logger.info("request", { method: req.method, path: req.path, ip: req.ip });
  next();
});

// ============================================================
// ROUTES
// ============================================================

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/reference", referenceRoutes);
app.use("/api/kegiatan", kegiatanRoutes);
app.use("/api/rekap", rekapRoutes);
app.use("/api/monitoring", monitoringRoutes);
app.use("/api/sppd", sppdRoutes);
app.use("/api/surat-tugas", suratTugasRoutes);

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
  logger.error("unhandled_error", { message: err.message });
  res.status(500).json({ error: "Terjadi kesalahan internal server." });
});

export default app;
