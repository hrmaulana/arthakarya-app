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

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const openResetDialog = (user) => {
    setResetTarget(user);
    setNewPassword("");
    setError("");
    setSuccessMsg("");
  };

  const handleReset = async (e) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      setError("Password minimal 6 karakter.");
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
    admin: "badge-disetujui",
    operator: "badge-diajukan",
  };

  // Admin-only guard (after hooks)
  if (!currentUser || currentUser.role !== "admin") {
    return <Navigate to="/kegiatan" replace />;
  }

  return (
    <div>
      <div className="page-header">
        <h2>Manajemen User</h2>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div className="card" style={{ border: "2px solid var(--color-primary)", marginBottom: "1.5rem" }}>
          <h3 className="mb-2">
            Reset Password: <strong>{resetTarget.username}</strong>
          </h3>
          <p className="text-muted mb-2">
            Unit: {resetTarget.nama_unit} · Role: {resetTarget.role}
          </p>
          <form onSubmit={handleReset}>
            <div className="form-row" style={{ alignItems: "end" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Password Baru</label>
                <input
                  type="text"
                  className="form-control"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimal 6 karakter"
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

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div className="empty-state"><p>Memuat data...</p></div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Unit Kerja</th>
                  <th>Role</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td><strong>{u.username}</strong></td>
                    <td>{u.nama_unit}</td>
                    <td>
                      <span className={`badge ${ROLE_BADGE[u.role] || ""}`}>
                        {u.role}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => openResetDialog(u)}
                      >
                        🔑 Reset Password
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
