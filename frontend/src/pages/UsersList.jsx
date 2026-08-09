import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import client from "../api/client.js";

export default function UsersList() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [resetTarget, setResetTarget] = useState(null); // { id, username }
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "operator", unit_kerja_id: "" });
  const [unitKerja, setUnitKerja] = useState([]);
  const [creating, setCreating] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(null); // user id yang sedang diproses

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get("/users");
      setUsers(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal mengambil data user.");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUnitKerja = useCallback(async () => {
    try {
      const res = await client.get("/reference/unit-kerja");
      setUnitKerja(res.data.data);
    } catch {
      // Daftar unit kerja hanya diperlukan saat Tambah User —
      // kegagalan fetch akan terlihat di dropdown (kosong).
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchUnitKerja();
  }, [fetchUsers, fetchUnitKerja]);

  const openAddForm = () => {
    setNewUser({ username: "", password: "", role: "operator", unit_kerja_id: "" });
    setError("");
    setSuccessMsg("");
    setShowAddForm(true);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const { username, password, role, unit_kerja_id } = newUser;
    if (username.trim().length < 3) {
      setError("Username minimal 3 karakter.");
      return;
    }
    if (password.length < 8) {
      setError("Password minimal 8 karakter.");
      return;
    }
    if (!unit_kerja_id) {
      setError("Unit kerja wajib dipilih.");
      return;
    }

    setCreating(true);
    setError("");
    try {
      const res = await client.post("/users", {
        username: username.trim(),
        password,
        role,
        unit_kerja_id: Number(unit_kerja_id),
      });
      setSuccessMsg(res.data.message);
      setShowAddForm(false);
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.error || "Gagal membuat user.");
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (user) => {
    if (
      user.is_active &&
      !window.confirm(
        `Nonaktifkan user "${user.username}"?\n\nUser tidak bisa login lagi, tapi seluruh data kegiatannya tetap tersimpan.`
      )
    ) {
      return;
    }
    setStatusUpdating(user.id);
    setError("");
    setSuccessMsg("");
    try {
      const res = await client.patch(`/users/${user.id}/status`, {
        is_active: !user.is_active,
      });
      setSuccessMsg(res.data.message);
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.error || "Gagal mengubah status user.");
    } finally {
      setStatusUpdating(null);
    }
  };

  const openResetDialog = (user) => {
    setResetTarget(user);
    setNewPassword("");
    setError("");
    setSuccessMsg("");
  };

  const handleReset = async (e) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 8) {
      setError("Password minimal 8 karakter.");
      return;
    }

    setResetting(true);
    setError("");
    try {
      const res = await client.post(`/users/${resetTarget.id}/reset-password`, {
        new_password: newPassword,
      });
      setSuccessMsg(res.data.message);
      setResetTarget(null);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal mereset password.");
    } finally {
      setResetting(false);
    }
  };

  const stored = localStorage.getItem("user");
  const currentUser = stored ? JSON.parse(stored) : null;

  const ROLE_BADGE = {
    admin: "badge-admin",
    operator: "badge-operator",
  };

  const ROLE_LABEL = {
    admin: "Admin",
    operator: "Operator",
  };

  // Admin-only guard (after hooks)
  if (!currentUser || currentUser.role !== "admin") {
    return <Navigate to="/kegiatan" replace />;
  }

  return (
    <div>
      <div className="page-header">
        <h2>Manajemen User</h2>
        <button className="btn btn-primary" onClick={openAddForm}>
          ＋ Tambah User
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div className="card" style={{ border: "2px solid var(--primary)" }}>
          <h3 className="mb-2">
            Reset Password: <strong>{resetTarget.username}</strong>
          </h3>
          <p className="text-muted mb-2">
            Unit: {resetTarget.nama_unit} · Role: {resetTarget.role}
          </p>
          <form onSubmit={handleReset}>
            <div className="form-row" style={{ alignItems: "end" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="reset-password">Password Baru</label>
                <input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  className="form-control"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimal 8 karakter"
                  autoFocus
                />
              </div>
              <div className="btn-group" style={{ marginBottom: 0 }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={resetting}
                >
                  {resetting ? "Mereset..." : "Reset Password"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setResetTarget(null)}
                >
                  Batal
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Tambah User Form */}
      {showAddForm && (
        <div className="card" style={{ border: "2px solid var(--primary)" }}>
          <h3 className="mb-2">Tambah User Baru</h3>
          <form onSubmit={handleCreate}>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="new-username">Username</label>
                <input
                  id="new-username"
                  type="text"
                  className="form-control"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  placeholder="Minimal 3 karakter"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label htmlFor="new-password">Password Awal</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  className="form-control"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="Minimal 8 karakter"
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="new-unit">Unit Kerja</label>
                <select
                  id="new-unit"
                  className="form-control"
                  value={newUser.unit_kerja_id}
                  onChange={(e) => setNewUser({ ...newUser, unit_kerja_id: e.target.value })}
                >
                  <option value="">-- Pilih Unit Kerja --</option>
                  {unitKerja.map((uk) => (
                    <option key={uk.id} value={uk.id}>
                      {uk.kode_unit} — {uk.nama_unit}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="new-role">Role</label>
                <select
                  id="new-role"
                  className="form-control"
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                >
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="btn-group">
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? "Membuat..." : "Simpan User"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowAddForm(false)}
              >
                Batal
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card card-flush">
        {loading ? (
          <div className="empty-state"><p>Memuat data...</p></div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th scope="col">Username</th>
                  <th scope="col">Unit Kerja</th>
                  <th scope="col">Role</th>
                  <th scope="col">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td><strong>{u.username}</strong></td>
                    <td>{u.nama_unit}</td>
                    <td>
                      <span className={`badge ${ROLE_BADGE[u.role] || "badge-draft"}`}>
                        {ROLE_LABEL[u.role] || u.role}
                      </span>{" "}
                      {!u.is_active && <span className="badge badge-draft">Nonaktif</span>}
                    </td>
                    <td>
                      <div className="btn-group">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => openResetDialog(u)}
                        >
                          🔑 Reset Password
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={statusUpdating === u.id}
                          onClick={() => handleToggleActive(u)}
                        >
                          {statusUpdating === u.id
                            ? "Memproses..."
                            : u.is_active
                              ? "⏹ Nonaktifkan"
                              : "▶ Aktifkan"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty-state" style={{ padding: "1.5rem" }}>
                      Belum ada user.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
