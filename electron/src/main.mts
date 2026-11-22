// SPDX-License-Identifier: MulanPSL-2.0
import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from "electron";
import { existsSync, mkdirSync, mkdtempSync, rmdirSync } from "node:fs";
import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Backend } from "./backend.mjs";
import { apiRequest, remoteAddress } from "./transport.mjs";
import type { ConnectionMode, DesktopOperations, DesktopRuntime } from "../../shared/desktop.js";

const origin = "fortuna://workspace";
const index = `${origin}/index.html`;
const csp =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'none'";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "fortuna",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

app.setName("Fortuna");
if (!app.isPackaged && !app.commandLine.hasSwitch("user-data-dir")) {
  const developmentProfile = path.resolve(app.getAppPath(), "../user-data/desktop");
  mkdirSync(developmentProfile, { recursive: true });
  app.setPath("userData", developmentProfile);
}
const portable =
  process.platform === "win32" &&
  app.isPackaged &&
  existsSync(path.join(process.resourcesPath, "portable.flag"));
const directory = portable
  ? path.join(path.dirname(process.execPath), "data")
  : path.join(app.getPath("userData"), "data");
if (portable) {
  try {
    mkdirSync(directory, { recursive: true });
    rmdirSync(mkdtempSync(path.join(directory, ".write-test-")));
    app.setPath("userData", directory);
  } catch {
    dialog.showErrorBox(
      "Fortuna",
      "Extract Fortuna to a writable folder to use portable data.\n请将 Fortuna 解压到可写文件夹，以使用便携数据。",
    );
    app.exit(1);
  }
}

type Connection = Pick<DesktopRuntime, "mode" | "remote"> & { database: string };
let window: BrowserWindow | undefined;
let backend: Backend | undefined;
let failure = "";
let state: Connection | undefined;
let pending = Promise.resolve();
let quitting = false;
function serialize<T>(operation: () => Promise<T>) {
  const result = pending.then(operation);
  pending = result.then(
    () => {},
    () => {},
  );
  return result;
}

const stateFile = path.join(app.getPath("userData"), "connection.json");
function isMode(value: unknown): value is ConnectionMode {
  return value === "builtin" || value === "file" || value === "remote";
}

async function loadState(): Promise<Connection> {
  try {
    const saved = JSON.parse(await readFile(stateFile, "utf8"));
    if (!isMode(saved.mode)) throw new Error("Invalid saved connection mode");
    const database = saved.database ?? "";
    if (
      typeof database !== "string" ||
      ((database || saved.mode === "file") && !path.isAbsolute(database))
    )
      throw new Error("Invalid saved database path");
    return {
      mode: saved.mode,
      database,
      remote: saved.remote === "" ? "" : remoteAddress(saved.remote),
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { mode: "builtin", remote: "", database: "" };
    throw error;
  }
}

async function save(next: Connection) {
  await writeFile(stateFile + ".tmp", JSON.stringify(next), { mode: 0o600 });
  await rename(stateFile + ".tmp", stateFile);
  state = next;
}

async function startBackend(selected: Connection, createFile = false) {
  const resources = app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), "../build/backend");
  const binary = process.platform === "win32" ? "fortuna-backend.exe" : "fortuna-backend";
  const candidate = new Backend(
    path.join(resources, "fortuna-backend", binary),
    directory,
    (message) => {
      if (backend === candidate) {
        backend = undefined;
        failure = message;
        window?.webContents.send("fortuna:unavailable", message);
      }
    },
    selected.mode === "file" ? selected.database : undefined,
  );
  await candidate.start(createFile);
  return candidate;
}

async function runtime(): Promise<DesktopRuntime> {
  state ??= await loadState();
  if (state.mode !== "remote" && !backend && !failure) {
    try {
      backend = await startBackend(state);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    mode: state.mode,
    remote: state.remote,
    databaseName: path.basename(state.database),
    fileSession: state.mode === "file" ? (backend?.sessionId ?? "") : "",
    error: failure,
  };
}

async function activate(next: Connection, createFile = false) {
  if (next.mode === "file" && !next.database) throw new Error("Choose a database file");
  if (!createFile && backend && state?.mode === next.mode && state.database === next.database) return runtime();
  const previous = backend;
  const candidate = next.mode === "remote" ? undefined : await startBackend(next, createFile);
  try {
    await save(next);
  } catch (error) {
    await candidate?.stop();
    throw error;
  }
  backend = candidate;
  failure = "";
  await previous?.stop();
  return runtime();
}

function handle<K extends keyof DesktopOperations>(
  name: K,
  fn: (
    ...args: Parameters<DesktopOperations[K]>
  ) => ReturnType<DesktopOperations[K]> | Awaited<ReturnType<DesktopOperations[K]>>,
) {
  ipcMain.handle(`fortuna:${name}`, (event, ...args: Parameters<DesktopOperations[K]>) => {
    const frame = event.senderFrame;
    if (
      quitting ||
      !frame ||
      event.sender !== window?.webContents ||
      frame !== event.sender.mainFrame ||
      frame.url.split("#")[0] !== index
    ) {
      throw new Error("Untrusted application frame");
    }
    return fn(...args);
  });
}

function installBridge() {
  handle("runtime", () => serialize(runtime));
  handle("setMode", (mode) =>
    serialize(async () => {
      if (!isMode(mode)) throw new Error("Invalid connection mode");
      return activate({ remote: state?.remote ?? "", database: state?.database ?? "", mode });
    }),
  );
  handle("chooseDatabase", (action) =>
    serialize(async () => {
      if (!window || (action !== "open" && action !== "create"))
        throw new Error("Invalid database selection");
      const filters = [
        { name: "SQLite", extensions: ["sqlite3", "sqlite", "db"] },
        { name: "All files", extensions: ["*"] },
      ];
      let filename: string;
      if (action === "open") {
        const result = await dialog.showOpenDialog(window, { properties: ["openFile"], filters });
        if (result.canceled) return false;
        filename = await realpath(result.filePaths[0]);
      } else {
        const result = await dialog.showSaveDialog(window, {
          defaultPath: "fortuna-accounts.sqlite3",
          filters,
        });
        if (result.canceled) return false;
        filename = result.filePath;
        if (![".db", ".sqlite", ".sqlite3"].includes(path.extname(filename).toLowerCase()))
          throw new Error("Choose a .db, .sqlite or .sqlite3 filename");
        if (path.resolve(filename) === path.join(directory, "fortuna.sqlite3"))
          throw new Error("Choose a separate database file");
      }
      await activate({
        mode: "file",
        remote: state?.remote ?? "",
        database: filename,
      }, action === 'create');
      return true;
    }),
  );
  handle("connect", (address) =>
    serialize(async () => {
      if (state?.mode !== "remote") throw new Error("Select remote mode first");
      await save({ ...state, remote: remoteAddress(address) });
    }),
  );
  handle("ping", (address) => {
    if (state?.mode !== "remote") throw new Error("Select remote mode first");
    return apiRequest(remoteAddress(address), "GET", "/ping");
  });
  handle("request", async (mode, address, token, method, route, data) => {
    const selected = state;
    if (!selected || selected.mode !== mode) throw new Error("Connection changed");
    if (typeof token !== "string" || token.length > 4096 || /[^\x21-\x7e]/.test(token))
      throw new Error("Invalid session token");
    let reply;
    if (mode !== "remote") {
      if (!backend || (mode === "file" ? address !== backend.sessionId : address || token))
        throw new Error("Invalid local connection");
      reply = await backend.request(method, route, data, token);
    } else {
      if (!selected.remote || address !== selected.remote) throw new Error("Connection changed");
      reply = await apiRequest(
        selected.remote,
        method,
        route,
        data,
        token ? { "Fortuna-Auth": token } : {},
      );
    }
    if (state !== selected) throw new Error("Connection changed");
    return reply;
  });
  handle("reveal", () => {
    if (state?.mode !== "builtin" || failure) throw new Error("Local workspace unavailable");
    shell.showItemInFolder(path.join(directory, "fortuna.sqlite3"));
  });
  handle("backup", async () => {
    const selected = state;
    if (!window || selected?.mode !== "builtin" || failure)
      throw new Error("Local workspace unavailable");
    const result = await dialog.showSaveDialog(window, {
      defaultPath: `fortuna-${new Date().toISOString().slice(0, 10)}.sqlite3`,
      filters: [{ name: "SQLite", extensions: ["sqlite3"] }],
    });
    if (result.canceled) return false;
    if (state !== selected || !backend) throw new Error("Connection changed");
    await backend.backup(result.filePath);
    return true;
  });
}

function installProtocol(root: string) {
  const types: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".ttf": "font/ttf",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  protocol.handle("fortuna", async (req) => {
    const url = new URL(req.url);
    if (
      req.method !== "GET" ||
      url.host !== "workspace" ||
      !/^\/(?:index\.html|assets\/[\w.-]+)$/.test(url.pathname)
    )
      return new Response(null, { status: 404 });
    const type = types[path.extname(url.pathname)];
    if (!type) return new Response(null, { status: 404 });
    try {
      return new Response(await readFile(path.join(root, url.pathname)), {
        headers: {
          "Content-Type": type,
          "Content-Security-Policy": csp,
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

async function launch() {
  const assets = app.isPackaged
    ? path.join(app.getAppPath(), "ui")
    : path.join(app.getAppPath(), "../build/ui");
  installProtocol(assets);
  installBridge();
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({
    width: 1200,
    height: 820,
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
      navigateOnDragDrop: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame || event.url.split("#")[0] !== index) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.on("closed", () => {
    window = undefined;
  });
  await window.loadURL(index);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.restore();
    window?.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void serialize(async () => backend?.stop()).finally(() => app.quit());
  });
  app
    .whenReady()
    .then(launch)
    .catch((error) => {
      dialog.showErrorBox("Fortuna", error.message);
      app.quit();
    });
}
