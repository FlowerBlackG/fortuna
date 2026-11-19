// SPDX-License-Identifier: MulanPSL-2.0
import { lazy, Suspense, useEffect, useEffectEvent, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { Alert, Button, ConfigProvider, Layout, Loading, Menu, Space } from "tdesign-react";
import enUS from "tdesign-react/es/locale/en_US";
import { ChartLineIcon, FileIcon, SettingIcon, WalletIcon } from "tdesign-icons-react";
import { authToken, ping, request, serverAddress, sessionEvents, setServer, setToken } from "./api";
import { MetadataProvider } from "./data";
import { useMetadata } from "./metadata";
import { action } from "./helpers";
import { AuthPage, ServerPage } from "./pages/Access";
import { SettingsPage } from "./pages/Settings";
import { ReportsPage, ReportPage } from "./pages/Reports";
import "./App.css";

const AnalysisPage = lazy(() =>
  import("./pages/Analysis").then((module) => ({ default: module.AnalysisPage })),
);

function Workspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const { error, refresh } = useMetadata();
  return (
    <Layout className="app-layout">
      <Layout.Header className="app-header">
        <Space align="center">
          <WalletIcon size="26" />
          <strong className="brand">Fortuna</strong>
          <span className="muted desktop-label">Personal asset settlement</span>
        </Space>
        <Space>
          <Button variant="text" onClick={() => navigate("/server")}>
            Server
          </Button>
          <Button
            variant="text"
            onClick={() =>
              action(async () => {
                await request("POST", "/logout");
                setToken("");
              })
            }
          >
            Log out
          </Button>
        </Space>
      </Layout.Header>
      <Menu.HeadMenu
        theme="light"
        value={location.pathname.split("/")[1] || "reports"}
        onChange={(value) => navigate(`/${value}`)}
      >
        <Menu.MenuItem value="reports" icon={<FileIcon />}>
          Reports
        </Menu.MenuItem>
        <Menu.MenuItem value="analysis" icon={<ChartLineIcon />}>
          Analysis
        </Menu.MenuItem>
        <Menu.MenuItem value="settings" icon={<SettingIcon />}>
          Settings
        </Menu.MenuItem>
      </Menu.HeadMenu>
      <Layout.Content className="page">
        {error && (
          <Alert
            theme="error"
            message={error}
            operation={
              <Button
                variant="text"
                onClick={() => {
                  void refresh().catch(() => {});
                }}
              >
                Retry metadata
              </Button>
            }
          />
        )}
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/reports/:reportId" element={<ReportPage />} />
          <Route
            path="/analysis"
            element={
              <Suspense fallback={<Loading text="Loading analysis…" />}>
                <AnalysisPage />
              </Suspense>
            }
          />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/reports" replace />} />
        </Routes>
      </Layout.Content>
      <Layout.Footer className="app-footer">
        Fortuna · Your assets, clearly understood.
      </Layout.Footer>
    </Layout>
  );
}

function Application() {
  const navigate = useNavigate();
  const location = useLocation();
  const [identity, setIdentity] = useState(authToken());
  const [checking, setChecking] = useState(true);
  const configureBackend = useEffectEvent(() => {
    void navigate("/server", { replace: true });
  });
  useEffect(() => {
    const session = () => setIdentity(authToken());
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
    let active = true;
    const address = serverAddress() || window.location.origin;
    void ping(address)
      .then(() => {
        if (active && !serverAddress()) setServer(address);
      })
      .catch(() => {
        if (active) configureBackend();
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);
  if (checking) return <Loading fullscreen text="Connecting to Fortuna…" />;
  if (location.pathname === "/server") return <ServerPage />;
  if (!serverAddress()) return <Navigate to="/server" replace />;
  if (!identity)
    return location.pathname === "/login" ? <AuthPage /> : <Navigate to="/login" replace />;
  return (
    <MetadataProvider key={`${serverAddress()}:${identity}`}>
      <Workspace />
    </MetadataProvider>
  );
}

export default function App() {
  return (
    <ConfigProvider globalConfig={enUS}>
      <HashRouter>
        <Application />
      </HashRouter>
    </ConfigProvider>
  );
}
