// SPDX-License-Identifier: MulanPSL-2.0
import { t, useLanguage } from "./i18n";
import { lazy, Suspense, useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { Alert, Button, ConfigProvider, Layout, Loading, Menu, Space } from "tdesign-react";
import enUS from "tdesign-react/es/locale/en_US";
import zhCN from "tdesign-react/es/locale/zh_CN";
import {
  ChartLineIcon,
  FileIcon,
  InfoCircleIcon,
  LogoutIcon,
  MenuFoldIcon,
  MenuUnfoldIcon,
  ServerIcon,
  SettingIcon,
} from "tdesign-icons-react";
import {
  authToken,
  initialAddress,
  ping,
  request,
  serverAddress,
  sessionEvents,
  setServer,
  setToken,
} from "./api";
import {
  desktop,
  desktopBuild,
  initializeRuntime,
  isBuiltin,
  runtime,
  switchMode,
} from "./desktop";
import { DatabaseFiles } from "./components/DatabaseFiles";
import { Logo } from "./components/Logo";
import { MetadataProvider } from "./data";
import { useMetadata } from "./metadata";
import { action } from "./helpers";
import { AuthPage, ServerPage } from "./pages/Access";
import { SettingsPage } from "./pages/Settings";
import { ReportsPage, ReportPage } from "./pages/Reports";
import { AboutPage } from "./pages/About";
import type { ServerInfo } from "./version";
import "./App.css";

const AnalysisPage = lazy(() =>
  import("./pages/Analysis").then((module) => ({ default: module.AnalysisPage })),
);

function WorkspaceMenu() {
  const location = useLocation();
  const navigate = useNavigate();
  const [narrow] = useState(() => window.matchMedia("(max-width: 700px)"));
  const [collapsed, setCollapsed] = useState(narrow.matches);
  useEffect(() => {
    const resize = () => setCollapsed(narrow.matches);
    narrow.addEventListener("change", resize);
    return () => narrow.removeEventListener("change", resize);
  }, [narrow]);
  const toggleLabel = collapsed ? t("Expand sidebar") : t("Collapse sidebar");
  return (
    <nav className="app-sidebar" aria-label={t("Workspace")}>
      <Menu
        width={["192px", "64px"]}
        collapsed={collapsed}
        value={location.pathname.split("/")[1] || "reports"}
        logo={
          <Space align="center">
            <Logo size={26} alt={collapsed ? "Fortuna" : ""} />
            {!collapsed && <strong className="brand">Fortuna</strong>}
          </Space>
        }
        operations={
          <div className="sidebar-actions">
            <Button
              shape="circle"
              variant="text"
              icon={collapsed ? <MenuUnfoldIcon /> : <MenuFoldIcon />}
              aria-expanded={!collapsed}
              aria-label={toggleLabel}
              title={toggleLabel}
              onClick={() => setCollapsed(!collapsed)}
            />
            <Space direction={collapsed ? "vertical" : "horizontal"} size={4}>
              <Button
                shape="circle"
                variant="text"
                icon={<ServerIcon />}
                aria-label={t("Server")}
                title={t("Server")}
                onClick={() => navigate("/server")}
              />
              {!isBuiltin() && (
                <Button
                  shape="circle"
                  variant="text"
                  icon={<LogoutIcon />}
                  aria-label={t("Log out")}
                  title={t("Log out")}
                  onClick={() =>
                    action(async () => {
                      await request("POST", "/logout");
                      setToken("");
                    })
                  }
                />
              )}
            </Space>
          </div>
        }
      >
        <Menu.MenuItem value="reports" href="#/reports" icon={<FileIcon />}>
          {t("Reports")}
        </Menu.MenuItem>
        <Menu.MenuItem value="analysis" href="#/analysis" icon={<ChartLineIcon />}>
          {t("Analysis")}
        </Menu.MenuItem>
        <Menu.MenuItem value="settings" href="#/settings" icon={<SettingIcon />}>
          {t("Settings")}
        </Menu.MenuItem>
        <Menu.MenuItem value="about" href="#/about" icon={<InfoCircleIcon />}>
          {t("About")}
        </Menu.MenuItem>
      </Menu>
    </nav>
  );
}

function Workspace({ serverVersion }: { serverVersion: ServerInfo }) {
  const { error, refresh } = useMetadata();
  return (
    <Layout direction="horizontal" className="app-layout">
      <WorkspaceMenu />
      <Layout className="workspace-content">
        <Layout.Content className="page">
          {error && (
            <Alert
              theme="error"
              message={error}
              operation={
                <Button
                  shape="round"
                  variant="text"
                  onClick={() => {
                    void refresh().catch(() => {});
                  }}
                >
                  {t("Retry metadata")}
                </Button>
              }
            />
          )}
          <Routes>
            <Route path="/reports" element={<ReportsPage serverVersion={serverVersion} />} />
            <Route
              path="/reports/:reportId"
              element={<ReportPage serverVersion={serverVersion} />}
            />
            <Route
              path="/analysis"
              element={
                <Suspense fallback={<Loading text={t("Loading analysis…")} />}>
                  <AnalysisPage />
                </Suspense>
              }
            />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/about" element={<AboutPage server={serverVersion} />} />
            <Route path="*" element={<Navigate to="/reports" replace />} />
          </Routes>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

function Application() {
  const navigate = useNavigate();
  const location = useLocation();
  const [identity, setIdentity] = useState(authToken());
  const [address, setAddress] = useState(initialAddress);
  const [connection, setConnection] = useState<{ address: string; version: ServerInfo | null }>();
  useEffect(() => {
    const session = () => {
      setIdentity(authToken());
      setAddress(initialAddress());
    };
    const configure = () => navigate("/server");
    sessionEvents.addEventListener("session", session);
    sessionEvents.addEventListener("configure", configure);
    sessionEvents.addEventListener("server", session);
    return () => {
      sessionEvents.removeEventListener("session", session);
      sessionEvents.removeEventListener("configure", configure);
      sessionEvents.removeEventListener("server", session);
    };
  }, [navigate]);
  useEffect(() => {
    if (connection?.address === address) return;
    let active = true;
    void ping(address)
      .then((version) => {
        if (!active) return;
        if (!desktopBuild && !serverAddress()) void setServer(address);
        setConnection({ address, version });
      })
      .catch(() => {
        if (active) setConnection({ address, version: null });
      });
    return () => {
      active = false;
    };
  }, [address, connection?.address]);
  if (location.pathname === "/server") return <ServerPage onConnected={setConnection} />;
  if (connection?.address !== address)
    return <Loading fullscreen text={t("Connecting to Fortuna…")} />;
  if ((!isBuiltin() && !serverAddress()) || connection.version === null)
    return <Navigate to="/server" replace />;
  if (!isBuiltin() && !identity)
    return location.pathname === "/login" ? <AuthPage /> : <Navigate to="/login" replace />;
  return (
    <MetadataProvider key={`${serverAddress()}:${identity}`}>
      <Workspace serverVersion={connection.version} />
    </MetadataProvider>
  );
}

function DesktopStartup() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(() => (desktop ? "" : t("Desktop connection unavailable")));
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    const remove = desktop.onUnavailable(setError);
    void desktop
      .runtime()
      .then((info) => {
        if (!active) return;
        initializeRuntime(info);
        if (info.error) setError(info.error);
        else setReady(true);
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
      remove();
    };
  }, []);
  if (error)
    return (
      <main className="access-page">
        <Space direction="vertical">
          <Alert theme="error" message={t("Could not open the workspace")} />
          <details>
            <summary>{t("Diagnostics")}</summary>
            <pre>{error}</pre>
          </details>
          <Space>
            <Button
              shape="round"
              theme="default"
              onClick={() => action(() => switchMode(runtime?.mode ?? "builtin"))}
            >
              {t("Retry")}
            </Button>
            {runtime?.mode === "file" && (
              <Button
                shape="round"
                theme="default"
                onClick={() => action(() => switchMode("builtin"))}
              >
                {t("Built-in")}
              </Button>
            )}
            <Button
              shape="round"
              theme="default"
              onClick={() => action(() => switchMode("remote"))}
            >
              {t("Remote server")}
            </Button>
          </Space>
          <DatabaseFiles />
        </Space>
      </main>
    );
  return ready ? <Application /> : <Loading fullscreen text={t("Opening workspace…")} />;
}

export default function App() {
  const language = useLanguage();
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return (
    <ConfigProvider globalConfig={language === "zh-CN" ? zhCN : enUS}>
      <HashRouter>
        {desktopBuild ? (
          <div className="desktop-shell">
            <div className="window-drag-region" aria-hidden="true" />
            <DesktopStartup />
          </div>
        ) : (
          <Application />
        )}
      </HashRouter>
    </ConfigProvider>
  );
}
