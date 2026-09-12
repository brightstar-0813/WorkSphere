import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "./auth";
import { AppFooter } from "./components/AppFooter";
import { Logo } from "./components/Logo";
import { LanguagePicker } from "./components/LanguagePicker";
import { mediaUrl } from "./config";
import { ThemePicker } from "./ThemePicker";
import { useAlerts } from "./alerts/AlertProvider";
import { LoginPage } from "./pages/LoginPage";
import { ShareAcceptPage } from "./pages/ShareAcceptPage";
import { JobsPage } from "./pages/JobsPage";
import { HuntingBidsPage } from "./pages/HuntingBidsPage";
import { HuntingFetchPage } from "./pages/HuntingFetchPage";
import { HuntingInterviewsPage } from "./pages/HuntingInterviewsPage";
import { CalendarPage } from "./pages/CalendarPage";
import { MoneyPage } from "./pages/MoneyPage";
import { DiscussPage } from "./pages/DiscussPage";
import { ReportsPage } from "./pages/ReportsPage";
import { AdminPage } from "./pages/AdminPage";
import { ProfilePage } from "./pages/ProfilePage";

type NavItem = {
  to: string;
  key: string;
  icon: string;
  adminOnly?: boolean;
  children?: readonly { to: string; key: string }[];
};

const NAV: readonly NavItem[] = [
  { to: "/jobs", key: "nav.jobs", icon: "◈" },
  {
    to: "/hunting",
    key: "nav.hunting",
    icon: "◎",
    children: [
      { to: "/hunting/fetch", key: "nav.huntingFetch" },
      { to: "/hunting/bids", key: "nav.huntingBids" },
      { to: "/hunting/interviews", key: "nav.huntingInterviews" },
    ],
  },
  { to: "/calendar", key: "nav.calendar", icon: "▦" },
  { to: "/money", key: "nav.money", icon: "＄" },
  { to: "/discuss", key: "nav.discuss", icon: "☰" },
  { to: "/reports", key: "nav.reports", icon: "▴" },
  { to: "/admin", key: "nav.admin", icon: "★", adminOnly: true },
];

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Shell() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { permission, requestPermission } = useAlerts();
  const location = useLocation();
  const active = NAV.find((n) => location.pathname.startsWith(n.to));
  const activeChild = active?.children?.find((c) => location.pathname.startsWith(c.to));
  const onProfile = location.pathname.startsWith("/profile");
  const initials = initialsOf(user?.name ?? "U");
  const topTitle = onProfile
    ? t("profile.heading")
    : activeChild
      ? t(activeChild.key)
      : active
        ? t(active.key)
        : t("appName");

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t("common.skipToMain")}
      </a>
      <aside className="sidebar">
        <div className="brand-block">
          <Logo withWordmark wordmark={t("appName")} size={34} light />
        </div>

        <NavLink to="/profile" className={`user-chip${onProfile ? " active" : ""}`}>
          <div className="user-avatar">
            {user?.avatarUrl ? <img src={mediaUrl(user.avatarUrl)} alt="" /> : initials}
          </div>
          <div className="user-meta">
            <strong>{user?.name}</strong>
            <span className="role-badge">{user?.role}</span>
          </div>
        </NavLink>

        <div>
          <p className="nav-label">{t("nav.workspace")}</p>
          <nav>
            {NAV.filter((n) => !n.adminOnly || user?.role === "ADMIN").map((item) =>
              item.children ? (
                <div
                  key={item.to}
                  className={`nav-group${location.pathname.startsWith(item.to) ? " open" : ""}`}
                >
                  <NavLink
                    to={item.children[0]!.to}
                    className={() =>
                      location.pathname.startsWith(item.to) ? "active nav-parent" : "nav-parent"
                    }
                  >
                    <span className="nav-ico">{item.icon}</span>
                    {t(item.key)}
                  </NavLink>
                  <div className="nav-sub">
                    {item.children.map((child) => (
                      <NavLink key={child.to} to={child.to} end={false}>
                        {t(child.key)}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ) : (
                <NavLink key={item.to} to={item.to}>
                  <span className="nav-ico">{item.icon}</span>
                  {t(item.key)}
                </NavLink>
              )
            )}
          </nav>
        </div>

        <div className="sidebar-foot">
          <button className="btn ghost" onClick={logout}>
            {t("nav.logout")}
          </button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <span className="topbar-kicker">{t("appName")}</span>
            <strong>{topTitle}</strong>
          </div>
          <div className="topbar-actions">
            {permission !== "granted" && permission !== "unsupported" && (
              <button className="btn alert-enable-btn" type="button" onClick={() => void requestPermission()}>
                {t("alerts.enable")}
              </button>
            )}
            {permission === "granted" && (
              <span className="alert-armed" title={t("alerts.enabledHint")}>
                {t("alerts.armed")}
              </span>
            )}
            <LanguagePicker />
            <ThemePicker compact />
          </div>
        </header>
        <main className="main" id="main-content" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<Navigate to="/jobs" replace />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/hunting" element={<Navigate to="/hunting/fetch" replace />} />
            <Route path="/hunting/fetch" element={<HuntingFetchPage />} />
            <Route path="/hunting/bids" element={<HuntingBidsPage />} />
            <Route path="/hunting/interviews" element={<HuntingInterviewsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/money" element={<MoneyPage />} />
            <Route path="/discuss" element={<DiscussPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route
              path="/admin"
              element={user?.role === "ADMIN" ? <AdminPage /> : <Navigate to="/jobs" />}
            />
          </Routes>
        </main>
      </div>
      <AppFooter />
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <p className="center muted">…</p>;
  return (
    <Routes>
      <Route path="/share/:token" element={<ShareAcceptPage />} />
      <Route path="/*" element={user ? <Shell /> : <LoginPage />} />
    </Routes>
  );
}
