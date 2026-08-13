import { useEffect, useRef } from "react";

// Mendengarkan Server-Sent Events dari endpoint SSE backend.
// onMessage dipanggil untuk tiap event (sudah di-JSON.parse). Reconnect
// otomatis (retry: 3000 di server). Hanya perubahan `url` yang membuka ulang
// koneksi; `onMessage` terbaru selalu dipakai lewat ref agar caller bisa
// melempar arrow function baru tiap render tanpa menyebabkan reconnect.
export default function useSse(url, onMessage) {
  const cbRef = useRef(onMessage);
  useEffect(() => {
    cbRef.current = onMessage;
  });

  useEffect(() => {
    const es = new EventSource(url);
    es.onmessage = (e) => {
      let payload = null;
      try {
        payload = JSON.parse(e.data);
      } catch {
        return; // frame non-JSON (mis. ": ping") — abaikan
      }
      if (payload) cbRef.current(payload);
    };
    return () => es.close();
  }, [url]);
}
