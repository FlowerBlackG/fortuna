// SPDX-License-Identifier: MulanPSL-2.0
import { t, serverMessage } from "./i18n";
import axios from "axios";
import type { IResponse } from "./response";
import type { ServerInfo } from "./version";

const SERVER_KEY = "fortuna.server";
const TOKEN_KEY = "fortuna.token";
export const sessionEvents = new EventTarget();
let token = localStorage.getItem(TOKEN_KEY) || "";
let server = localStorage.getItem(SERVER_KEY) || "";

export function serverAddress() {
  return server;
}
export function authToken() {
  return token;
}
export function setToken(value: string) {
  token = value;
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
  sessionEvents.dispatchEvent(new Event("session"));
}
export function setServer(value: string) {
  const normalized = normalizeServer(value);
  if (server !== normalized) setToken("");
  server = normalized;
  localStorage.setItem(SERVER_KEY, server);
  sessionEvents.dispatchEvent(new Event("server"));
}
export function normalizeServer(value: string) {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(t("Enter an HTTP or HTTPS server address"));
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}
export async function ping(address: string): Promise<ServerInfo> {
  const response = await axios.get<
    IResponse<{
      app: string;
      version: string;
      version_code?: number;
      build_time?: string;
      environment?: ServerInfo["environment"];
    }>
  >(`${normalizeServer(address)}/api/ping`, { timeout: 6000 });
  if (response.data?.code !== 200 || response.data.data?.app !== "Fortuna") {
    throw new Error(t("This address did not respond as a Fortuna server"));
  }
  const { version, version_code, build_time, environment } = response.data.data;
  return { tag: version, code: version_code, buildTime: build_time, environment };
}
export class ApiError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export async function request<T>(method: string, path: string, data?: unknown): Promise<T> {
  if (!server) {
    sessionEvents.dispatchEvent(new Event("configure"));
    throw new Error(t("Configure your server first"));
  }
  const requestServer = server;
  const requestToken = token;
  const response = await axios.request<IResponse<T>>({
    baseURL: `${requestServer}/api`,
    url: path,
    method,
    data,
    timeout: 30000,
    headers: requestToken ? { "Fortuna-Auth": requestToken } : {},
  });
  const body = response.data;
  if (!body || typeof body.code !== "number") throw new Error(t("Unexpected response from server"));
  if (body.code === 401 && server === requestServer && token === requestToken) setToken("");
  if (body.code !== 200) throw new ApiError(body.code, serverMessage(body.msg));
  return body.data;
}

window.addEventListener("storage", (event) => {
  if (event.key === TOKEN_KEY || event.key === SERVER_KEY || event.key === null) {
    token = localStorage.getItem(TOKEN_KEY) || "";
    server = localStorage.getItem(SERVER_KEY) || "";
    sessionEvents.dispatchEvent(new Event("session"));
    sessionEvents.dispatchEvent(new Event("server"));
  }
});
