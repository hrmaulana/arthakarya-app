import { useState, useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { sppdApi } from "../lib/sppdApi.js";
import {
  LogoMark, IconKegiatan, IconDashboard, IconUsers,
  IconLock, IconLogout, IconSun, IconMoon, IconChart, IconMonitor,
  IconChevronDown, IconPlane, IconMenu, IconX, IconFile,
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
    return location.pathname.startsWith("/monitoring");
  });

  const [sppdOpen, setSppdOpen] = useState(() => {
    return location.pathname.startsWith("/sppd");
  });

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [alerts, setAlerts] = useState(null);

  const closeSidebar = () => setSidebarOpen(false);

  // Fetch alerts
  useEffect(() => {
    sppdApi.alerts().then((res) => setAlerts(res.data.data)).catch(() => {});
    const interval = setInterval(() => {
      sppdApi.alerts().then((res) => setAlerts(res.data.data)).catch(() => {});
    }, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(interval);
  }, []);

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

  const totalAlerts = alerts
    ? (alerts.overdue_pertanggungjawaban || 0)
      + (alerts.perlu_revisi || 0)
      + (alerts.menunggu_unggahan || 0)
      + (alerts.pending_verifikasi || 0)
    : 0;

  return (
    <div className="app-layout">
      {/* Mobile overlay */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={closeSidebar} />}

      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? " open" : ""}`} onClick={closeSidebar}>
        <button className="sidebar-close" onClick={closeSidebar}>
          <IconX />
        </button>

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

          {/* Monitoring */}
          <li>
            <button
              className="sidebar-parent"
              onClick={(e) => { e.stopPropagation(); setMonitoringOpen((o) => !o); }}
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
                <li>
                  <NavLink
                    to="/monitoring/rpd-timeline"
                    className={({ isActive }) => (isActive ? "active" : "")}
                  >
                    RPD Timeline
                  </NavLink>
                </li>
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

          {/* SPPD — expandable submenu */}
          <li>
            <button
              className="sidebar-parent"
              onClick={(e) => { e.stopPropagation(); setSppdOpen((o) => !o); }}
            >
              <IconPlane /> SPPD
              {totalAlerts > 0 && (
                <span className="sidebar-badge">{totalAlerts}</span>
              )}
              <IconChevronDown className={`chevron ${sppdOpen ? "open" : ""}`} />
            </button>
            {sppdOpen && (
              <ul className="sidebar-submenu">
                <li>
                  <NavLink
                    to="/sppd/surat-tugas"
                    className={({ isActive }) => (isActive ? "active" : "")}
                  >
                    <IconFile /> Surat Tugas
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/sppd"
                    className={({ isActive }) => (isActive ? "active" : "")}
                    end
                  >
                    <IconPlane /> Daftar SPPD
                    {alerts?.pending_approval > 0 && user?.role === "admin" && (
                      <span className="sidebar-badge sidebar-badge-warn">{alerts.pending_approval}</span>
                    )}
                  </NavLink>
                </li>
              </ul>
            )}
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
        <div className="mobile-topbar">
          <button className="hamburger" onClick={() => setSidebarOpen(true)}>
            <IconMenu />
          </button>
          <span className="mobile-topbar-title">Arthakarya</span>
        </div>

        <div className="page-content">
          <Outlet context={{ formatRupiah, user }} />
        </div>
      </div>
    </div>
  );
}
