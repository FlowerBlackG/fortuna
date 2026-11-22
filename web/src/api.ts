// SPDX-License-Identifier: MulanPSL-2.0
import { t, serverMessage } from "./i18n";
import axios from "axios";
import type { IResponse } from "../../shared/response";
import type { ServerInfo } from "./version";
import { desktop, desktopBuild, isBuiltin, isLocal, runtime } from "./desktop";

const SERVER_KEY = "fortuna.server";
const TOKEN_KEY = "fortuna.token";
export const sessionEvents = new EventTarget();
let token = localStorage.getItem(TOKEN_KEY) || "";
let server = localStorage.getItem(SERVER_KEY) || "";

export function serverAddress() {
  if (!desktopBuild) return server;
  if (runtime?.mode === "file") return runtime.fileSession;
  return isBuiltin() ? "" : runtime?.remote || "";
}
export const initialAddress = () => serverAddress() || (desktopBuild ? "" : window.location.origin);
const remoteTokenKey = () => `${TOKEN_KEY}:${serverAddress()}`;
const tokenStorage = () => (runtime?.mode === "file" ? sessionStorage : localStorage);
export function authToken() {
  if (!desktopBuild) return token;
  return isBuiltin() ? "" : tokenStorage().getItem(remoteTokenKey()) || "";
}
export function setToken(value: string) {
  if (isBuiltin()) return;
  const key = desktopBuild ? remoteTokenKey() : TOKEN_KEY;
  if (!desktopBuild) token = value;
  if (value) tokenStorage().setItem(key, value);
  else tokenStorage().removeItem(key);
  sessionEvents.dispatchEvent(new Event("session"));
}
export async function setServer(value: string) {
  const normalized = normalizeServer(value);
  if (desktop && runtime) {
    await desktop.connect(normalized);
    runtime.remote = normalized;
  } else {
    if (server !== normalized) setToken("");
    server = normalized;
    localStorage.setItem(SERVER_KEY, server);
  }
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
  type Ping = {
    app: string;
    version: string;
    version_code?: number;
    build_time?: string;
    environment?: ServerInfo["environment"];
  };
  let body: IResponse<Ping>;
  if (desktop && runtime && isLocal())
    body = await desktop.request<Ping>(runtime.mode, address, "", "GET", "/ping");
  else if (desktop) body = await desktop.ping<Ping>(normalizeServer(address));
  else
    body = (
      await axios.get<IResponse<Ping>>(`${normalizeServer(address)}/api/ping`, { timeout: 6000 })
    ).data;
  if (body?.code !== 200 || body.data?.app !== "Fortuna") {
    throw new Error(t("This address did not respond as a Fortuna server"));
  }
  const { version, version_code, build_time, environment } = body.data;
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
  if (!serverAddress() && !isBuiltin()) {
    sessionEvents.dispatchEvent(new Event("configure"));
    throw new Error(t("Configure your server first"));
  }
  const requestServer = serverAddress();
  const requestToken = authToken();
  const body =
    desktop && runtime
      ? await desktop.request<T>(runtime.mode, requestServer, requestToken, method, path, data)
      : (
          await axios.request<IResponse<T>>({
            baseURL: `${requestServer}/api`,
            url: path,
            method,
            data,
            timeout: 30000,
            headers: requestToken ? { "Fortuna-Auth": requestToken } : {},
          })
        ).data;
  if (!body || typeof body.code !== "number") throw new Error(t("Unexpected response from server"));
  if (body.code === 401 && serverAddress() === requestServer && authToken() === requestToken)
    setToken("");
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
