// SPDX-License-Identifier: MulanPSL-2.0
import { Alert, Card, Empty } from "tdesign-react";
import { chartCurrency, distribution, number } from "../calculations";
import { useMetadata } from "../metadata";
import type { AssetRecord, ExchangeRate } from "../types";
import { Chart } from "./Chart";

export function ReportDistribution({
  records,
  rates,
  selectedCurrency,
  decimals,
}: {
  records: AssetRecord[];
  rates: ExchangeRate[];
  selectedCurrency: string;
  decimals: number;
}) {
  const { metadata } = useMetadata();
  const currency = chartCurrency(metadata, selectedCurrency);
  const currencyName =
    metadata.currencies.find((item) => item.currency_id === currency)?.name || "No currency";
  return (
    <div className="distribution-grid">
      {(["institution_id", "asset_type_id"] as const).map((group) => {
        const result = distribution(records, rates, currency, group);
        const negative = [...result.values.values()].some((value) => value < 0);
        const data = [...result.values]
          .filter(([, value]) => value > 0)
          .map(([id, value]) => {
            const asset = metadata.asset_types.find((item) => item.asset_type_id === id);
            return {
              name:
                group === "asset_type_id"
                  ? asset?.name || "Missing asset type"
                  : metadata.institutions.find((item) => item.institution_id === id)?.name ||
                    "Missing institution",
              value,
              ...(group === "asset_type_id" && asset && /^[0-9A-F]{6}$/.test(asset.color)
                ? { itemStyle: { color: `#${asset.color}` } }
                : {}),
            };
          });
        const label =
          group === "asset_type_id" ? "Distribution by asset type" : "Distribution by institution";
        return (
          <Card title={label} key={group}>
            <p className="muted">Effective value · {currencyName} · Current filters</p>
            {result.missing ? (
              <Alert
                theme="warning"
                message={`${result.missing} record(s) cannot be converted. Configure exchange rates to show a complete distribution.`}
              />
            ) : negative ? (
              <Alert
                theme="info"
                message="This view includes negative group totals, which cannot be represented as pie slices. The record totals include them."
              />
            ) : !data.length ? (
              <Empty description="No positive values in this view" />
            ) : (
              <Chart
                label={label}
                option={{
                  animation: false,
                  tooltip: {
                    trigger: "item",
                    valueFormatter: (value: number) => `${number(value, decimals)} ${currencyName}`,
                  },
                  legend: { type: "scroll", bottom: 0 },
                  series: [
                    {
                      type: "pie",
                      radius: ["35%", "62%"],
                      center: ["50%", "44%"],
                      label: { formatter: "{b}: {d}%" },
                      data,
                    },
                  ],
                }}
              />
            )}
          </Card>
        );
      })}
    </div>
  );
}
