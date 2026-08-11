import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import Login from "./pages/Login.jsx";
import KegiatanList from "./pages/KegiatanList.jsx";
import KegiatanForm from "./pages/KegiatanForm.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import UsersList from "./pages/UsersList.jsx";
import RpdGantt from "./pages/RpdGantt.jsx";
import ChangePassword from "./pages/ChangePassword.jsx";
import MonitoringAnggaran from "./pages/MonitoringAnggaran.jsx";
import SppdList from "./pages/SppdList.jsx";
import SppdForm from "./pages/SppdForm.jsx";
import SppdDetail from "./pages/SppdDetail.jsx";
import SuratTugasList from "./pages/SuratTugasList.jsx";
import SuratTugasForm from "./pages/SuratTugasForm.jsx";
import SuratTugasDetail from "./pages/SuratTugasDetail.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/kegiatan" replace />} />
        <Route path="/kegiatan" element={<KegiatanList />} />
        <Route path="/kegiatan/new" element={<KegiatanForm />} />
        <Route path="/kegiatan/:id/edit" element={<KegiatanForm />} />
        <Route path="/dashboard" element={<Dashboard />} />

        {/* Monitoring sub-routes */}
        <Route path="/monitoring/penyerapan" element={<MonitoringAnggaran />} />
        <Route path="/monitoring/rpd-timeline" element={<RpdGantt />} />

        {/* Redirect old paths */}
        <Route path="/monitoring" element={<Navigate to="/monitoring/penyerapan" replace />} />
        <Route path="/rpd-timeline" element={<Navigate to="/monitoring/rpd-timeline" replace />} />

        {/* SPPD */}
        <Route path="/sppd" element={<SppdList />} />
        <Route path="/sppd/new" element={<SppdForm />} />
        <Route path="/sppd/:id" element={<SppdDetail />} />
        <Route path="/sppd/:id/edit" element={<SppdForm />} />

        {/* Surat Tugas — prerequisite for SPPD */}
        <Route path="/sppd/surat-tugas" element={<SuratTugasList />} />
        <Route path="/sppd/surat-tugas/new" element={<SuratTugasForm />} />
        <Route path="/sppd/surat-tugas/:id" element={<SuratTugasDetail />} />
        <Route path="/sppd/surat-tugas/:id/edit" element={<SuratTugasForm />} />

        <Route path="/users" element={<UsersList />} />
        <Route path="/change-password" element={<ChangePassword />} />
      </Route>
      <Route path="*" element={<Navigate to="/kegiatan" replace />} />
    </Routes>
  );
}
