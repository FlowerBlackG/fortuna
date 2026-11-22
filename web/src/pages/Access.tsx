// SPDX-License-Identifier: MulanPSL-2.0
import { t } from "../i18n";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Alert, Button, Card, Form, Input, Radio, Space } from "tdesign-react";
import { ServerIcon, WalletIcon } from "tdesign-icons-react";
import { authToken, ping, request, serverAddress, setServer, setToken } from "../api";
import type { Account } from "../types";
import type { ServerInfo } from "../version";

export function ServerPage({
  onConnected,
}: {
  onConnected: (server: { address: string; version: ServerInfo }) => void;
}) {
  const navigate = useNavigate();
  const [address, setAddress] = useState(serverAddress() || window.location.origin);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function connect() {
    setLoading(true);
    setError("");
    try {
      const version = await ping(address);
      setServer(address);
      onConnected({ address: serverAddress(), version });
      await navigate(authToken() ? "/reports" : "/login");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Connection failed"));
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="access-page">
      <Card title={t("Connect to your Fortuna server")} className="access-card">
        {error && <Alert theme="error" message={error} />}
        <Form labelAlign="top" onSubmit={() => void connect()}>
          <Form.FormItem label={t("Server address")} initialData={address}>
            <Input value={address} onChange={setAddress} placeholder="http://localhost:5000" />
          </Form.FormItem>
          <Space>
            <Button shape="round" type="submit" loading={loading}>
              {t("Test & connect")}
            </Button>
            {serverAddress() && (
              <Button shape="round" variant="outline" onClick={() => navigate("/reports")}>
                {t("Back")}
              </Button>
            )}
          </Space>
        </Form>
      </Card>
    </main>
  );
}

export function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setError("");
    if (!username.trim() || !password) {
      setError(t("Enter your username and password"));
      return;
    }
    if (mode === "register" && password !== confirm) {
      setError(t("Passwords do not match"));
      return;
    }
    setLoading(true);
    try {
      const result = await request<{ token: string; account: Account }>(
        "POST",
        mode === "login" ? "/login" : "/account",
        { username, password },
      );
      setToken(result.token);
      await navigate("/reports");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Login failed"));
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="access-page">
      <Card className="access-card">
        <Space align="center">
          <WalletIcon size="32" />
          <h1>Fortuna</h1>
        </Space>
        <Radio.Group
          variant="default-filled"
          value={mode}
          onChange={(value) => {
            setMode(String(value));
            setError("");
          }}
        >
          <Radio.Button value="login">{t("Log in")}</Radio.Button>
          <Radio.Button value="register">{t("Create account")}</Radio.Button>
        </Radio.Group>
        {error && <Alert theme="error" message={error} />}
        <Form labelAlign="top" onSubmit={() => void submit()}>
          <Form.FormItem label={t("Username")}>
            <Input value={username} onChange={setUsername} autocomplete="username" />
          </Form.FormItem>
          <Form.FormItem label={t("Password")}>
            <Input
              type="password"
              value={password}
              onChange={setPassword}
              autocomplete={mode === "login" ? "current-password" : "new-password"}
            />
          </Form.FormItem>
          {mode === "register" && (
            <Form.FormItem label={t("Confirm password")}>
              <Input
                type="password"
                value={confirm}
                onChange={setConfirm}
                autocomplete="new-password"
              />
            </Form.FormItem>
          )}
          <Button shape="round" block type="submit" loading={loading}>
            {mode === "login" ? t("Log in") : t("Create account")}
          </Button>
        </Form>
        <Button
          shape="round"
          variant="text"
          icon={<ServerIcon />}
          block
          onClick={() => navigate("/server")}
        >
          {t("Server")}: {serverAddress()}
        </Button>
      </Card>
    </main>
  );
}
