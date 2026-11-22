// SPDX-License-Identifier: MulanPSL-2.0
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Backend } from "../../build/electron/backend.mjs";

test("frozen runtime locks the database, backs up and reopens the same workspace", async (t) => {
  const executable = path.resolve(
    import.meta.dirname,
    "../../build/backend/fortuna-backend",
    process.platform === "win32" ? "fortuna-backend.exe" : "fortuna-backend",
  );
  const directory = await mkdtemp(path.join(os.tmpdir(), "fortuna-test-"));
  const backend = new Backend(executable, directory, assert.fail);
  const other = new Backend(executable, directory, assert.fail);
  t.after(async () => {
    await Promise.all([backend.stop(), other.stop()]);
    await rm(directory, { recursive: true });
  });
  await backend.start();
  await assert.rejects(other.start(), /already open/);
  const report = await backend.request("POST", "/reports", { title: "Offline" });
  assert.equal(report.code, 200);
  const filename = path.join(directory, "backup.sqlite3");
  await backend.backup(filename);
  assert.equal((await readFile(filename)).subarray(0, 16).toString(), "SQLite format 3\0");
  await assert.rejects(backend.backup(filename), /new filename/);
  await backend.stop();
  await other.start();
  assert.deepEqual((await other.request("GET", "/reports")).data, [report.data]);
});
