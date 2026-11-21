// SPDX-License-Identifier: MulanPSL-2.0
import { describe, expect, it } from "vite-plus/test";
import { emptyFilters, filterRecords } from "./recordState";
import type { AssetRecord, Metadata } from "./types";

const metadata: Metadata = {
  currencies: [],
  institutions: [],
  settings: {},
  asset_types: [
    {
      asset_type_id: "deposit",
      user_id: "u",
      name: "Deposit",
      color: "65AE73",
      note: "",
      custom_fields: [
        {
          data_order: 7,
          display_order: 0,
          type: "date",
          field_name: "Due",
          prefix: "",
          postfix: "",
          nullable: true,
        },
        {
          data_order: 2,
          display_order: 1,
          type: "float",
          field_name: "Interest",
          prefix: "",
          postfix: "%",
          nullable: false,
        },
      ],
    },
  ],
};
const records: AssetRecord[] = [
  {
    record_id: "one",
    user_id: "u",
    report_id: "r",
    currency_id: "usd",
    institution_id: "bank",
    asset_type_id: "deposit",
    content: "Savings",
    amount: 100,
    effective_rate: 1,
    asset_custom_fields_data: [5.5, "2027-01-20"],
  },
  {
    record_id: "two",
    user_id: "u",
    report_id: "r",
    currency_id: "usd",
    institution_id: "other",
    asset_type_id: "deposit",
    content: "Reserve",
    amount: 200,
    effective_rate: 1,
    asset_custom_fields_data: [3, null],
  },
];
describe("record filters", () => {
  it("combines institution, type, and case-insensitive content filters", () => {
    expect(
      filterRecords(
        records,
        { ...emptyFilters, assetTypes: ["deposit"], institutions: ["bank"], search: "SAV" },
        metadata,
      ).map((record) => record.record_id),
    ).toEqual(["one"]);
  });
  it("filters numeric and date values by sorted data order, not display order", () => {
    expect(
      filterRecords(
        records,
        {
          ...emptyFilters,
          assetTypes: ["deposit"],
          custom: { 2: { min: "5", max: "6" }, 7: { min: "2027-01-01", max: "2027-01-31" } },
        },
        metadata,
      ).map((record) => record.record_id),
    ).toEqual(["one"]);
  });
  it("does not apply a custom filter to unrelated types or treat missing values as valid dates", () => {
    expect(
      filterRecords(records, { ...emptyFilters, custom: { 7: { min: "2027-01-01" } } }, metadata),
    ).toHaveLength(2);
    expect(
      filterRecords(
        records,
        { ...emptyFilters, assetTypes: ["deposit"], custom: { 7: { max: "2026-12-31" } } },
        metadata,
      ),
    ).toHaveLength(0);
  });
});
