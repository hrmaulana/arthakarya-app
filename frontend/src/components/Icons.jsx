/**
 * Arthakarya — Custom Icon Set
 * Bold 2.5px stroke, 24×24 grid, distinctive from generic Feather/Lucide defaults.
 * Every icon is purpose-designed for this application.
 */
import { memo } from "react";

const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2.5",
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

// ── Brand Mark: Stylized rising chart forming "AK" ──
export const LogoMark = memo(() => (
  <svg {...iconProps} strokeWidth="2.5">
    <polyline points="4 20 8 14 12 16 16 8 20 4" />
    <polyline points="16 4 20 4 20 8" />
  </svg>
));

// ── Sidebar Navigation ──

// Clipboard with layered document — distinct from generic list icon
export const IconKegiatan = memo(() => (
  <svg {...iconProps}>
    <rect x="4" y="3" width="14" height="18" rx="2" />
    <line x1="8" y1="7" x2="16" y2="7" />
    <line x1="8" y1="11" x2="16" y2="11" />
    <line x1="8" y1="15" x2="12" y2="15" />
    <rect x="9" y="1" width="4" height="4" rx="1" />
  </svg>
));

// Three connected bars — dynamic growth story, not static grid
export const IconDashboard = memo(() => (
  <svg {...iconProps}>
    <rect x="2" y="18" width="4" height="4" rx="1" />
    <rect x="8" y="12" width="4" height="10" rx="1" />
    <rect x="14" y="5" width="4" height="17" rx="1" />
    <rect x="20" y="14" width="4" height="8" rx="1" />
  </svg>
));

// Two overlapping silhouettes — angled & varied for character
export const IconUsers = memo(() => (
  <svg {...iconProps}>
    <circle cx="8" cy="7" r="3" />
    <path d="M1 21v-1.5a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1.5" />
    <circle cx="17" cy="8" r="2.5" />
    <path d="M14 20v-1a4 4 0 0 1 3-3.8" />
  </svg>
));

// Shield with keyhole — security with substance, not a generic padlock
export const IconLock = memo(() => (
  <svg {...iconProps}>
    <path d="M12 2L3 7v4c0 6 4 11 9 11s9-5 9-11V7l-9-5z" />
    <circle cx="12" cy="13" r="2" />
    <line x1="12" y1="15" x2="12" y2="18" />
  </svg>
));

// Arrow breaking out of a frame — exit with momentum
export const IconLogout = memo(() => (
  <svg {...iconProps}>
    <rect x="2" y="4" width="14" height="16" rx="2" />
    <path d="M16 12h6M20 9l3 3-3 3" />
  </svg>
));

// ── Theme Toggle ──
export const IconSun = memo(() => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="4" />
    <line x1="12" y1="2" x2="12" y2="4" />
    <line x1="12" y1="20" x2="12" y2="22" />
    <line x1="3" y1="12" x2="1" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="5.6" y1="5.6" x2="4.2" y2="4.2" />
    <line x1="18.4" y1="18.4" x2="19.8" y2="19.8" />
    <line x1="5.6" y1="18.4" x2="4.2" y2="19.8" />
    <line x1="18.4" y1="5.6" x2="19.8" y2="4.2" />
  </svg>
));

export const IconMoon = memo(() => (
  <svg {...iconProps}>
    <path d="M20 14.5A8 8 0 1 1 10 4a7.5 7.5 0 0 0 10 10.5z" />
  </svg>
));

// ── Login Form ──

// Person silhouette with grounded stance
export const IconUser = memo(() => (
  <svg {...iconProps}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1" />
  </svg>
));

// Lock with clean geometry
export const IconPassword = memo(() => (
  <svg {...iconProps}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    <circle cx="12" cy="16" r="1.5" />
    <line x1="12" y1="17.5" x2="12" y2="19" />
  </svg>
));

// ── Actions ──
export const IconPlus = memo(() => (
  <svg {...iconProps}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
));

export const IconEdit = memo(() => (
  <svg {...iconProps} width="16" height="16">
    <path d="M15 3.5L20.5 9 9 20.5H3.5V15L15 3.5z" />
    <line x1="13" y1="5.5" x2="18.5" y2="11" />
  </svg>
));

export const IconTrash = memo(() => (
  <svg {...iconProps} width="16" height="16">
    <polyline points="3 6 5 6 21 6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
));

export const IconSend = memo(() => (
  <svg {...iconProps} width="16" height="16">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
));

export const IconCheck = memo(() => (
  <svg {...iconProps} width="16" height="16">
    <polyline points="20 6 9 17 4 12" />
  </svg>
));

export const IconX = memo(() => (
  <svg {...iconProps} width="16" height="16">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
));

// Pie chart — Monitoring Anggaran (penyerapan)
export const IconMonitor = memo(() => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="12" x2="12" y2="3" />
    <line x1="12" y1="12" x2="19.5" y2="15.5" />
    <path d="M12 3a9 9 0 0 1 7.5 12.5" />
  </svg>
));

// Bar chart with timeline — RPD & Gantt
export const IconChart = memo(() => (
  <svg {...iconProps}>
    <rect x="2" y="18" width="3" height="4" rx="0.5" />
    <rect x="7" y="12" width="3" height="10" rx="0.5" />
    <rect x="12" y="6" width="3" height="16" rx="0.5" />
    <rect x="17" y="10" width="3" height="12" rx="0.5" />
    <polyline points="3 18 9 12 14 6 19 10" />
  </svg>
));

export const IconRefresh = memo(() => (
  <svg {...iconProps} width="16" height="16">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.5 15a9 9 0 1 1-2.6-8.3L23 10" />
  </svg>
));
