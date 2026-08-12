// Arthakarya — Shared Types

export interface UnitKerja {
  id: number;
  kode_unit: string;
  nama_unit: string;
}

export interface JenisKegiatan {
  id: number;
  nama_jenis: string;
}

export interface User {
  id: number;
  unit_kerja_id: number;
  username: string;
  role: "admin" | "operator";
}

export interface Kegiatan {
  id: number;
  unit_kerja_id: number;
  jenis_kegiatan_id: number;
  created_by: number;
  nama_kegiatan: string;
  tanggal: string;
  status: "draft" | "diajukan" | "disetujui" | "ditolak";
  created_at?: string;
  updated_at?: string;
  unit_kerja_nama?: string;
  jenis_kegiatan_nama?: string;
}

export interface MataAnggaran {
  id?: number;
  kegiatan_id?: number;
  kode_akun?: string; // null untuk baris legacy (diketik bebas sebelum fitur ini)
  nama_item: string;
  jumlah_rp: number;
  keterangan?: string;
}

export interface KegiatanWithMataAnggaran extends Kegiatan {
  mata_anggaran: MataAnggaran[];
}

export interface AuthPayload {
  userId: number;
  username: string;
  unit_kerja_id: number;
  role: "admin" | "operator";
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}
