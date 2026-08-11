import { useState, useEffect } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { suratTugasApi } from "../lib/suratTugasApi.js";

export default function SuratTugasList() {
  const navigate = useNavigate();
  const { user } = useOutletContext();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await suratTugasApi.list();
      setList(res.data.data);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchList(); }, []);

  const handleDelete = async (id) => {
    try {
      await suratTugasApi.remove(id);
      setConfirmDelete(null);
      fetchList();
    } catch (err) {
      alert(err.response?.data?.error || "Gagal menghapus Surat Tugas.");
      setConfirmDelete(null);
    }
  };

  return (
    <>
      <div className="page-header">
        <h2>Surat Tugas & Undangan</h2>
        <button className="btn btn-primary" onClick={() => navigate("/sppd/surat-tugas/new")}>
          + Upload Surat Tugas
        </button>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Daftar Surat Tugas</h3>
        </div>

        {loading ? (
          <div className="empty-state"><p>Memuat data Surat Tugas...</p></div>
        ) : list.length === 0 ? (
          <div className="empty-state">
            <p>Belum ada Surat Tugas. Upload Surat Tugas untuk memulai pengajuan SPPD.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nomor Surat</th>
                  <th>Tanggal</th>
                  <th>Perihal</th>
                  <th>SPPD</th>
                  <th>Diunggah Oleh</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((st) => (
                  <tr key={st.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/sppd/surat-tugas/${st.id}`)}
                  >
                    <td className="font-bold">{st.nomor_surat}</td>
                    <td>
                      {new Date(st.tanggal_surat + "T00:00:00").toLocaleDateString("id-ID", {
                        day: "numeric", month: "long", year: "numeric",
                      })}
                    </td>
                    <td>{st.perihal}</td>
                    <td>
                      <span className="badge badge-secondary">{st.jumlah_sppd} SPPD</span>
                    </td>
                    <td>{st.created_by_username}</td>
                    <td>
                      {parseInt(st.jumlah_sppd) === 0 && (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDelete(st.id);
                          }}
                        >
                          Hapus
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm Delete Modal */}
      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Hapus Surat Tugas?</h3>
            <p>Surat Tugas dan file yang diunggah akan dihapus permanen.</p>
            <div className="btn-group" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Batal</button>
              <button className="btn btn-danger" onClick={() => handleDelete(confirmDelete)}>
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
