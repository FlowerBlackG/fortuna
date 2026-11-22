// SPDX-License-Identifier: MulanPSL-2.0
import { expect, it } from "vite-plus/test";
import { formatReportField, mergeReportFields, reportFields } from "../../src/reportFields";
import type { AssetRecord, AssetType, CustomField } from "../../src/types";

it("merges selected fields by exact name and affixes while preserving each record's field index", () => {
  const ratio: CustomField = {
    field_name: "Ratio",
    prefix: "C-",
    postfix: "%",
    type: "int",
    nullable: false,
    display_order: 0,
    data_order: 5,
  };
  const asset = (id: string, fields: CustomField[]): AssetType => ({
    asset_type_id: id,
    name: id,
    user_id: "u",
    note: "",
    color: "",
    custom_fields: fields,
  });
  const a = asset("A", [ratio, { ...ratio, data_order: 9 }]);
  const b = asset("B", [
    { ...ratio, type: "str", nullable: true, data_order: 8 },
    { ...ratio, prefix: "D-", data_order: 2 },
    { ...ratio, postfix: "‰", data_order: 4 },
  ]);
  const row = (type: AssetType, values: unknown[]): AssetRecord => ({
    asset_type_id: type.asset_type_id,
    asset_custom_fields_data: values,
    report_id: "r",
    record_id: type.name,
    user_id: "u",
    currency_id: "usd",
    institution_id: "bank",
    amount: 1,
    effective_rate: 1,
    content: "",
  });
  const rows = [row(a, [1, 2]), row(b, [3, 4, "ten"])];
  const fields = reportFields(rows, [a, b]);
  const render = (selected: typeof fields) => {
    const columns = mergeReportFields(selected);
    return rows.map((record) => columns.map((col) => formatReportField(record, col)));
  };
  expect(render(fields)).toEqual([
    ["C-1%", "C-2%", "", ""],
    ["C-ten%", "", "D-3%", "C-4‰"],
  ]);
  expect(render(fields.filter((field) => field.key !== "B/8"))).toEqual([
    ["C-1%", "C-2%", "", ""],
    ["", "", "D-3%", "C-4‰"],
  ]);
});
