// Kompresi/resize gambar SEBELUM upload (dokumen SPPD).
// Mengurangi ukuran transfer melalui jaringan instansi (Bappenas) — scan/foto
// 5-10MB di-resize ke max 1920px + JPEG quality 0.72, biasanya turun <500KB.
// PDF & non-gambar dilewatkan apa adanya.
const MAX_DIMENSION = 1920; // px — cukup untuk arsip & preview
const JPEG_QUALITY = 0.72;
const COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024; // hanya kompres bila > 1.5MB

/**
 * Mengembalikan File hasil kompresi bila menguntungkan, atau file asli bila:
 * - bukan gambar (PDF, dll.)
 * - gambar kecil (dimensi ≤ MAX_DIMENSION dan ukuran ≤ threshold)
 * - hasil kompresi ternyata tidak mengecilkan ukuran
 * - proses gagal (mis. browser tanpa createImageBitmap)
 */
export async function compressImage(file) {
  if (!file || typeof file.type !== "string" || !file.type.startsWith("image/")) {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const needsCompress = scale < 1 || file.size > COMPRESS_THRESHOLD_BYTES;
    if (!needsCompress) {
      bitmap.close();
      return file;
    }
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    // Latar putih — JPEG tidak punya alpha; PNG transparan jadi hitam tanpa ini.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob || blob.size >= file.size) {
      return file; // kompresi tidak mengecilkan → kirim asli
    }
    return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
      type: "image/jpeg",
    });
  } catch {
    return file; // gagal proses → kirim asli (jangan halangi upload)
  }
}
