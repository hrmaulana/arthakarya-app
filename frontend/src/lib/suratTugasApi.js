// Surat Tugas API client
import axios from "axios";

const client = axios.create({ baseURL: "/api/surat-tugas" });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const suratTugasApi = {
  list: () => client.get("/"),

  get: (id) => client.get(`/${id}`),

  create: (formData) =>
    client.post("/", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),

  update: (id, formData) =>
    client.put(`/${id}`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),

  remove: (id) => client.delete(`/${id}`),

  fileUrl: (id, jenis) => `/api/surat-tugas/${id}/file/${jenis}`,
};
