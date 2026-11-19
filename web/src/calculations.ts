// SPDX-License-Identifier: MulanPSL-2.0
import type { AssetRecord, CustomField, CurrencyTotal, ExchangeRate, Metadata } from "./types";

export function customFields(value: unknown): CustomField[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  return value
    .filter((field): field is CustomField => {
      if (
        !field ||
        typeof field !== "object" ||
        !Number.isInteger(field.data_order) ||
        seen.has(field.data_order) ||
        !Number.isInteger(field.display_order) ||
        !["str", "int", "float", "date"].includes(field.type) ||
        typeof field.field_name !== "string" ||
        typeof field.prefix !== "string" ||
        typeof field.postfix !== "string" ||
        typeof field.nullable !== "boolean"
      )
        return false;
      seen.add(field.data_order);
      return true;
    })
    .sort((a, b) => a.data_order - b.data_order);
}
export function customValue(
  record: AssetRecord,
  fields: CustomField[],
  field: CustomField,
): unknown {
  if (!Array.isArray(record.asset_custom_fields_data)) return null;
  return (
    record.asset_custom_fields_data[
      fields.findIndex((item) => item.data_order === field.data_order)
    ] ?? null
  );
}
export function validFieldValue(field: CustomField, value: unknown) {
  if (value === null || value === undefined) return field.nullable;
  if (field.type === "str") return typeof value === "string";
  if (field.type === "date")
    return (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) &&
      Number.isFinite(Date.parse(value))
    );
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (field.type !== "int" || Number.isInteger(value))
  );
}
export function conversion(rates: ExchangeRate[], source: string, target: string): number | null {
  if (source === target) return 1;
  const graph = new Map<string, Map<string, number>>();
  const add = (from: string, to: string, rate: number, overwrite = true) => {
    if (!graph.has(from)) graph.set(from, new Map());
    if (overwrite || !graph.get(from)!.has(to)) graph.get(from)!.set(to, rate);
  };
  for (const rate of rates) {
    if (rate.exchange_rate > 0 && Number.isFinite(rate.exchange_rate)) {
      add(rate.numerator_currency_id, rate.denominator_currency_id, rate.exchange_rate);
    }
  }
  for (const rate of rates) {
    if (rate.exchange_rate > 0 && Number.isFinite(rate.exchange_rate)) {
      add(rate.denominator_currency_id, rate.numerator_currency_id, 1 / rate.exchange_rate, false);
    }
  }
  const queue: [string, number][] = [[source, 1]];
  const visited = new Set([source]);
  for (let index = 0; index < queue.length; index++) {
    const [currency, factor] = queue[index];
    for (const [next, multiplier] of graph.get(currency) || []) {
      if (visited.has(next)) continue;
      const value = factor * multiplier;
      if (next === target) return Number.isFinite(value) ? value : null;
      visited.add(next);
      queue.push([next, value]);
    }
  }
  return null;
}
export function totals(records: AssetRecord[], rates: ExchangeRate[], target = "") {
  const amounts = new Map<string, { nominal: number; effective: number }>();
  let missing = 0;
  for (const record of records) {
    const factor = target ? conversion(rates, record.currency_id, target) : 1;
    if (factor === null || !Number.isFinite(record.amount * record.effective_rate * factor)) {
      missing++;
      continue;
    }
    const key = target || record.currency_id;
    const amount = amounts.get(key) || { nominal: 0, effective: 0 };
    amount.nominal += record.amount * factor;
    amount.effective += record.amount * record.effective_rate * factor;
    amounts.set(key, amount);
  }
  return { amounts, missing };
}
export function number(value: number, decimals: number) {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    : "Invalid value";
}
export function reportTitle(report: { title: string; create_time: string }) {
  return report.title.trim() || new Date(report.create_time).toLocaleString();
}

export function chartCurrency(metadata: Metadata, selected = ""): string {
  const settings = metadata.settings;
  const defaultCurrency =
    settings && typeof settings === "object" && "default_currency" in settings
      ? settings.default_currency
      : "";
  for (const id of [selected, defaultCurrency]) {
    if (typeof id === "string" && metadata.currencies.some((item) => item.currency_id === id))
      return id;
  }
  return (
    [...metadata.currencies].sort((a, b) => a.currency_id.localeCompare(b.currency_id))[0]
      ?.currency_id || ""
  );
}

export function convertTotals(amounts: CurrencyTotal[], rates: ExchangeRate[], currency: string) {
  let value = 0;
  for (const amount of amounts) {
    const factor = conversion(rates, amount.currency_id, currency);
    if (factor === null || !Number.isFinite(amount.effective * factor)) return null;
    value += amount.effective * factor;
  }
  return Number.isFinite(value) ? value : null;
}

export function distribution(
  records: AssetRecord[],
  rates: ExchangeRate[],
  currency: string,
  group: "asset_type_id" | "institution_id",
) {
  const values = new Map<string, number>();
  let missing = 0;
  for (const record of records) {
    const factor = currency ? conversion(rates, record.currency_id, currency) : null;
    const value = factor === null ? NaN : record.amount * record.effective_rate * factor;
    const sum = (values.get(record[group]) || 0) + value;
    if (!Number.isFinite(sum)) {
      missing++;
      continue;
    }
    values.set(record[group], sum);
  }
  return { values, missing };
}
