// Rate limiter sederhana (in-memory) untuk endpoint login.
// Single-instance app — Map di memori cukup; tidak butuh Redis.
//
// Aturan: maksimal 5 percobaan login GAGAL per 15 menit per kombinasi
// IP + username. Setelah limit, kunci sementara 15 menit (HTTP 429).
// Login sukses menghapus riwayat kegagalan.

const WINDOW_MS = 15 * 60 * 1000; // 15 menit
const MAX_FAILURES = 5;

interface AttemptRecord {
  failures: number;
  firstFailureAt: number;
}

const attempts = new Map<string, AttemptRecord>();

function prune(): void {
  const now = Date.now();
  for (const [key, rec] of attempts) {
    if (now - rec.firstFailureAt > WINDOW_MS) {
      attempts.delete(key);
    }
  }
}

export function registerFailure(key: string): void {
  prune();
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.firstFailureAt > WINDOW_MS) {
    attempts.set(key, { failures: 1, firstFailureAt: now });
  } else {
    rec.failures += 1;
  }
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}

export function isBlocked(key: string): boolean {
  prune();
  const rec = attempts.get(key);
  return rec !== undefined && rec.failures >= MAX_FAILURES;
}
