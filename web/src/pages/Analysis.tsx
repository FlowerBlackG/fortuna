// SPDX-License-Identifier: MulanPSL-2.0
import { getLanguage, t } from "../i18n";
import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Loading,
  Radio,
  Select,
  Space,
  Table,
} from "tdesign-react";
import { RefreshIcon } from "tdesign-icons-react";
import { request } from "../api";
import { useLoad } from "../useLoad";
import { useMetadata } from "../metadata";
import {
  chartCurrency,
  distribution,
  number,
  reportTitle,
  totals,
  type GroupBy,
} from "../calculations";
import { ReportSankey, StackedChart } from "../components/AnalysisCharts";
import { FilterControls, ValuationControls } from "../components/Records";
import { emptyFilters, filterRecords, useDefaultCurrency, usePrecision } from "../recordState";
import { useTablePagination } from "../tableState";
import type { AssetRecord, Report } from "../types";

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const grouping = {
  asset_type_id: "Asset type",
  institution_id: "Institution",
  currency_id: "Currency",
} as const;

export function AnalysisPage() {
  const { metadata, refresh, ensure } = useMetadata();
  const state = useLoad(async () => {
    const [reports, records] = await Promise.all([
      request<Report[]>("GET", "/reports"),
      request<AssetRecord[]>("GET", "/records"),
      refresh(),
    ]);
    await ensure(records);
    return { reports, records };
  }, []);
  const [filters, setFilters] = useState(emptyFilters);
  const [groupBy, setGroupBy] = useState<GroupBy>("asset_type_id");
  const [selectedCurrency, setCurrency] = useDefaultCurrency();
  const currency = chartCurrency(metadata, selectedCurrency);
  const currencyName =
    metadata.currencies.find((item) => item.currency_id === currency)?.name || "";
  const [decimals, setDecimals] = usePrecision();
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [selected, setSelected] = useState<string[] | null>(null);
  const available = (state.data?.reports || [])
    .filter((report) => {
      const local = localDate(new Date(report.report_time));
      return (!from || local >= from) && (!through || local <= through);
    })
    .sort((a, b) => Date.parse(a.report_time) - Date.parse(b.report_time));
  const reports = available.filter(
    (report) => selected === null || selected.includes(report.report_id),
  );
  const records = filterRecords(state.data?.records || [], filters, metadata);
  const grouped = new Map<string, AssetRecord[]>();
  for (const record of records) {
    if (!grouped.has(record.report_id)) grouped.set(record.report_id, []);
    grouped.get(record.report_id)!.push(record);
  }
  const points = reports.map((report) => {
    const rows = grouped.get(report.report_id) || [];
    const result = totals(rows, report.exchange_rates, currency);
    const { values, missing } = distribution(rows, report.exchange_rates, currency, groupBy);
    return {
      report,
      ...result,
      missing,
      title: reportTitle(report),
      time: Date.parse(report.report_time),
      values,
      total: missing ? null : (result.amounts.get(currency) ?? 0),
    };
  });
  const missing = points.reduce((count, point) => count + point.missing, 0);
  const pagination = useTablePagination(points.length);
  const groupLabel = t(grouping[groupBy]).toLowerCase();
  const ids = new Set(points.flatMap((p) => [...p.values.keys()]));
  const labels = new Map<string, { name: string; color?: string }>(
    groupBy === "asset_type_id"
      ? metadata.asset_types.map((item) => [item.asset_type_id, item])
      : groupBy === "institution_id"
        ? metadata.institutions.map((item) => [item.institution_id, item])
        : metadata.currencies.map((item) => [item.currency_id, item]),
  );
  const groups = [...ids].map((id, index) => {
    const item = labels.get(id);
    return {
      id,
      name:
        item?.name ||
        t(
          groupBy === "asset_type_id"
            ? "Missing asset type"
            : groupBy === "institution_id"
              ? "Missing institution"
              : "Missing currency",
        ),
      color:
        item?.color && /^[0-9a-f]{6}$/i.test(item.color)
          ? `#${item.color}`
          : `hsl(${Math.round((156 + index * 137.5) % 360)}, 40%, 48%)`,
    };
  });
  const chartProps = {
    points,
    groups,
    groupLabel,
    currencyName,
    money: (value: number) => `${number(value, decimals)} ${currencyName}`,
  };
  function selectRange(range: "ytd" | "year") {
    const today = new Date();
    const start = new Date(today);
    if (range === "ytd") start.setMonth(0, 1);
    else {
      start.setFullYear(start.getFullYear() - 1);
      if (start.getMonth() !== today.getMonth()) start.setDate(0);
    }
    setFrom(localDate(start));
    setThrough(localDate(today));
  }
  return (
    <div className="stack">
      {state.error && <Alert theme="error" message={state.error} />}
      <Card>
        <div className="toolbar">
          <DatePicker
            clearable
            placeholder={t("From date")}
            value={from}
            onChange={(value) => setFrom(String(value || ""))}
          />
          <DatePicker
            clearable
            placeholder={t("Through date")}
            value={through}
            onChange={(value) => setThrough(String(value || ""))}
          />
          <Button shape="round" variant="text" onClick={() => selectRange("ytd")}>
            {t("YTD")}
          </Button>
          <Button shape="round" variant="text" onClick={() => selectRange("year")}>
            {t("Last 1 year")}
          </Button>
          <Button
            shape="round"
            variant="text"
            onClick={() => {
              setFrom("");
              setThrough("");
            }}
          >
            {t("All time")}
          </Button>
          <Button
            shape="round"
            variant="outline"
            icon={<RefreshIcon />}
            aria-label={t("Refresh")}
            title={t("Refresh")}
            loading={state.loading}
            onClick={() => {
              void state.refresh().catch(() => {});
            }}
          />
        </div>
        <div className="toolbar">
          <Select
            multiple
            inputProps={{ autoWidth: false }}
            filterable
            clearable
            minCollapsedNum={3}
            style={{ width: "min(700px, 100%)" }}
            placeholder={t("Choose reports")}
            value={
              selected === null
                ? available.map((report) => report.report_id)
                : selected.filter((id) => available.some((report) => report.report_id === id))
            }
            options={available.map((report) => ({
              value: report.report_id,
              label: reportTitle(report),
            }))}
            onChange={(value) => setSelected(value as string[])}
          />
          <Button shape="round" variant="text" onClick={() => setSelected(null)}>
            {t("Select all in date range")}
          </Button>
        </div>
        <ValuationControls
          currency={currency}
          setCurrency={setCurrency}
          decimals={decimals}
          setDecimals={setDecimals}
          singleCurrency
        />
        <FilterControls value={filters} onChange={setFilters} />
        <div className="toolbar">
          <span>{t("Group by")}</span>
          <Radio.Group
            aria-label={t("Group charts by")}
            variant="default-filled"
            value={groupBy}
            onChange={(value) => setGroupBy(value as GroupBy)}
            options={Object.entries(grouping).map(([value, label]) => ({ value, label: t(label) }))}
          />
        </div>
        {from && through && from > through && (
          <Alert theme="warning" message={t("The start date is after the end date.")} />
        )}
        {missing > 0 && (
          <Alert
            theme="warning"
            message={t(
              "{0} record(s) cannot be valued. Affected converted report totals appear as gaps in the chart rather than misleading partial values.",
              missing,
            )}
          />
        )}
        <Loading loading={state.loading}>
          <StackedChart {...chartProps} />
        </Loading>
        <Space>
          <span className="muted">{t("{0} reports · Dashed line: total", reports.length)}</span>
        </Space>
      </Card>
      <Card title={t("Report Sankey")}>
        <ReportSankey {...chartProps} />
      </Card>
      <Card title={t("Report values")}>
        <Table
          rowKey="report_id"
          data={points.map((point) => ({
            report_id: point.report.report_id,
            title: reportTitle(point.report),
            date: point.report.report_time,
            values: point,
          }))}
          columns={[
            { colKey: "title", title: t("Report") },
            {
              colKey: "date",
              title: t("Report time"),
              cell: ({ row }) => new Date(row.date).toLocaleString(getLanguage()),
            },
            {
              colKey: "values",
              title: t("Effective value"),
              cell: ({ row }) =>
                row.values.missing && currency
                  ? t("Incomplete — missing conversion or invalid data")
                  : [...row.values.amounts]
                      .map(
                        ([id, value]) =>
                          `${number(value, decimals)} ${metadata.currencies.find((item) => item.currency_id === id)?.name || t("Missing currency")}`,
                      )
                      .join(" · ") || "0",
            },
          ]}
          empty={t("Choose reports to compare.")}
          pagination={pagination}
        />
      </Card>
    </div>
  );
}
