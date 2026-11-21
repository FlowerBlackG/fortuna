// SPDX-License-Identifier: MulanPSL-2.0
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const backend = process.env.FORTUNA_API || "http://127.0.0.1:5000";
const frontend = process.env.FORTUNA_WEB || "http://localhost:5173";
const password = "regression-test";
let token = "";
async function api(method, path, data) {
  const response = await fetch(`${backend}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "Fortuna-Auth": token },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const body = await response.json();
  assert.equal(body.code, 200, body.msg);
  return body.data;
}
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/sbin/google-chrome-stable",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
await page.addInitScript(() => {
  window.fortunaErrors = [];
  window.addEventListener("error", (event) =>
    window.fortunaErrors.push({ message: event.message, url: location.hash }),
  );
});
page.on("pageerror", (error) => errors.push(error.message));
let metadataRequests = 0;
let pings = 0;
page.on("request", (request) => {
  if (request.url().endsWith("/api/metadata")) metadataRequests++;
  if (request.url().endsWith("/api/ping")) pings++;
});
const formItem = (scope, label) =>
  scope
    .locator(".t-form__item")
    .filter({ has: page.locator(".t-form__label", { hasText: label }) });
async function chartOptions() {
  // This regression targets the Vite development server and inspects actual ECharts instances.
  return page.evaluate(async () => {
    const echarts = await import("/node_modules/.vite/deps/echarts_core.js");
    return [...document.querySelectorAll(".chart")].map((element) =>
      echarts.getInstanceByDom(element)?.getOption(),
    );
  });
}
async function selectCurrency(name) {
  await page
    .locator(".toolbar")
    .filter({ has: page.getByText("Display in", { exact: true }) })
    .locator(".t-select")
    .click();
  await page
    .locator(".t-select-option")
    .filter({ hasText: new RegExp(`^${name}$`) })
    .last()
    .click();
}

try {
  token = (await api("POST", "/account", { username: `regression-${Date.now()}`, password })).token;
  const usd = await api("POST", "/currencies", { name: "USD" });
  const cny = await api("POST", "/currencies", { name: "CNY" });
  const bank = await api("POST", "/institutions", { name: "Bank" });
  const broker = await api("POST", "/institutions", { name: "Broker" });
  const cash = await api("POST", "/asset-types", { name: "Cash", color: "65AE73" });
  const deposit = await api("POST", "/asset-types", { name: "Deposit", color: "5577CC" });
  await api("PUT", "/settings", { settings: { default_currency: cny.currency_id } });
  const reports = [];
  for (const multiplier of [1, 2]) {
    const report = await api("POST", "/reports", {
      title: `Snapshot ${multiplier}`,
      report_time: `2020-01-0${multiplier}T00:00:00Z`,
    });
    reports.push(report);
    await api("PUT", `/reports/${report.report_id}/exchange-rates`, {
      numerator_currency_id: usd.currency_id,
      denominator_currency_id: cny.currency_id,
      exchange_rate: multiplier === 1 ? 6 : 8,
    });
    await api("POST", "/records", {
      report_id: report.report_id,
      currency_id: usd.currency_id,
      asset_type_id: cash.asset_type_id,
      institution_id: bank.institution_id,
      content: "Cash",
      amount: 6 * multiplier,
      effective_rate: 1,
    });
    await api("POST", "/records", {
      report_id: report.report_id,
      currency_id: cny.currency_id,
      asset_type_id: deposit.asset_type_id,
      institution_id: broker.institution_id,
      content: "Deposit",
      amount: 60 * multiplier,
      effective_rate: 0.5,
    });
  }
  await page.addInitScript(
    ({ backend, token }) => {
      localStorage.setItem("fortuna.server", backend);
      localStorage.setItem("fortuna.token", token);
    },
    { backend, token },
  );
  await page.goto(`${frontend}/#/reports`);
  await page.getByRole("cell", { name: "66.00 CNY", exact: true }).waitFor();
  await page.getByRole("cell", { name: "156.00 CNY", exact: true }).waitFor();
  const initialPings = pings;
  const nav = page.getByRole("navigation", { name: "Workspace" });
  await nav.getByRole("button", { name: "Collapse sidebar" }).click();
  await nav.getByRole("link", { name: "Settings", exact: true }).click();
  await nav.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.getByRole("button", { name: "Add currency", exact: true })).toBeEnabled();
  const beforeAdd = metadataRequests;
  let failedRefreshes = 0;
  await page.route("**/api/metadata", async (route) => {
    failedRefreshes++;
    await route.fulfill({
      json: { code: 503, msg: "Metadata temporarily unavailable", data: null },
    });
  });
  await page.getByRole("button", { name: "Add currency", exact: true }).click();
  const dialog = page.locator(".t-dialog:visible");
  await formItem(dialog, /^Name$/)
    .locator("input")
    .fill("EUR");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("cell", { name: "EUR", exact: true }).waitFor();
  assert.equal(metadataRequests, beforeAdd);
  assert.equal(failedRefreshes, 0);
  assert.equal((await api("GET", "/currencies")).filter((item) => item.name === "EUR").length, 1);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByText("Metadata temporarily unavailable", { exact: true }).waitFor();
  assert.equal(failedRefreshes, 1);
  await page.getByRole("cell", { name: "EUR", exact: true }).waitFor();
  await expect(page.locator(".t-dialog:visible")).toHaveCount(0);
  await page.unroute("**/api/metadata");
  await page.getByRole("button", { name: "Retry metadata", exact: true }).click();
  await page
    .getByText("Metadata temporarily unavailable", { exact: true })
    .waitFor({ state: "hidden" });
  await expect(page.getByRole("button", { name: "Add currency", exact: true })).toBeEnabled();
  const beforeEdit = metadataRequests;
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "EUR", exact: true }) })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await formItem(page.locator(".t-dialog:visible"), /^Name$/)
    .locator("input")
    .fill("EUR edited");
  await page
    .locator(".t-dialog:visible")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.getByRole("cell", { name: "EUR edited", exact: true }).waitFor();
  assert.equal(metadataRequests, beforeEdit);
  await api("POST", "/currencies", { name: "Added elsewhere" });
  await page.getByText("Institutions", { exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Add institution", exact: true })).toBeEnabled();
  const beforeReturn = metadataRequests;
  await page.getByText("Currencies", { exact: true }).first().click();
  await page.getByRole("cell", { name: "Added elsewhere", exact: true }).waitFor();
  await expect(page.getByRole("button", { name: "Add currency", exact: true })).toBeEnabled();
  assert.equal(metadataRequests, beforeReturn + 1);
  assert.equal(pings, initialPings);

  await page.getByText("Reports", { exact: true }).first().click();
  await page.getByRole("link", { name: "Snapshot 1", exact: true }).click();
  const rateSection = page.getByRole("region", { name: "Report exchange rates", exact: true });
  await rateSection.getByRole("button", { name: "Edit", exact: true }).click();
  const rateDialog = page.locator(".t-dialog:visible");
  const rateInput = formItem(rateDialog, /^Exchange rate$/).getByRole("textbox");
  await rateInput.focus();
  await expect(rateInput).toHaveValue("6");
  await rateInput.fill("7");
  await rateDialog.getByRole("button", { name: "Save", exact: true }).click();
  await rateDialog.waitFor({ state: "hidden" });
  await expect(page.locator(".total-number")).toHaveText("72.00");
  assert.equal(
    (await api("GET", `/reports/${reports[0].report_id}/exchange-rates`))[0].exchange_rate,
    7,
  );
  assert.equal(
    (await api("GET", `/reports/${reports[1].report_id}/exchange-rates`))[0].exchange_rate,
    8,
  );
  await expect
    .poll(async () =>
      (await chartOptions())[0]?.series[0]?.data.map((item) => item.value).sort((a, b) => a - b),
    )
    .toEqual([30, 42]);
  await rateSection.getByRole("button", { name: "Edit", exact: true }).click();
  await rateInput.focus();
  await expect(rateInput).toHaveValue("7");
  await rateInput.fill("6");
  await rateDialog.getByRole("button", { name: "Save", exact: true }).click();
  await rateDialog.waitFor({ state: "hidden" });
  await page.getByRole("switch").click();
  await expect(
    rateSection.getByRole("button", { name: "Add exchange rate", exact: true }),
  ).toHaveCount(0);
  await expect(rateSection.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await rateSection.getByRole("cell", { name: "USD / CNY", exact: true }).waitFor();
  await page.getByRole("switch").click();
  await expect(page.locator(".chart canvas")).toHaveCount(2);
  await expect
    .poll(async () =>
      (await chartOptions()).map((option) =>
        option?.series[0]?.data.map((item) => item.value).sort((a, b) => a - b),
      ),
    )
    .toEqual([
      [30, 36],
      [30, 36],
    ]);
  await selectCurrency("USD");
  await expect
    .poll(async () =>
      (await chartOptions())[0]?.series[0]?.data.map((item) => item.value).sort((a, b) => a - b),
    )
    .toEqual([5, 6]);
  await selectCurrency("Original currencies");
  await expect
    .poll(async () =>
      (await chartOptions())[0]?.series[0]?.data.map((item) => item.value).sort((a, b) => a - b),
    )
    .toEqual([30, 36]);
  await page.screenshot({ path: "../user-data/distributions-regression.png", fullPage: true });
  await page.getByText("Analysis", { exact: true }).first().click();
  await page.getByRole("button", { name: "YTD", exact: true }).click();
  await expect(page.getByPlaceholder("From date")).toHaveValue(/-01-01$/);
  await expect(page.getByText("0 reports · Dashed line: total")).toBeVisible();
  await page.getByRole("button", { name: "Last 1 year", exact: true }).click();
  const through = await page.getByPlaceholder("Through date").inputValue();
  const from = await page.getByPlaceholder("From date").inputValue();
  assert.equal(Number(from.slice(0, 4)), Number(through.slice(0, 4)) - 1);
  await page.getByRole("button", { name: "All time", exact: true }).click();
  await page
    .getByRole("img", {
      name: "Effective asset value stacked by asset type over time",
      exact: true,
    })
    .locator("canvas")
    .waitFor();
  await expect
    .poll(async () =>
      (await chartOptions())[0]?.series?.map((series) => ({
        name: series.name,
        stack: series.stack || "",
        values: series.data.map((point) => point[1]),
      })),
    )
    .toEqual([
      { name: "Cash", stack: "assets", values: [36, 96] },
      { name: "Deposit", stack: "assets", values: [30, 60] },
      { name: "Total", stack: "", values: [66, 156] },
    ]);
  assert.equal((await chartOptions())[0].xAxis[0].type, "time");
  assert.deepEqual(
    (await chartOptions())[0].series[0].data.map(([timestamp]) => timestamp),
    reports.map((report) => Date.parse(report.report_time)),
  );
  await page.getByPlaceholder("All institutions", { exact: true }).click();
  await page
    .locator(".t-select-option")
    .filter({ hasText: /^Bank$/ })
    .click();
  await page.keyboard.press("Escape");
  await expect
    .poll(async () =>
      (await chartOptions())[0]?.series.map((series) => series.data.map((point) => point[1])),
    )
    .toEqual([
      [36, 96],
      [36, 96],
    ]);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.screenshot({ path: "../user-data/stacked-analysis-regression.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.setViewportSize({ width: 1440, height: 1100 });

  await api("PUT", "/settings", { settings: {} });
  await page.getByText("Reports", { exact: true }).first().click();
  await page.getByRole("link", { name: "Snapshot 1", exact: true }).waitFor();
  await expect(page.getByRole("columnheader", { name: /Effective total/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Snapshot 1", exact: true }).click();
  await expect
    .poll(async () =>
      (await chartOptions())[0]?.series[0]?.data.map((item) => item.value).sort((a, b) => a - b),
    )
    .toEqual([5, 6]);
  await rateSection.getByRole("button", { name: "Delete exchange rate", exact: true }).click();
  await page.locator(".t-popconfirm").getByRole("button", { name: "OK", exact: true }).click();
  await expect(
    page.getByText(
      "1 record(s) cannot be converted. Configure exchange rates to show a complete distribution.",
      { exact: true },
    ),
  ).toHaveCount(2);
  assert.equal((await api("GET", `/reports/${reports[0].report_id}/exchange-rates`)).length, 0);
  assert.equal(
    (await api("GET", `/reports/${reports[1].report_id}/exchange-rates`))[0].exchange_rate,
    8,
  );
  await api("PUT", "/settings", { settings: { default_currency: cny.currency_id } });
  await page.getByRole("link", { name: "← All reports", exact: true }).click();
  await page.getByRole("cell", { name: "Incomplete — missing conversion", exact: true }).waitFor();
  await page.getByRole("cell", { name: "156.00 CNY", exact: true }).waitFor();
  await page.getByText("Analysis", { exact: true }).first().click();
  await expect
    .poll(async () =>
      (await chartOptions())[0]?.series
        .find((series) => series.id === "total")
        ?.data.map((point) => point[1]),
    )
    .toEqual([null, 156]);
  const newReport = await api("POST", "/reports", {});
  assert.deepEqual(newReport.exchange_rates, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.fortunaErrors), []);
  console.log(
    "Regression passed: cache/error recovery, report-specific rate editing and deletion, read-only viewing, independent report totals and pie/stacked chart values, missing-rate gaps, empty rates on new reports, filters and mobile layout.",
  );
} finally {
  if (token) await api("DELETE", "/account", { password });
  await browser.close();
}
