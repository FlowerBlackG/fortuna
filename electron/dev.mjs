// SPDX-License-Identifier: MulanPSL-2.0
import { spawn } from "node:child_process";
import { once } from "node:events";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { watchDesktopRenderer } from "../web/desktop-watch.mjs";

const cwd = import.meta.dirname;
const tsc = fileURLToPath(new URL("./bin/tsc", import.meta.resolve("typescript/package.json")));
const renderer = await watchDesktopRenderer();
const sources = ["src", "../shared"].map((dir) =>
  watch(path.join(cwd, dir), { recursive: true }, scheduleCompile),
);

let app;
let restarting = false;
let stopping = false;
let rendererReady = false;
let runtimeReady = false;
let compiling = false;
let dirty = false;
let timer;

function launch() {
  if (stopping || app || !rendererReady || !runtimeReady || compiling || dirty) return;
  const child = spawn(electron, [".", "--fortuna-watch"], {
    cwd,
    detached: process.platform !== "win32",
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  app = child;
  child.on("error", (error) => {
    console.error(error);
    stop(1);
  });
  child.once("exit", (code) => {
    app = undefined;
    if (stopping) return;
    if (restarting) {
      restarting = false;
      launch();
    } else {
      stop(code ?? 1);
    }
  });
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  clearTimeout(timer);
  for (const source of sources) source.close();
  if (app?.connected) app.disconnect();
  void renderer.close().catch(console.error);
}

function scheduleCompile() {
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(compile, 100);
}

async function compile() {
  if (stopping || compiling || !dirty) return;
  dirty = false;
  compiling = true;
  try {
    const child = spawn(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd, stdio: "inherit" });
    const [code] = await once(child, "close");
    runtimeReady = code === 0;
  } catch (error) {
    console.error(error);
    runtimeReady = false;
  } finally {
    compiling = false;
  }
  if (stopping) return;
  if (dirty) {
    await compile();
  } else if (runtimeReady) {
    if (app?.connected) {
      console.log("[desktop] Electron code rebuilt; restarting app.");
      restarting = true;
      app.disconnect();
    } else {
      launch();
    }
  }
}

renderer.on("event", (event) => {
  if (stopping) return;
  if (event.code === "BUNDLE_START" || event.code === "ERROR") rendererReady = false;
  if (event.code !== "BUNDLE_END") return;
  rendererReady = true;
  if (app?.connected) {
    console.log("[desktop] UI rebuilt; reloading window.");
    app.send("fortuna:reload", () => {});
  } else {
    launch();
  }
});

process.once("SIGINT", () => stop(130));
process.once("SIGTERM", () => stop(143));
scheduleCompile();
