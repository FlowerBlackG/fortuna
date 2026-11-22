// SPDX-License-Identifier: MulanPSL-2.0
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
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
  const reference = {
    field_name: "Reference",
    type: "str",
    nullable: true,
    data_order: 7,
    display_order: 0,
    prefix: "",
    postfix: "",
  };
  const cash = await api("POST", "/asset-types", {
    name: "Cash",
    color: "65AE73",
    custom_fields: [reference],
  });
  const deposit = await api("POST", "/asset-types", {
    name: "Deposit",
    color: "5577CC",
    custom_fields: [
      reference,
      {
        ...reference,
        field_name: "Yield",
        data_order: 2,
        display_order: 1,
        type: "float",
        postfix: "%",
      },
      ...Array.from({ length: 12 }, (_, i) => ({
        ...reference,
        field_name: `Deposit detail ${i + 1}`,
        data_order: 8 + i,
        display_order: 2 + i,
      })),
    ],
  });
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
      asset_custom_fields_data: ["cash ref"],
      amount: 6 * multiplier,
      effective_rate: 1,
    });
    await api("POST", "/records", {
      report_id: report.report_id,
      currency_id: cny.currency_id,
      asset_type_id: deposit.asset_type_id,
      institution_id: broker.institution_id,
      content: "Deposit",
      asset_custom_fields_data: [2.5, null],
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
  await nav.getByRole("link", { name: "About", exact: true }).click();
  await page.getByRole("heading", { name: "Fortuna", exact: true }).waitFor();
  const build = await api("GET", "/ping");
  await expect(page.getByRole("row").filter({ hasText: "Server environment" })).toContainText(
    build.environment,
  );
  await expect(
    page.getByText(`${build.version} (${build.version_code})`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Server build" })).toContainText(
    /\d{4}-\d{2}-\d{2} \d{2}:\d{2} (CST|[+-]\d{1,2}(:\d{2})?)/,
  );
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
  await expect(
    page.getByRole("columnheader", { name: "Effective value", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /^(Amount|Effective rate)$/ })).toHaveCount(
    2,
  );
  await expect(
    page.getByRole("columnheader", { name: "Deposit · Yield", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Reference", exact: true })).toHaveCount(1);
  await expect(page.getByRole("cell", { name: "2.5%", exact: true })).toBeVisible();
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
  await expect(page.getByPlaceholder("From date")).toHaveValue(
    new RegExp(`^${Number(through.slice(0, 4)) - 1}-`),
  );
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
  for (const [label, names] of Object.entries({
    Institution: ["Bank", "Broker"],
    Currency: ["USD", "CNY"],
  })) {
    await page.getByText(label, { exact: true }).click();
    const [stack, sankey] = await chartOptions();
    assert.deepEqual(
      stack.series.map((s) => s.name),
      [...names, "Total"],
    );
    assert.deepEqual(
      sankey.series[0].links.map((link) => link.value),
      [36, 30],
    );
    const canvas = page.getByRole("img", {
      name: `Effective asset value stacked by ${label.toLowerCase()} over time`,
    });
    const [x, y] = await canvas.evaluate(async (element) => {
      const { getInstanceByDom } = await import("/node_modules/.vite/deps/echarts_core.js");
      return getInstanceByDom(element).convertToPixel({ gridIndex: 0 }, [
        Date.parse("2020-01-01T06:00:00Z"),
        20,
      ]);
    });
    await canvas.hover({ position: { x, y } });
    await expect(page.locator("body > .analysis-tooltip:visible")).toContainText(
      `${names[0]}: 36.00 CNY`,
    );
    await expect(page.locator("body > .analysis-tooltip:visible")).toContainText(
      "Total: 66.00 CNY",
    );
  }
  await page.getByText("Asset type", { exact: true }).click();
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
  const institution = "Bank with a long legend label\n上海分行";
  await api("PATCH", `/institutions/${bank.institution_id}`, { name: institution });
  await api("PATCH", `/currencies/${usd.currency_id}`, { name: "USD美元" });
  await nav.getByRole("link", { name: "Settings" }).click();
  await page.getByText("Preferences", { exact: true }).click();
  await formItem(page, /^Language$/)
    .locator(".t-select")
    .click();
  await page.locator(".t-select-option").getByText("简体中文").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  for (const [label, font] of [
    ["英文", "Latin Text"],
    ["非英文", "CJK Text"],
    ["英文等宽", "Latin Mono"],
    ["非英文等宽", "CJK Mono"],
  ]) {
    await formItem(page, new RegExp(`^${label}$`))
      .locator("input")
      .fill(font);
  }
  await page.reload();
  const zhNav = page.getByRole("navigation", { name: "工作区" });
  await zhNav.getByRole("link", { name: "分析" }).click();
  await page.getByText("机构", { exact: true }).click();
  const plot = page.getByRole("img", { name: "按机构堆叠的资产有效价值趋势" });
  await plot.locator("canvas").waitFor();
  const legend = await plot.evaluate(async (el) => {
    const { getInstanceByDom } = await import("/node_modules/.vite/deps/echarts_core.js");
    const chart = getInstanceByDom(el);
    const label = chart
      .getZr()
      .storage.getDisplayList()
      .find((s) => s.type === "tspan" && s.style.text?.startsWith("Bank"));
    const rect = label.getBoundingRect().clone();
    rect.applyTransform(label.getComputedTransform());
    return { text: label.style.text, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  assert.match(legend.text, /\.\.\.$/);
  await plot.hover({ position: { x: legend.x, y: legend.y } });
  await expect(page.locator(".analysis-tooltip:visible")).toHaveText(institution);
  await zhNav.getByRole("link", { name: "报告", exact: true }).click();
  const depositRecord = (await api("GET", `/records?report_id=${reports[1].report_id}`)).find(
    (r) => r.content === "Deposit",
  );
  await api("PATCH", `/records/${depositRecord.record_id}`, {
    institution_id: bank.institution_id,
  });
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "Snapshot 2" }) })
    .getByRole("button", { name: "导出报告" })
    .click();
  const exportDialog = page.locator(".t-dialog:visible");
  const cashField = formItem(exportDialog, /^Cash$/).getByRole("checkbox", { name: "Reference" });
  await expect(cashField).toBeChecked();
  await expect(
    formItem(exportDialog, /^Deposit$/).getByRole("checkbox", { name: "Reference" }),
  ).toBeChecked();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    exportDialog.getByRole("button", { name: "导出", exact: true }).click(),
  ]);
  const archive = unzipSync(await readFile(await download.path()));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(archive["Snapshot 2.xlsx"]);
  assert.deepEqual(
    book.worksheets.map((sheet) => sheet.name),
    ["按机构", "按资产类型", "按货币"],
  );
  for (const sheet of book.worksheets) {
    assert.equal(sheet.getCell("A1").font.name, "Latin Text");
    assert.equal(sheet.getCell("A2").font.name, "CJK Text");
    const rows = sheet.getRows(1, sheet.rowCount);
    const summary = rows.find((r) => r.getCell(2).text === "有效价值");
    assert.deepEqual(summary.values.slice(1), ["货币", "有效价值"]);
    assert.deepEqual(sheet.getRow(summary.number + 1).values.slice(1), ["CNY", 156]);
    const details = rows.find((r) => r.getCell(1).text === "内容");
    assert.deepEqual(
      [4, 5, 6].map((col) => details.getCell(col).text),
      ["金额", "有效系数", "有效价值"],
    );
    assert.ok(!details.values.includes("以CNY计的有效价值"));
    const referenceCol = details.values.indexOf("Reference");
    assert.ok(referenceCol > 0);
    assert.equal(details.values.filter((name) => String(name).includes("Reference")).length, 1);
    const item = rows.find((r) => r.getCell(1).text === "Cash" && r.getCell(4).value === 12);
    assert.equal(item.getCell(4).font.name, "Latin Mono");
    assert.equal(item.getCell(5).value, 1);
    assert.equal(item.getCell(6).text, "12.00 USD美元 (96.00 CNY)");
    assert.ok(item.values.includes("cash ref"));
    assert.equal(item.getCell(referenceCol).text, "cash ref");
    const deposit = rows.find((r) => r.getCell(1).text === "Deposit" && !r.getCell(1).isMerged);
    assert.deepEqual(
      [4, 5, 6].map((i) => deposit.getCell(i).value),
      [120, 0.5, 60],
    );
    assert.ok(deposit.values.includes("2.5%"));
    assert.equal(deposit.getCell(referenceCol).text, "—");
    const subtotals = rows
      .filter((r) => r.getCell(1).text === "小计（CNY）")
      .map((r) => r.getCell(6).value)
      .sort((a, b) => a - b);
    assert.deepEqual(subtotals, sheet.name === "按机构" ? [156] : [60, 96]);
  }
  const cashRow = book.worksheets[0]
    .getRows(1, book.worksheets[0].rowCount)
    .find((r) => r.getCell(4).value === 12);
  assert.deepEqual(
    cashRow.getCell(3).value.richText.map((r) => [r.text, r.font.name]),
    [
      ["USD", "Latin Mono"],
      ["美元", "CJK Mono"],
    ],
  );
  const pdf = Buffer.from(archive["Snapshot 2.pdf"]).toString("latin1");
  const pages = [...pdf.matchAll(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/g)];
  assert.equal(pages.length, 3);
  assert.equal(new Set(pages.map(([box]) => box)).size, 1);
  assert.ok(Number(pages[0][1]) > 842);
  assert.match(pdf, /\/PageMode \/UseOutlines/);
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.fortunaErrors), []);
  console.log(
    "Regression passed: cache/error recovery, report-specific rate editing and deletion, read-only viewing, independent report totals and pie/stacked chart values, missing-rate gaps, empty rates on new reports, filters and mobile layout.",
  );
} finally {
  if (token) await api("DELETE", "/account", { password });
  await browser.close();
}
