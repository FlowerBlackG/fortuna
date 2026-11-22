// SPDX-License-Identifier: MulanPSL-2.0
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { apiRequest } from "./transport.mjs";

export class Backend {
  readonly sessionId = randomUUID();
  #child?: ChildProcessWithoutNullStreams;
  #secret?: string;
  #base?: string;
  #closed?: Promise<void>;
  #backup?: PromiseWithResolvers<void>;

  constructor(
    private readonly executable: string,
    private readonly directory: string,
    private readonly onFailure: (message: string) => void,
    private readonly database?: string,
  ) {}

  async start(createFile = false) {
    if (this.#base) return;
    if (this.#child) throw new Error("Local workspace is busy");
    const args = ["--data", this.directory];
    if (this.database) args.push("--database", this.database);
    if (createFile) args.push("--create");
    const child = spawn(this.executable, args, {
      stdio: "pipe",
      windowsHide: true,
    });
    this.#child = child;
    this.#secret = randomBytes(32).toString("hex");
    let diagnostics = "";
    const log = (part: string) => {
      diagnostics = (diagnostics + part).slice(-4096);
    };
    child.stderr.setEncoding("utf8").on("data", log);
    const ready = Promise.withResolvers<number>();
    child.once("error", ready.reject);
    child.stdin.on("error", ready.reject);
    this.#closed = new Promise((resolve) =>
      child.once("close", (code, signal) => {
        const message = `Local workspace exited (${signal || code}). ${diagnostics.trim()}`;
        const running = Boolean(this.#base);
        this.#base = this.#secret = this.#child = undefined;
        ready.reject(new Error(message));
        this.#backup?.reject(new Error(message));
        this.#backup = undefined;
        if (running) this.onFailure(message);
        resolve();
      }),
    );
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (!line.startsWith("FORTUNA/1 ")) {
        log(line + "\n");
        return;
      }
      try {
        const msg = JSON.parse(line.slice(10));
        if (
          msg.type === "ready" &&
          msg.host === "127.0.0.1" &&
          Number.isInteger(msg.port) &&
          msg.port > 0 &&
          msg.port <= 65535
        )
          ready.resolve(msg.port);
        if (msg.type === "backup" && this.#backup) {
          if (msg.ok === true) this.#backup.resolve();
          else this.#backup.reject(new Error(msg.error || "Backup failed"));
          this.#backup = undefined;
        }
      } catch {
        ready.reject(new Error("Invalid local workspace reply"));
      }
    });
    child.stdin.write(this.#secret + "\n");
    const timeout = setTimeout(
      () => ready.reject(new Error(`Local workspace startup timed out. ${diagnostics}`)),
      30000,
    );
    try {
      const base = `http://127.0.0.1:${await ready.promise}`;
      const account = await apiRequest(base, "GET", "/account", undefined, {
        "Fortuna-Desktop-Auth": this.#secret,
      });
      if (this.#child !== child) throw new Error("Local workspace exited during startup");
      if (this.database) {
        const ping = await apiRequest(base, "GET", "/ping", undefined, {
          "Fortuna-Desktop-Auth": this.#secret,
        });
        if (ping.code !== 200 || account.code !== 401)
          throw new Error("Local account login unavailable");
      } else if (
        account.code !== 200 ||
        !account.data ||
        typeof account.data !== "object" ||
        !("username" in account.data) ||
        account.data.username !== "__fortuna_builtin__"
      )
        throw new Error("Local account unavailable");
      this.#base = base;
    } catch (error) {
      await this.stop();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  request(method: string, path: string, data?: unknown, token = "") {
    if (!this.#base || !this.#secret) throw new Error("Local workspace unavailable");
    return apiRequest(this.#base, method, path, data, {
      "Fortuna-Desktop-Auth": this.#secret,
      ...(token && { "Fortuna-Auth": token }),
    });
  }

  backup(destination: string) {
    if (!this.#child || !this.#base || this.#backup)
      throw new Error("Local workspace unavailable or backup in progress");
    this.#backup = Promise.withResolvers<void>();
    this.#child.stdin.write(JSON.stringify({ type: "backup", destination }) + "\n");
    return this.#backup.promise;
  }

  async stop() {
    const child = this.#child;
    if (!child) return;
    this.#base = undefined;
    child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 6000);
    try {
      await this.#closed;
    } finally {
      clearTimeout(timer);
    }
  }
}
