import { describe, it, expect } from "bun:test";
import { addSseClient, broadcast } from "../src/events.js";

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
});
