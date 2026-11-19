// SPDX-License-Identifier: MulanPSL-2.0
import { useState } from "react";
import { useNavigate } from "react-router";
import { Alert, Button, Card, Form, Input, Radio, Space } from "tdesign-react";
import { WalletIcon } from "tdesign-icons-react";
import { authToken, ping, request, serverAddress, setServer, setToken } from "../api";
import type { Account } from "../types";

export function ServerPage() {
  const navigate = useNavigate();
  const [address, setAddress] = useState(serverAddress() || window.location.origin);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function connect() {
    setLoading(true);
    setError("");
    try {
      await ping(address);
      setServer(address);
      await navigate(authToken() ? "/reports" : "/login");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="access-page">
      <Card title="Connect to your Fortuna server" className="access-card">
        <p className="muted">
          Enter the server address. It is saved in this browser and can be changed anytime.
        </p>
        {error && <Alert theme="error" message={error} />}
        <Form labelAlign="top" onSubmit={() => void connect()}>
          <Form.FormItem label="Server address">
            <Input value={address} onChange={setAddress} placeholder="http://localhost:5000" />
          </Form.FormItem>
          <Space>
            <Button type="submit" loading={loading}>
              Test & connect
            </Button>
            {serverAddress() && (
              <Button variant="outline" onClick={() => navigate("/reports")}>
                Back
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
      setError("Enter your username and password");
      return;
    }
    if (mode === "register" && password !== confirm) {
      setError("Passwords do not match");
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
      setError(reason instanceof Error ? reason.message : "Login failed");
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
        <p className="muted">A clear view of everything you hold.</p>
        <Radio.Group
          variant="default-filled"
          value={mode}
          onChange={(value) => {
            setMode(String(value));
            setError("");
          }}
        >
          <Radio.Button value="login">Log in</Radio.Button>
          <Radio.Button value="register">Create account</Radio.Button>
        </Radio.Group>
        {error && <Alert theme="error" message={error} />}
        <Form labelAlign="top" onSubmit={() => void submit()}>
          <Form.FormItem label="Username">
            <Input value={username} onChange={setUsername} autocomplete="username" />
          </Form.FormItem>
          <Form.FormItem label="Password">
            <Input
              type="password"
              value={password}
              onChange={setPassword}
              autocomplete={mode === "login" ? "current-password" : "new-password"}
            />
          </Form.FormItem>
          {mode === "register" && (
            <Form.FormItem label="Confirm password">
              <Input
                type="password"
                value={confirm}
                onChange={setConfirm}
                autocomplete="new-password"
              />
            </Form.FormItem>
          )}
          <Button block type="submit" loading={loading}>
            {mode === "login" ? "Log in" : "Create account"}
          </Button>
        </Form>
        <Button variant="text" block onClick={() => navigate("/server")}>
          Server: {serverAddress()}
        </Button>
      </Card>
    </main>
  );
}
