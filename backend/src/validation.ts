// Zod request validation — semua payload dari klien divalidasi di sini
// sebelum diproses. Pesan error dalam Bahasa Indonesia agar konsisten
// dengan response handler lainnya.
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

const passwordRule = z
  .string()
  .min(8, "Password minimal 8 karakter.")
  .max(200, "Password maksimal 200 karakter.");

export const loginSchema = z.object({
  username: z.string().trim().min(3, "Username minimal 3 karakter.").max(100),
  password: z.string().min(1, "Password wajib diisi.").max(200),
});

export const changePasswordSchema = z
  .object({
    old_password: passwordRule,
    new_password: passwordRule,
  })
  .refine((d) => d.old_password !== d.new_password, {
    message: "Password baru tidak boleh sama dengan password lama.",
    path: ["new_password"],
  });

export const resetPasswordSchema = z.object({
  new_password: passwordRule,
});

// PATCH /api/users/:id/status — admin menonaktifkan/mengaktifkan user
export const userStatusSchema = z.object({
  is_active: z.boolean({ invalid_type_error: "is_active harus berupa boolean." }),
});

// POST /api/users — admin membuat user baru
export const userCreateSchema = z.object({
  username: z.string().trim().min(3, "Username minimal 3 karakter.").max(100),
  password: passwordRule,
  role: z.enum(["admin", "operator"], { message: "Role tidak valid." }),
  unit_kerja_id: z
    .number({ invalid_type_error: "unit_kerja_id harus berupa angka." })
    .int()
    .positive(),
});

const statusEnum = z.enum(["draft", "diajukan", "disetujui", "ditolak"]);

const mataAnggaranItemSchema = z.object({
  nama_item: z
    .string()
    .trim()
    .min(1, "nama_item wajib diisi.")
    .max(500, "nama_item maksimal 500 karakter."),
  jumlah_rp: z
    .number({ invalid_type_error: "jumlah_rp harus berupa angka." })
    .int("jumlah_rp harus berupa angka bulat.")
    .min(0, "jumlah_rp tidak boleh negatif."),
  keterangan: z.string().trim().max(2000).optional().nullable(),
});

const kegiatanHeaderSchema = z.object({
  nama_kegiatan: z
    .string()
    .trim()
    .min(1, "nama_kegiatan wajib diisi.")
    .max(500, "nama_kegiatan maksimal 500 karakter."),
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "tanggal harus format YYYY-MM-DD."),
  unit_kerja_id: z.number({ invalid_type_error: "unit_kerja_id harus berupa angka." }).int().positive(),
  jenis_kegiatan_id: z
    .number({ invalid_type_error: "jenis_kegiatan_id harus berupa angka." })
    .int()
    .positive(),
  status: statusEnum.optional(),
});

// POST /api/kegiatan — header + mata_anggaran wajib
export const kegiatanCreateSchema = kegiatanHeaderSchema.extend({
  mata_anggaran: z
    .array(mataAnggaranItemSchema)
    .min(1, "Minimal satu item mata anggaran diperlukan."),
});

// PUT /api/kegiatan/:id — header wajib, mata_anggaran opsional (sync penuh jika ada)
export const kegiatanUpdateSchema = kegiatanHeaderSchema.extend({
  mata_anggaran: z
    .array(mataAnggaranItemSchema)
    .min(1, "Minimal satu item mata anggaran diperlukan.")
    .optional(),
});

// PATCH /api/kegiatan/:id/status
export const statusUpdateSchema = z.object({
  status: statusEnum,
});

/**
 * Express middleware: parse & validasi req.body terhadap schema zod.
 * Body yang sudah lolos ditimpa dengan hasil parse (trim, coerce, dll).
 */
export function validate(schema: z.ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const message = firstIssue?.message || "Data tidak valid.";
      res.status(400).json({ error: message });
      return;
    }
    req.body = result.data;
    next();
  };
}
