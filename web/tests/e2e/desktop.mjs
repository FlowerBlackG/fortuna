// SPDX-License-Identifier: MulanPSL-2.0
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const executable = path.resolve(process.argv[2]);
const portable = existsSync(path.join(path.dirname(executable), "resources/portable.flag"));
const profile = await mkdtemp(path.join(os.tmpdir(), "fortuna-ui-"));
const database = path.join(portable ? path.dirname(executable) : profile, "data/fortuna.sqlite3");
if (existsSync(database)) throw new Error("Use a fresh test copy of the portable distribution");
let child, browser, page;
let closed = Promise.resolve([]);

async function launch() {
  const args = [
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    ...process.argv.slice(3),
  ];
  child = spawn(executable, args, {
    env: { ...process.env, PATH: "", PYTHONPATH: "", PYTHONHOME: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  closed = once(child, "close");
  const endpoint = Promise.withResolvers();
  let diagnostics = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-8192);
    const match = diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)\s/);
    if (match) endpoint.resolve(match[1]);
  });
  void closed.then(() => endpoint.reject(new Error(diagnostics)), endpoint.reject);
  const timer = setTimeout(
    () => endpoint.reject(new Error("Desktop startup timeout: " + diagnostics)),
    30000,
  );
  try {
    browser = await chromium.connectOverCDP(await endpoint.promise);
  } finally {
    clearTimeout(timer);
  }
  const context = browser.contexts()[0];
  page = context.pages()[0] || (await context.waitForEvent("page"));
  page.on("pageerror", (error) => console.error(error));
  await page.waitForURL("fortuna://workspace/**");
}

async function close() {
  // Closing the last native window exercises the application's own shutdown path.
  await page.close();
  const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
  try {
    assert.equal((await closed)[0], 0);
  } finally {
    clearTimeout(timer);
  }
  await browser.close();
}

const reports = () => page.getByRole("heading", { name: "Reports", exact: true }).waitFor();
const logout = () => page.getByRole("button", { name: "Log out", exact: true });
const serverPage = () => page.getByRole("button", { name: "Server", exact: true }).click();
const mode = (name) => page.getByText(name, { exact: true }).click();
const local = (method, route, data) =>
  page.evaluate(
    ([method, route, data]) =>
      window.fortunaDesktop.request("builtin", "", "", method, route, data),
    [method, route, data],
  );
try {
  await launch();
  await reports();
  assert.ok(existsSync(database), "Database must be in the test profile");
  await expect(logout()).toHaveCount(0);
  await page.getByText("Settings", { exact: true }).first().click();
  await mode("Local database");
  await expect(page.getByRole("button", { name: "Show database location" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export database backup…" })).toBeVisible();
  const first = await local("POST", "/reports", { title: "Local persistence test" });
  assert.equal(first.code, 200);
  await page.getByText("Reports", { exact: true }).first().click();
  await page.getByRole("link", { name: first.data.title }).waitFor();
  await serverPage();
  await mode("Remote server");
  await page.getByRole("button", { name: "Test & connect" }).waitFor();
  if (process.env.FORTUNA_API) {
    await page.locator("input:not([type=radio])").fill(process.env.FORTUNA_API);
    await page.getByRole("button", { name: "Test & connect" }).click();
    await mode("Create account");
    await page.locator("input[autocomplete=username]").fill(`desktop-${Date.now()}`);
    await page.locator("input[type=password]").first().fill("desktop-test");
    await page.locator("input[type=password]").last().fill("desktop-test");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await reports();
    await expect(logout()).toBeVisible();
    await expect(page.getByRole("link", { name: first.data.title })).toHaveCount(0);
    await serverPage();
  }
  await mode("Built-in");
  await page.getByRole("link", { name: first.data.title }).waitFor();
  await close();
  await rename(database, database + ".saved");
  await mkdir(database);
  await launch();
  await mode("Diagnostics");
  await expect(page.getByText("Could not open the workspace")).toBeVisible();
  await rmdir(database);
  await rename(database + ".saved", database);
  await page.getByRole("button", { name: "Retry" }).click();
  await reports();
  assert.deepEqual((await local("GET", "/reports")).data, [first.data]);
  if (process.env.FORTUNA_API) {
    await serverPage();
    await mode("Remote server");
    await reports();
    await close();
    await launch();
    await reports();
    await logout().click();
    await page.getByRole("button", { name: "Log in", exact: true }).waitFor();
  }
  await close();
  console.log("Desktop workspace, isolated modes, persistence and native window shutdown passed.");
} catch (error) {
  console.error(
    await page
      ?.locator("body")
      .innerText({ timeout: 1000 })
      .catch(() => "Window unavailable"),
  );
  throw error;
} finally {
  if (child && child.exitCode === null && !child.signalCode) {
    child.kill();
    await closed;
  }
  await rm(profile, { recursive: true, force: true });
}
