// SSE event hub — in-memory, satu instance per proses server.
// Broadcast hanya menjangkau klien di proses ini (sesuai arsitektur single-instance).
import type { Response } from "express";

const clients = new Set<Response>();

export function addSseClient(res: Response): void {
  clients.add(res);
}

export function removeSseClient(res: Response): void {
  clients.delete(res);
}

// Tulis satu event ke semua klien. Klien yang error/sudah tutup dibuang
// agar satu klien bermasalah tidak menggagalkan yang lain.
export function broadcast(payload: object): void {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      removeSseClient(res);
    }
  }
}

// Buka koneksi SSE: set header anti-buffering, flush, retry + event awal
// "connected", daftarkan klien, lalu jaga tetap hidup dengan ping tiap 25 dtk.
export function openSse(res: Response): void {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // matikan buffering proxy (lihat catatan OPS.md)
  });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  addSseClient(res);

  const keepAlive = setInterval(() => res.write(": ping\n\n"), 25_000);
  res.on("close", () => {
    clearInterval(keepAlive);
    removeSseClient(res);
  });
}
