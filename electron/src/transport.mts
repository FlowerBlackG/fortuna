// SPDX-License-Identifier: MulanPSL-2.0
import http from "node:http";
import https from "node:https";
import type { IResponse } from "../../shared/response.js";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const collection = "(?:currencies|institutions|asset-types|reports|records)";
const routes: [RegExp, string[]][] = [
  [/^\/(?:ping|metadata)$/, ["GET"]],
  [/^\/account$/, ["GET", "POST", "PATCH", "DELETE"]],
  [/^\/(?:login|logout)$/, ["POST"]],
  [/^\/settings$/, ["GET", "PUT"]],
  [new RegExp(`^/${collection}$`), ["GET", "POST"]],
  [new RegExp(`^/${collection}/${uuid}$`), ["GET", "PATCH", "DELETE"]],
  [new RegExp(`^/reports/${uuid}/exchange-rates$`), ["GET", "PUT", "DELETE"]],
  [/^\/reports\?include_totals=true$/, ["GET"]],
  [new RegExp(`^/records\\?report_id=${uuid}$`), ["GET"]],
];

export function remoteAddress(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\x00-\x20\\?#]/.test(value)) {
    throw new Error("Invalid server address");
  }
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !url.hostname
  ) {
    throw new Error("Invalid server address");
  }
  return url.href.replace(/\/+$/, "");
}

export function validateRequest(method: string, path: string, data?: unknown): string | undefined {
  if (
    typeof path !== "string" ||
    /\s/.test(path) ||
    !routes.some(([pattern, methods]) => pattern.test(path) && methods.includes(method))
  ) {
    throw new Error("Unsupported API route or method");
  }
  if (data === undefined) return;
  if (method === "GET" || !data || Object.getPrototypeOf(data) !== Object.prototype)
    throw new Error("Invalid request body");
  const json = JSON.stringify(data, (_key, value) => {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype
    )
      throw new Error("Expected JSON");
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("Expected a finite number");
    return value;
  });
  if (Buffer.byteLength(json) > 4 * 1024 * 1024) throw new Error("Request body too large");
  return json;
}

// Direct connections only. Core HTTP does not follow redirects or consult browser cookies.
export function apiRequest(
  base: string,
  method: string,
  path: string,
  data?: unknown,
  headers: Record<string, string> = {},
): Promise<IResponse<unknown>> {
  const body = validateRequest(method, path, data);
  const url = new URL(`${base}/api${path}`);
  const get = url.protocol === "https:" ? https.request : http.request;
  return new Promise((resolve, reject) => {
    const req = get(
      url,
      {
        method,
        headers: { ...headers, ...(body && { "Content-Type": "application/json" }) },
        agent: false,
        signal: AbortSignal.timeout(path === "/ping" ? 6000 : 30000),
      },
      (res) => {
        const fail = (message: string) => {
          reject(new Error(message));
          res.destroy();
        };
        if (
          res.statusCode !== 200 ||
          res.headers["content-type"]?.split(";")[0] !== "application/json"
        ) {
          fail("Expected a Fortuna JSON response");
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("error", reject);
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 32 * 1024 * 1024) fail("Server response too large");
          else chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!Number.isInteger(result?.code) || typeof result.msg !== "string")
              throw new Error("Invalid API response");
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
