// SPDX-License-Identifier: MulanPSL-2.0
import { lazy, Suspense, useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { Alert, Button, ConfigProvider, Layout, Loading, Menu, Space } from "tdesign-react";
import enUS from "tdesign-react/es/locale/en_US";
import {
  ChartLineIcon,
  FileIcon,
  LogoutIcon,
  ServerIcon,
  SettingIcon,
  WalletIcon,
} from "tdesign-icons-react";
import { authToken, ping, request, serverAddress, sessionEvents, setServer, setToken } from "./api";
import { MetadataProvider } from "./data";
import { useMetadata } from "./metadata";
import { action } from "./helpers";
import { AuthPage, ServerPage } from "./pages/Access";
import { SettingsPage } from "./pages/Settings";
import { ReportsPage, ReportPage } from "./pages/Reports";
import Version from "./version";
import "./App.css";

const AnalysisPage = lazy(() =>
  import("./pages/Analysis").then((module) => ({ default: module.AnalysisPage })),
);

function Workspace({ serverVersion }: { serverVersion: string }) {
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
          <Button
            variant="text"
            icon={<ServerIcon />}
            aria-label="Server"
            title="Server"
            onClick={() => navigate("/server")}
          />
          <Button
            variant="text"
            icon={<LogoutIcon />}
            aria-label="Log out"
            title="Log out"
            onClick={() =>
              action(async () => {
                await request("POST", "/logout");
                setToken("");
              })
            }
          />
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
        Fortuna Web {Version.tag} · Server {serverVersion || "—"}
      </Layout.Footer>
    </Layout>
  );
}

function Application() {
  const navigate = useNavigate();
  const location = useLocation();
  const [identity, setIdentity] = useState(authToken());
  const [address, setAddress] = useState(serverAddress() || window.location.origin);
  const [connection, setConnection] = useState<{ address: string; version: string | null }>();
  useEffect(() => {
    const session = () => {
      setIdentity(authToken());
      setAddress(serverAddress() || window.location.origin);
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
        if (!serverAddress()) setServer(address);
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
  if (connection?.address !== address) return <Loading fullscreen text="Connecting to Fortuna…" />;
  if (!serverAddress() || connection.version === null) return <Navigate to="/server" replace />;
  if (!identity)
    return location.pathname === "/login" ? <AuthPage /> : <Navigate to="/login" replace />;
  return (
    <MetadataProvider key={`${serverAddress()}:${identity}`}>
      <Workspace serverVersion={connection.version} />
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
