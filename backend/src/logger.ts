// Structured JSON logger — machine-readable logs, one JSON line per entry.
// Dikirim ke stdout (docker logging driver menangani rotasi & collection).

type LogLevel = "info" | "warn" | "error";

function log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  });

  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
};
