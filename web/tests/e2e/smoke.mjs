// SPDX-License-Identifier: MulanPSL-2.0
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const backend = process.env.FORTUNA_API || "http://127.0.0.1:5000";
const frontend = process.env.FORTUNA_WEB || "http://localhost:5173";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/sbin/google-chrome-stable",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
await page.addInitScript(() => {
  window.fortunaErrors = [];
  window.addEventListener("error", (event) => window.fortunaErrors.push(event.message));
});
page.on("pageerror", (error) => errors.push(error.message));
let token = "";
const password = "fortuna-browser-test";
const username = `browser-${Date.now()}`;

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
const formItem = (scope, label) =>
  scope
    .locator(".t-form__item")
    .filter({ has: page.locator(".t-form__label", { hasText: label }) });
async function choose(scope, label, option) {
  await formItem(scope, label).locator(".t-select").click();
  await page
    .locator(".t-select-option")
    .filter({ hasText: new RegExp(`^${option}$`) })
    .last()
    .click();
}
async function addMetadata(tab, button, name) {
  await page.getByText(tab, { exact: true }).first().click();
  await page.getByRole("button", { name: button, exact: true }).click();
  const dialog = page.locator(".t-dialog:visible");
  await formItem(dialog, /^Name$/)
    .locator("input")
    .fill(name);
  await formItem(dialog, /^Name$/)
    .locator("input")
    .press("Enter");
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("cell", { name, exact: true }).waitFor();
}

try {
  await page.goto(frontend);
  if (process.env.FORTUNA_SAME_ORIGIN === "1") {
    await page.getByRole("button", { name: "Log in", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("fortuna.server")), frontend);
  } else {
    await page.getByText("Connect to your Fortuna server", { exact: true }).waitFor();
    await page.locator("input").fill(backend);
    await page.getByRole("button", { name: "Test & connect" }).click();
  }
  await page.getByText("Create account", { exact: true }).click();
  await formItem(page, /^Username$/)
    .locator("input")
    .fill(username);
  await formItem(page, /^Password$/)
    .locator("input")
    .fill(password);
  await formItem(page, /^Confirm password$/)
    .locator("input")
    .fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("heading", { name: "Reports", exact: true }).waitFor();
  token = await page.evaluate(() => localStorage.getItem("fortuna.token"));
  assert.ok(token);
  await page.getByText("Settings", { exact: true }).first().click();
  await addMetadata("Currencies", "Add currency", "USD");
  await addMetadata("Currencies", "Add currency", "CNY");
  await addMetadata("Institutions", "Add institution", "Test Bank");
  await page.getByText("Asset types", { exact: true }).first().click();
  await page.getByRole("button", { name: "Add asset type", exact: true }).click();
  let dialog = page.locator(".t-dialog:visible");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(formItem(dialog, /^Name$/)).toContainText("Enter a name");
  await formItem(dialog, /^Name$/)
    .locator("input")
    .fill("Deposit");
  await formItem(dialog, /^Note$/)
    .locator("textarea")
    .fill("Long term");
  await formItem(dialog, /^Color/)
    .locator("input")
    .fill("4455AA");
  await dialog.getByRole("button", { name: "Add custom field" }).click();
  await formItem(dialog, /^Field name$/)
    .locator("input")
    .fill("Interest");
  await choose(dialog, /^Type$/, "Decimal");
  await formItem(dialog, /^Postfix$/)
    .locator("input")
    .fill("%");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const editAsset = page
    .getByRole("row")
    .filter({ hasText: "Deposit" })
    .getByRole("button", { name: "Edit" });
  await editAsset.click();
  await expect(formItem(dialog, /^Name$/).locator("input")).toHaveValue("Deposit");
  await expect(formItem(dialog, /^Note$/).locator("textarea")).toHaveValue("Long term");
  await expect(formItem(dialog, /^Color/).locator("input")).toHaveValue("4455AA");
  await expect(formItem(dialog, /^Field name$/).locator("input")).toHaveValue("Interest");
  await expect(formItem(dialog, /^Type$/).getByRole("textbox")).toHaveValue("Decimal");
  await expect(formItem(dialog, /^Postfix$/).locator("input")).toHaveValue("%");
  await formItem(dialog, /^Name$/)
    .locator("input")
    .fill("Discarded");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await editAsset.click();
  await expect(formItem(dialog, /^Name$/).locator("input")).toHaveValue("Deposit");
  await formItem(dialog, /^Name$/)
    .locator("input")
    .press("Enter");
  await dialog.waitFor({ state: "hidden" });
  await expect(page.getByText("Exchange rates", { exact: true })).toHaveCount(0);
  await page.getByText("Reports", { exact: true }).first().click();
  await page.getByRole("button", { name: "Create report", exact: true }).click();
  await page.getByPlaceholder("Report title (optional)").fill("Browser smoke report");
  await page.getByPlaceholder("Report title (optional)").press("Tab");
  await page.getByText("Title saved", { exact: true }).waitFor();
  const timeInput = page.locator(".t-date-picker input").first();
  await timeInput.fill("2020-03-21 14:15:16");
  await timeInput.press("Enter");
  await expect
    .poll(async () => (await api("GET", "/reports"))[0].report_time.slice(0, 4))
    .toBe("2020");
  await page.getByRole("button", { name: "Add exchange rate" }).click();
  dialog = page.locator(".t-dialog:visible");
  await choose(dialog, /^Numerator currency$/, "USD");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(formItem(dialog, /^Denominator currency$/)).toContainText("Choose a currency");
  await choose(dialog, /^Denominator currency$/, "CNY");
  const rateInput = formItem(dialog, /^Exchange rate$/).getByRole("textbox");
  await rateInput.focus();
  await expect(rateInput).toHaveValue("1");
  await rateInput.fill("6.7");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Add record", exact: true }).click();
  dialog = page.locator(".t-dialog:visible");
  await choose(dialog, /^Asset type$/, "Deposit");
  await choose(dialog, /^Institution$/, "Test Bank");
  await choose(dialog, /^Currency$/, "USD");
  await formItem(dialog, /^Amount$/)
    .locator("input")
    .fill("100");
  await formItem(dialog, /^Effective rate$/)
    .locator("input")
    .fill("0.7");
  await formItem(dialog, /^Content$/)
    .locator("textarea")
    .fill("Savings\nSecond line");
  await formItem(dialog, /^Interest/)
    .locator("input")
    .fill("5.5");
  await formItem(dialog, /^Interest/)
    .locator("input")
    .press("Enter");
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("cell", { name: "Savings Second line" }).waitFor();
  await page.getByText("Syncing…", { exact: true }).waitFor({ state: "hidden" });
  let records = await api("GET", "/records");
  assert.equal(records.length, 1);
  assert.equal(records[0].amount, 100);
  assert.equal(records[0].effective_rate, 0.7);
  assert.deepEqual(records[0].asset_custom_fields_data, [5.5]);
  const reportId = records[0].report_id;
  await page
    .getByRole("row")
    .filter({ hasText: "Savings" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  dialog = page.locator(".t-dialog:visible");
  await formItem(dialog, /^Amount$/)
    .locator("input")
    .fill("200");
  await dialog.getByRole("button", { name: "Save record" }).click();
  await page.getByText("Syncing…", { exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("cell", { name: "140.00 USD", exact: true }).waitFor();
  await page.route("**/api/records/*", async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ json: { code: 503, msg: "Temporary test failure", data: null } });
    } else await route.continue();
  });
  await page
    .getByRole("row")
    .filter({ hasText: "Savings" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  dialog = page.locator(".t-dialog:visible");
  await formItem(dialog, /^Content$/)
    .locator("textarea")
    .fill("Savings\nRetried successfully");
  await dialog.getByRole("button", { name: "Save record" }).click();
  await page.getByText("Not synced: Temporary test failure", { exact: true }).waitFor();
  assert.equal((await api("GET", "/records"))[0].content, "Savings\nSecond line");
  await page.unroute("**/api/records/*");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page
    .getByText("Not synced: Temporary test failure", { exact: true })
    .waitFor({ state: "hidden" });
  await page.getByText("Syncing…", { exact: true }).waitFor({ state: "hidden" });
  assert.equal((await api("GET", "/records"))[0].content, "Savings\nRetried successfully");
  await api("POST", "/records", {
    ...records[0],
    content: "Second deposit",
    amount: 250,
    effective_rate: 0.2,
    asset_custom_fields_data: [2],
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("cell", { name: "Second deposit", exact: true }).waitFor();
  await expect(page.getByRole("columnheader", { name: /^(Amount|Effective rate)$/ })).toHaveCount(
    2,
  );
  await page
    .getByRole("columnheader", { name: "Effective value" })
    .locator(".t-table-sort-asc")
    .click();
  await expect(page.locator("tbody tr").first()).toContainText("Second deposit");
  await page
    .getByRole("columnheader", { name: "Effective value" })
    .locator(".t-table-sort-desc")
    .click();
  await expect(page.locator("tbody tr").first()).toContainText("Savings");
  await page.getByPlaceholder("All asset types", { exact: true }).click();
  await page
    .locator(".t-select-option")
    .filter({ hasText: /^Deposit$/ })
    .click();
  await page.getByRole("heading", { name: "Browser smoke report" }).click();
  await page.getByRole("cell", { name: "5.5%", exact: true }).waitFor();
  await page.getByPlaceholder("Minimum", { exact: true }).fill("5");
  await page.getByPlaceholder("Minimum", { exact: true }).press("Tab");
  await expect(page.locator(".t-table").first().locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first()).toContainText("Savings");
  await page.getByPlaceholder("Minimum", { exact: true }).fill("");
  await page.getByPlaceholder("Minimum", { exact: true }).press("Tab");
  await expect(page.locator(".t-table").first().locator("tbody tr")).toHaveCount(2);
  await page
    .locator(".toolbar")
    .filter({ has: page.getByText("Display in", { exact: true }) })
    .locator(".t-select")
    .click();
  await page.locator(".t-select-option").filter({ hasText: /^CNY$/ }).click();
  await page.getByRole("cell", { name: "140.00 USD (938.00 CNY)", exact: true }).waitFor();
  await expect(page.getByRole("columnheader", { name: /^Effective value in / })).toHaveCount(0);
  await expect(page.locator(".total-number")).toHaveText("1,273.00");
  await page
    .locator(".toolbar")
    .filter({ has: page.getByText("Display in", { exact: true }) })
    .locator(".t-select")
    .click();
  await page
    .locator(".t-select-option")
    .filter({ hasText: /^Original currencies$/ })
    .click();
  await page
    .locator("tbody tr")
    .filter({ hasText: "Second deposit" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await page.locator(".t-popconfirm").getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.locator(".t-table").first().locator("tbody tr")).toHaveCount(1);
  await page.screenshot({ path: "../user-data/report-desktop.png", fullPage: true });
  await page.getByText("Analysis", { exact: true }).first().click();
  const stackCanvas = page.getByRole("img", { name: /stacked by asset type/ }).locator("canvas");
  await stackCanvas.waitFor();
  await page.getByRole("img", { name: "Report Sankey by asset type" }).locator("canvas").waitFor();
  await page.getByRole("cell", { name: "140.00 USD", exact: true }).waitFor();
  await page.screenshot({ path: "../user-data/analysis-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect.poll(() => stackCanvas.evaluate((canvas) => canvas.clientWidth)).toBeLessThan(390);
  await page.screenshot({ path: "../user-data/analysis-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${frontend}/#/reports/${reportId}`);
  await page.getByRole("cell", { name: "140.00 USD", exact: true }).waitFor();
  records = await api("GET", "/records");
  assert.equal(records[0].amount, 200);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.locator(".t-popconfirm").getByRole("button", { name: "OK", exact: true }).click();
  await page.getByText("No records match this view.", { exact: true }).waitFor();
  assert.equal((await api("GET", "/records")).length, 0);
  await api("POST", "/asset-types", { name: "Cash", color: "65AE73" });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "Add record", exact: true }).click();
  await dialog.getByRole("switch", { name: "Quick insert mode" }).click();
  await formItem(dialog, /^Content$/)
    .getByRole("textbox")
    .focus();
  for (const [field, option] of [
    ["Asset type", "Deposit"],
    ["Institution", "Test Bank"],
    ["Currency", "USD"],
  ]) {
    await page.keyboard.press("Tab");
    await expect(formItem(dialog, new RegExp(`^${field}$`)).getByRole("textbox")).toBeFocused();
    await expect(
      page.locator(".t-select__dropdown:visible .t-select-option").filter({ hasText: option }),
    ).toBeVisible();
    await expect(page.locator(".t-select__dropdown:visible")).toHaveCount(1);
  }
  await page.keyboard.press("Tab");
  await expect(formItem(dialog, /^Amount$/).locator(":focus")).toHaveCount(1);
  await expect(page.locator(".t-select__dropdown:visible")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Save record" }).click();
  await expect(dialog.locator(".t-form__controls.t-is-warning")).toHaveCount(3);
  await choose(dialog, /^Asset type$/, "Deposit");
  await expect(dialog.locator(".t-form__controls.t-is-warning")).toHaveCount(2);
  await choose(dialog, /^Institution$/, "Test Bank");
  await choose(dialog, /^Currency$/, "USD");
  for (const label of ["Interest", "currency", "institution"])
    await dialog.getByRole("checkbox", { name: `Keep ${label}`, exact: true }).press("Space");
  const interest = formItem(dialog, /^Interest/).getByRole("textbox");
  const amount = formItem(dialog, /^Amount$/).getByRole("textbox");
  const save = dialog.getByRole("button", { name: "Save record" });
  await interest.fill("3.5");
  await amount.fill("50");
  await page.route("**/api/records", (route) =>
    route.fulfill({ json: { code: 503, msg: "Quick insert failed", data: null } }),
  );
  await save.click();
  await page.getByText("Quick insert failed", { exact: true }).waitFor();
  await expect(amount).toHaveValue("50");
  await page.unroute("**/api/records");
  await save.click();
  await expect(amount).toHaveValue("0");
  await expect(interest).toHaveValue("3.5");
  await expect(dialog.locator(".t-form__controls.t-is-warning")).toHaveCount(0);
  await choose(dialog, /^Asset type$/, "Cash");
  await choose(dialog, /^Asset type$/, "Deposit");
  await expect(interest).toHaveValue("");
  await expect(dialog.getByRole("checkbox", { name: "Keep Interest" })).not.toBeChecked();
  await amount.fill("12");
  await amount.press("Enter");
  await expect(amount).toHaveValue("0");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  const batch = (await api("GET", "/records")).sort((a, b) => a.amount - b.amount);
  assert.deepEqual(
    batch.map((row) => [row.amount, row.asset_custom_fields_data]),
    [
      [12, [null]],
      [50, [3.5]],
    ],
  );
  assert.notEqual(batch[0].record_id, batch[1].record_id);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page.getByRole("button", { name: "Log in", exact: true }).waitFor();
  const login = await api("POST", "/login", { username, password });
  token = login.token;
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.fortunaErrors), []);
  console.log(
    "Browser smoke passed: server setup, registration, metadata CRUD, custom fields, exchange rates, report/record editing, failed-save retry, sorting, numeric filters, conversion, chart, mobile layout, reload, deletion, logout; no page errors.",
  );
} finally {
  if (token)
    await api("DELETE", "/account", { password }).catch((error) =>
      console.error("Cleanup:", error.message),
    );
  await browser.close();
}
