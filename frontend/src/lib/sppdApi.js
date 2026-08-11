// SPPD API client
import axios from "axios";

const client = axios.create({ baseURL: "/api/sppd" });

// Include JWT token
client.interceptors.request.use((config) => {
  const token = localStorage.getItem("arthakarya-token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const sppdApi = {
  // Alerts badge
  alerts: () => client.get("/alerts"),

  list: (status) =>
    client.get("/", { params: status ? { status } : {} }),

  get: (id) => client.get(`/${id}`),

  create: (data) => client.post("/", data),

  update: (id, data) => client.put(`/${id}`, data),

  remove: (id) => client.delete(`/${id}`),

  submit: (id) => client.post(`/${id}/submit`),

  approve: (id, keputusan, catatan) =>
    client.post(`/${id}/approve`, { keputusan, catatan }),

  // Pertanggungjawaban
  ajukanPertanggungjawaban: (id) =>
    client.post(`/${id}/ajukan-pertanggungjawaban`),

  verifikasiDokumen: (id, keputusan, catatan) =>
    client.post(`/${id}/verifikasi-dokumen`, { keputusan, catatan }),

  // Dokumen
  uploadDokumen: (id, formData) =>
    client.post(`/${id}/dokumen`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),

  deleteDokumen: (sppdId, dokumenId) =>
    client.delete(`/${sppdId}/dokumen/${dokumenId}`),

  dokumenUrl: (sppdId, dokumenId) =>
    `/api/sppd/${sppdId}/dokumen/${dokumenId}/file`,

  // Peserta
  listPeserta: (id) => client.get(`/${id}/peserta`),

  addPeserta: (id, data) =>
    client.post(`/${id}/peserta`, data),

  updatePeserta: (id, pid, data) =>
    client.put(`/${id}/peserta/${pid}`, data),

  removePeserta: (id, pid) =>
    client.delete(`/${id}/peserta/${pid}`),

  // Cetak PDF
  cetakUrl: (id, pid) =>
    `/api/sppd/${id}/cetak/${pid}`,
};
