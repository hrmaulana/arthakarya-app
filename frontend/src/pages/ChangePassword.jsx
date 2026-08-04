import { useState } from "react";
import client from "../api/client.js";

export default function ChangePassword() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!oldPassword || !newPassword || !confirmPassword) {
      setError("Semua kolom wajib diisi.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password baru minimal 8 karakter.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Konfirmasi password tidak cocok.");
      return;
    }

    if (oldPassword === newPassword) {
      setError("Password baru tidak boleh sama dengan password lama.");
      return;
    }

    setSubmitting(true);
    try {
      await client.put("/auth/change-password", {
        old_password: oldPassword,
        new_password: newPassword,
      });
      setSuccess("Password berhasil diubah.");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.response?.data?.error || "Gagal mengubah password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: "500px" }}>
      <div className="page-header">
        <h2>Ganti Password</h2>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="old">Password Lama</label>
            <input
              id="old"
              type="password"
              className="form-control"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          <div className="form-group">
            <label htmlFor="new">Password Baru</label>
            <input
              id="new"
              type="password"
              className="form-control"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirm">Konfirmasi Password Baru</label>
            <input
              id="confirm"
              type="password"
              className="form-control"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
          >
            {submitting ? "Menyimpan..." : "Simpan Password Baru"}
          </button>
        </form>
      </div>
    </div>
  );
}
