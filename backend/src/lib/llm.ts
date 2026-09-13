/**
 * LLM Service — AI content generation with graceful fallback.
 *
 * Uses OpenRouter (deepseek/deepseek-v4-flash) if OPENROUTER_API_KEY is set.
 * Falls back to template-based text generation without errors.
 * Results are cached per prompt hash for 1 hour.
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiOptions {
  prompt: string;
  system?: string;
  model?: string;
}

export interface RiskItem {
  id: string;
  jenis: string;
  level: "tinggi" | "sedang" | "rendah";
  unit_kerja: { id: number; kode: string; nama: string };
  akun?: { kode: string; nama: string } | null;
  nilai: Record<string, number | string | undefined>;
}

// ---------------------------------------------------------------------------
// LRU Cache (prompt hash → response, TTL 1 jam)
// ---------------------------------------------------------------------------

interface CacheEntry {
  result: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 jam

function getCached(hash: string): string | null {
  const entry = cache.get(hash);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(hash);
    return null;
  }
  return entry.result;
}

function setCached(hash: string, result: string): void {
  // Evict oldest entries when cache grows too large
  if (cache.size > 200) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(hash, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

function hashPrompt(prompt: string, system?: string): string {
  const h = createHash("sha256");
  h.update(prompt);
  if (system) h.update(system);
  return h.digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// OpenRouter API call
// ---------------------------------------------------------------------------

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

async function callOpenRouter(
  prompt: string,
  system?: string,
  model?: string,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return "[AI tidak tersedia]";

  const selectedModel = model || "deepseek/deepseek-v4-flash";

  const body: Record<string, unknown> = {
    model: selectedModel,
    messages: [
      ...(system ? [{ role: "system" as const, content: system }] : []),
      { role: "user" as const, content: prompt },
    ],
    max_tokens: 1024,
    temperature: 0.7,
  };

  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://arthakarya.app",
      "X-Title": "Arthakarya Risk Analysis",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "unknown error");
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        msg: "openrouter_api_error",
        status: response.status,
        text,
      }),
    );
    return "[AI tidak tersedia — gagal memanggil API]";
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    return "[AI tidak tersedia — respons kosong]";
  }

  return content.trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate text using AI (OpenRouter) with graceful fallback.
 * Caches results per prompt hash for 1 hour.
 */
export async function aiGenerate(opts: AiOptions): Promise<string> {
  const { prompt, system, model } = opts;

  // If no API key, return unavailable marker immediately
  if (!process.env.OPENROUTER_API_KEY) {
    return "[AI tidak tersedia]";
  }

  // Check cache
  const cacheKey = hashPrompt(prompt, system);
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  // Call API
  const result = await callOpenRouter(prompt, system, model);

  // Only cache successful (non-fallback) responses
  if (!result.startsWith("[AI tidak tersedia")) {
    setCached(cacheKey, result);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Template-based fallback descriptions (no API key required)
// ---------------------------------------------------------------------------

function namaBulan(month: number): string {
  const bulan = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  return bulan[month - 1] || `bulan ke-${month}`;
}

/**
 * Generate natural-language description for a detected risk item.
 * Template-based — works without any API key.
 */
export function generateRiskDescription(risk: RiskItem): string {
  const { jenis, level, nilai } = risk;

  switch (jenis) {
    case "serapan_rendah": {
      const pct = nilai.persentase as number;
      const bulan = nilai.bulan_sekarang as number;
      const pagu = (nilai.pagu as number)?.toLocaleString("id-ID") || "0";
      const realisasi = (nilai.realisasi as number)?.toLocaleString("id-ID") || "0";
      return (
        `Realisasi baru ${pct}% (Rp${realisasi}) dari pagu Rp${pagu} ` +
        `di ${namaBulan(bulan)}. Risiko tinggi tidak terserapnya anggaran ` +
        `memerlukan refocussing segera.`
      );
    }

    case "akun_hampir_habis": {
      const sisa = (nilai.sisa_pagu as number)?.toLocaleString("id-ID") || "0";
      const pct = nilai.persentase as number;
      const pagu = (nilai.pagu as number)?.toLocaleString("id-ID") || "0";
      return (
        `Sisa pagu hanya Rp${sisa} (${pct}% dari pagu Rp${pagu}). ` +
        `Anggaran akun ini hampir habis — alokasi kegiatan baru perlu ` +
        `dikontrol ketat.`
      );
    }

    case "over_alokasi": {
      const totalRencana = (nilai.total_rencana as number)?.toLocaleString("id-ID") || "0";
      const sisa = (nilai.sisa_pagu as number)?.toLocaleString("id-ID") || "0";
      const kelebihan = (nilai.kelebihan as number)?.toLocaleString("id-ID") || "0";
      return (
        `Total rencana kegiatan Rp${totalRencana} melebihi sisa pagu ` +
        `Rp${sisa} sebesar Rp${kelebihan}. Risiko over-alokasi perlu ` +
        `segera direviu dan direalokasi.`
      );
    }

    case "data_usang": {
      const hari = nilai.hari_terakhir as number;
      const tgl = nilai.tanggal_terakhir as string;
      return (
        `Data monitoring terakhir diimport pada ${tgl} (${hari} hari yang lalu). ` +
        `Data usang dapat menyebabkan keputusan berdasarkan informasi yang ` +
        `tidak akurat. Segera lakukan import ulang.`
      );
    }

    case "sppd_overdue": {
      const hari = nilai.hari_terlambat as number;
      const nama = nilai.nama_kegiatan as string || "Kegiatan";
      return (
        `SPPD "${nama}" telah selesai dilaksanakan ${hari} hari yang lalu ` +
        `namun pertanggungjawaban belum diajukan. Segera ajukan ` +
        `pertanggungjawaban untuk menghindari sanksi administrasi.`
      );
    }

    case "pagu_tidak_teralokasi": {
      const pagu = (nilai.pagu as number)?.toLocaleString("id-ID") || "0";
      const akun = nilai.kode_akun as string || "";
      return (
        `Akun ${akun} memiliki pagu Rp${pagu} namun tidak ada kegiatan ` +
        `yang menggunakan akun ini. Risiko anggaran tidak termanfaatkan -- ` +
        `pertimbangkan realokasi atau penyusunan kegiatan baru.`
      );
    }

    default:
      return `Terdeteksi risiko ${jenis} dengan level ${level}.`;
  }
}

/**
 * Generate natural-language recommendation for a detected risk item.
 * Template-based — works without any API key.
 */
export function generateRiskRecommendation(risk: RiskItem): string {
  const { jenis, level } = risk;

  switch (jenis) {
    case "serapan_rendah":
      return (
        "Segera lakukan akselerasi realisasi: percepat kegiatan yang sudah " +
        "direncanakan, ajukan SPPD, dan pastikan dokumen pertanggungjawaban " +
        "siap. Jika tidak memungkinkan, ajukan refocussing anggaran ke " +
        "kegiatan lain yang lebih siap dilaksanakan."
      );

    case "akun_hampir_habis":
      return (
        "Kontrol ketat sisa pagu. Tunda pembuatan kegiatan baru dengan " +
        "akun ini hingga pagu tahun depan. Jika masih ada kegiatan urgent, " +
        "pertimbangkan realokasi dari akun lain yang masih longgar."
      );

    case "over_alokasi":
      return (
        "Reviu kegiatan yang menggunakan akun ini. Kurangi alokasi atau " +
        "tunda kegiatan yang belum mendesak. Jika diperlukan, ajukan revisi " +
        "anggaran ke atasan."
      );

    case "data_usang":
      return (
        "Segera koordinasikan dengan admin untuk melakukan import ulang " +
        "data monitoring dari SAKTI. Data terkini penting untuk akurasi " +
        "pengambilan keputusan."
      );

    case "sppd_overdue":
      return (
        "Hubungi pelaksana SPPD untuk segera melengkapi dokumen " +
        "pertanggungjawaban (boarding pass, kwitansi, laporan kegiatan). " +
        "Batas waktu pertanggungjawaban perlu dipenuhi untuk menghindari " +
        "sanksi."
      );

    case "pagu_tidak_teralokasi":
      return (
        "Tinjau kemungkinan realokasi pagu ke akun lain yang membutuhkan " +
        "tambahan anggaran, atau susun kegiatan baru yang sesuai dengan " +
        "akun ini agar pagu dapat termanfaatkan."
      );

    default:
      return `Lakukan evaluasi dan tindakan korektif untuk risiko ${jenis} level ${level}.`;
  }
}

/**
 * Generate root-cause analysis for a set of risk items (aggregate).
 */
export function generateRiskAnalisis(items: { jenis: string; level: string; unit: string }[]): string {
  // Count patterns
  const serapanRendah = items.filter((i) => i.jenis === "serapan_rendah").length;
  const paguTidakTeralokasi = items.filter((i) => i.jenis === "pagu_tidak_teralokasi").length;
  const overAlokasi = items.filter((i) => i.jenis === "over_alokasi").length;
  const sppdOverdue = items.filter((i) => i.jenis === "sppd_overdue").length;

  const parts: string[] = [];

  if (serapanRendah > 0 && paguTidakTeralokasi > 0) {
    parts.push(
      `${serapanRendah} risiko serapan rendah dan ${paguTidakTeralokasi} risiko ` +
      "pagu tidak teralokasi saling terkait — realisasi rendah terjadi karena " +
      "anggaran pada akun tertentu belum direncanakan kegiatan. " +
      "Rekomendasi: percepat penyusunan kegiatan pada akun tersebut."
    );
  } else if (serapanRendah > 0) {
    parts.push(
      `Serapan rendah terdeteksi di ${serapanRendah} area. Kemungkinan penyebab: ` +
      "kegiatan masih draft, proses pengadaan belum dimulai, atau SPPD belum " +
      "diajukan. Review status kegiatan terkait."
    );
  }

  if (overAlokasi > 0) {
    parts.push(
      `${overAlokasi} area over-alokasi — total rencana kegiatan melebihi sisa pagu. ` +
      "Hal ini mengindikasikan perlunya reviu ulang prioritas kegiatan."
    );
  }

  if (sppdOverdue > 0) {
    parts.push(
      `${sppdOverdue} SPPD overdue pertanggungjawaban. ` +
      "Perlu pengingat kepada pelaksana untuk segera melengkapi dokumen."
    );
  }

  if (parts.length === 0) {
    parts.push(
      "Tidak ditemukan korelasi signifikan antar risiko yang terdeteksi. " +
      "Setiap risiko bersifat independen dan dapat ditangani secara terpisah."
    );
  }

  return parts.join(" ");
}