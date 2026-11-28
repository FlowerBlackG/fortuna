// SPDX-License-Identifier: MulanPSL-2.0
import { t } from "../i18n";
import { Empty } from "tdesign-react";
import type { ECharts, ECElementEvent } from "echarts/core";
import { format } from "echarts/core";
import { Chart } from "./Chart";
import { useResolvedTheme } from "../theme";

interface Snapshot {
  title: string;
  time: number;
  values: Map<string, number>;
  total: number | null;
}

interface ChartProps {
  points: Snapshot[];
  groups: { id: string; name: string; color: string }[];
  groupLabel: string;
  currencyName: string;
  money: (value: number) => string;
}

const tooltip = {
  renderMode: "html",
  appendTo: "body",
  confine: false,
  transitionDuration: 0,
  hideDelay: 0,
  className: "analysis-tooltip",
};

type TooltipRow = [name: string, value: string, color?: string];

function tooltipCard(title: string, rows: TooltipRow[], total: string) {
  const card = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = title;
  card.append(heading);
  for (const [name, value, color] of rows.concat([[t("Total"), total]])) {
    const row = document.createElement("div");
    if (color) {
      const dot = document.createElement("span");
      dot.className = "analysis-tooltip-dot";
      dot.style.backgroundColor = color;
      row.append(dot);
    }
    row.append(`${name}: ${value}`);
    card.append(row);
  }
  return card;
}

export function StackedChart({ points, groups, groupLabel, currencyName, money }: ChartProps) {
  const totalColor = useResolvedTheme() === "dark" ? "#d9e8df" : "#24352f";
  function bindEvents(chart: ECharts) {
    let visible = groups;
    const hide = () => chart.dispatchAction({ type: "hideTip" });
    const legendChange = (event: unknown) => {
      const { selected } = event as { selected: Record<string, boolean> };
      visible = groups.filter((group) => selected[group.name] !== false);
      hide();
    };
    function hover({ event, seriesIndex, dataIndex }: ECElementEvent) {
      if (!event || seriesIndex === undefined || !points.length) return;
      const x = event.offsetX;
      const y = event.offsetY;
      const time = chart.convertFromPixel({ xAxisIndex: 0 }, x);
      const point =
        points[dataIndex] ??
        points.reduce((nearest, p) =>
          Math.abs(p.time - time) < Math.abs(nearest.time - time) ? p : nearest,
        );
      if (point.total === null) return hide();
      const hovered = groups[seriesIndex];
      const bands = visible.filter((group) => group === hovered || point.values.get(group.id));
      const negatives = bands.filter((group) => (point.values.get(group.id) ?? 0) < 0).reverse();
      const ordered = negatives.concat(
        bands.filter((group) => (point.values.get(group.id) ?? 0) >= 0),
      );
      let center = ordered.indexOf(hovered);
      if (center === -1) {
        // The dashed total can cross a band or cover the top symbol of a single report.
        const level = chart.convertFromPixel({ yAxisIndex: 0 }, y);
        let upper = negatives.reduce((sum, group) => sum + point.values.get(group.id)!, 0);
        center = ordered.findIndex(
          (group) => (upper += Math.abs(point.values.get(group.id) ?? 0)) >= level,
        );
        if (center === -1) center = ordered.length - 1;
      }
      const start = Math.max(0, Math.min(center - 1, ordered.length - 3));
      const neighbors = ordered.slice(start, start + 3).reverse();
      const total = money(point.total);
      chart.dispatchAction({
        type: "showTip",
        x,
        y,
        tooltip: {
          formatter: () =>
            tooltipCard(
              point.title,
              neighbors.map((group) => [
                group.name,
                money(point.values.get(group.id) ?? 0),
                group.color,
              ]),
              total,
            ),
        },
      });
    }
    chart.on("mousemove", "series.line", hover);
    function legendHover({ value, event }: ECElementEvent) {
      if (!event || typeof value !== "string") return;
      const text = document.createElement("div");
      text.style.whiteSpace = "pre-line";
      text.textContent = value;
      chart.dispatchAction({
        type: "showTip",
        x: event.offsetX,
        y: event.offsetY,
        tooltip: { formatter: () => text },
      });
    }
    chart.on("mousemove", "legend", legendHover);
    chart.on("mouseout", hide);
    chart.getZr().on("globalout", hide);
    chart.on("legendselectchanged", legendChange);
    return () => {
      chart.off("mousemove", hover);
      chart.off("mousemove", legendHover);
      chart.off("mouseout", hide);
      chart.getZr()?.off("globalout", hide);
      chart.off("legendselectchanged", legendChange);
    };
  }
  return (
    <Chart
      label={t("Effective asset value stacked by {0} over time", groupLabel)}
      bindEvents={bindEvents}
      option={{
        animation: false,
        tooltip: { ...tooltip, triggerOn: "none" },
        legend: {
          type: "scroll",
          top: 0,
          left: 8,
          right: 8,
          triggerEvent: true,
          formatter: (name: string) => {
            const [first, ...rest] = name.trim().split(/[\r\n]+/);
            return format.truncateText(
              rest.length ? `${first}...` : first,
              120,
              "12px sans-serif",
              "...",
            );
          },
        },
        grid: { left: 80, right: 30, top: 50, bottom: 80 },
        xAxis: { type: "time", splitNumber: 4, axisLabel: { hideOverlap: true } },
        yAxis: { type: "value", name: currencyName },
        dataZoom: [{ type: "inside" }, { type: "slider", bottom: 8 }],
        series: [
          ...groups.map(({ id, name, color }) => ({
            id,
            name,
            type: "line",
            triggerEvent: true,
            stack: "assets",
            stackStrategy: "samesign",
            areaStyle: { opacity: 0.6 },
            itemStyle: { color },
            symbolSize: 7,
            data: points.map((p) => [p.time, p.total === null ? null : (p.values.get(id) ?? 0)]),
          })),
          {
            id: "total",
            name: t("Total"),
            type: "line",
            triggerEvent: true,
            symbolSize: 6,
            itemStyle: { color: totalColor },
            lineStyle: { width: 2, type: "dashed" },
            data: points.map((p) => [p.time, p.total]),
          },
        ],
      }}
    />
  );
}

export function ReportSankey({ points, groups, groupLabel, money }: ChartProps) {
  const totalColor = useResolvedTheme() === "dark" ? "#d9e8df" : "#24352f";
  const single = points.length === 1;
  const nodes = [];
  const links = [];
  const titles = points.map((p) => p.title);
  if (single) titles.push(groupLabel[0].toUpperCase() + groupLabel.slice(1));
  const hasNegative = points.some(
    (point) => point.total !== null && [...point.values.values()].some((v) => v < 0),
  );
  for (const [index, point] of points.entries()) {
    const depth = single ? 1 : index;
    if (single)
      nodes.push({
        name: "total",
        depth: 0,
        label: { formatter: hasNegative ? t("Absolute balances") : t("Total") },
        itemStyle: { color: totalColor },
        index,
      });
    let empty = true;
    for (const group of groups) {
      const value = point.values.get(group.id);
      if (point.total === null || !value) continue;
      empty = false;
      const name = `${index}/${group.id}`;
      nodes.push({
        name,
        value: Math.abs(value),
        depth,
        index,
        group,
        itemStyle: { color: group.color },
        label: {
          formatter: () => (value < 0 ? `− ${group.name}` : group.name),
          position: depth === titles.length - 1 ? "left" : "right",
        },
      });
      const prev = points[index - 1];
      const previousValue = prev?.values.get(group.id) ?? 0;
      if (
        single ||
        (prev && prev.total !== null && Math.sign(previousValue) === Math.sign(value))
      ) {
        links.push({
          source: single ? "total" : `${index - 1}/${group.id}`,
          target: name,
          value: single ? Math.abs(value) : Math.min(Math.abs(value), Math.abs(previousValue)),
          index,
          group,
          lineStyle: { color: group.color },
        });
      }
    }
    // Keep empty report columns at their chronological depth, including the last one.
    if (empty)
      nodes.push({
        name: `empty/${index}`,
        value: 0,
        depth,
        index,
        label: { show: false },
        tooltip: { show: false },
      });
  }
  if (!nodes.some((node) => node.value)) {
    return (
      <Empty
        description={
          points.length
            ? t("No valued balances in the selected reports")
            : t("Choose reports to compare.")
        }
      />
    );
  }
  function formatTip({
    dataType,
    data,
  }: {
    dataType: string;
    data: { index: number; group?: ChartProps["groups"][number] };
  }) {
    const { index, group } = data;
    const reports =
      dataType === "edge" && !single ? points.slice(index - 1, index + 1) : [points[index]];
    const values = (get: (point: Snapshot) => number) =>
      reports.map((p) => money(get(p))).join(" → ");
    return tooltipCard(
      reports.map((p) => p.title).join(" → "),
      group ? [[group.name, values((p) => p.values.get(group.id)!)]] : [],
      values((p) => p.total!),
    );
  }
  const maxGroups = Math.max(...points.map((point) => point.values.size));
  return (
    <>
      <div className="sankey-scroll">
        <div style={{ minWidth: titles.length * 110 }}>
          <div className="sankey-headings">
            {titles.map((title, i) => (
              <span
                key={i}
                title={title}
                style={{
                  left: `${(100 * i) / (titles.length - 1)}%`,
                  maxWidth: `${100 / titles.length}%`,
                }}
              >
                {title}
              </span>
            ))}
          </div>
          <Chart
            label={t("Report Sankey by {0}", groupLabel)}
            style={{ minHeight: maxGroups * 16 + 40 }}
            option={{
              animation: false,
              tooltip: { ...tooltip, trigger: "item", formatter: formatTip },
              series: [
                {
                  type: "sankey",
                  left: 6,
                  right: 6,
                  top: 12,
                  bottom: 12,
                  nodeWidth: 14,
                  nodeGap: 5,
                  nodeAlign: "left",
                  layoutIterations: 0,
                  draggable: false,
                  labelLayout: { hideOverlap: true },
                  emphasis: { focus: "trajectory" },
                  data: nodes,
                  links,
                },
              ],
            }}
          />
        </div>
      </div>
    </>
  );
}
