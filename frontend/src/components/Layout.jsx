import { useState, useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import {
  LogoMark, IconKegiatan, IconDashboard, IconUsers,
  IconLock, IconLogout, IconSun, IconMoon, IconChart, IconMonitor,
} from "./Icons.jsx";

function getInitials(name) {
  if (!name) return "?";
  return name.charAt(0).toUpperCase();
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem("arthakarya-theme");
    if (stored) return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("arthakarya-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "light" ? "dark" : "light"));

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const formatRupiah = (n) => {
    if (n === null || n === undefined) return "-";
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  };

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo-icon">
            <LogoMark />
          </div>
          <div className="sidebar-brand-text">
            <h1>Arthakarya</h1>
            <span>Perencanaan & Anggaran</span>
          </div>
        </div>

        <div className="sidebar-divider" />
        <div className="sidebar-section-label">Menu</div>

        <ul className="sidebar-nav">
          <li>
            <NavLink to="/kegiatan" className={({ isActive }) => (isActive ? "active" : "")}>
              <IconKegiatan /> Daftar Kegiatan
            </NavLink>
          </li>
          <li>
            <NavLink to="/dashboard" className={({ isActive }) => (isActive ? "active" : "")}>
              <IconDashboard /> {user?.role === "admin" ? "Dashboard Rekap" : "Rekap"}
            </NavLink>
          </li>
          <li>
            <NavLink to="/monitoring" className={({ isActive }) => (isActive ? "active" : "")}>
              <IconMonitor /> Monitoring Anggaran
            </NavLink>
          </li>
          {user?.role === "admin" && (
            <>
              <li>
                <NavLink to="/rpd-timeline" className={({ isActive }) => (isActive ? "active" : "")}>
                  <IconChart /> RPD & Timeline
                </NavLink>
              </li>
              <li>
                <NavLink to="/users" className={({ isActive }) => (isActive ? "active" : "")}>
                  <IconUsers /> Manajemen User
                </NavLink>
              </li>
            </>
          )}
          <li>
            <NavLink to="/change-password" className={({ isActive }) => (isActive ? "active" : "")}>
              <IconLock /> Ganti Password
            </NavLink>
          </li>
        </ul>

        <div className="sidebar-footer">
          <div className="sidebar-avatar">{getInitials(user?.username)}</div>
          <div className="sidebar-user-info">
            <strong>{user?.username}</strong>
            <span>{user?.nama_unit || user?.role}</span>
          </div>
          <button className="theme-toggle" onClick={toggleTheme} title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
            {theme === "light" ? <IconMoon /> : <IconSun />}
          </button>
          <button
            onClick={handleLogout}
            className="theme-toggle"
            title="Logout"
          >
            <IconLogout />
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="main-content">
        <div className="page-content">
          <Outlet context={{ formatRupiah, user }} />
        </div>
      </div>
    </div>
  );
}
