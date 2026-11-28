// SPDX-License-Identifier: MulanPSL-2.0
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron, expect } from "@playwright/test";

const project = path.resolve(import.meta.dirname, "../../../electron");
const executablePath = createRequire(path.join(project, "package.json"))("electron");
const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), "fortuna-files-")));
const destination = path.join(profile, "my backup.sqlite3");
const database = path.join(profile, "household.sqlite3");
const launch = () =>
  _electron.launch({
    executablePath,
    args: [project, `--user-data-dir=${profile}`],
  });
let app = await launch();
try {
  let page = await app.firstWindow();
  await page.getByRole("heading", { name: "Reports", exact: true }).waitFor();
  // Replace the two OS dialogs at their boundary; exercise the real IPC handlers and database.
  await app.evaluate(({ dialog, shell }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    shell.showItemInFolder = (selected) => {
      globalThis.revealedDatabase = selected;
    };
  }, destination);
  await page.getByText("Settings", { exact: true }).first().click();
  await page.getByText("Local database", { exact: true }).click();
  await page.getByRole("button", { name: "Show database location" }).click();
  await expect
    .poll(() => app.evaluate(() => globalThis.revealedDatabase))
    .toBe(path.join(profile, "data/fortuna.sqlite3"));
  await page.getByRole("button", { name: "Export database backup…" }).click();
  await expect(page.getByRole("status")).toHaveText("Backup saved");
  assert.equal((await readFile(destination)).subarray(0, 16).toString(), "SQLite format 3\0");

  const click = (name) => page.getByRole("button", { name, exact: true }).click();
  const reports = () => page.getByRole("heading", { name: "Reports", exact: true }).waitFor();
  const signIn = async () => {
    await page.locator("input[autocomplete=username]").fill("Alice");
    await page.locator("input[type=password]").fill("local password");
    await click("Log in");
    await reports();
  };
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, database);
  await click("Create database…");
  await page.getByText("Create account", { exact: true }).click();
  await page.locator("input[autocomplete=username]").fill("Alice");
  for (const input of await page.locator("input[type=password]").all())
    await input.fill("local password");
  await click("Create account");
  await reports();
  await page.getByText("Settings", { exact: true }).first().click();
  await page.getByText("Local database", { exact: true }).click();
  await page.locator("strong").getByText("household.sqlite3", { exact: true }).hover();
  await expect(page.locator(".t-popup__content").getByText(database, { exact: true })).toBeVisible();
  await page.getByText("Reports", { exact: true }).first().click();
  await click("Create report");
  const title = page.getByPlaceholder("Report title (optional)");
  await title.fill("Household savings");
  await title.press("Tab");
  await page.getByText("Title saved", { exact: true }).waitFor();
  await click("Log out");
  await signIn();
  await page.getByRole("link", { name: "Household savings" }).waitFor();

  await click("Server");
  const invalid = path.join(profile, "invalid.db");
  await writeFile(invalid, "not a database");
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, invalid);
  await click("Open database…");
  await expect(page.locator(".t-alert--error")).toBeVisible();
  assert.equal(await readFile(invalid, "utf8"), "not a database");
  const saved = JSON.parse(await readFile(path.join(profile, "connection.json"), "utf8"));
  assert.equal(saved.mode, "file");
  assert.equal(saved.database, database);
  await click("Back");
  await reports();

  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await expect(page.getByRole("button", { name: "household.sqlite3", exact: true })).toBeVisible();
  await signIn();
  await click("Server");
  await page.getByText("Built-in", { exact: true }).click();
  await reports();
  await expect(page.getByRole("button", { name: "Log out", exact: true })).toHaveCount(0);
  await click("Server");
  await page.getByText("Database file", { exact: true }).click();
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, database);
  await click("Open database…");
  await signIn();
  await page.getByRole("link", { name: "Household savings" }).waitFor();
} finally {
  await app.close();
  await rm(profile, { recursive: true, force: true });
}
