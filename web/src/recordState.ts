// SPDX-License-Identifier: MulanPSL-2.0
import { useState } from "react";
import { customFields, customValue, validFieldValue } from "./calculations";
import { displayValue, settingsObject } from "./helpers";
import { useMetadata } from "./metadata";
import type { AssetRecord, Metadata } from "./types";

export interface RecordFilters {
  assetTypes: string[];
  institutions: string[];
  search: string;
  custom: Record<number, { text?: string; min?: string; max?: string }>;
}
export const emptyFilters: RecordFilters = {
  assetTypes: [],
  institutions: [],
  search: "",
  custom: {},
};
export function filterRecords(records: AssetRecord[], filters: RecordFilters, metadata: Metadata) {
  const fields =
    filters.assetTypes.length === 1
      ? customFields(
          metadata.asset_types.find((item) => item.asset_type_id === filters.assetTypes[0])
            ?.custom_fields,
        )
      : [];
  return records.filter((record) => {
    if (filters.assetTypes.length && !filters.assetTypes.includes(record.asset_type_id))
      return false;
    if (filters.institutions.length && !filters.institutions.includes(record.institution_id))
      return false;
    if (filters.search && !record.content.toLowerCase().includes(filters.search.toLowerCase()))
      return false;
    return fields.every((field) => {
      const filter = filters.custom[field.data_order];
      if (!filter || (!filter.text && !filter.min && !filter.max)) return true;
      const value = customValue(record, fields, field);
      if (value === null || !validFieldValue(field, value)) return false;
      if (field.type === "str")
        return displayValue(value)
          .toLowerCase()
          .includes((filter.text || "").toLowerCase());
      if (field.type === "date") {
        const date = displayValue(value).slice(0, 10);
        return (!filter.min || date >= filter.min) && (!filter.max || date <= filter.max);
      }
      return (
        (!filter.min || Number(value) >= Number(filter.min)) &&
        (!filter.max || Number(value) <= Number(filter.max))
      );
    });
  });
}

export function usePrecision() {
  const [decimals, setDecimals] = useState(() => {
    const stored = Number(localStorage.getItem("fortuna.decimals") ?? "2");
    return Number.isInteger(stored) && stored >= 0 && stored <= 10 ? stored : 2;
  });
  return [
    decimals,
    (value: number) => {
      setDecimals(value);
      localStorage.setItem("fortuna.decimals", String(value));
    },
  ] as const;
}

export function useDefaultCurrency() {
  const { metadata } = useMetadata();
  const [chosen, setChosen] = useState<string | null>(null);
  const defaultCurrency = settingsObject(metadata.settings).default_currency;
  const currency =
    chosen ??
    (typeof defaultCurrency === "string" &&
    metadata.currencies.some((item) => item.currency_id === defaultCurrency)
      ? defaultCurrency
      : "");
  return [currency, setChosen] as const;
}
