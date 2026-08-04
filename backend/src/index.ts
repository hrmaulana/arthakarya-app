// Arthakarya Backend — Main Entry Point
import app from "./app.js";
import { logger } from "./logger.js";

const PORT = parseInt(process.env.PORT || "3001", 10);

app.listen(PORT, () => {
  logger.info("server_started", { port: PORT, env: process.env.NODE_ENV || "development" });
});
