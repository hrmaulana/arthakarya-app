import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { LogoMark, IconUser, IconPassword } from "../components/Icons.jsx";

const levelOf = (p) => {
  const n = Number(p) || 0;
  if (n < 40) return "low";
  if (n < 70) return "mid";
  return "high";
};

const formatRupiah = (n) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { login, user } = useAuth();
  const navigate = useNavigate();

  // Ringkasan monitoring publik (halaman login, tanpa autentikasi)
  const [monSummary, setMonSummary] = useState(null);
  const [slideIdx, setSlideIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/monitoring/public-summary");
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json?.data) setMonSummary(json.data);
      } catch {
        // Gagal/mati offline → tampilkan brand seperti biasa
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const slides = monSummary
    ? [
        { icon: "💰", label: "Total Pagu Revisi", value: formatRupiah(monSummary.pagu) },
        { icon: "✅", label: "Realisasi s.d. Periode", value: formatRupiah(monSummary.realisasi) },
        { icon: "🏦", label: "Sisa Anggaran", value: formatRupiah(monSummary.sisa) },
        {
          icon: "🎯",
          label: "Persentase Penyerapan",
          value: `${Number(monSummary.persentase).toLocaleString("id-ID")}%`,
          level: levelOf(monSummary.persentase),
        },
      ]
    : [];

  useEffect(() => {
    if (slides.length === 0) return;
    const t = setInterval(() => {
      setSlideIdx((i) => (i + 1) % slides.length);
    }, 4000);
    return () => clearInterval(t);
  }, [monSummary, paused, slides.length]);

  if (user) {
    navigate("/kegiatan", { replace: true });
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password) {
      setError("Username dan password wajib diisi.");
      return;
    }
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate("/kegiatan", { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || "Gagal login. Silakan coba lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      {/* Left — Brand + slideshow monitoring */}
      <div className="login-left">
        <div className="login-left-content">
          <div className="login-logo">
            <LogoMark />
          </div>
          <h1>Arthakarya</h1>
          <p>
            Aplikasi Perencanaan Kegiatan dan Anggaran — kelola kegiatan,
            susun rincian anggaran, dan pantau realisasi dengan mudah.
          </p>

          {slides.length > 0 && (
            <div
              className="login-slides"
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
            >
              <div key={slideIdx} className="login-slide login-slide-enter">
                <div className="login-slide-label">
                  {slides[slideIdx].icon} {slides[slideIdx].label}
                </div>
                <div
                  className={`login-slide-value ${
                    slides[slideIdx].level ? `login-level-${slides[slideIdx].level}` : ""
                  }`}
                >
                  {slides[slideIdx].value}
                </div>
              </div>
              <div className="login-dots">
                {slides.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`login-dot ${i === slideIdx ? "active" : ""}`}
                    onClick={() => setSlideIdx(i)}
                    aria-label={`Slide ${i + 1}`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right — Form */}
      <div className="login-right">
        <div className="login-card">
          <h2>Selamat Datang</h2>
          <p className="login-subtitle">Masuk untuk melanjutkan ke dashboard Anda.</p>

          {error && <div className="login-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <div className="input-with-icon">
                <IconUser />
                <input
                  id="username"
                  type="text"
                  className="form-control"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Masukkan username"
                  autoFocus
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <div className="input-with-icon">
                <IconPassword />
                <input
                  id="password"
                  type="password"
                  className="form-control"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan password"
                  autoComplete="current-password"
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
              style={{ width: "100%", marginTop: "0.5rem" }}
            >
              {submitting ? "Memproses..." : "Masuk ke Dashboard"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
