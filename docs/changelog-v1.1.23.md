# Changelog v1.1.23 — 17 Agustus 2026

## ✨ Fitur: Auto-catch-up 'disetujui' → 'dilaksanakan' saat ajukan pertanggungjawaban

### Ringkasan
Sebelumnya operator harus **menunggu cron harian** agar status SPPD naik dari `disetujui` ke `dilaksanakan`
(setelah tanggal berangkat lewat) sebelum bisa mengajukan pertanggungjawaban. Padahal perjalanan dinas
sudah selesai. Sekarang endpoint submit otomatis memajukan status saat tanggal berangkat sudah lewat,
jadi operator bisa langsung upload dokumen & mengajukan tanpa menunggu jadwal cron. Cron harian tetap
berfungsi sebagai jaring pengaman.

### Perubahan

**Backend — `backend/src/routes/sppd.ts`**
- `POST /api/sppd/:id/ajukan-pertanggungjawaban` sekarang menerima status `disetujui` bila
  `tanggal_berangkat <= hari ini (WIB)`:
  - status `disetujui` + tanggal lewat → otomatis dimajukan ke `dilaksanakan` dalam transaksi
    (lock `FOR UPDATE` anti race, perbandingan tanggal di SQL agar konsisten dengan tipe `DATE`),
    lalu lanjut ke `pertanggungjawaban`.
  - status `disetujui` + tanggal masih di depan → `400` "SPPD belum dilaksanakan."
  - status lain → `400` (perilaku lama, tidak berubah).

**Frontend — `frontend/src/pages/SppdDetail.jsx`**
- Seksi Pertanggungjawaban (upload dokumen + tombol **"Ajukan Pertanggungjawaban"**) kini juga muncul
  saat status `disetujui` dengan tanggal berangkat sudah lewat.
- Tombol hapus dokumen tetap hanya aktif di status `dilaksanakan` (batasan backend tidak diubah).

**Tes — `backend/tests/integration.test.ts`**
- Kasus baru (2): SPPD `disetujui` tanggal lewat → `200` & status `pertanggungjawaban`;
  SPPD `disetujui` tanggal masih depan → `400`.
- Kasus lama disesuaikan: "bukan `dilaksanakan`" kini memakai status `draft` untuk skenario `400`.
- Seluruh suite: 85 test lulus, typecheck bersih.
