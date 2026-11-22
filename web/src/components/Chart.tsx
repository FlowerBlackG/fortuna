// SPDX-License-Identifier: MulanPSL-2.0
import { useEffect, useRef, type CSSProperties } from "react";
import * as echarts from "echarts/core";
import type { EChartsCoreOption } from "echarts/core";
import { useLanguage } from "../i18n";
import { useResolvedTheme } from "../theme";
import { LineChart, PieChart, SankeyChart } from "echarts/charts";
import { LabelLayout } from "echarts/features";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DataZoomComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  PieChart,
  SankeyChart,
  LabelLayout,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

export function Chart({
  option,
  label,
  style,
  bindEvents,
}: {
  option: EChartsCoreOption;
  label: string;
  style?: CSSProperties;
  bindEvents?: (chart: echarts.ECharts) => () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const language = useLanguage();
  const theme = useResolvedTheme();
  useEffect(() => {
    const chart = echarts.init(element.current!, theme === "dark" ? "dark" : undefined, {
      locale: language === "zh-CN" ? "ZH" : "EN",
    });
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const container = element.current;
        if (
          container &&
          (chart.getWidth() !== container.clientWidth ||
            chart.getHeight() !== container.clientHeight)
        )
          chart.resize();
      });
    });
    observer.observe(element.current!);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      chart.dispose();
    };
  }, [language, theme]);
  useEffect(() => {
    const chart = echarts.getInstanceByDom(element.current!)!;
    chart.setOption({ backgroundColor: "transparent", ...option }, true);
    const unbind = bindEvents?.(chart);
    return () => {
      if (!chart.isDisposed()) unbind?.();
    };
  }, [option, bindEvents, language, theme]);
  return <div className="chart" style={style} ref={element} role="img" aria-label={label} />;
}
