// SPDX-License-Identifier: MulanPSL-2.0
import { describe, expect, it } from "vite-plus/test";
import {
  chartCurrency,
  conversion,
  convertTotals,
  customFields,
  customValue,
  distribution,
  totals,
} from "../../src/calculations";
import type { AssetRecord, ExchangeRate, Metadata } from "../../src/types";
import { compareSnapshots, type ReportSnapshot } from "../../src/reportComparison";

function rate(numerator: string, denominator: string, value: number): ExchangeRate {
  return {
    user_id: "user",
    report_id: "report",
    numerator_currency_id: numerator,
    denominator_currency_id: denominator,
    exchange_rate: value,
  };
}
function record(currency: string, amount: number, effectiveRate = 1): AssetRecord {
  return {
    record_id: "record",
    user_id: "user",
    report_id: "report",
    currency_id: currency,
    amount,
    effective_rate: effectiveRate,
    institution_id: "bank",
    asset_type_id: "deposit",
    content: "",
    asset_custom_fields_data: [],
  };
}
describe("currency valuation", () => {
  it("respects numerator / denominator and inverse conversion", () => {
    expect(conversion([rate("USD", "CNY", 6)], "USD", "CNY")! * 6).toBe(36);
    expect(conversion([rate("USD", "CNY", 6)], "CNY", "USD")).toBeCloseTo(1 / 6);
  });
  it("uses shortest paths, tolerates cycles, and reports disconnected currencies", () => {
    const rates = [rate("A", "B", 2), rate("B", "C", 3), rate("A", "C", 7), rate("C", "D", 4)];
    expect(conversion(rates, "A", "C")).toBe(7);
    expect(conversion(rates, "A", "D")).toBe(28);
    expect(conversion(rates, "A", "E")).toBeNull();
    expect(conversion(rates, "A", "A")).toBe(1);
  });
  it("keeps original-currency totals separate and applies effective rates", () => {
    const rows = [record("USD", 100, 0.7), record("CNY", 67, 0.5)];
    const original = totals(rows, []);
    expect([...original.amounts]).toEqual([
      ["USD", 70],
      ["CNY", 33.5],
    ]);
    const converted = totals(rows, [rate("USD", "CNY", 6.7)], "USD");
    expect([...converted.amounts]).toEqual([["USD", 75]]);
  });
  it("marks unconvertible records as missing rather than silently counting zero", () => {
    const result = totals([record("USD", 100), record("BTC", 2)], [], "USD");
    expect(result.missing).toBe(1);
    expect(result.amounts.get("USD")).toBe(100);
  });
});
describe("report distributions and summaries", () => {
  const rates = [rate("USD", "CNY", 6)];
  const rows = [
    { ...record("USD", 100, 0.7), asset_type_id: "cash", institution_id: "bank" },
    { ...record("CNY", 60), asset_type_id: "deposit", institution_id: "bank" },
    { ...record("USD", 20), asset_type_id: "cash", institution_id: "broker" },
  ];
  it("converts before grouping and reconciles asset and institution distributions", () => {
    const assets = distribution(rows, rates, "CNY", "asset_type_id");
    const institutions = distribution(rows, rates, "CNY", "institution_id");
    expect([...assets.values]).toEqual([
      ["cash", 540],
      ["deposit", 60],
    ]);
    expect([...institutions.values]).toEqual([
      ["bank", 480],
      ["broker", 120],
    ]);
    expect(assets.missing).toBe(0);
    expect([...assets.values.values()].reduce((a, b) => a + b, 0)).toBe(
      totals(rows, rates, "CNY").amounts.get("CNY"),
    );
  });
  it("converts raw currency subtotals and refuses incomplete totals", () => {
    expect(
      convertTotals(
        [
          { currency_id: "USD", effective: 70 },
          { currency_id: "CNY", effective: 60 },
        ],
        rates,
        "CNY",
      ),
    ).toBe(480);
    expect(convertTotals([{ currency_id: "BTC", effective: 1 }], rates, "CNY")).toBeNull();
    expect(convertTotals([], rates, "CNY")).toBe(0);
    expect(distribution([record("BTC", 1)], rates, "CNY", "asset_type_id").missing).toBe(1);
  });
  it("chooses selected, then default, then a stable fallback currency", () => {
    const metadata: Metadata = {
      currencies: ["USD", "CNY"].map((currency_id) => ({
        currency_id,
        user_id: "u",
        name: currency_id,
        note: "",
      })),
      asset_types: [],
      institutions: [],
      settings: { default_currency: "USD" },
    };
    expect(chartCurrency(metadata, "CNY")).toBe("CNY");
    expect(chartCurrency(metadata)).toBe("USD");
    expect(chartCurrency({ ...metadata, settings: null })).toBe("CNY");
    expect(chartCurrency({ ...metadata, currencies: [] })).toBe("");
  });
});
describe("cross-report growth", () => {
  function snapshot(records: AssetRecord[], rates: ExchangeRate[]): ReportSnapshot {
    return {
      report: {
        report_id: "r",
        user_id: "u",
        title: "",
        report_time: "",
        create_time: "",
        update_time: "",
        exchange_rates: rates,
      },
      records,
    };
  }
  const previous = snapshot(
    [record("USD", 100, 0.5), { ...record("JPY", 90), institution_id: "closed" }],
    [rate("USD", "CNY", 6)],
  );
  const current = snapshot(
    [record("USD", 100, 0.5), { ...record("CNY", 30), institution_id: "new" }],
    [rate("USD", "CNY", 8)],
  );

  it("uses each snapshot's rates and marks only incomplete changes unavailable", () => {
    expect(compareSnapshots(current, previous, "institution_id", "CNY")).toEqual({
      currencies: ["CNY"],
      rows: [
        { id: "bank", changes: [100] },
        { id: "closed", changes: [null] },
        { id: "new", changes: [30] },
      ],
    });
  });

  it("includes currencies present in only one snapshot and measures currency rows in their own units", () => {
    expect(compareSnapshots(current, previous, "currency_id", "").rows).toEqual([
      { id: "USD", changes: [0] },
      { id: "JPY", changes: [-90] },
      { id: "CNY", changes: [30] },
    ]);
    expect(compareSnapshots(current, previous, "asset_type_id", "")).toEqual({
      currencies: ["USD", "JPY", "CNY"],
      rows: [{ id: "deposit", changes: [0, -90, 30] }],
    });
  });
});
describe("custom fields", () => {
  it("indexes by sorted data order, independently of display order and gaps", () => {
    const definitions = [
      {
        data_order: 8,
        display_order: 0,
        type: "str",
        field_name: "B",
        prefix: "",
        postfix: "",
        nullable: true,
      },
      {
        data_order: 3,
        display_order: 1,
        type: "str",
        field_name: "A",
        prefix: "",
        postfix: "",
        nullable: true,
      },
    ];
    const fields = customFields(definitions);
    const row = { ...record("USD", 1), asset_custom_fields_data: ["first", "second"] };
    expect(customValue(row, fields, fields[0])).toBe("first");
    expect(customValue(row, fields, fields[1])).toBe("second");
    expect(customFields("invalid")).toEqual([]);
  });
});
