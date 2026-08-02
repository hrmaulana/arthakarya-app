import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { LogoMark, IconUser, IconPassword } from "../components/Icons.jsx";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { login, user } = useAuth();
  const navigate = useNavigate();

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
      {/* Left — Brand */}
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

          <div className="login-demo">
            Demo: <strong>admin</strong> / <strong>operator_uk2</strong><br />
            password: <strong>password123</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
