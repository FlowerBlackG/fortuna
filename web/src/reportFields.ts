// SPDX-License-Identifier: MulanPSL-2.0
import { customFields, validFieldValue } from "./calculations";
import { displayValue } from "./helpers";
import { getLanguage, translate } from "./i18n";
import type { AssetRecord, AssetType, CustomField } from "./types";

export interface ReportField {
  key: string;
  assetType: AssetType;
  field: CustomField;
  index: number;
  title: string;
}

export function reportFields(records: AssetRecord[], types: AssetType[]): ReportField[] {
  const present = new Set(records.map((record) => record.asset_type_id));
  return types
    .filter((type) => present.has(type.asset_type_id))
    .flatMap((assetType) =>
      customFields(assetType.custom_fields)
        .map((field, index) => ({
          key: `${assetType.asset_type_id}/${field.data_order}`,
          assetType,
          field,
          index,
          title: present.size > 1 ? `${assetType.name} · ${field.field_name}` : field.field_name,
        }))
        .sort((a, b) => a.field.display_order - b.field.display_order),
    );
}

interface ReportColumn {
  key: string;
  title: string;
  byType: Map<string, ReportField>;
  numeric: boolean;
}

export function mergeReportFields(fields: ReportField[]) {
  const columns: ReportColumn[] = [];
  const matching = new Map<string, ReportColumn[]>();
  for (const source of fields) {
    const { field, assetType } = source;
    const signature = JSON.stringify([field.field_name, field.prefix, field.postfix]);
    const candidates = matching.get(signature) ?? [];
    // Two matching fields on one record still need separate cells.
    let column = candidates.find((item) => !item.byType.has(assetType.asset_type_id));
    if (!column) {
      column = { key: source.key, title: source.title, byType: new Map(), numeric: true };
      columns.push(column);
      candidates.push(column);
      matching.set(signature, candidates);
    } else {
      column.title = field.field_name;
    }
    column.byType.set(assetType.asset_type_id, source);
    column.numeric &&= field.type === "int" || field.type === "float";
  }
  return columns;
}

export function reportFieldValue(record: AssetRecord, column: ReportColumn): unknown {
  const source = column.byType.get(record.asset_type_id);
  if (!source) return null;
  return Array.isArray(record.asset_custom_fields_data)
    ? (record.asset_custom_fields_data[source.index] ?? null)
    : null;
}

export function formatReportField(
  record: AssetRecord,
  column: ReportColumn,
  language = getLanguage(),
): string | number {
  const source = column.byType.get(record.asset_type_id);
  if (!source) return "";
  const value: unknown = reportFieldValue(record, column);
  const { field } = source;
  if (!validFieldValue(field, value)) return translate(language, "Needs correction");
  if (value === null) return "—";
  if (typeof value === "number" && !field.prefix && !field.postfix) return value;
  return `${field.prefix}${displayValue(value)}${field.postfix}`;
}
