import { useState, useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import {
  LogoMark, IconKegiatan, IconDashboard, IconUsers,
  IconLock, IconLogout, IconSun, IconMoon, IconChart, IconMonitor,
  IconChevronDown, IconPlane,
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

  const [monitoringOpen, setMonitoringOpen] = useState(() => {
    // Auto-open if already on a monitoring sub-route
    return location.pathname.startsWith("/monitoring");
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

          {/* Monitoring — expandable parent */}
          <li>
            <button
              className="sidebar-parent"
              onClick={() => setMonitoringOpen((o) => !o)}
            >
              <IconMonitor /> Monitoring
              <IconChevronDown className={`chevron ${monitoringOpen ? "open" : ""}`} />
            </button>
            {monitoringOpen && (
              <ul className="sidebar-submenu">
                <li>
                  <NavLink
                    to="/monitoring/penyerapan"
                    className={({ isActive }) => (isActive ? "active" : "")}
                    end
                  >
                    Penyerapan
                  </NavLink>
                </li>
                {user?.role === "admin" && (
                  <li>
                    <NavLink
                      to="/monitoring/rpd-timeline"
                      className={({ isActive }) => (isActive ? "active" : "")}
                    >
                      RPD Timeline
                    </NavLink>
                  </li>
                )}
              </ul>
            )}
          </li>

          {user?.role === "admin" && (
            <li>
              <NavLink to="/users" className={({ isActive }) => (isActive ? "active" : "")}>
                <IconUsers /> Manajemen User
              </NavLink>
            </li>
          )}

          {/* SPPD — Coming Soon */}
          <li>
            <NavLink
              to="/sppd"
              end
              className={({ isActive }) =>
                `sppd-link${isActive ? " active" : ""}`
              }
            >
              <IconPlane /> SPPD
              <span className="coming-soon-badge">Segera</span>
            </NavLink>
          </li>

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
