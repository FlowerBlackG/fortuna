// SPDX-License-Identifier: MulanPSL-2.0
import { useState } from "react";
import { Alert, Button, Card, DatePicker, Loading, Select, Space, Table } from "tdesign-react";
import { RefreshIcon } from "tdesign-icons-react";
import { request } from "../api";
import { useLoad } from "../useLoad";
import { useMetadata } from "../metadata";
import { chartCurrency, distribution, number, reportTitle, totals } from "../calculations";
import { Chart } from "../components/Chart";
import { FilterControls, ValuationControls } from "../components/Records";
import { emptyFilters, filterRecords, useDefaultCurrency, usePrecision } from "../recordState";
import type { AssetRecord, Report } from "../types";

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

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
  const points = reports.map((report) => ({
    report,
    ...totals(grouped.get(report.report_id) || [], report.exchange_rates, currency),
    groups: distribution(
      grouped.get(report.report_id) || [],
      report.exchange_rates,
      currency,
      "asset_type_id",
    ),
  }));
  const seriesIds = [
    ...new Set(
      reports.flatMap((report) =>
        (grouped.get(report.report_id) || []).map((record) => record.asset_type_id),
      ),
    ),
  ];
  const missing = points.reduce((count, point) => count + point.missing, 0);
  const chartOptions = {
    animation: false,
    color: ["#28765a", "#5c84c3", "#c99736", "#a775aa", "#64a6a2"],
    tooltip: {
      trigger: "axis",
      valueFormatter: (value: number) => `${number(value, decimals)} ${currencyName}`,
    },
    legend: { top: 0, type: "scroll" },
    grid: { left: 80, right: 30, top: 50, bottom: 80 },
    xAxis: { type: "time", splitNumber: 4, axisLabel: { hideOverlap: true } },
    yAxis: { type: "value", name: currencyName },
    dataZoom: [{ type: "inside" }, { type: "slider", bottom: 8 }],
    series: [
      ...seriesIds.map((id) => ({
        id,
        name:
          metadata.asset_types.find((item) => item.asset_type_id === id)?.name ||
          "Missing asset type",
        type: "line",
        stack: "assets",
        stackStrategy: "samesign",
        areaStyle: { opacity: 0.6 },
        ...(metadata.asset_types.some(
          (item) => item.asset_type_id === id && /^[0-9A-F]{6}$/.test(item.color),
        )
          ? {
              itemStyle: {
                color: `#${metadata.asset_types.find((item) => item.asset_type_id === id)!.color}`,
              },
            }
          : {}),
        connectNulls: false,
        symbolSize: 7,
        data: points.map((point) => [
          Date.parse(point.report.report_time),
          point.missing ? null : point.groups.values.get(id) || 0,
        ]),
      })),
      {
        id: "total",
        name: "Total",
        type: "line",
        connectNulls: false,
        symbolSize: 6,
        itemStyle: { color: "#24352f" },
        lineStyle: { width: 2, type: "dashed" },
        data: points.map((point) => [
          Date.parse(point.report.report_time),
          point.missing ? null : point.amounts.get(currency)?.effective || 0,
        ]),
      },
    ],
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
            placeholder="From date"
            value={from}
            onChange={(value) => setFrom(String(value || ""))}
          />
          <DatePicker
            clearable
            placeholder="Through date"
            value={through}
            onChange={(value) => setThrough(String(value || ""))}
          />
          <Button variant="text" onClick={() => selectRange("ytd")}>
            YTD
          </Button>
          <Button variant="text" onClick={() => selectRange("year")}>
            Last 1 year
          </Button>
          <Button
            variant="text"
            onClick={() => {
              setFrom("");
              setThrough("");
            }}
          >
            All time
          </Button>
          <Button
            variant="outline"
            icon={<RefreshIcon />}
            aria-label="Refresh"
            title="Refresh"
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
            placeholder="Choose reports"
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
          <Button variant="text" onClick={() => setSelected(null)}>
            Select all in date range
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
        {from && through && from > through && (
          <Alert theme="warning" message="The start date is after the end date." />
        )}
        {missing > 0 && (
          <Alert
            theme="warning"
            message={`${missing} record(s) cannot be valued. Affected converted report totals appear as gaps in the chart rather than misleading partial values.`}
          />
        )}
        <Loading loading={state.loading}>
          <Chart
            option={chartOptions}
            label="Effective asset value stacked by asset type over time"
          />
        </Loading>
        <Space>
          <span className="muted">{reports.length} reports · Dashed line: total</span>
        </Space>
      </Card>
      <Card title="Report values">
        <Table
          rowKey="report_id"
          data={points.map((point) => ({
            report_id: point.report.report_id,
            title: reportTitle(point.report),
            date: point.report.report_time,
            values: point,
          }))}
          columns={[
            { colKey: "title", title: "Report" },
            {
              colKey: "date",
              title: "Report time",
              cell: ({ row }) => new Date(row.date).toLocaleString(),
            },
            {
              colKey: "values",
              title: "Effective value",
              cell: ({ row }) =>
                row.values.missing && currency
                  ? "Incomplete — missing conversion or invalid data"
                  : [...row.values.amounts]
                      .map(
                        ([id, value]) =>
                          `${number(value.effective, decimals)} ${metadata.currencies.find((item) => item.currency_id === id)?.name || "Missing currency"}`,
                      )
                      .join(" · ") || "0",
            },
          ]}
          empty="Choose reports to compare."
          pagination={{ total: points.length, defaultPageSize: 20 }}
        />
      </Card>
    </div>
  );
}
