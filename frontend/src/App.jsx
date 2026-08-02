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
        <Route path="/rpd-timeline" element={<RpdGantt />} />
        <Route path="/users" element={<UsersList />} />
        <Route path="/change-password" element={<ChangePassword />} />
      </Route>
      <Route path="*" element={<Navigate to="/kegiatan" replace />} />
    </Routes>
  );
}
