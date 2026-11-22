// SPDX-License-Identifier: MulanPSL-2.0
import { conversion, type GroupBy } from "./calculations";
import type { AssetRecord, Report } from "./types";

export interface ReportSnapshot {
  report: Report;
  records: AssetRecord[];
}

export function isEarlierReport(candidate: Report, current: Report) {
  // The API normalizes report times to ISO 8601 UTC, including sub-millisecond precision.
  return candidate.report_id !== current.report_id && candidate.report_time < current.report_time;
}

function groupedValues({ report, records }: ReportSnapshot, grouping: GroupBy, currency: string) {
  const groups = new Map<string, Map<string, number>>();
  const factors = new Map<string, number>();
  for (const record of records) {
    const source = record.currency_id;
    if (!factors.has(source)) {
      factors.set(
        source,
        currency ? (conversion(report.exchange_rates, source, currency) ?? NaN) : 1,
      );
    }
    const id = record[grouping];
    const values = groups.get(id) ?? new Map<string, number>();
    const unit = currency || source;
    values.set(
      unit,
      (values.get(unit) ?? 0) + record.amount * record.effective_rate * factors.get(source)!,
    );
    groups.set(id, values);
  }
  return groups;
}

export function compareSnapshots(
  current: ReportSnapshot,
  previous: ReportSnapshot,
  grouping: GroupBy,
  currency: string,
) {
  const before = groupedValues(previous, grouping, currency);
  const after = groupedValues(current, grouping, currency);
  // An empty column currency means the row label supplies the unit.
  const currencies =
    currency || grouping === "currency_id"
      ? [currency]
      : Array.from(
          new Set([
            ...previous.records.map((record) => record.currency_id),
            ...current.records.map((record) => record.currency_id),
          ]),
        );
  const rows = Array.from(new Set([...before.keys(), ...after.keys()]), (id) => ({
    id,
    changes: currencies.map((column) => {
      const unit = column || id;
      const delta = (after.get(id)?.get(unit) ?? 0) - (before.get(id)?.get(unit) ?? 0);
      return Number.isFinite(delta) ? delta : null;
    }),
  }));
  return { currencies, rows };
}
