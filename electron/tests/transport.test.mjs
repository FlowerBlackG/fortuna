// SPDX-License-Identifier: MulanPSL-2.0
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { apiRequest, remoteAddress, validateRequest } from "../../build/electron/transport.mjs";

test("renderer requests are limited to Fortuna routes, methods and JSON objects", () => {
  for (const path of [
    "https://example.org",
    "//example.org",
    "/../../etc",
    "/reports?next=https://example.org",
    "/reports%2f..",
    "/records\n",
  ]) {
    assert.throws(() => validateRequest("GET", path));
  }
  assert.throws(() => validateRequest("POST", "/metadata", {}));
  assert.throws(() => validateRequest("GET", "/settings", {}));
  assert.throws(() => validateRequest("PUT", "/settings", new Uint8Array(1)));
  assert.throws(() => validateRequest("PUT", "/settings", { x: "x".repeat(4 * 1024 * 1024) }));
  for (const url of [
    "file:///tmp/db",
    "https://user:pass@example.org",
    "https://example.org?a",
    "http://localhost\\evil",
  ]) {
    assert.throws(() => remoteAddress(url));
  }
  assert.equal(remoteAddress("https://example.org/fortuna/"), "https://example.org/fortuna");
});

test("authenticated transport rejects redirects, oversized responses and non-JSON", async (t) => {
  let count = 0;
  let responder;
  const server = createServer((req, res) => {
    count++;
    responder(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  responder = (req, res) => {
    assert.equal(req.headers["fortuna-auth"], "session");
    assert.equal(req.headers["fortuna-desktop-auth"], undefined);
    res.writeHead(307, { Location: `${base}/redirect` }).end();
  };
  await assert.rejects(
    apiRequest(base, "GET", "/account", undefined, { "Fortuna-Auth": "session" }),
  );
  assert.equal(count, 1);
  responder = (_req, res) => res.end("<html/>");
  await assert.rejects(apiRequest(base, "GET", "/ping"));
  responder = (_req, res) =>
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(Buffer.alloc(32 * 1024 * 1024 + 1));
  await assert.rejects(apiRequest(base, "GET", "/ping"), /too large/);
});
