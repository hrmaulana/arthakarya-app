import { describe, it, expect } from "bun:test";
import { addSseClient, broadcast, openSse } from "../src/events.js";

// Fake Express Response — cukup untuk menguji hub (hanya butuh .write/.on).
function fakeRes() {
  const writes: string[] = [];
  return {
    writes,
    write: (s: string) => {
      writes.push(s);
      return true;
    },
    on: () => {},
  };
}

// Fake req/res yang mencatat listener per event — cukup untuk menguji openSse.
function fakeStream() {
  const writes: string[] = [];
  const handlers: Record<string, () => void> = {};
  return {
    writes,
    handlers,
    set: () => {},
    flushHeaders: () => {},
    write: (s: string) => {
      writes.push(s);
      return true;
    },
    on: (ev: string, cb: () => void) => {
      handlers[ev] = cb;
    },
  };
}

describe("events hub", () => {
  it("broadcast menulis frame `data: JSON` ke setiap klien", () => {
    const a = fakeRes();
    const b = fakeRes();
    addSseClient(a as any);
    addSseClient(b as any);

    broadcast({ type: "kegiatan" });

    expect(a.writes.join("")).toBe('data: {"type":"kegiatan"}\n\n');
    expect(b.writes.join("")).toBe('data: {"type":"kegiatan"}\n\n');
  });

  it("klien yang error dibuang (tidak dipanggil pada broadcast berikutnya)", () => {
    let calls = 0;
    const dead = {
      write: () => {
        calls++;
        throw new Error("socket gone");
      },
      on: () => {},
    };
    addSseClient(dead as any);

    broadcast({ type: "a" });
    broadcast({ type: "b" });

    expect(calls).toBe(1); // hanya broadcast pertama yang menyentuh klien mati
  });

  it("satu klien error tidak menggagalkan klien lain", () => {
    const ok = fakeRes();
    const dead = {
      write: () => {
        throw new Error("socket gone");
      },
      on: () => {},
    };
    addSseClient(dead as any);
    addSseClient(ok as any);

    broadcast({ type: "rpd-target", tahun: 2026 });

    expect(ok.writes.join("")).toBe('data: {"type":"rpd-target","tahun":2026}\n\n');
  });

  it("klien dibuang dari hub saat close dipicu lewat req (bukan hanya res)", () => {
    const res = fakeStream();
    const req = fakeStream();
    openSse(res as any, req as any);

    // Sudah terdaftar sebagai klien: broadcast menulis ke koneksi ini.
    broadcast({ type: "kegiatan" });
    expect(res.writes.filter((w) => w.startsWith("data:")).length).toBe(2); // connected + broadcast

    // Simulasikan client disconnect di sisi req (jalur yang baru ditambahkan) —
    // memicu cleanup: interval di-clear & klien dibuang dari hub.
    req.handlers.close?.();

    broadcast({ type: "kegiatan" });
    expect(res.writes.filter((w) => w.startsWith("data:")).length).toBe(2); // tidak bertambah
  });
});
